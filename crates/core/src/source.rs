use crate::{
    clone_or_update_repo, copy_dir, current_commit, default_source_id, expand_path, load_config,
    parse_git_url, path_exists, safe_skill_dir_name, save_config, scan_skill_directory, HubConfig,
    SkillInfo, SkillSource, SourceKind,
};
use anyhow::{Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 扫描 source 后返回给 CLI/GUI 展示的 skill 信息。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredSkill {
    /// skill 名称。
    pub name: String,
    /// 源 repo 内相对路径。
    pub source_path: PathBuf,
    /// 描述。
    pub description: Option<String>,
    /// 是否已经安装到 hub。
    pub installed: bool,
    /// hub 中的目标路径。
    pub hub_path: PathBuf,
}

/// source scan 的结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceScanResult {
    /// 被扫描的 source。
    pub source: SkillSource,
    /// source 根目录，Git source 对应 cache 目录。
    pub root: PathBuf,
    /// 发现的 skills。
    pub skills: Vec<DiscoveredSkill>,
}

/// 安装 source skill 的选项。
#[derive(Debug, Clone, Default)]
pub struct InstallOptions {
    /// 指定安装的 skill 名称；为空且 all=false 时由 CLI 决定是否交互选择。
    pub skills: Vec<String>,
    /// 是否安装全部 skill。
    pub all: bool,
    /// 是否覆盖 hub 中已存在的同名 skill。
    pub force: bool,
    /// 只输出计划，不写文件。
    pub dry_run: bool,
}

/// 安装结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallResult {
    /// 实际安装或 dry-run 将安装的 skills。
    pub installed: Vec<DiscoveredSkill>,
    /// 跳过的 skills 及原因。
    pub skipped: Vec<(String, String)>,
}

/// 添加 source 到配置。
pub fn add_source(
    id: Option<String>,
    url: String,
    branch: Option<String>,
    dry_run: bool,
) -> Result<SkillSource> {
    let mut config = load_config()?;
    let parsed = parse_git_url(&url);
    let id = id.unwrap_or_else(|| default_source_id(&url));
    let source = SkillSource {
        id: id.clone(),
        url,
        branch,
        kind: parsed.kind,
        skill_count: None,
        last_scan_at: None,
        last_commit: None,
    };
    if !dry_run {
        config.sources.insert(id, source.clone());
        save_config(&config)?;
    }
    Ok(source)
}

/// 列出已登记的 sources。
pub fn list_sources() -> Result<Vec<SkillSource>> {
    Ok(load_config()?.sources.into_values().collect())
}

/// 删除 source 配置；不会删除已经安装到 hub 的 skill。
pub fn remove_source(id: &str, dry_run: bool) -> Result<Option<SkillSource>> {
    let mut config = load_config()?;
    let removed = config.sources.remove(id);
    if !dry_run {
        save_config(&config)?;
    }
    Ok(removed)
}

/// 扫描 source；如果传入的是 URL/路径且尚未登记，会临时扫描但不写配置。
pub fn scan_source(source_ref: &str, dry_run: bool) -> Result<SourceScanResult> {
    let mut config = load_config()?;
    let source = resolve_source(&config, source_ref)?;
    let root = prepare_source_root(&config, &source)?;
    let skills = discovered_from_root(&config, &root)?;

    let mut updated_source = source.clone();
    updated_source.skill_count = Some(skills.len());
    updated_source.last_scan_at = Some(Utc::now().to_rfc3339());
    updated_source.last_commit = current_commit(&root);

    if config.sources.contains_key(&updated_source.id) && !dry_run {
        config
            .sources
            .insert(updated_source.id.clone(), updated_source.clone());
        save_config(&config)?;
    }

    Ok(SourceScanResult {
        source: updated_source,
        root,
        skills,
    })
}

/// 从 source 选择性安装 skill 到 hub。
///
/// 这里是最关键的“repo 预览后选择安装”能力：CLI/GUI 先 scan，再把用户选择传进来。
pub fn install_from_source(source_ref: &str, options: InstallOptions) -> Result<InstallResult> {
    let scan = scan_source(source_ref, options.dry_run)?;
    let selected = select_skills(&scan.skills, &options)?;
    let mut installed = Vec::new();
    let mut skipped = Vec::new();

    for skill in selected {
        if path_exists(&skill.hub_path) && !options.force {
            skipped.push((
                skill.name.clone(),
                "hub already contains this skill; use --force".to_string(),
            ));
            continue;
        }
        if !options.dry_run {
            let source_dir = scan.root.join(&skill.source_path);
            copy_dir(&source_dir, &skill.hub_path, options.force)?;
        }
        installed.push(skill);
    }

    Ok(InstallResult { installed, skipped })
}

fn resolve_source(config: &HubConfig, source_ref: &str) -> Result<SkillSource> {
    if let Some(source) = config.sources.get(source_ref) {
        return Ok(source.clone());
    }
    let parsed = parse_git_url(source_ref);
    let id = default_source_id(source_ref);
    Ok(SkillSource {
        id,
        url: source_ref.to_string(),
        branch: None,
        kind: parsed.kind,
        skill_count: None,
        last_scan_at: None,
        last_commit: None,
    })
}

fn prepare_source_root(config: &HubConfig, source: &SkillSource) -> Result<PathBuf> {
    if source.kind == SourceKind::Local || Path::new(&source.url).exists() {
        return Ok(expand_path(&source.url));
    }
    let cache_dir = config.cache_dir.join(&source.id);
    clone_or_update_repo(&source.url, source.branch.as_deref(), &cache_dir)
        .with_context(|| format!("prepare source {}", source.id))?;
    Ok(cache_dir)
}

fn discovered_from_root(config: &HubConfig, root: &Path) -> Result<Vec<DiscoveredSkill>> {
    let skills = scan_skill_directory(root)?;
    skills
        .into_iter()
        .map(|skill| discovered_from_skill(config, root, skill))
        .collect()
}

fn discovered_from_skill(
    config: &HubConfig,
    root: &Path,
    skill: SkillInfo,
) -> Result<DiscoveredSkill> {
    let dir_name = safe_skill_dir_name(&skill.name)?;
    let hub_path = config.hub_dir.join(dir_name);
    let source_path = skill
        .path
        .strip_prefix(root)
        .unwrap_or(&skill.path)
        .to_path_buf();
    Ok(DiscoveredSkill {
        name: skill.name,
        source_path,
        description: skill.description,
        installed: hub_path.exists(),
        hub_path,
    })
}

fn select_skills(
    skills: &[DiscoveredSkill],
    options: &InstallOptions,
) -> Result<Vec<DiscoveredSkill>> {
    if options.all {
        return Ok(skills.to_vec());
    }
    if options.skills.is_empty() {
        anyhow::bail!("no skills selected; pass --all or --skill <name>");
    }
    let wanted: Vec<String> = options
        .skills
        .iter()
        .map(|value| value.to_lowercase())
        .collect();
    Ok(skills
        .iter()
        .filter(|skill| wanted.contains(&skill.name.to_lowercase()))
        .cloned()
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_id_from_local_path() {
        assert_eq!(default_source_id("/tmp/agent-skills"), "agent-skills");
    }
}
