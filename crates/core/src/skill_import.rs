use crate::{
    environment_skill_target_exists, get_environment, load_config, prepare_environment_target_for,
    rollback_environment_target, safe_skill_dir_name, scan_skill_directory,
    write_environment_skill, EnvironmentKind, EnvironmentSummary, REMOTE_HUB_DIR,
};
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io,
    path::{Path, PathBuf},
};
use tempfile::TempDir;
use walkdir::WalkDir;
use zip::ZipArchive;

const MAX_ZIP_ENTRIES: usize = 10_000;
const MAX_ZIP_UNCOMPRESSED_BYTES: u64 = 256 * 1024 * 1024;
const SYMLINK_FILE_TYPE: u32 = 0o120000;
const FILE_TYPE_MASK: u32 = 0o170000;

/// 用户选择的一次性导入来源类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillImportSourceKind {
    /// 本机目录。
    Directory,
    /// ZIP 压缩包。
    Zip,
}

/// 导入预览中单个 Skill 的可用状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkillImportCandidateStatus {
    /// 可以直接添加。
    Ready,
    /// 当前环境 Hub 已经存在同名目录。
    Conflict,
    /// 名称、目录结构或文件内容不符合导入要求。
    Invalid,
}

/// 用户可在导入弹窗中勾选的 Skill。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillImportCandidate {
    /// 稳定选择 ID，使用来源内规范化相对路径。
    pub id: String,
    /// Skill frontmatter 名称。
    pub name: String,
    /// 导入 Hub 后使用的目录名。
    pub dir_name: String,
    /// 来源内相对路径。
    pub relative_path: String,
    /// Skill 简短描述。
    pub description: Option<String>,
    /// 当前可导入状态。
    pub status: SkillImportCandidateStatus,
    /// 无效或冲突原因。
    pub reason: Option<String>,
}

/// 文件夹或 ZIP 的导入预览。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillImportPreview {
    /// 已规范化的本机来源路径。
    pub source_path: String,
    /// 来源类型。
    pub source_kind: SkillImportSourceKind,
    /// 扫描到的候选 Skill。
    pub skills: Vec<SkillImportCandidate>,
}

/// 单个 Skill 的导入结果状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EnvironmentImportStatus {
    /// 已写入当前环境 Hub。
    Imported,
    /// 目标已存在且本次未覆盖。
    Conflict,
    /// 预演成功，没有写文件。
    DryRun,
}

/// 单个 Skill 写入当前环境后的结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentImportItem {
    /// 预览阶段返回的选择 ID。
    pub skill_id: String,
    /// Skill 名称。
    pub skill_name: String,
    /// 导入状态。
    pub status: EnvironmentImportStatus,
    /// 当前环境中的目标路径。
    pub target_path: String,
    /// 覆盖前备份路径。
    pub backup_path: Option<String>,
}

/// 一次批量 Skill 导入结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentImportResult {
    /// 目标环境。
    pub environment: EnvironmentSummary,
    /// 每个选中 Skill 的处理结果。
    pub items: Vec<EnvironmentImportItem>,
}

struct PreparedImportSource {
    kind: SkillImportSourceKind,
    source_path: PathBuf,
    root: PathBuf,
    _temporary: Option<TempDir>,
}

struct DiscoveredImportSkill {
    candidate: SkillImportCandidate,
    path: PathBuf,
}

/// 扫描一个本机文件夹或 ZIP，并结合目标环境标记同名冲突。
pub fn preview_environment_import(
    environment_id: &str,
    source_path: impl AsRef<Path>,
) -> Result<SkillImportPreview> {
    let environment = get_environment(environment_id)?;
    let prepared = prepare_import_source(source_path.as_ref())?;
    let skills = discover_import_skills(&prepared.root, &environment)?;
    Ok(SkillImportPreview {
        source_path: prepared.source_path.display().to_string(),
        source_kind: prepared.kind,
        skills: skills.into_iter().map(|item| item.candidate).collect(),
    })
}

