use crate::{expand_path, normalize_path, SyncMethod};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::ops::{Deref, DerefMut};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use tempfile::NamedTempFile;

static HUB_LOCK_MUTEX: Mutex<()> = Mutex::new(());

/// Agent 的稳定 ID。使用字符串是为了允许用户配置任意 Coding Agent。
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AgentKind(String);

impl AgentKind {
    /// 返回配置和 CLI 使用的稳定 ID。
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// 解析并校验 Agent ID。
    pub fn parse(value: &str) -> Option<Self> {
        let id = value.trim().to_ascii_lowercase();
        if id.is_empty()
            || !id.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
            })
        {
            return None;
        }
        Some(Self(id))
    }

    pub fn codex() -> Self {
        Self("codex".into())
    }

    pub fn claude() -> Self {
        Self("claude".into())
    }

    pub fn cursor() -> Self {
        Self("cursor".into())
    }

    pub fn openclaw() -> Self {
        Self("openclaw".into())
    }
}

/// 单个 Agent 的本地配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    /// Agent 类型。
    pub kind: AgentKind,
    /// 人类可读名称。
    pub label: String,
    /// 该 Agent 读取 skills 的目录。
    pub skills_dir: PathBuf,
    /// 是否参与扫描、展示和同步。
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
}

fn enabled_by_default() -> bool {
    true
}

/// Git 或本地 skill 来源配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSource {
    /// 用户给 source 起的稳定 ID，例如 `agent-skills`。
    pub id: String,
    /// 原始 URL 或本地目录路径。
    pub url: String,
    /// Git 分支；本地目录可为空。
    pub branch: Option<String>,
    /// 来源类型，便于 GUI 展示。
    pub kind: SourceKind,
    /// 最近一次扫描到的 skill 数量。
    pub skill_count: Option<usize>,
    /// 最近一次 scan 的 ISO 时间。
    pub last_scan_at: Option<String>,
    /// 最近一次 scan 的 commit，local source 可为空。
    pub last_commit: Option<String>,
}

/// skill source 类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceKind {
    /// github.com 仓库。
    Github,
    /// gitlab 或自建 GitLab 仓库。
    Gitlab,
    /// 其它 Git URL，包括 SSH。
    GenericGit,
    /// 本地目录。
    Local,
}

/// SSH 环境连接配置；只保存连接信息，不托管私钥。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteHost {
    /// 远程设备名称，例如 `office-mac`。
    pub name: String,
    /// SSH host，可来自 `~/.ssh/config`。
    pub host: String,
    /// SSH 用户名；为空时使用 ssh 默认配置。
    pub user: Option<String>,
    /// SSH 端口；为空时使用 ssh 默认配置。
    pub port: Option<u16>,
}

/// skills-hub 主配置文件。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HubConfig {
    /// hub 中真实保存 skills 的目录。
    pub hub_dir: PathBuf,
    /// 配置文件路径。
    pub config_path: PathBuf,
    /// lock 文件路径。
    pub lock_path: PathBuf,
    /// 备份目录，migrate 会先备份再替换 symlink。
    pub backups_dir: PathBuf,
    /// Git clone cache 目录。
    pub cache_dir: PathBuf,
    /// GUI/CLI 操作日志目录。
    #[serde(default = "default_logs_dir")]
    pub logs_dir: PathBuf,
    /// 本机 Agent 配置。
    pub agents: BTreeMap<AgentKind, AgentConfig>,
    /// 用户显式移除的内置 Agent，防止配置升级时重新补回。
    #[serde(default)]
    pub removed_agents: BTreeSet<AgentKind>,
    /// 已登记的 skill sources。
    pub sources: BTreeMap<String, SkillSource>,
    /// 已登记的 SSH 环境连接。
    pub remotes: BTreeMap<String, RemoteHost>,
    /// 默认同步方式；GUI/CLI 未显式指定时使用。
    #[serde(default)]
    pub default_sync_method: SyncMethod,
}

/// GUI/CLI 共用偏好设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HubPreferences {
    /// 默认同步方式；未显式指定时所有本机/远程同步都使用它。
    pub default_sync_method: SyncMethod,
    /// 当前 Hub 实体目录。
    pub hub_dir: PathBuf,
    /// 可配置的本机 Agent。
    pub agents: Vec<AgentConfig>,
}

/// 读取偏好设置。
pub fn get_preferences() -> Result<HubPreferences> {
    let config = load_config()?;
    Ok(HubPreferences {
        default_sync_method: config.default_sync_method,
        hub_dir: config.hub_dir,
        agents: config.agents.into_values().collect(),
    })
}

