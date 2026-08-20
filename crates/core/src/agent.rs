use crate::{
    copy_dir, create_relative_symlink, edit_lock, is_symlink_to, load_config, load_lock,
    path_exists, paths_resolve_same, safe_skill_dir_name, scan_skill_root, AgentKind,
    ManagedLinkRecord, MigrationRecord, SkillInfo,
};
use anyhow::Result;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// 同步方式，风格对齐 cc-switch。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SyncMethod {
    /// 默认策略：优先 symlink，失败时 copy。
    #[default]
    Auto,
    /// 强制 symlink；失败直接报错/冲突。
    Symlink,
    /// 强制 copy；适合跨文件系统或不支持 symlink 的环境。
    Copy,
}

impl SyncMethod {
    /// 解析 CLI 参数。
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "auto" => Some(Self::Auto),
            "symlink" => Some(Self::Symlink),
            "copy" => Some(Self::Copy),
            _ => None,
        }
    }

    /// 返回 CLI 展示用名称。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Symlink => "symlink",
            Self::Copy => "copy",
        }
    }
}

/// Agent link/sync 的状态。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LinkStatus {
    /// 已创建 symlink。
    Linked,
    /// 已 copy 到目标目录。
    Copied,
    /// dry-run 下只展示计划。
    DryRun,
    /// 目标存在真实目录或未知文件，拒绝覆盖。
    Conflict,
    /// 已经是正确链接/副本，无需操作。
    Skipped,
    /// 已取消 skills-hub 管理的链接/副本。
    Unlinked,
    /// hub 中找不到该 skill。
    Missing,
}

/// 单个 Agent 的 link/sync 结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkTargetResult {
    /// Agent 类型。
    pub agent: AgentKind,
    /// 状态。
    pub status: LinkStatus,
    /// Agent 侧目标路径。
    pub path: PathBuf,
    /// hub 中真实路径。
    pub target_path: PathBuf,
    /// 实际使用的同步方式。
    pub method: SyncMethod,
    /// 状态原因。
    pub reason: Option<String>,
}

/// 备份并接管 Agent 侧同名目录的结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TakeoverResult {
    /// Agent 类型。
    pub agent: AgentKind,
    /// skill 名称。
    pub skill_name: String,
    /// Agent 侧被接管的路径。
    pub path: PathBuf,
    /// hub 中真实路径。
    pub target_path: PathBuf,
    /// 原始目录的备份路径。
    pub backup_path: PathBuf,
    /// 接管后状态。
    pub status: LinkStatus,
    /// 实际使用的同步方式。
    pub method: SyncMethod,
    /// 状态原因。
    pub reason: Option<String>,
}

/// 从某个 Agent 侧安全移除一个 skill 的结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSkillRemoveResult {
    /// Agent 类型。
    pub agent: AgentKind,
    /// skill 名称。
    pub skill_name: String,
    /// Agent 侧原路径。
    pub path: PathBuf,
    /// 真实目录/文件被移动到的备份路径；symlink 删除时为空。
    pub backup_path: Option<PathBuf>,
    /// 移除后的状态。
    pub status: LinkStatus,
    /// 状态原因。
    pub reason: Option<String>,
}

/// link/copy 一个 hub skill 到多个 Agent。
pub fn link_skill(
    skill_name: &str,
    agents: &[AgentKind],
    force: bool,
    dry_run: bool,
    method: SyncMethod,
) -> Result<Vec<LinkTargetResult>> {
    let config = load_config()?;
    let mut lock = edit_lock(&config)?;
    let hub_skill = find_hub_skill(skill_name)?;
    let Some(hub_skill) = hub_skill else {
        return Ok(agents
            .iter()
            .map(|agent| LinkTargetResult {
                agent: agent.clone(),
                status: LinkStatus::Missing,
                path: config.agents[agent].skills_dir.join(skill_name),
                target_path: config.hub_dir.join(skill_name),
                method,
                reason: Some("skill not found in hub".to_string()),
            })
            .collect());
    };

    let mut results = Vec::new();
    for agent in agents {
        let agent_config = &config.agents[agent];
        let target_path = hub_skill.path.clone();
        let dest_path = agent_config.skills_dir.join(&hub_skill.dir_name);
        let result = sync_one_local_agent(
            agent.clone(),
            &hub_skill.dir_name,
            &target_path,
            &dest_path,
            force,
            dry_run,
            method,
            &mut lock.managed_links,
        )?;
        results.push(result);
    }

    if !dry_run {
        lock.save()?;
    }
    Ok(results)
}