/// 把预览中选中的 Skill 一次性复制到当前环境 Hub。
///
/// 导入会重新扫描来源并只信任相对路径 ID；同名目标默认返回冲突，`force=true`
/// 时先备份旧目录。写入失败会清理半成品并尽力恢复原备份。
pub fn import_environment_skills(
    environment_id: &str,
    source_path: impl AsRef<Path>,
    skill_ids: &[String],
    force: bool,
    dry_run: bool,
) -> Result<EnvironmentImportResult> {
    if skill_ids.is_empty() {
        bail!("no skills selected");
    }
    let environment = get_environment(environment_id)?;
    let prepared = prepare_import_source(source_path.as_ref())?;
    let discovered = discover_import_skills(&prepared.root, &environment)?;
    let by_id = discovered
        .into_iter()
        .map(|item| (item.candidate.id.clone(), item))
        .collect::<BTreeMap<_, _>>();
    let selected_ids = skill_ids.iter().cloned().collect::<BTreeSet<_>>();
    if selected_ids.len() != skill_ids.len() {
        bail!("duplicate skill selection");
    }

    let mut selected = Vec::new();
    for skill_id in skill_ids {
        let item = by_id
            .get(skill_id)
            .ok_or_else(|| anyhow!("selected skill no longer exists; scan again: {skill_id}"))?;
        if item.candidate.status == SkillImportCandidateStatus::Invalid {
            bail!(
                "cannot import invalid skill {}: {}",
                item.candidate.name,
                item.candidate.reason.as_deref().unwrap_or("invalid skill")
            );
        }
        selected.push(item);
    }

    let mut results = Vec::with_capacity(selected.len());
    for item in selected {
        let candidate = &item.candidate;
        let target_path = environment_target_path(&environment, &candidate.dir_name)?;
        if candidate.status == SkillImportCandidateStatus::Conflict && !force {
            results.push(EnvironmentImportItem {
                skill_id: candidate.id.clone(),
                skill_name: candidate.name.clone(),
                status: EnvironmentImportStatus::Conflict,
                target_path,
                backup_path: None,
            });
            continue;
        }
        if dry_run {
            results.push(EnvironmentImportItem {
                skill_id: candidate.id.clone(),
                skill_name: candidate.name.clone(),
                status: EnvironmentImportStatus::DryRun,
                target_path,
                backup_path: None,
            });
            continue;
        }

        let backup_path = prepare_environment_target_for(
            &environment,
            &candidate.dir_name,
            candidate.status == SkillImportCandidateStatus::Conflict,
            "imports",
        )?;
        if let Err(error) = write_environment_skill(&environment, &candidate.dir_name, &item.path) {
            let rollback = match backup_path.as_deref() {
                Some(backup_path) => rollback_environment_target(
                    &environment,
                    &candidate.dir_name,
                    Some(backup_path),
                ),
                None => Ok(()),
            };
            return match rollback {
                Ok(()) => Err(error.context(format!("import {}", candidate.name))),
                Err(rollback_error) => Err(error.context(format!(
                    "import {}; rollback also failed: {rollback_error}",
                    candidate.name
                ))),
            };
        }
        results.push(EnvironmentImportItem {
            skill_id: candidate.id.clone(),
            skill_name: candidate.name.clone(),
            status: EnvironmentImportStatus::Imported,
            target_path,
            backup_path,
        });
    }

    Ok(EnvironmentImportResult {
        environment,
        items: results,
    })
}

