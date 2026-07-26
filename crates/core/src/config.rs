use crate::{expand_path, SyncMethod};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

/// skills-hub 当前支持的本机 Agent 类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum AgentKind {
    /// OpenAI Codex CLI / Desktop 的 skill 目录。
    #[serde(rename = "codex")]
    Codex,
    /// Claude Code 的 skill 目录。
    #[serde(rename = "claude")]
    Claude,
    /// Cursor 的 skill 目录。
    #[serde(rename = "cursor")]
    Cursor,
    /// OpenClaw 的 skill 目录。
    #[serde(rename = "openclaw")]
    OpenClaw,
}

impl AgentKind {
    /// 返回 CLI 中使用的短名称。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Cursor => "cursor",
            Self::OpenClaw => "openclaw",
        }
    }

    /// 解析命令行传入的 agent 名称。
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "codex" => Some(Self::Codex),
            "claude" => Some(Self::Claude),
            "cursor" => Some(Self::Cursor),
            "openclaw" => Some(Self::OpenClaw),
            _ => None,
        }
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

/// 远程设备配置；v1 只保存连接信息，不托管私钥。
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
    /// 已登记的 skill sources。
    pub sources: BTreeMap<String, SkillSource>,
    /// 已登记的远程设备。
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
}

/// 读取偏好设置。
pub fn get_preferences() -> Result<HubPreferences> {
    let config = load_config()?;
    Ok(HubPreferences {
        default_sync_method: config.default_sync_method,
    })
}

/// 更新偏好设置。
pub fn update_preferences(default_sync_method: SyncMethod) -> Result<HubPreferences> {
    let mut config = load_config()?;
    config.default_sync_method = default_sync_method;
    save_config(&config)?;
    Ok(HubPreferences {
        default_sync_method,
    })
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
    let mut agents = BTreeMap::new();
    agents.insert(
        AgentKind::Codex,
        AgentConfig {
            kind: AgentKind::Codex,
            label: "Codex".to_string(),
            skills_dir: expand_path("~/.codex/skills"),
        },
    );
    agents.insert(
        AgentKind::Claude,
        AgentConfig {
            kind: AgentKind::Claude,
            label: "Claude".to_string(),
            skills_dir: expand_path("~/.claude/skills"),
        },
    );
    agents.insert(
        AgentKind::Cursor,
        AgentConfig {
            kind: AgentKind::Cursor,
            label: "Cursor".to_string(),
            skills_dir: expand_path("~/.cursor/skills"),
        },
    );
    agents.insert(
        AgentKind::OpenClaw,
        AgentConfig {
            kind: AgentKind::OpenClaw,
            label: "OpenClaw".to_string(),
            skills_dir: expand_path("~/.openclaw/skills"),
        },
    );
    HubConfig {
        hub_dir: expand_path("~/.agents/skills"),
        config_path,
        lock_path,
        backups_dir,
        cache_dir,
        logs_dir,
        agents,
        sources: BTreeMap::new(),
        remotes: BTreeMap::new(),
        default_sync_method: SyncMethod::Auto,
    }
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
        config
            .agents
            .entry(*agent)
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

/// 读取 lock；不存在时返回空 lock。
pub fn load_lock(config: &HubConfig) -> Result<HubLock> {
    if !config.lock_path.exists() {
        return Ok(HubLock {
            version: 1,
            ..HubLock::default()
        });
    }
    let content = fs::read_to_string(&config.lock_path)?;
    Ok(serde_json::from_str(&content)?)
}

/// 保存 lock 文件。
pub fn save_lock(config: &HubConfig, lock: &HubLock) -> Result<()> {
    if let Some(parent) = config.lock_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        &config.lock_path,
        format!("{}\n", serde_json::to_string_pretty(lock)?),
    )?;
    Ok(())
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

    #[test]
    fn fills_new_agents_into_existing_config() {
        let fallback = default_config();
        let mut existing = fallback.clone();
        existing.agents.remove(&AgentKind::Claude);

        let config = fill_missing_default_agents(existing, &fallback);

        assert!(config.agents.contains_key(&AgentKind::Claude));
        assert!(config.agents[&AgentKind::Claude]
            .skills_dir
            .ends_with(".claude/skills"));
    }
}