/// 取消一个 hub skill 到多个 Agent 的分发。
pub fn unlink_skill(
    skill_name: &str,
    agents: &[AgentKind],
    dry_run: bool,
) -> Result<Vec<LinkTargetResult>> {
    let config = load_config()?;
    let mut lock = edit_lock(&config)?;
    let hub_skill = find_hub_skill(skill_name)?;
    let target_path = hub_skill
        .as_ref()
        .map(|skill| skill.path.clone())
        .unwrap_or_else(|| config.hub_dir.join(skill_name));
    let dir_name = hub_skill
        .as_ref()
        .map(|skill| skill.dir_name.clone())
        .unwrap_or_else(|| skill_name.to_string());
    let mut results = Vec::new();

    for agent in agents {
        let dest_path = config.agents[agent].skills_dir.join(&dir_name);
        let managed = is_managed_link(
            &lock.managed_links,
            agent,
            &dir_name,
            &dest_path,
            &target_path,
        );

        if !path_exists(&dest_path) {
            results.push(LinkTargetResult {
                agent: agent.clone(),
                status: LinkStatus::Skipped,
                path: dest_path,
                target_path: target_path.clone(),
                method: SyncMethod::Auto,
                reason: Some("target does not exist".to_string()),
            });
            continue;
        }

        if !managed && !is_symlink_to(&dest_path, &target_path)? {
            // 安全保护：取消同步只删除 symlink 或 lock 里明确记录的 copy 副本，绝不删除未知真实目录。
            results.push(LinkTargetResult {
                agent: agent.clone(),
                status: LinkStatus::Conflict,
                path: dest_path,
                target_path: target_path.clone(),
                method: SyncMethod::Auto,
                reason: Some("existing path is not managed by skills-hub".to_string()),
            });
            continue;
        }

        if !dry_run {
            fs::remove_file(&dest_path).or_else(|_| fs::remove_dir_all(&dest_path))?;
            lock.managed_links.retain(|record| {
                !(&record.agent == agent
                    && record.skill_name == dir_name
                    && record.link_path == dest_path)
            });
        }
        results.push(LinkTargetResult {
            agent: agent.clone(),
            status: if dry_run {
                LinkStatus::DryRun
            } else {
                LinkStatus::Unlinked
            },
            path: dest_path,
            target_path: target_path.clone(),
            method: SyncMethod::Auto,
            reason: None,
        });
    }

    if !dry_run {
        lock.save()?;
    }
    Ok(results)
}

/// 同步 hub 中所有 skills 到指定 Agents。
pub fn sync_agents(
    agents: &[AgentKind],
    force: bool,
    dry_run: bool,
    method: SyncMethod,
) -> Result<Vec<LinkTargetResult>> {
    let config = load_config()?;
    let skills = scan_skill_root(&config.hub_dir)?;
    let mut results = Vec::new();
    for skill in skills {
        results.extend(link_skill(&skill.dir_name, agents, force, dry_run, method)?);
    }
    Ok(results)
}

/// 从某个 Agent 目录中安全移除 skill。
///
/// - skills-hub 管理的 symlink：直接删除 symlink。
/// - 真实目录/文件：移动到 backups，避免误删用户内容。
pub fn remove_agent_skill(
    skill_name: &str,
    agent: AgentKind,
    dry_run: bool,
) -> Result<AgentSkillRemoveResult> {
    let config = load_config()?;
    let mut lock = edit_lock(&config)?;
    let dir_name = safe_skill_dir_name(skill_name)?;
    let path = config.agents[&agent].skills_dir.join(&dir_name);

    if !path_exists(&path) {
        return Ok(AgentSkillRemoveResult {
            agent,
            skill_name: dir_name,
            path,
            backup_path: None,
            status: LinkStatus::Missing,
            reason: Some("target does not exist".to_string()),
        });
    }

    let is_symlink = fs::symlink_metadata(&path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false);
    let backup_path = if is_symlink {
        None
    } else {
        let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
        Some(
            config
                .backups_dir
                .join(&timestamp)
                .join(agent.as_str())
                .join(&dir_name),
        )
    };

    if !dry_run {
        if let Some(backup_path) = &backup_path {
            if let Some(parent) = backup_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::rename(&path, backup_path)?;
        } else {
            fs::remove_file(&path).or_else(|_| fs::remove_dir_all(&path))?;
        }
        lock.managed_links.retain(|record| {
            !(record.agent == agent && record.skill_name == dir_name && record.link_path == path)
        });
        lock.save()?;
    }

    Ok(AgentSkillRemoveResult {
        agent,
        skill_name: dir_name,
        path,
        backup_path,
        status: if dry_run {
            LinkStatus::DryRun
        } else {
            LinkStatus::Unlinked
        },
        reason: None,
    })
}