fn prepare_import_source(source_path: &Path) -> Result<PreparedImportSource> {
    let original_metadata = fs::symlink_metadata(source_path)
        .with_context(|| format!("inspect import source {}", source_path.display()))?;
    if original_metadata.file_type().is_symlink() {
        bail!("import source cannot be a symbolic link");
    }
    let source_path = fs::canonicalize(source_path)
        .with_context(|| format!("resolve import source {}", source_path.display()))?;
    let metadata = fs::symlink_metadata(&source_path)?;
    if metadata.is_dir() {
        return Ok(PreparedImportSource {
            kind: SkillImportSourceKind::Directory,
            root: source_path.clone(),
            source_path,
            _temporary: None,
        });
    }
    if !metadata.is_file()
        || !source_path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
    {
        bail!("import source must be a directory or .zip file");
    }

    let temporary = TempDir::new()?;
    extract_zip_safely(&source_path, temporary.path())?;
    Ok(PreparedImportSource {
        kind: SkillImportSourceKind::Zip,
        source_path,
        root: temporary.path().to_path_buf(),
        _temporary: Some(temporary),
    })
}

fn extract_zip_safely(source_path: &Path, target_root: &Path) -> Result<()> {
    let file = File::open(source_path)?;
    let mut archive = ZipArchive::new(file).context("open ZIP archive")?;
    if archive.len() > MAX_ZIP_ENTRIES {
        bail!("ZIP contains too many entries; maximum is {MAX_ZIP_ENTRIES}");
    }
    let mut declared_total = 0_u64;
    let mut written_total = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        if entry.encrypted() {
            bail!("encrypted ZIP entries are not supported: {}", entry.name());
        }
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| anyhow!("unsafe ZIP path: {}", entry.name()))?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & FILE_TYPE_MASK == SYMLINK_FILE_TYPE)
        {
            bail!("ZIP symbolic links are not supported: {}", entry.name());
        }
        declared_total = declared_total
            .checked_add(entry.size())
            .ok_or_else(|| anyhow!("ZIP size overflow"))?;
        if declared_total > MAX_ZIP_UNCOMPRESSED_BYTES {
            bail!("ZIP expands beyond the 256 MiB limit");
        }
        let target = target_root.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut output = File::create(&target)?;
        let written = io::copy(&mut entry, &mut output)?;
        written_total = written_total
            .checked_add(written)
            .ok_or_else(|| anyhow!("ZIP size overflow"))?;
        if written_total > MAX_ZIP_UNCOMPRESSED_BYTES {
            bail!("ZIP expands beyond the 256 MiB limit");
        }
        set_zip_permissions(&target, entry.unix_mode())?;
    }
    Ok(())
}

#[cfg(unix)]
fn set_zip_permissions(path: &Path, mode: Option<u32>) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    if let Some(mode) = mode {
        fs::set_permissions(path, fs::Permissions::from_mode(mode & 0o777))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn set_zip_permissions(_path: &Path, _mode: Option<u32>) -> Result<()> {
    Ok(())
}

fn discover_import_skills(
    root: &Path,
    environment: &EnvironmentSummary,
) -> Result<Vec<DiscoveredImportSkill>> {
    let infos = scan_skill_directory(root)?;
    if infos.is_empty() {
        bail!("no SKILL.md found in import source");
    }
    let mut discovered = Vec::with_capacity(infos.len());
    for info in infos {
        let relative = info
            .path
            .strip_prefix(root)
            .with_context(|| format!("skill is outside import root: {}", info.path.display()))?;
        let id = normalized_relative_path(relative);
        let symlink_error = validate_skill_tree(&info.path)
            .err()
            .map(|error| error.to_string());
        let dir_name_result = safe_skill_dir_name(&info.name);
        let (dir_name, mut status, mut reason) = match dir_name_result {
            Ok(dir_name) => (dir_name, SkillImportCandidateStatus::Ready, None),
            Err(error) => (
                info.dir_name.clone(),
                SkillImportCandidateStatus::Invalid,
                Some(error.to_string()),
            ),
        };
        if let Some(error) = symlink_error {
            status = SkillImportCandidateStatus::Invalid;
            reason = Some(error);
        } else if status != SkillImportCandidateStatus::Invalid
            && environment_skill_target_exists(environment, &dir_name)?
        {
            status = SkillImportCandidateStatus::Conflict;
            reason = Some("current environment already contains this skill".to_string());
        }
        discovered.push(DiscoveredImportSkill {
            candidate: SkillImportCandidate {
                id: id.clone(),
                name: info.name,
                dir_name,
                relative_path: id,
                description: info.description,
                status,
                reason,
            },
            path: info.path,
        });
    }

    let mut counts = BTreeMap::<String, usize>::new();
    for item in &discovered {
        *counts
            .entry(item.candidate.dir_name.to_lowercase())
            .or_default() += 1;
    }
    for item in &mut discovered {
        if counts
            .get(&item.candidate.dir_name.to_lowercase())
            .copied()
            .unwrap_or_default()
            > 1
        {
            item.candidate.status = SkillImportCandidateStatus::Invalid;
            item.candidate.reason =
                Some("multiple skills resolve to the same Hub name".to_string());
        }
    }
    discovered.sort_by(|left, right| {
        left.candidate
            .name
            .to_lowercase()
            .cmp(&right.candidate.name.to_lowercase())
            .then_with(|| left.candidate.id.cmp(&right.candidate.id))
    });
    Ok(discovered)
}

fn validate_skill_tree(root: &Path) -> Result<()> {
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry?;
        if entry.file_type().is_symlink() {
            bail!(
                "symbolic links are not supported in imported skills: {}",
                entry.path().display()
            );
        }
    }
    Ok(())
}