/// 更新偏好设置。
pub fn update_preferences(default_sync_method: SyncMethod) -> Result<HubPreferences> {
    let mut config = load_config()?;
    config.default_sync_method = default_sync_method;
    save_config(&config)?;
    Ok(HubPreferences {
        default_sync_method,
        hub_dir: config.hub_dir,
        agents: config.agents.into_values().collect(),
    })
}

/// 更新 Hub 实体目录。此操作只修改配置，不搬运旧目录内容。
pub fn update_hub_dir(value: &str) -> Result<HubConfig> {
    let mut config = load_config()?;
    if value.trim().is_empty() {
        return Err(anyhow!("hub directory cannot be empty"));
    }
    let hub_dir = normalize_path(expand_path(value.trim()))?;
    for agent in config.agents.values().filter(|agent| agent.enabled) {
        if normalize_path(&agent.skills_dir)? == hub_dir {
            return Err(anyhow!(
                "hub directory cannot equal an enabled agent directory"
            ));
        }
    }
    fs::create_dir_all(&hub_dir)?;
    config.hub_dir = hub_dir;
    save_config(&config)?;
    Ok(config)
}

/// 新增或更新一个本机 Agent。此操作不会同步或删除任何技能。
pub fn upsert_agent(id: &str, label: &str, skills_dir: &str, enabled: bool) -> Result<AgentConfig> {
    let mut config = load_config()?;
    let kind = AgentKind::parse(id).ok_or_else(|| anyhow!("invalid agent id: {id}"))?;
    let label = label.trim();
    if label.is_empty() || skills_dir.trim().is_empty() {
        return Err(anyhow!("agent label and skills directory are required"));
    }
    let skills_dir = normalize_path(expand_path(skills_dir.trim()))?;
    if normalize_path(&config.hub_dir)? == skills_dir {
        return Err(anyhow!("agent directory cannot equal hub directory"));
    }
    let path_changed = config.agents.get(&kind).is_some_and(|agent| {
        normalize_path(&agent.skills_dir).map_or(true, |path| path != skills_dir)
    });
    let agent = AgentConfig {
        kind: kind.clone(),
        label: label.to_string(),
        skills_dir,
        enabled,
    };
    if path_changed {
        clear_agent_lock_records(&config, &kind)?;
    }
    config.removed_agents.remove(&kind);
    config.agents.insert(kind, agent.clone());
    save_config(&config)?;
    Ok(agent)
}

/// 删除 Agent 配置。已有目录和链接保持不动。
pub fn remove_agent(id: &str) -> Result<Option<AgentConfig>> {
    let mut config = load_config()?;
    let kind = AgentKind::parse(id).ok_or_else(|| anyhow!("invalid agent id: {id}"))?;
    let removed = config.agents.remove(&kind);
    if removed.is_some() {
        clear_agent_lock_records(&config, &kind)?;
        config.removed_agents.insert(kind);
    }
    save_config(&config)?;
    Ok(removed)
}

fn clear_agent_lock_records(config: &HubConfig, kind: &AgentKind) -> Result<()> {
    let mut lock = edit_lock(config)?;
    if remove_agent_lock_records(&mut lock, kind) {
        lock.save()?;
    }
    Ok(())
}

fn remove_agent_lock_records(lock: &mut HubLock, kind: &AgentKind) -> bool {
    let previous_len = lock.managed_links.len();
    lock.managed_links.retain(|record| &record.agent != kind);
    lock.managed_links.len() != previous_len
}

/// lock 中记录 skills-hub 自己创建过的链接，避免误删用户真实目录。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HubLock {
    /// lock 版本，后续迁移 schema 用。
    pub version: u32,
    /// 本工具管理过的本机 agent symlink。
    pub managed_links: Vec<ManagedLinkRecord>,
    /// migrate 历史记录，方便用户排查和恢复。
    pub migrations: Vec<MigrationRecord>,
}

/// 本工具创建的 symlink 记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedLinkRecord {
    /// 目标 Agent。
    pub agent: AgentKind,
    /// skill 名称。
    pub skill_name: String,
    /// symlink 路径。
    pub link_path: PathBuf,
    /// symlink 指向的 hub 路径。
    pub target_path: PathBuf,
    /// 更新时间。
    pub updated_at: String,
}

/// migrate 的单条记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationRecord {
    /// 来源 Agent。
    pub agent: AgentKind,
    /// skill 名称。
    pub skill_name: String,
    /// 原始安装路径。
    pub original_path: PathBuf,
    /// hub 中的新路径。
    pub hub_path: PathBuf,
    /// 备份路径。
    pub backup_path: PathBuf,
    /// 迁移时间。
    pub migrated_at: String,
}