/// 安全接管 Agent 侧同名真实目录：先移动到 backups，再从 hub 启用该 skill。
pub fn takeover_agent_skill(
    skill_name: &str,
    agent: AgentKind,
    dry_run: bool,
    method: SyncMethod,
) -> Result<TakeoverResult> {
    let config = load_config()?;
    let mut lock = edit_lock(&config)?;
    let hub_skill = find_hub_skill(skill_name)?
        .ok_or_else(|| anyhow::anyhow!("skill not found in hub: {skill_name}"))?;
    let agent_config = &config.agents[&agent];
    let dest_path = agent_config.skills_dir.join(&hub_skill.dir_name);

    if !path_exists(&dest_path) {
        anyhow::bail!("target path does not exist: {}", dest_path.display());
    }
    if is_symlink_to(&dest_path, &hub_skill.path)? {
        anyhow::bail!("target is already linked: {}", dest_path.display());
    }

    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_path = config
        .backups_dir
        .join(&timestamp)
        .join(agent.as_str())
        .join(&hub_skill.dir_name);

    let (status, used_method, reason) = if dry_run {
        (LinkStatus::DryRun, method, None)
    } else {
        if let Some(parent) = backup_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&dest_path, &backup_path)?;
        let (status, used_method, reason) = sync_by_method(&hub_skill.path, &dest_path, method)?;
        if matches!(status, LinkStatus::Linked | LinkStatus::Copied) {
            upsert_link(
                &mut lock.managed_links,
                ManagedLinkRecord {
                    agent: agent.clone(),
                    skill_name: hub_skill.dir_name.clone(),
                    link_path: dest_path.clone(),
                    target_path: hub_skill.path.clone(),
                    updated_at: Utc::now().to_rfc3339(),
                },
            );
            lock.save()?;
        }
        (status, used_method, reason)
    };

    Ok(TakeoverResult {
        agent,
        skill_name: hub_skill.dir_name,
        path: dest_path,
        target_path: hub_skill.path,
        backup_path,
        status,
        method: used_method,
        reason,
    })
}

#[allow(clippy::too_many_arguments)]
fn sync_one_local_agent(
    agent: AgentKind,
    skill_name: &str,
    source_path: &Path,
    dest_path: &Path,
    force: bool,
    dry_run: bool,
    method: SyncMethod,
    lock_records: &mut Vec<ManagedLinkRecord>,
) -> Result<LinkTargetResult> {
    if paths_resolve_same(source_path, dest_path)? {
        anyhow::bail!(
            "refuse to sync skill onto itself: {}",
            source_path.display()
        );
    }

    if path_exists(dest_path) && is_symlink_to(dest_path, source_path)? {
        return Ok(LinkTargetResult {
            agent,
            status: LinkStatus::Skipped,
            path: dest_path.to_path_buf(),
            target_path: source_path.to_path_buf(),
            method: SyncMethod::Symlink,
            reason: Some("already linked".to_string()),
        });
    }

    if path_exists(dest_path) {
        let managed = is_managed_link(lock_records, &agent, skill_name, dest_path, source_path);
        if !managed && !force {
            // 保护用户数据：sync 不覆盖未知真实目录，除非用户显式 force。
            return Ok(LinkTargetResult {
                agent: agent.clone(),
                status: LinkStatus::Conflict,
                path: dest_path.to_path_buf(),
                target_path: source_path.to_path_buf(),
                method,
                reason: Some("existing path is not managed by skills-hub".to_string()),
            });
        }
        if !dry_run {
            fs::remove_file(dest_path).or_else(|_| fs::remove_dir_all(dest_path))?;
        }
    }

    let (status, used_method, reason) = if dry_run {
        (LinkStatus::DryRun, method, None)
    } else {
        sync_by_method(source_path, dest_path, method)?
    };

    if !dry_run && matches!(status, LinkStatus::Linked | LinkStatus::Copied) {
        upsert_link(
            lock_records,
            ManagedLinkRecord {
                agent: agent.clone(),
                skill_name: skill_name.to_string(),
                link_path: dest_path.to_path_buf(),
                target_path: source_path.to_path_buf(),
                updated_at: Utc::now().to_rfc3339(),
            },
        );
    }

    Ok(LinkTargetResult {
        agent,
        status,
        path: dest_path.to_path_buf(),
        target_path: source_path.to_path_buf(),
        method: used_method,
        reason,
    })
}