fn normalized_relative_path(path: &Path) -> String {
    if path.as_os_str().is_empty() {
        return ".".to_string();
    }
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn environment_target_path(environment: &EnvironmentSummary, skill_name: &str) -> Result<String> {
    match environment.kind {
        EnvironmentKind::Local => Ok(load_config()?
            .hub_dir
            .join(skill_name)
            .display()
            .to_string()),
        EnvironmentKind::Remote => Ok(format!("{REMOTE_HUB_DIR}/{skill_name}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, sync::Mutex};
    use zip::{write::SimpleFileOptions, ZipWriter};

    static HOME_LOCK: Mutex<()> = Mutex::new(());

    fn with_temp_home<T>(test: impl FnOnce(&Path) -> T) -> T {
        let _guard = HOME_LOCK.lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let previous = std::env::var_os("HOME");
        std::env::set_var("HOME", temp.path());
        let result = test(temp.path());
        if let Some(previous) = previous {
            std::env::set_var("HOME", previous);
        } else {
            std::env::remove_var("HOME");
        }
        result
    }

    fn write_skill(path: &Path, name: &str, body: &str) {
        fs::create_dir_all(path).unwrap();
        fs::write(
            path.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: imported\n---\n{body}"),
        )
        .unwrap();
    }

    #[test]
    fn previews_and_selectively_imports_nested_folder_skills() {
        with_temp_home(|home| {
            crate::init_hub(false).unwrap();
            let source = home.join("shared-skills");
            write_skill(&source.join("alpha"), "alpha", "old");
            write_skill(&source.join("nested/beta"), "beta", "body");

            let preview = preview_environment_import("local", &source).unwrap();
            assert_eq!(preview.skills.len(), 2);
            assert!(preview
                .skills
                .iter()
                .all(|skill| skill.status == SkillImportCandidateStatus::Ready));

            let result = import_environment_skills(
                "local",
                &source,
                &["nested/beta".to_string()],
                false,
                false,
            )
            .unwrap();
            assert_eq!(result.items[0].status, EnvironmentImportStatus::Imported);
            assert!(home.join(".agents/skills/beta/SKILL.md").exists());
            assert!(!home.join(".agents/skills/alpha").exists());
        });
    }

    #[test]
    fn conflict_requires_force_and_force_creates_backup() {
        with_temp_home(|home| {
            crate::init_hub(false).unwrap();
            let source = home.join("incoming/demo");
            let target = home.join(".agents/skills/demo");
            write_skill(&source, "demo", "new");
            write_skill(&target, "demo", "old");

            let preview = preview_environment_import("local", &source).unwrap();
            assert_eq!(
                preview.skills[0].status,
                SkillImportCandidateStatus::Conflict
            );
            let skipped =
                import_environment_skills("local", &source, &[".".to_string()], false, false)
                    .unwrap();
            assert_eq!(skipped.items[0].status, EnvironmentImportStatus::Conflict);
            assert!(fs::read_to_string(target.join("SKILL.md"))
                .unwrap()
                .ends_with("old"));

            let replaced =
                import_environment_skills("local", &source, &[".".to_string()], true, false)
                    .unwrap();
            let backup = PathBuf::from(replaced.items[0].backup_path.as_ref().unwrap());
            assert!(fs::read_to_string(target.join("SKILL.md"))
                .unwrap()
                .ends_with("new"));
            assert!(fs::read_to_string(backup.join("SKILL.md"))
                .unwrap()
                .ends_with("old"));
        });
    }

    #[test]
    fn previews_wrapped_zip_and_rejects_zip_symlink() {
        with_temp_home(|home| {
            crate::init_hub(false).unwrap();
            let archive_path = home.join("skills.zip");
            let file = File::create(&archive_path).unwrap();
            let mut writer = ZipWriter::new(file);
            writer
                .start_file("bundle/demo/SKILL.md", SimpleFileOptions::default())
                .unwrap();
            writer
                .write_all(b"---\nname: demo\ndescription: zip\n---\nbody")
                .unwrap();
            writer.finish().unwrap();

            let preview = preview_environment_import("local", &archive_path).unwrap();
            assert_eq!(preview.source_kind, SkillImportSourceKind::Zip);
            assert_eq!(preview.skills[0].id, "bundle/demo");

            let symlink_zip = home.join("symlink.zip");
            let file = File::create(&symlink_zip).unwrap();
            let mut writer = ZipWriter::new(file);
            writer
                .add_symlink("demo/link", "../outside", SimpleFileOptions::default())
                .unwrap();
            writer.finish().unwrap();
            let error = preview_environment_import("local", &symlink_zip).unwrap_err();
            assert!(error.to_string().contains("symbolic links"));

            let traversal_zip = home.join("traversal.zip");
            let file = File::create(&traversal_zip).unwrap();
            let mut writer = ZipWriter::new(file);
            writer
                .start_file("../outside/SKILL.md", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"---\nname: outside\n---\nbody").unwrap();
            writer.finish().unwrap();
            let error = preview_environment_import("local", &traversal_zip).unwrap_err();
            assert!(error.to_string().contains("unsafe ZIP path"));
        });
    }

    #[test]
    fn duplicate_target_names_are_invalid() {
        with_temp_home(|home| {
            crate::init_hub(false).unwrap();
            let source = home.join("duplicates");
            write_skill(&source.join("one"), "same", "one");
            write_skill(&source.join("two"), "SAME", "two");
            let preview = preview_environment_import("local", &source).unwrap();
            assert!(preview
                .skills
                .iter()
                .all(|skill| skill.status == SkillImportCandidateStatus::Invalid));
        });
    }

    #[cfg(unix)]
    #[test]
    fn failed_overwrite_restores_the_previous_skill() {
        use std::os::unix::fs::PermissionsExt;

        with_temp_home(|home| {
            crate::init_hub(false).unwrap();
            let source = home.join("incoming/demo");
            let target = home.join(".agents/skills/demo");
            write_skill(&source, "demo", "new");
            write_skill(&target, "demo", "old");
            let unreadable = source.join("unreadable.txt");
            fs::write(&unreadable, "blocked").unwrap();
            fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o000)).unwrap();

            let result =
                import_environment_skills("local", &source, &[".".to_string()], true, false);
            fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o600)).unwrap();

            assert!(result.is_err());
            assert!(fs::read_to_string(target.join("SKILL.md"))
                .unwrap()
                .ends_with("old"));
        });
    }
}
