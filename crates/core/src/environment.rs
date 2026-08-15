use crate::{
    copy_dir, list_remotes, load_config, remote_scan_hub, safe_skill_dir_name, scan_skill_root,
    unlink_skill, EnvironmentKind::Local, RemoteHost, REMOTE_HUB_DIR, REMOTE_HUB_SHELL_DIR,
};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::Path,
    process::Command,
};
use tempfile::TempDir;
use walkdir::WalkDir;

/// 可以独立管理 Skill 的运行环境类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnvironmentKind {
    /// 当前运行 skills-hub 的本机。
    Local,
    /// 通过 SSH 连接的另一台电脑。
    Remote,
}

/// 环境在桌面端侧栏中的摘要。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentSummary {
    /// 稳定环境 ID；本机为 `local`，远端为 `remote:<name>`。
    pub id: String,
    /// 用户可读名称。
    pub name: String,
    /// 环境类型。
    pub kind: EnvironmentKind,
    /// SSH host；本机为空。
    pub host: Option<String>,
    /// SSH 用户；本机为空。
    pub user: Option<String>,
    /// SSH 端口；本机为空。
    pub port: Option<u16>,
}

impl EnvironmentSummary {
    /// 创建本机环境摘要。
    pub fn local() -> Self {
        Self {
            id: "local".to_string(),
            name: "本机".to_string(),
            kind: EnvironmentKind::Local,
            host: None,
            user: None,
            port: None,
        }
    }

    /// 从远程连接配置创建环境摘要。
    pub fn remote(remote: RemoteHost) -> Self {
        Self {
            id: format!("remote:{}", remote.name),
            name: remote.name,
            kind: EnvironmentKind::Remote,
            host: Some(remote.host),
            user: remote.user,
            port: remote.port,
        }
    }
}

/// 列出本机和所有已登记 SSH 环境。
pub fn list_environments() -> Result<Vec<EnvironmentSummary>> {
    let mut environments = vec![EnvironmentSummary::local()];
    environments.extend(list_remotes()?.into_iter().map(EnvironmentSummary::remote));
    Ok(environments)
}

/// 根据稳定 ID 找到环境配置。
pub fn get_environment(id: &str) -> Result<EnvironmentSummary> {
    if id == "local" {
        return Ok(EnvironmentSummary::local());
    }
    let Some(name) = id.strip_prefix("remote:") else {
        return Err(anyhow!("invalid environment id: {id}"));
    };
    list_remotes()?
        .into_iter()
        .find(|remote| remote.name == name)
        .map(EnvironmentSummary::remote)
        .ok_or_else(|| anyhow!("environment not found: {id}"))
}

/// 两个环境中同名 Skill 的比较状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EnvironmentCompareStatus {
    /// 两侧目录内容一致。
    Identical,
    /// 只存在于来源环境。
    SourceOnly,
    /// 只存在于目标环境。
    TargetOnly,
    /// 两侧同名但目录内容不同。
    Different,
}

/// 跨环境比较中的单个 Skill。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentCompareItem {
    /// Skill 目录名。
    pub skill_name: String,
    /// 比较状态。
    pub status: EnvironmentCompareStatus,
    /// 来源环境路径。
    pub source_path: Option<String>,
    /// 目标环境路径。
    pub target_path: Option<String>,
}

/// 两个独立环境的 Hub 比较结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentCompareResult {
    /// 来源环境。
    pub source: EnvironmentSummary,
    /// 目标环境。
    pub target: EnvironmentSummary,
    /// Skill 比较列表。
    pub items: Vec<EnvironmentCompareItem>,
}

/// 跨环境传输结果状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EnvironmentTransferStatus {
    /// 已完成复制。
    Transferred,
    /// 目标已存在，等待用户确认。
    Conflict,
    /// 预演模式，没有写文件。
    DryRun,
}

/// 单个 Skill 的跨环境传输结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentTransferResult {
    /// 来源环境。
    pub source: EnvironmentSummary,
    /// 目标环境。
    pub target: EnvironmentSummary,
    /// Skill 目录名。
    pub skill_name: String,
    /// 传输状态。
    pub status: EnvironmentTransferStatus,
    /// 覆盖前备份路径。
    pub backup_path: Option<String>,
}