fn sync_by_method(
    source_path: &Path,
    dest_path: &Path,
    method: SyncMethod,
) -> Result<(LinkStatus, SyncMethod, Option<String>)> {
    match method {
        SyncMethod::Symlink => {
            create_relative_symlink(source_path, dest_path)?;
            Ok((LinkStatus::Linked, SyncMethod::Symlink, None))
        }
        SyncMethod::Copy => {
            copy_dir(source_path, dest_path, true)?;
            Ok((LinkStatus::Copied, SyncMethod::Copy, None))
        }
        SyncMethod::Auto => match create_relative_symlink(source_path, dest_path) {
            Ok(()) => Ok((LinkStatus::Linked, SyncMethod::Symlink, None)),
            Err(error) => {
                let reason = format!("symlink failed, fallback to copy: {error}");
                copy_dir(source_path, dest_path, true)?;
                Ok((LinkStatus::Copied, SyncMethod::Copy, Some(reason)))
            }
        },
    }
}

/// 从某个 Agent 迁移已有真实 skill 到 hub。
pub fn migrate_from_agent(
    agent: AgentKind,
    force: bool,
    dry_run: bool,
) -> Result<Vec<MigrationRecord>> {
    let config = load_config()?;
    let mut lock = edit_lock(&config)?;
    let agent_config = &config.agents[&agent];
    let skills = scan_skill_root(&agent_config.skills_dir)?;
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let mut records = Vec::new();

    for skill in skills {
        if skill.is_symlink || skill.dir_name.starts_with('.') {
            continue;
        }
        let skill_name = safe_skill_dir_name(&skill.name)?;
        let hub_path = config.hub_dir.join(&skill_name);
        if hub_path.exists() && !force {
            continue;
        }
        let backup_path = config
            .backups_dir
            .join(&timestamp)
            .join(agent.as_str())
            .join(&skill.dir_name);
        let record = MigrationRecord {
            agent: agent.clone(),
            skill_name: skill_name.clone(),
            original_path: skill.path.clone(),
            hub_path: hub_path.clone(),
            backup_path: backup_path.clone(),
            migrated_at: Utc::now().to_rfc3339(),
        };

        if !dry_run {
            // 迁移是唯一会移动用户真实目录的能力：先复制到 hub，再移动原目录到 backup，最后创建 symlink。
            copy_dir(&skill.path, &hub_path, force)?;
            if let Some(parent) = backup_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::rename(&skill.path, &backup_path)?;
            create_relative_symlink(&hub_path, &skill.path)?;
            lock.migrations.push(record.clone());
            upsert_link(
                &mut lock.managed_links,
                ManagedLinkRecord {
                    agent: agent.clone(),
                    skill_name,
                    link_path: skill.path,
                    target_path: hub_path,
                    updated_at: Utc::now().to_rfc3339(),
                },
            );
        }
        records.push(record);
    }

    if !dry_run {
        lock.save()?;
    }
    Ok(records)
}

/// 扫描 hub 中的 skill。
pub fn scan_hub() -> Result<Vec<SkillInfo>> {
    let config = load_config()?;
    scan_skill_root(&config.hub_dir)
}

fn find_hub_skill(skill_name: &str) -> Result<Option<SkillInfo>> {
    let config = load_config()?;
    let skills = scan_skill_root(&config.hub_dir)?;
    Ok(skills
        .into_iter()
        .find(|skill| skill.dir_name == skill_name || skill.name == skill_name))
}

