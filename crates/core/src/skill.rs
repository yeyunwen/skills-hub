use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// 从 `SKILL.md` frontmatter 中解析出的元数据。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillMetadata {
    /// skill 展示名称；没有时使用目录名。
    pub name: Option<String>,
    /// skill 简短描述。
    pub description: Option<String>,
}

/// 已扫描到的 skill。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInfo {
    /// skill 名称，优先取 frontmatter `name`。
    pub name: String,
    /// 落盘目录名。
    pub dir_name: String,
    /// skill 根目录。
    pub path: PathBuf,
    /// `SKILL.md` 文件路径。
    pub skill_file: PathBuf,
    /// 描述。
    pub description: Option<String>,
    /// 是否为 symlink。
    pub is_symlink: bool,
    /// symlink 的真实目标。
    pub symlink_target: Option<PathBuf>,
}

/// 解析 `SKILL.md` 的 YAML frontmatter。
pub fn parse_skill_frontmatter(content: &str) -> SkillMetadata {
    let normalized = content.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    if !normalized.starts_with("---\n") {
        return SkillMetadata::default();
    }
    let Some(end) = normalized[4..].find("\n---") else {
        return SkillMetadata::default();
    };
    let yaml = &normalized[4..4 + end];
    serde_yaml::from_str(yaml).unwrap_or_default()
}

/// 读取单个目录下的 skill 信息；目录内必须存在 `SKILL.md`。
pub fn read_skill_info(dir: impl AsRef<Path>) -> Result<Option<SkillInfo>> {
    let dir = dir.as_ref();
    let skill_file = dir.join("SKILL.md");
    if !skill_file.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&skill_file)?;
    let meta = parse_skill_frontmatter(&content);
    let metadata = fs::symlink_metadata(dir)?;
    let is_symlink = metadata.file_type().is_symlink();
    let dir_name = dir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "skill".to_string());
    Ok(Some(SkillInfo {
        name: meta.name.unwrap_or_else(|| dir_name.clone()),
        dir_name,
        path: dir.to_path_buf(),
        skill_file,
        description: meta.description,
        is_symlink,
        symlink_target: if is_symlink {
            fs::canonicalize(dir).ok()
        } else {
            None
        },
    }))
}

/// 扫描目录树中的 skills。
///
/// 与 TS 原型相比，Rust 版这里会递归扫描，便于支持 repo 中 `skills/foo/SKILL.md` 这种结构。
pub fn scan_skill_directory(root: impl AsRef<Path>) -> Result<Vec<SkillInfo>> {
    let root = root.as_ref();
    if !root.exists() {
        return Ok(Vec::new());
    }
    if let Some(info) = read_skill_info(root)? {
        return Ok(vec![info]);
    }
    let mut skills = Vec::new();

    // WalkDir 不跟随 symlink，避免递归扫描时遇到环；但 Agent 目录里的 skill 经常就是
    // `foo -> ~/.agents/skills/foo` 这样的 symlink，所以这里单独识别根目录下一层 symlink。
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') {
            continue;
        }
        if entry.file_type()?.is_symlink() && path.join("SKILL.md").exists() {
            if let Some(info) = read_skill_info(&path)? {
                skills.push(info);
            }
        }
    }

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() || entry.file_name() != "SKILL.md" {
            continue;
        }
        if let Some(parent) = entry.path().parent() {
            let relative_parent = parent.strip_prefix(root).unwrap_or(parent);
            if relative_parent
                .components()
                .any(|part| part.as_os_str().to_string_lossy().starts_with('.'))
            {
                continue;
            }
            if let Some(info) = read_skill_info(parent)? {
                skills.push(info);
            }
        }
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills.dedup_by(|a, b| a.path == b.path);
    Ok(skills)
}

/// 校验 hub 中的目录名，避免路径穿越或隐藏目录。
pub fn safe_skill_dir_name(name: &str) -> Result<String> {
    let value = name.trim();
    let valid = !value.is_empty()
        && !value.starts_with('.')
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if !valid {
        anyhow::bail!("invalid skill name: {name}");
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frontmatter() {
        let meta = parse_skill_frontmatter("---\nname: demo\ndescription: hello\n---\nbody");
        assert_eq!(meta.name.as_deref(), Some("demo"));
        assert_eq!(meta.description.as_deref(), Some("hello"));
    }
}