/// 将 Skill 移入当前环境回收区后的结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentTrashResult {
    /// Skill 所属环境。
    pub environment: EnvironmentSummary,
    /// Skill 目录名。
    pub skill_name: String,
    /// 可用于手动恢复的回收区路径。
    pub trash_path: String,
}

#[derive(Debug, Clone)]
struct EnvironmentSkillEntry {
    path: String,
    content_hash: String,
}

/// 比较两个环境的 Hub 内容。
pub fn compare_environments(source_id: &str, target_id: &str) -> Result<EnvironmentCompareResult> {
    if source_id == target_id {
        return Err(anyhow!("source and target environments must differ"));
    }
    let source = get_environment(source_id)?;
    let target = get_environment(target_id)?;
    let source_entries = environment_hub_entries(&source)?;
    let target_entries = environment_hub_entries(&target)?;
    let names = source_entries
        .keys()
        .chain(target_entries.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let items = names
        .into_iter()
        .map(|skill_name| {
            let source_entry = source_entries.get(&skill_name);
            let target_entry = target_entries.get(&skill_name);
            let status = match (source_entry, target_entry) {
                (Some(source_entry), Some(target_entry))
                    if source_entry.content_hash == target_entry.content_hash =>
                {
                    EnvironmentCompareStatus::Identical
                }
                (Some(_), Some(_)) => EnvironmentCompareStatus::Different,
                (Some(_), None) => EnvironmentCompareStatus::SourceOnly,
                (None, Some(_)) => EnvironmentCompareStatus::TargetOnly,
                (None, None) => unreachable!(),
            };
            EnvironmentCompareItem {
                skill_name,
                status,
                source_path: source_entry.map(|entry| entry.path.clone()),
                target_path: target_entry.map(|entry| entry.path.clone()),
            }
        })
        .collect();
    Ok(EnvironmentCompareResult {
        source,
        target,
        items,
    })
}

/// 安全复制一个 Skill 到另一环境；目标冲突时默认停止，强制覆盖前先备份。
pub fn transfer_environment_skill(
    source_id: &str,
    target_id: &str,
    skill_name: &str,
    force: bool,
    dry_run: bool,
) -> Result<EnvironmentTransferResult> {
    if source_id == target_id {
        return Err(anyhow!("source and target environments must differ"));
    }
    let dir_name = safe_skill_dir_name(skill_name)?;
    let source = get_environment(source_id)?;
    let target = get_environment(target_id)?;
    let source_entries = environment_hub_entries(&source)?;
    let source_entry = source_entries
        .get(&dir_name)
        .ok_or_else(|| anyhow!("skill not found in source environment: {dir_name}"))?;
    let target_entries = environment_hub_entries(&target)?;
    if target_entries.contains_key(&dir_name) && !force {
        return Ok(EnvironmentTransferResult {
            source,
            target,
            skill_name: dir_name,
            status: EnvironmentTransferStatus::Conflict,
            backup_path: None,
        });
    }
    if dry_run {
        return Ok(EnvironmentTransferResult {
            source,
            target,
            skill_name: dir_name,
            status: EnvironmentTransferStatus::DryRun,
            backup_path: None,
        });
    }

    let temporary = TempDir::new()?;
    let staged = temporary.path().join(&dir_name);
    stage_environment_skill(&source, &source_entry.path, &staged)?;
    let backup_path = prepare_environment_target(&target, &dir_name, force)?;
    write_environment_skill(&target, &dir_name, &staged)?;
    Ok(EnvironmentTransferResult {
        source,
        target,
        skill_name: dir_name,
        status: EnvironmentTransferStatus::Transferred,
        backup_path,
    })
}

/// 将当前环境 Hub 中的 Skill 移入回收区，而不是物理删除。
///
/// 本机会先解除由 skills-hub 管理的 Agent 链接或副本；SSH 环境只移除
/// 明确指向该 Hub Skill 的符号链接，未知真实目录保持不动。
pub fn trash_environment_skill(
    environment_id: &str,
    skill_name: &str,
    dry_run: bool,
) -> Result<EnvironmentTrashResult> {
    let environment = get_environment(environment_id)?;
    let dir_name = safe_skill_dir_name(skill_name)?;
    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S-%3f").to_string();

    let trash_path = match environment.kind {
        Local => {
            let config = load_config()?;
            let info = scan_skill_root(&config.hub_dir)?
                .into_iter()
                .find(|skill| skill.dir_name == dir_name || skill.name == skill_name)
                .ok_or_else(|| anyhow!("skill not found in environment: {dir_name}"))?;
            let hub = fs::canonicalize(&config.hub_dir)?;
            let parent = info
                .path
                .parent()
                .ok_or_else(|| anyhow!("invalid skill path: {}", info.path.display()))?;
            if fs::canonicalize(parent)? != hub {
                return Err(anyhow!(
                    "refuse to trash skill outside hub: {}",
                    info.path.display()
                ));
            }
            let trash = config
                .backups_dir
                .join("trash")
                .join(&timestamp)
                .join(&dir_name);
            if !dry_run {
                let agents = config
                    .agents
                    .values()
                    .filter(|agent| agent.enabled)
                    .map(|agent| agent.kind.clone())
                    .collect::<Vec<_>>();
                unlink_skill(&dir_name, &agents, false)?;
                if let Some(parent) = trash.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::rename(&info.path, &trash)?;
            }
            trash.display().to_string()
        }
        EnvironmentKind::Remote => {
            let (_, skills) = remote_scan_hub(&environment.name)?;
            let skill = skills
                .into_iter()
                .find(|skill| skill.dir_name == dir_name || skill.name == skill_name)
                .ok_or_else(|| anyhow!("skill not found in environment: {dir_name}"))?;
            let trash = format!(
                "~/.config/skills-hub/backups/trash/{timestamp}/{}",
                skill.dir_name
            );
            if !dry_run {
                let script = format!(
                    r#"set -eu
target="{REMOTE_HUB_SHELL_DIR}/{dir_name}"
trash="$HOME/.config/skills-hub/backups/trash/{timestamp}/{dir_name}"
if [ ! -e "$target" ] && [ ! -L "$target" ]; then
  echo "skill does not exist: $target" >&2
  exit 2
fi
hub_real=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$target")
for root in "$HOME/.codex/skills" "$HOME/.claude/skills" "$HOME/.cursor/skills" "$HOME/.openclaw/skills"; do
  agent_path="$root/{dir_name}"
  if [ -L "$agent_path" ]; then
    link_real=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$agent_path")
    if [ "$link_real" = "$hub_real" ]; then
      rm "$agent_path"
    fi
  fi
done
mkdir -p "$(dirname "$trash")"
mv "$target" "$trash"
printf '%s' "$trash""#,
                    dir_name = skill.dir_name,
                );
                run_environment_ssh(&environment, &script)?;
            }
            trash
        }
    };

    Ok(EnvironmentTrashResult {
        environment,
        skill_name: dir_name,
        trash_path,
    })
}

fn environment_hub_entries(
    environment: &EnvironmentSummary,
) -> Result<BTreeMap<String, EnvironmentSkillEntry>> {
    match environment.kind {
        Local => {
            let config = load_config()?;
            scan_skill_root(&config.hub_dir)?
                .into_iter()
                .map(|skill| {
                    let source = skill.symlink_target.unwrap_or(skill.path);
                    let content_hash = hash_directory(&source)?;
                    Ok((
                        skill.dir_name,
                        EnvironmentSkillEntry {
                            path: source.display().to_string(),
                            content_hash,
                        },
                    ))
                })
                .collect()
        }
        EnvironmentKind::Remote => {
            let (_, skills) = remote_scan_hub(&environment.name)?;
            Ok(skills
                .into_iter()
                .map(|skill| {
                    (
                        skill.dir_name,
                        EnvironmentSkillEntry {
                            path: skill.symlink_target.unwrap_or(skill.path),
                            content_hash: skill.content_hash.unwrap_or_default(),
                        },
                    )
                })
                .collect())
        }
    }
}

fn hash_directory(root: &Path) -> Result<String> {
    let mut files = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| {
            !entry
                .path()
                .components()
                .any(|part| part.as_os_str() == ".git")
        })
        .collect::<Vec<_>>();
    files.sort_by_key(|entry| entry.path().to_path_buf());
    let mut digest = Sha256::new();
    for entry in files {
        let relative = entry.path().strip_prefix(root).unwrap_or(entry.path());
        digest.update(relative.to_string_lossy().as_bytes());
        let mut file = fs::File::open(entry.path())?;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            digest.update(&buffer[..read]);
        }
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn stage_environment_skill(
    environment: &EnvironmentSummary,
    source_path: &str,
    staged: &Path,
) -> Result<()> {
    match environment.kind {
        Local => copy_dir(Path::new(source_path), staged, false),
        EnvironmentKind::Remote => {
            let mut command = Command::new("rsync");
            command.arg("-az");
            add_rsync_port(&mut command, environment);
            command.arg(format!(
                "{}:{}/",
                environment_remote_spec(environment)?,
                source_path
            ));
            command.arg(format!("{}/", staged.display()));
            run_checked(command, "download remote skill")
        }
    }
}

fn prepare_environment_target(
    environment: &EnvironmentSummary,
    skill_name: &str,
    force: bool,
) -> Result<Option<String>> {
    prepare_environment_target_for(environment, skill_name, force, "transfers")
}

/// 为一次环境写入准备目标位置；覆盖时把旧内容移动到指定备份分类。
pub(crate) fn prepare_environment_target_for(
    environment: &EnvironmentSummary,
    skill_name: &str,
    force: bool,
    backup_category: &str,
) -> Result<Option<String>> {
    if !force {
        return Ok(None);
    }
    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    match environment.kind {
        Local => {
            let config = load_config()?;
            let target = config.hub_dir.join(skill_name);
            if target.symlink_metadata().is_err() {
                return Ok(None);
            }
            let backup = config
                .backups_dir
                .join(backup_category)
                .join(timestamp)
                .join(skill_name);
            if let Some(parent) = backup.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::rename(target, &backup)?;
            Ok(Some(backup.display().to_string()))
        }
        EnvironmentKind::Remote => {
            let target = format!("{REMOTE_HUB_SHELL_DIR}/{skill_name}");
            let backup = format!(
                "$HOME/.config/skills-hub/backups/{backup_category}/{timestamp}/{skill_name}"
            );
            let script = format!(
                "if [ -e \"{target}\" ] || [ -L \"{target}\" ]; then mkdir -p \"$(dirname \"{backup}\")\"; mv \"{target}\" \"{backup}\"; printf '%s' \"{backup}\"; fi"
            );
            run_environment_ssh(environment, &script)?;
            Ok(Some(backup))
        }
    }
}

/// 判断环境 Hub 的目标目录名是否已经被任意文件、目录或符号链接占用。
pub(crate) fn environment_skill_target_exists(
    environment: &EnvironmentSummary,
    skill_name: &str,
) -> Result<bool> {
    match environment.kind {
        Local => Ok(load_config()?
            .hub_dir
            .join(skill_name)
            .symlink_metadata()
            .is_ok()),
        EnvironmentKind::Remote => {
            let output = run_environment_ssh(
                environment,
                &format!(
                    "if [ -e \"{REMOTE_HUB_SHELL_DIR}/{skill_name}\" ] || [ -L \"{REMOTE_HUB_SHELL_DIR}/{skill_name}\" ]; then printf 1; else printf 0; fi"
                ),
            )?;
            Ok(output == "1")
        }
    }
}

pub(crate) fn write_environment_skill(
    environment: &EnvironmentSummary,
    skill_name: &str,
    staged: &Path,
) -> Result<()> {
    match environment.kind {
        Local => {
            let config = load_config()?;
            let target = config.hub_dir.join(skill_name);
            fs::create_dir(&target).with_context(|| {
                format!("reserve environment skill target {}", target.display())
            })?;
            if let Err(error) = copy_dir(staged, &target, false) {
                let cleanup = fs::remove_dir_all(&target);
                return match cleanup {
                    Ok(()) => Err(error),
                    Err(cleanup_error) => Err(error.context(format!(
                        "cleanup partial target {} also failed: {cleanup_error}",
                        target.display()
                    ))),
                };
            }
            Ok(())
        }
        EnvironmentKind::Remote => {
            run_environment_ssh(
                environment,
                &format!(
                    "mkdir -p \"{REMOTE_HUB_SHELL_DIR}\" && mkdir \"{REMOTE_HUB_SHELL_DIR}/{skill_name}\""
                ),
            )?;
            let mut command = Command::new("rsync");
            command.arg("-az");
            add_rsync_port(&mut command, environment);
            command.arg(format!("{}/", staged.display()));
            command.arg(format!(
                "{}:{REMOTE_HUB_DIR}/{skill_name}/",
                environment_remote_spec(environment)?
            ));
            if let Err(error) = run_checked(command, "upload remote skill") {
                let cleanup = run_environment_ssh(
                    environment,
                    &format!("rm -rf \"{REMOTE_HUB_SHELL_DIR}/{skill_name}\""),
                );
                return match cleanup {
                    Ok(_) => Err(error),
                    Err(cleanup_error) => Err(error.context(format!(
                        "cleanup partial remote target also failed: {cleanup_error}"
                    ))),
                };
            }
            Ok(())
        }
    }
}

/// 清理失败写入并恢复覆盖前的备份；用于需要回滚保护的新导入流程。
pub(crate) fn rollback_environment_target(
    environment: &EnvironmentSummary,
    skill_name: &str,
    backup_path: Option<&str>,
) -> Result<()> {
    match environment.kind {
        Local => {
            let config = load_config()?;
            let target = config.hub_dir.join(skill_name);
            if target.symlink_metadata().is_ok() {
                return Err(anyhow!(
                    "refuse to restore backup over existing target: {}",
                    target.display()
                ));
            }
            if let Some(backup_path) = backup_path {
                fs::rename(backup_path, target)?;
            }
            Ok(())
        }
        EnvironmentKind::Remote => {
            let backup_script = backup_path
                .map(|backup| {
                    format!(
                        "if [ -e \"{REMOTE_HUB_SHELL_DIR}/{skill_name}\" ] || [ -L \"{REMOTE_HUB_SHELL_DIR}/{skill_name}\" ]; then echo 'refuse to restore backup over existing target' >&2; exit 3; fi; if [ -e \"{backup}\" ] || [ -L \"{backup}\" ]; then mv \"{backup}\" \"{REMOTE_HUB_SHELL_DIR}/{skill_name}\"; fi"
                    )
                })
                .unwrap_or_default();
            run_environment_ssh(environment, &backup_script).map(|_| ())
        }
    }
}

fn add_rsync_port(command: &mut Command, environment: &EnvironmentSummary) {
    if let Some(port) = environment.port {
        command.arg("-e").arg(format!("ssh -p {port}"));
    }
}

fn run_environment_ssh(environment: &EnvironmentSummary, script: &str) -> Result<String> {
    let mut command = Command::new("ssh");
    if let Some(port) = environment.port {
        command.args(["-p", &port.to_string()]);
    }
    command.arg(environment_remote_spec(environment)?);
    command.arg(script);
    let output = command.output()?;
    if !output.status.success() {
        return Err(anyhow!(
            "remote command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn environment_remote_spec(environment: &EnvironmentSummary) -> Result<String> {
    let host = environment
        .host
        .as_ref()
        .ok_or_else(|| anyhow!("remote environment is missing host"))?;
    Ok(match &environment.user {
        Some(user) => format!("{user}@{host}"),
        None => host.clone(),
    })
}

fn run_checked(mut command: Command, operation: &str) -> Result<()> {
    let output = command.output()?;
    if output.status.success() {
        return Ok(());
    }
    Err(anyhow!(
        "{operation} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    ))
}