fn upsert_link(records: &mut Vec<ManagedLinkRecord>, record: ManagedLinkRecord) {
    records.retain(|item| !(item.agent == record.agent && item.skill_name == record.skill_name));
    records.push(record);
}

fn is_managed_link(
    records: &[ManagedLinkRecord],
    agent: &AgentKind,
    skill_name: &str,
    link_path: &Path,
    target_path: &Path,
) -> bool {
    records.iter().any(|record| {
        &record.agent == agent
            && record.skill_name == skill_name
            && record.link_path == link_path
            && record.target_path == target_path
    })
}

/// skill 在某个 Agent 下的状态。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SkillAgentStatusKind {
    /// hub 中存在，但没有分发到任何 Agent。
    HubOnly,
    /// Agent 目录中是指向 hub 的 symlink。
    Linked,
    /// Agent 目录中是 skills-hub 管理过的 copy 副本。
    Copied,
    /// Agent 目录中不存在该 skill。
    Missing,
    /// Agent 目录中存在真实目录或未知文件，和 hub 冲突。
    Conflict,
}

/// 单个 Agent 下某个 skill 的状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillAgentStatus {
    /// Agent 类型。
    pub agent: AgentKind,
    /// 状态。
    pub status: SkillAgentStatusKind,
    /// Agent 侧路径。
    pub path: PathBuf,
    /// 如果 linked，则为 hub 目标路径。
    pub target_path: Option<PathBuf>,
}

/// 一个 hub skill 在所有 Agent 下的状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillStatus {
    /// skill 名称。
    pub skill_name: String,
    /// hub 路径。
    pub hub_path: PathBuf,
    /// 各 Agent 状态。
    pub agents: Vec<SkillAgentStatus>,
}

/// 列出 hub skills 以及它们在 Codex/Claude/Cursor/OpenClaw 中的链接状态。
pub fn list_status() -> Result<Vec<SkillStatus>> {
    let config = load_config()?;
    let lock = load_lock(&config)?;
    let hub_skills = scan_skill_root(&config.hub_dir)?;
    let mut result = Vec::new();

    for skill in hub_skills {
        let mut agents = Vec::new();
        for (agent, agent_config) in &config.agents {
            let path = agent_config.skills_dir.join(&skill.dir_name);
            let managed_copy = is_managed_link(
                &lock.managed_links,
                agent,
                &skill.dir_name,
                &path,
                &skill.path,
            );
            let status = if !path_exists(&path) {
                SkillAgentStatusKind::Missing
            } else if is_symlink_to(&path, &skill.path)? {
                SkillAgentStatusKind::Linked
            } else if managed_copy {
                // copy 模式会在 Agent 侧生成真实目录；只有 lock 记录证明它由 skills-hub 管理时，
                // 才把它展示为 copied，避免把用户自己的真实目录误认为可管理副本。
                SkillAgentStatusKind::Copied
            } else {
                SkillAgentStatusKind::Conflict
            };
            agents.push(SkillAgentStatus {
                agent: agent.clone(),
                target_path: matches!(
                    status,
                    SkillAgentStatusKind::Linked | SkillAgentStatusKind::Copied
                )
                .then(|| skill.path.clone()),
                status,
                path,
            });
        }

        if agents
            .iter()
            .all(|item| item.status == SkillAgentStatusKind::Missing)
        {
            for item in &mut agents {
                item.status = SkillAgentStatusKind::HubOnly;
            }
        }

        result.push(SkillStatus {
            skill_name: skill.dir_name,
            hub_path: skill.path,
            agents,
        });
    }

    Ok(result)
}

/// skill 详情里的单个文件条目。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillFileEntry {
    /// 相对 skill 根目录的路径。
    pub path: PathBuf,
    /// 是否是目录。
    pub is_dir: bool,
}

/// GUI 使用的 skill 详情。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDetail {
    /// skill 基础信息。
    pub info: SkillInfo,
    /// `SKILL.md` 原文。
    pub readme: String,
    /// skill 目录下的文件树，最多递归几层由实现保护。
    pub files: Vec<SkillFileEntry>,
    /// 该 skill 在各 Agent 下的状态。
    pub statuses: Vec<SkillAgentStatus>,
}