/// 返回默认日志目录。
pub fn default_logs_dir() -> PathBuf {
    expand_path("~/.config/skills-hub/logs")
}

/// 返回默认配置，所有路径都会展开成绝对路径。
pub fn default_config() -> HubConfig {
    let config_path = expand_path("~/.config/skills-hub/config.json");
    let lock_path = expand_path("~/.config/skills-hub/lock.json");
    let backups_dir = expand_path("~/.config/skills-hub/backups");
    let cache_dir = expand_path("~/.cache/skills-hub/sources");
    let logs_dir = default_logs_dir();
    let agents = default_agents();
    HubConfig {
        hub_dir: expand_path("~/.agents/skills"),
        config_path,
        lock_path,
        backups_dir,
        cache_dir,
        logs_dir,
        agents,
        removed_agents: BTreeSet::new(),
        sources: BTreeMap::new(),
        remotes: BTreeMap::new(),
        default_sync_method: SyncMethod::Auto,
    }
}

fn default_agents() -> BTreeMap<AgentKind, AgentConfig> {
    [
        ("codex", "Codex", "~/.codex/skills"),
        ("claude", "Claude", "~/.claude/skills"),
        ("cursor", "Cursor", "~/.cursor/skills"),
        ("openclaw", "OpenClaw", "~/.openclaw/skills"),
        ("hermes", "Hermes", "~/.hermes/skills"),
        ("continue", "Continue", "~/.continue/skills"),
        ("windsurf", "Windsurf", "~/.codeium/windsurf/skills"),
        ("trae", "Trae", "~/.trae/skills"),
        ("qoder", "Qoder", "~/.qoder/skills"),
        ("zode", "Zode", "~/.zode/skills"),
    ]
    .into_iter()
    .map(|(id, label, directory)| {
        let kind = AgentKind::parse(id).expect("built-in agent id must be valid");
        (
            kind.clone(),
            AgentConfig {
                kind,
                label: label.into(),
                skills_dir: expand_path(directory),
                enabled: true,
            },
        )
    })
    .collect()
}

/// 读取配置；不存在时返回默认配置但不写磁盘。
pub fn load_config() -> Result<HubConfig> {
    let fallback = default_config();
    if !fallback.config_path.exists() {
        return Ok(fallback);
    }
    let content = fs::read_to_string(&fallback.config_path)?;
    let config = serde_json::from_str(&content)?;
    Ok(fill_missing_default_agents(config, &fallback))
}

/// 为旧配置补齐新版本新增的 Agent，不覆盖用户自定义过的已有目录。
fn fill_missing_default_agents(mut config: HubConfig, fallback: &HubConfig) -> HubConfig {
    for (agent, agent_config) in &fallback.agents {
        if config.removed_agents.contains(agent) {
            continue;
        }
        config
            .agents
            .entry(agent.clone())
            .or_insert_with(|| agent_config.clone());
    }
    config
}

/// 保存配置文件。
pub fn save_config(config: &HubConfig) -> Result<()> {
    if let Some(parent) = config.config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        &config.config_path,
        format!("{}\n", serde_json::to_string_pretty(config)?),
    )?;
    Ok(())
}

fn acquire_hub_lock() -> Result<MutexGuard<'static, ()>> {
    HUB_LOCK_MUTEX
        .lock()
        .map_err(|_| anyhow!("skills hub lock mutex is poisoned"))
}

fn load_lock_unlocked(config: &HubConfig) -> Result<HubLock> {
    if !config.lock_path.exists() {
        return Ok(HubLock {
            version: 1,
            ..HubLock::default()
        });
    }
    let content = fs::read_to_string(&config.lock_path)?;
    Ok(serde_json::from_str(&content)?)
}

fn save_lock_unlocked(config: &HubConfig, lock: &HubLock) -> Result<()> {
    let parent = config
        .lock_path
        .parent()
        .ok_or_else(|| anyhow!("lock path has no parent: {}", config.lock_path.display()))?;
    fs::create_dir_all(parent)?;

    let content = format!("{}\n", serde_json::to_string_pretty(lock)?);
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(content.as_bytes())?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(&config.lock_path)
        .map_err(|error| error.error)?;
    Ok(())
}

/// 读取 lock；不存在时返回空 lock。
pub fn load_lock(config: &HubConfig) -> Result<HubLock> {
    let _guard = acquire_hub_lock()?;
    load_lock_unlocked(config)
}

/// 保存 lock 文件。内容先写入同目录临时文件，再原子替换目标文件。
pub fn save_lock(config: &HubConfig, lock: &HubLock) -> Result<()> {
    let _guard = acquire_hub_lock()?;
    save_lock_unlocked(config, lock)
}