/// 读取 hub 中某个 skill 的详情。
pub fn get_skill_detail(skill_name: &str) -> Result<SkillDetail> {
    let info = find_hub_skill(skill_name)?
        .ok_or_else(|| anyhow::anyhow!("skill not found: {skill_name}"))?;
    let readme = fs::read_to_string(&info.skill_file)?;
    let statuses = list_status()?
        .into_iter()
        .find(|item| item.skill_name == info.dir_name)
        .map(|item| item.agents)
        .unwrap_or_default();
    let files = list_skill_files(&info.path)?;
    Ok(SkillDetail {
        info,
        readme,
        files,
        statuses,
    })
}

/// 从 hub 和所有受管理的 Agent 目录中删除 skill。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoveHubSkillResult {
    /// 被删除的 hub skill；不存在时为空。
    pub skill: Option<SkillInfo>,
    /// 各 Agent 的清理结果。
    pub agents: Vec<LinkTargetResult>,
}

/// 删除前先清理 skills-hub 管理的 Agent symlink/copy，未知真实目录保持不动。
pub fn remove_hub_skill(skill_name: &str, force: bool) -> Result<RemoveHubSkillResult> {
    let config = load_config()?;
    let Some(info) = find_hub_skill(skill_name)? else {
        return Ok(RemoveHubSkillResult {
            skill: None,
            agents: Vec::new(),
        });
    };
    let hub = fs::canonicalize(&config.hub_dir)?;
    let parent = info
        .path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("invalid skill path: {}", info.path.display()))?;
    let parent = fs::canonicalize(parent)?;
    if parent != hub && !info.path.starts_with(&config.hub_dir) {
        anyhow::bail!(
            "refuse to remove skill outside hub: {}",
            info.path.display()
        );
    }
    if info.is_symlink && !force {
        anyhow::bail!(
            "refuse to remove symlink skill without force: {}",
            info.path.display()
        );
    }
    let agents = config
        .agents
        .values()
        .filter(|agent| agent.enabled)
        .map(|agent| agent.kind.clone())
        .collect::<Vec<_>>();
    let agent_results = unlink_skill(&info.dir_name, &agents, false)?;
    if info.path.exists() || info.path.symlink_metadata().is_ok() {
        if info.is_symlink {
            fs::remove_file(&info.path)?;
        } else {
            fs::remove_dir_all(&info.path)?;
        }
    }
    Ok(RemoveHubSkillResult {
        skill: Some(info),
        agents: agent_results,
    })
}

fn list_skill_files(root: &Path) -> Result<Vec<SkillFileEntry>> {
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .max_depth(4)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.path() == root {
            continue;
        }
        let relative = entry.path().strip_prefix(root).unwrap_or(entry.path());
        if relative
            .components()
            .any(|part| part.as_os_str().to_string_lossy().starts_with('.'))
        {
            continue;
        }
        files.push(SkillFileEntry {
            path: relative.to_path_buf(),
            is_dir: entry.file_type().is_dir(),
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// 扫描 hub 和所有本机 Agent skill 目录的结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanAllResult {
    /// hub 中的 skills。
    pub hub: Vec<SkillInfo>,
    /// 各 Agent 目录下的 skills。
    pub agents: Vec<AgentScanResult>,
}

/// 单个 Agent 的扫描结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentScanResult {
    /// Agent 类型。
    pub agent: AgentKind,
    /// Agent skill 目录。
    pub skills_dir: PathBuf,
    /// 扫描到的 skills。
    pub skills: Vec<SkillInfo>,
}

/// 扫描 hub 和 Codex/Claude/Cursor/OpenClaw 的 skill 数量与内容。
pub fn scan_all() -> Result<ScanAllResult> {
    let config = load_config()?;
    let hub = scan_skill_root(&config.hub_dir)?;
    let mut agents = Vec::new();
    for (agent, agent_config) in &config.agents {
        if !agent_config.enabled {
            continue;
        }
        agents.push(AgentScanResult {
            agent: agent.clone(),
            skills_dir: agent_config.skills_dir.clone(),
            skills: scan_skill_root(&agent_config.skills_dir)?,
        });
    }
    Ok(ScanAllResult { hub, agents })
}