/// 持有互斥锁的可编辑 lock，保证读取、修改、保存属于同一个事务。
pub struct HubLockTransaction<'a> {
    _guard: MutexGuard<'static, ()>,
    config: &'a HubConfig,
    lock: HubLock,
}

impl Deref for HubLockTransaction<'_> {
    type Target = HubLock;

    fn deref(&self) -> &Self::Target {
        &self.lock
    }
}

impl DerefMut for HubLockTransaction<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.lock
    }
}

impl HubLockTransaction<'_> {
    pub fn save(&self) -> Result<()> {
        save_lock_unlocked(self.config, &self.lock)
    }
}

pub fn edit_lock(config: &HubConfig) -> Result<HubLockTransaction<'_>> {
    let guard = acquire_hub_lock()?;
    let lock = load_lock_unlocked(config)?;
    Ok(HubLockTransaction {
        _guard: guard,
        config,
        lock,
    })
}

/// 初始化 hub 目录、配置文件、lock 文件和 cache/backup 目录。
pub fn init_hub(dry_run: bool) -> Result<HubConfig> {
    let config = load_config()?;
    if !dry_run {
        fs::create_dir_all(&config.hub_dir)?;
        fs::create_dir_all(&config.backups_dir)?;
        fs::create_dir_all(&config.cache_dir)?;
        fs::create_dir_all(&config.logs_dir)?;
        save_config(&config)?;
        if !config.lock_path.exists() {
            save_lock(
                &config,
                &HubLock {
                    version: 1,
                    ..HubLock::default()
                },
            )?;
        }
    }
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn default_hub_uses_agents_directory_without_duplicate_agent_target() {
        let config = default_config();

        assert_eq!(config.hub_dir, expand_path("~/.agents/skills"));
        assert!(config
            .agents
            .values()
            .all(|agent| agent.skills_dir != config.hub_dir));
    }

    #[test]
    fn fills_new_agents_into_existing_config() {
        let fallback = default_config();
        let mut existing = fallback.clone();
        existing.agents.remove(&AgentKind::claude());

        let config = fill_missing_default_agents(existing, &fallback);

        assert!(config.agents.contains_key(&AgentKind::claude()));
        assert!(config.agents[&AgentKind::claude()]
            .skills_dir
            .ends_with(".claude/skills"));
    }

    #[test]
    fn keeps_explicitly_removed_default_agent_removed() {
        let fallback = default_config();
        let mut existing = fallback.clone();
        existing.agents.remove(&AgentKind::claude());
        existing.removed_agents.insert(AgentKind::claude());

        let config = fill_missing_default_agents(existing, &fallback);

        assert!(!config.agents.contains_key(&AgentKind::claude()));
    }

    #[test]
    fn removes_only_selected_agent_lock_records() {
        let record = |agent: AgentKind| ManagedLinkRecord {
            agent,
            skill_name: "demo".into(),
            link_path: PathBuf::from("/tmp/agent/demo"),
            target_path: PathBuf::from("/tmp/hub/demo"),
            updated_at: String::new(),
        };
        let mut lock = HubLock {
            version: 1,
            managed_links: vec![record(AgentKind::codex()), record(AgentKind::claude())],
            migrations: Vec::new(),
        };

        assert!(remove_agent_lock_records(&mut lock, &AgentKind::codex()));
        assert_eq!(lock.managed_links.len(), 1);
        assert_eq!(lock.managed_links[0].agent, AgentKind::claude());
    }

    #[test]
    fn concurrent_lock_transactions_preserve_every_record() {
        let temp = tempfile::tempdir().unwrap();
        let mut config = default_config();
        config.lock_path = temp.path().join("lock.json");
        let config = Arc::new(config);
        let worker_count = 24;
        let barrier = Arc::new(Barrier::new(worker_count));

        let workers = (0..worker_count)
            .map(|index| {
                let config = Arc::clone(&config);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    let mut lock = edit_lock(&config).unwrap();
                    lock.managed_links.push(ManagedLinkRecord {
                        agent: AgentKind::codex(),
                        skill_name: format!("skill-{index}"),
                        link_path: PathBuf::from(format!("/agent/skill-{index}")),
                        target_path: PathBuf::from(format!("/hub/skill-{index}")),
                        updated_at: String::new(),
                    });
                    lock.save().unwrap();
                })
            })
            .collect::<Vec<_>>();

        for worker in workers {
            worker.join().unwrap();
        }

        let content = fs::read_to_string(&config.lock_path).unwrap();
        let parsed: HubLock = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed.managed_links.len(), worker_count);
        for index in 0..worker_count {
            assert!(parsed
                .managed_links
                .iter()
                .any(|record| record.skill_name == format!("skill-{index}")));
        }
    }
}
