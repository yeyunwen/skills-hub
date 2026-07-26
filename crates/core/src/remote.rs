use crate::{load_config, safe_skill_dir_name, save_config, AgentKind, LinkStatus, RemoteHost, SyncMethod};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// 从本机 SSH 配置发现到的 Host alias。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredSshHost {
    /// `~/.ssh/config` 中的 Host alias。
    pub alias: String,
    /// `ssh -G` 解析后的 HostName；解析失败时为空。
    pub hostname: Option<String>,
    /// `ssh -G` 解析后的 User。
    pub user: Option<String>,
    /// `ssh -G` 解析后的 Port。
    pub port: Option<u16>,
    /// 发现该 Host 的配置文件路径。
    pub source_file: PathBuf,
    /// 是否已经添加到 skills-hub 远程列表。
    pub added: bool,
}

/// 发现本机 `~/.ssh/config` 中可直接使用的 SSH Host。
///
/// 这里对齐 Codex App 的体验：优先展示用户已经维护好的 SSH alias。
/// 只解析静态配置，不发起真实连接；最终连接仍完全交给系统 ssh/ssh-agent。
pub fn discover_ssh_hosts() -> Result<Vec<DiscoveredSshHost>> {
    let config = load_config()?;
    let mut aliases = BTreeSet::new();
    let mut entries = Vec::new();
    let Some(home) = dirs::home_dir() else {
        return Ok(Vec::new());
    };
    let root = home.join(".ssh/config");
    collect_ssh_hosts_from_file(&root, &mut aliases, &mut entries)?;

    let mut hosts = Vec::new();
    for (alias, source_file) in entries {
        let resolved = resolve_ssh_host(&alias);
        let added = config
            .remotes
            .values()
            .any(|remote| remote.name == alias || remote.host == alias);
        hosts.push(DiscoveredSshHost {
            alias,
            hostname: resolved.hostname,
            user: resolved.user,
            port: resolved.port,
            source_file,
            added,
        });
    }
    Ok(hosts)
}

#[derive(Default)]
struct ResolvedSshHost {
    hostname: Option<String>,
    user: Option<String>,
    port: Option<u16>,
}

fn collect_ssh_hosts_from_file(
    path: &Path,
    aliases: &mut BTreeSet<String>,
    entries: &mut Vec<(String, PathBuf)>,
) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(path)?;
    let base_dir = path.parent().unwrap_or_else(|| Path::new("."));
    for raw_line in content.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(keyword) = parts.next() else {
            continue;
        };
        if keyword.eq_ignore_ascii_case("include") {
            for pattern in parts {
                for include_path in expand_ssh_include(base_dir, pattern) {
                    collect_ssh_hosts_from_file(&include_path, aliases, entries)?;
                }
            }
            continue;
        }
        if !keyword.eq_ignore_ascii_case("host") {
            continue;
        }
        for alias in parts {
            if is_concrete_ssh_alias(alias) && aliases.insert(alias.to_string()) {
                entries.push((alias.to_string(), path.to_path_buf()));
            }
        }
    }
    Ok(())
}

fn expand_ssh_include(base_dir: &Path, pattern: &str) -> Vec<PathBuf> {
    let normalized = if let Some(stripped) = pattern.strip_prefix("~/") {
        dirs::home_dir().map(|home| home.join(stripped))
    } else {
        let path = PathBuf::from(pattern);
        Some(if path.is_absolute() {
            path
        } else {
            base_dir.join(path)
        })
    };
    let Some(path) = normalized else {
        return Vec::new();
    };
    let text = path.to_string_lossy();
    if !text.contains('*') {
        return vec![path];
    }

    // 轻量支持 OpenSSH Include 常见的 `conf.d/*.conf`。不引入 glob 依赖，避免扩大工程复杂度。
    let Some(parent) = path.parent() else {
        return Vec::new();
    };
    let Some(file_pattern) = path.file_name().and_then(|value| value.to_str()) else {
        return Vec::new();
    };
    let Some((prefix, suffix)) = file_pattern.split_once('*') else {
        return Vec::new();
    };
    let Ok(read_dir) = fs::read_dir(parent) else {
        return Vec::new();
    };
    let mut matches = read_dir
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|candidate| {
            candidate
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(prefix) && name.ends_with(suffix))
        })
        .collect::<Vec<_>>();
    matches.sort();
    matches
}

fn is_concrete_ssh_alias(alias: &str) -> bool {
    !alias.starts_with('!')
        && !alias.contains('*')
        && !alias.contains('?')
        && !alias.trim().is_empty()
}

fn resolve_ssh_host(alias: &str) -> ResolvedSshHost {
    let output = Command::new("ssh").args(["-G", alias]).output();
    let Ok(output) = output else {
        return ResolvedSshHost::default();
    };
    if !output.status.success() {
        return ResolvedSshHost::default();
    }
    let mut resolved = ResolvedSshHost::default();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut parts = line.splitn(2, char::is_whitespace);
        let Some(key) = parts.next() else {
            continue;
        };
        let value = parts.next().unwrap_or("").trim();
        match key.to_ascii_lowercase().as_str() {
            "hostname" if !value.is_empty() => resolved.hostname = Some(value.to_string()),
            "user" if !value.is_empty() => resolved.user = Some(value.to_string()),
            "port" => resolved.port = value.parse().ok(),
            _ => {}
        }
    }
    resolved
}

/// 远程同步命令计划。
///
/// v1 先生成/执行 rsync 计划，不在远端安装 skh，降低多设备接入成本。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSyncPlan {
    /// 远程设备。
    pub remote: RemoteHost,
    /// 要同步到哪些 Agent。
    pub agents: Vec<AgentKind>,
    /// 本地源目录。
    pub source_dir: PathBuf,
    /// 远端 hub 目录。
    pub remote_hub_dir: String,
    /// 同步方式。
    pub sync_method: SyncMethod,
    /// 实际执行的命令数组，便于 GUI 展示和用户排查。
    pub commands: Vec<Vec<String>>,
}

/// 添加远程设备配置。
pub fn add_remote(
    name: String,
    host: String,
    user: Option<String>,
    port: Option<u16>,
    dry_run: bool,
) -> Result<RemoteHost> {
    let mut config = load_config()?;
    let trimmed_host = host.trim().to_string();
    let remote_name = if name.trim().is_empty() {
        trimmed_host.clone()
    } else {
        name.trim().to_string()
    };
    let remote = RemoteHost {
        name: remote_name.clone(),
        host: trimmed_host,
        user,
        port,
    };
    if !dry_run {
        config.remotes.insert(remote_name, remote.clone());
        save_config(&config)?;
    }
    Ok(remote)
}

/// 列出远程设备。
pub fn list_remotes() -> Result<Vec<RemoteHost>> {
    Ok(load_config()?.remotes.into_values().collect())
}

/// 删除远程设备配置。
pub fn remove_remote(name: &str, dry_run: bool) -> Result<Option<RemoteHost>> {
    let mut config = load_config()?;
    let removed = config.remotes.remove(name);
    if !dry_run {
        save_config(&config)?;
    }
    Ok(removed)
}

/// 远程 SSH 连接状态。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteConnectionStatusKind {
    /// 连接成功。
    Connected,
    /// 连接失败。
    Failed,
}

/// 远程 SSH 连接检测结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteConnectionStatus {
    /// 远程设备名称。
    pub name: String,
    /// 状态。
    pub status: RemoteConnectionStatusKind,
    /// 错误或说明。
    pub message: Option<String>,
    /// 检测时间。
    pub checked_at: String,
}

/// 检测远程 SSH 是否可连接。
///
/// 这里复用系统 ssh/ssh-agent，只设置较短超时，避免 GUI 长时间卡住。
pub fn check_remote_connection(name: &str) -> Result<RemoteConnectionStatus> {
    let config = load_config()?;
    let remote = config
        .remotes
        .get(name)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("remote not found: {name}"))?;
    let mut command = Command::new("ssh");
    command.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=5"]);
    if let Some(port) = remote.port {
        command.args(["-p", &port.to_string()]);
    }
    command.arg(remote_spec(&remote));
    command.arg("echo skills-hub-ok");
    let output = command.output()?;
    let (status, message) = if output.status.success() {
        (RemoteConnectionStatusKind::Connected, None)
    } else {
        (
            RemoteConnectionStatusKind::Failed,
            Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        )
    };
    Ok(RemoteConnectionStatus {
        name: name.to_string(),
        status,
        message,
        checked_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// 生成远程同步计划。
pub fn remote_sync_plan(
    name: &str,
    agents: &[AgentKind],
    sync_method: SyncMethod,
) -> Result<RemoteSyncPlan> {
    let config = load_config()?;
    let remote = config
        .remotes
        .get(name)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("remote not found: {name}"))?;
    let remote_spec = remote_spec(&remote);
    let remote_hub_dir = "~/.agents/skills".to_string();
    let mut commands = Vec::new();

    // 跨机器只能 copy/rsync；真正的 symlink/copy 发生在远端 hub -> 远端 agent 这一步。
    let mut rsync = vec!["rsync".to_string(), "-az".to_string()];
    if let Some(port) = remote.port {
        rsync.push("-e".to_string());
        rsync.push(format!("ssh -p {port}"));
    }
    rsync.push(format!("{}/", config.hub_dir.display()));
    rsync.push(format!("{remote_spec}:{remote_hub_dir}/"));
    commands.push(rsync);

    let shell = remote_link_shell(agents, sync_method);
    let mut ssh = vec!["ssh".to_string()];
    if let Some(port) = remote.port {
        ssh.extend(["-p".to_string(), port.to_string()]);
    }
    ssh.push(remote_spec);
    ssh.push(shell);
    commands.push(ssh);

    Ok(RemoteSyncPlan {
        remote,
        agents: agents.to_vec(),
        source_dir: config.hub_dir,
        remote_hub_dir,
        sync_method,
        commands,
    })
}

/// 执行远程同步计划。
pub fn run_remote_sync(plan: &RemoteSyncPlan, dry_run: bool) -> Result<()> {
    if dry_run {
        return Ok(());
    }
    for command in &plan.commands {
        let Some((bin, args)) = command.split_first() else {
            continue;
        };
        let output = Command::new(bin).args(args).output()?;
        if !output.status.success() {
            anyhow::bail!(
                "remote sync failed: {}\n{}",
                command.join(" "),
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }
    Ok(())
}

fn run_remote_shell(remote: &RemoteHost, script: &str) -> Result<Output> {
    let mut command = Command::new("ssh");
    if let Some(port) = remote.port {
        command.args(["-p", &port.to_string()]);
    }
    command.arg(remote_spec(remote));
    command.arg(script);
    let output = command.output()?;
    if !output.status.success() {
        anyhow::bail!(
            "remote command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(output)
}

fn remote_link_shell(agents: &[AgentKind], sync_method: SyncMethod) -> String {
    let agent_dirs = agents
        .iter()
        .map(|agent| format!("{}:{}", agent.as_str(), remote_agent_dir(*agent)))
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        r#"set -eu
hub="$HOME/.agents/skills"
method="{}"
mkdir -p "$hub"
for pair in {}; do
  agent="${{pair%%:*}}"
  dest="${{pair#*:}}"
  eval dest="$dest"
  mkdir -p "$dest"
  find "$hub" -path '*/.git' -prune -o -name SKILL.md -type f -print | while IFS= read -r skill_file; do
    skill="$(dirname "$skill_file")"
    name="$(basename "$skill")"
    case "$name" in .*) continue ;; esac
    target="$dest/$name"
    if [ -e "$target" ] || [ -L "$target" ]; then
      if [ -L "$target" ]; then
        rm "$target"
      else
        echo "skip conflict $agent:$name $target" >&2
        continue
      fi
    fi
    if [ "$method" = "copy" ]; then
      cp -R "$skill" "$target"
    elif [ "$method" = "symlink" ]; then
      ln -s "$skill" "$target"
    else
      ln -s "$skill" "$target" 2>/dev/null || cp -R "$skill" "$target"
    fi
  done
done"#,
        sync_method.as_str(),
        agent_dirs
    )
}

fn remote_single_skill_link_shell(
    agent: AgentKind,
    skill_name: &str,
    remote_hub_path: &str,
    remote_agent_path: &str,
    sync_method: SyncMethod,
) -> String {
    format!(
        r#"set -eu
agent={:?}
name={:?}
hub_skill={:?}
target={:?}
method={:?}
eval hub_skill="$hub_skill"
eval target="$target"
mkdir -p "$(dirname "$target")"
if [ ! -f "$hub_skill/SKILL.md" ]; then
  echo "missing-hub:$hub_skill" >&2
  exit 2
fi
if [ -e "$target" ] || [ -L "$target" ]; then
  if [ -L "$target" ]; then
    rm "$target"
  else
    echo "conflict:$agent:$name:$target"
    exit 0
  fi
fi
if [ "$method" = "copy" ]; then
  cp -R "$hub_skill" "$target"
  echo "copied:$target"
elif [ "$method" = "symlink" ]; then
  ln -s "$hub_skill" "$target"
  echo "linked:$target"
else
  if ln -s "$hub_skill" "$target" 2>/dev/null; then
    echo "linked:$target"
  else
    cp -R "$hub_skill" "$target"
    echo "copied:$target"
  fi
fi"#,
        agent.as_str(),
        skill_name,
        remote_hub_path,
        remote_agent_path,
        sync_method.as_str()
    )
}

fn remote_spec(remote: &RemoteHost) -> String {
    match &remote.user {
        Some(user) => format!("{user}@{}", remote.host),
        None => remote.host.clone(),
    }
}

/// 远程扫描到的单个 skill。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSkillInfo {
    /// skill 名称。
    pub name: String,
    /// 远程目录名。
    pub dir_name: String,
    /// 远程路径。
    pub path: String,
    /// 描述。
    pub description: Option<String>,
}

/// 远程单个 Agent 的扫描结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteAgentScanResult {
    /// Agent 类型。
    pub agent: AgentKind,
    /// 是否发现该 Agent 的根目录或配置。
    pub available: bool,
    /// 远程 skill 目录。
    pub skills_dir: String,
    /// skills。
    pub skills: Vec<RemoteSkillInfo>,
}

/// 远程扫描结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteScanResult {
    /// 远程设备。
    pub remote: RemoteHost,
    /// 各 Agent 的扫描结果。
    pub agents: Vec<RemoteAgentScanResult>,
}

/// 远程 skill 与本机 hub 对比后的状态。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteSkillStatusKind {
    /// 本机 hub 和远端都存在同名 skill。
    Synced,
    /// 本机 hub 存在，但远端缺失。
    Missing,
    /// 远端存在，但本机 hub 不存在。
    RemoteOnly,
}

/// 远程 list 中的单条状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSkillStatus {
    /// skill 名称。
    pub skill_name: String,
    /// Agent 类型。
    pub agent: AgentKind,
    /// 状态。
    pub status: RemoteSkillStatusKind,
    /// 远程路径。
    pub remote_path: Option<String>,
}

/// 远程 list 结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteListResult {
    /// 远程设备。
    pub remote: RemoteHost,
    /// 各 Agent 的可用性与扫描结果。
    pub agents: Vec<RemoteAgentScanResult>,
    /// 状态列表。
    pub statuses: Vec<RemoteSkillStatus>,
}

/// 从远端导入单个 skill 到本机 hub 的结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteImportResult {
    /// 远程设备。
    pub remote: RemoteHost,
    /// 来源 Agent。
    pub agent: AgentKind,
    /// skill 名称。
    pub skill_name: String,
    /// 远程来源路径。
    pub remote_path: String,
    /// 本机 hub 目标路径。
    pub hub_path: PathBuf,
    /// 是否实际导入。
    pub imported: bool,
}

/// 同步单个本机 hub skill 到远端 Agent 的结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSkillSyncResult {
    /// 远程设备。
    pub remote: RemoteHost,
    /// 目标 Agent。
    pub agent: AgentKind,
    /// skill 名称。
    pub skill_name: String,
    /// 本机 hub 来源路径。
    pub source_path: PathBuf,
    /// 远端 hub 路径。
    pub remote_hub_path: String,
    /// 远端 Agent 目标路径。
    pub remote_agent_path: String,
    /// 同步状态。
    pub status: LinkStatus,
    /// 状态原因。
    pub reason: Option<String>,
}

/// 从远端 Agent 目录安全移除单个 skill 的结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteRemoveResult {
    /// 远程设备。
    pub remote: RemoteHost,
    /// 目标 Agent。
    pub agent: AgentKind,
    /// skill 名称。
    pub skill_name: String,
    /// 远程原路径。
    pub remote_path: String,
    /// 真实目录移动到的远程备份路径；symlink 删除时为空。
    pub backup_path: Option<String>,
    /// 是否实际移除。
    pub removed: bool,
}

/// 扫描远端 Agent skill 目录。
///
/// v1 不要求远端安装 skh；通过 SSH 执行一段 Python3 脚本来解析 `SKILL.md`。
/// 如果远端没有 python3，会返回清晰错误，后续可以再加 POSIX shell fallback。
pub fn remote_scan(name: &str, agents: &[AgentKind]) -> Result<RemoteScanResult> {
    let config = load_config()?;
    let remote = config
        .remotes
        .get(name)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("remote not found: {name}"))?;
    let mut results = Vec::new();
    for agent in agents {
        let dir = remote_agent_dir(*agent);
        let (available, skills) = run_remote_skill_scan(&remote, *agent)?;
        results.push(RemoteAgentScanResult {
            agent: *agent,
            available,
            skills_dir: dir.to_string(),
            skills,
        });
    }
    Ok(RemoteScanResult {
        remote,
        agents: results,
    })
}

/// 对比本机 hub 和远程扫描结果，给出 synced/missing/remote-only。
pub fn remote_list(name: &str, agents: &[AgentKind]) -> Result<RemoteListResult> {
    let config = load_config()?;
    let hub_skills = crate::scan_skill_directory(&config.hub_dir)?;
    let hub_names: std::collections::BTreeSet<String> =
        hub_skills.into_iter().map(|skill| skill.dir_name).collect();
    let scan = remote_scan(name, agents)?;
    let mut statuses = Vec::new();

    for agent_scan in &scan.agents {
        let remote_names: std::collections::BTreeMap<String, String> = agent_scan
            .skills
            .iter()
            .map(|skill| (skill.dir_name.clone(), skill.path.clone()))
            .collect();
        for hub_name in &hub_names {
            if let Some(path) = remote_names.get(hub_name) {
                statuses.push(RemoteSkillStatus {
                    skill_name: hub_name.clone(),
                    agent: agent_scan.agent,
                    status: RemoteSkillStatusKind::Synced,
                    remote_path: Some(path.clone()),
                });
            } else {
                statuses.push(RemoteSkillStatus {
                    skill_name: hub_name.clone(),
                    agent: agent_scan.agent,
                    status: RemoteSkillStatusKind::Missing,
                    remote_path: None,
                });
            }
        }
        for (remote_name, path) in remote_names {
            if !hub_names.contains(&remote_name) {
                statuses.push(RemoteSkillStatus {
                    skill_name: remote_name,
                    agent: agent_scan.agent,
                    status: RemoteSkillStatusKind::RemoteOnly,
                    remote_path: Some(path),
                });
            }
        }
    }

    Ok(RemoteListResult {
        remote: scan.remote,
        agents: scan.agents,
        statuses,
    })
}

/// 从远端 Agent 目录导入一个 skill 到本机 hub。
pub fn remote_import_skill(
    name: &str,
    agent: AgentKind,
    skill_name: &str,
    force: bool,
    dry_run: bool,
) -> Result<RemoteImportResult> {
    let config = load_config()?;
    let remote = config
        .remotes
        .get(name)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("remote not found: {name}"))?;
    let dir_name = safe_skill_dir_name(skill_name)?;
    let scan = remote_scan(name, &[agent])?;
    let skill = scan
        .agents
        .iter()
        .flat_map(|agent_scan| &agent_scan.skills)
        .find(|skill| skill.dir_name == dir_name || skill.name == skill_name)
        .ok_or_else(|| anyhow::anyhow!("remote skill not found: {skill_name}"))?;
    let hub_path = config.hub_dir.join(&dir_name);

    if hub_path.exists() && !force {
        anyhow::bail!("skill already exists in hub: {}", hub_path.display());
    }

    if !dry_run {
        if hub_path.exists() {
            fs::remove_dir_all(&hub_path)?;
        }
        if let Some(parent) = hub_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut rsync = Command::new("rsync");
        rsync.arg("-az");
        if let Some(port) = remote.port {
            rsync.arg("-e").arg(format!("ssh -p {port}"));
        }
        rsync.arg(format!("{}:{}/", remote_spec(&remote), skill.path));
        rsync.arg(format!("{}/", hub_path.display()));
        let output = rsync.output()?;
        if !output.status.success() {
            anyhow::bail!(
                "remote import failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    Ok(RemoteImportResult {
        remote,
        agent,
        skill_name: dir_name,
        remote_path: skill.path.clone(),
        hub_path,
        imported: !dry_run,
    })
}

/// 只同步单个本机 hub skill 到远端指定 Agent。
pub fn remote_sync_skill(
    name: &str,
    agent: AgentKind,
    skill_name: &str,
    sync_method: SyncMethod,
    dry_run: bool,
) -> Result<RemoteSkillSyncResult> {
    let config = load_config()?;
    let remote = config
        .remotes
        .get(name)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("remote not found: {name}"))?;
    let dir_name = safe_skill_dir_name(skill_name)?;
    let hub_skill = crate::scan_skill_directory(&config.hub_dir)?
        .into_iter()
        .find(|skill| skill.dir_name == dir_name || skill.name == skill_name)
        .ok_or_else(|| anyhow::anyhow!("skill not found in hub: {skill_name}"))?;

    remote_sync_skill_from_path(remote, agent, &hub_skill, sync_method, dry_run)
}

/// 从本机某个 Agent 目录同步单个 skill 到远端指定 Agent。
pub fn remote_sync_local_agent_skill(
    name: &str,
    source_agent: AgentKind,
    target_agent: AgentKind,
    skill_name: &str,
    sync_method: SyncMethod,
    dry_run: bool,
) -> Result<RemoteSkillSyncResult> {
    let config = load_config()?;
    let remote = config
        .remotes
        .get(name)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("remote not found: {name}"))?;
    let dir_name = safe_skill_dir_name(skill_name)?;
    let source_dir = &config.agents[&source_agent].skills_dir;
    let skill = crate::scan_skill_directory(source_dir)?
        .into_iter()
        .find(|skill| skill.dir_name == dir_name || skill.name == skill_name)
        .ok_or_else(|| anyhow::anyhow!("skill not found in local agent: {source_agent:?}/{skill_name}"))?;

    remote_sync_skill_from_path(remote, target_agent, &skill, sync_method, dry_run)
}

fn remote_sync_skill_from_path(
    remote: RemoteHost,
    agent: AgentKind,
    skill: &crate::SkillInfo,
    sync_method: SyncMethod,
    dry_run: bool,
) -> Result<RemoteSkillSyncResult> {
    let source_path = skill.symlink_target.clone().unwrap_or_else(|| skill.path.clone());
    let remote_hub_path = format!("~/.agents/skills/{}", skill.dir_name);
    let remote_agent_path = format!("{}/{}", remote_agent_dir(agent), skill.dir_name);

    if dry_run {
        return Ok(RemoteSkillSyncResult {
            remote,
            agent,
            skill_name: skill.dir_name.clone(),
            source_path,
            remote_hub_path,
            remote_agent_path,
            status: LinkStatus::DryRun,
            reason: None,
        });
    }

    run_remote_shell(
        &remote,
        &format!(
            r#"set -eu
hub_skill={remote_hub_path:?}
eval hub_skill="$hub_skill"
mkdir -p "$hub_skill""#
        ),
    )?;

    let mut rsync = Command::new("rsync");
    rsync.args(["-az", "--delete"]);
    if let Some(port) = remote.port {
        rsync.arg("-e").arg(format!("ssh -p {port}"));
    }
    rsync.arg(format!("{}/", source_path.display()));
    rsync.arg(format!("{}:{}/", remote_spec(&remote), remote_hub_path));
    let output = rsync.output()?;
    if !output.status.success() {
        anyhow::bail!(
            "remote single skill sync failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let output = run_remote_shell(
        &remote,
        &remote_single_skill_link_shell(
            agent,
            &skill.dir_name,
            &remote_hub_path,
            &remote_agent_path,
            sync_method,
        ),
    )?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let (status, reason) = if stdout.starts_with("conflict:") {
        (LinkStatus::Conflict, Some(stdout))
    } else if stdout.starts_with("copied:") {
        (LinkStatus::Copied, None)
    } else {
        (LinkStatus::Linked, None)
    };

    Ok(RemoteSkillSyncResult {
        remote,
        agent,
        skill_name: skill.dir_name.clone(),
        source_path,
        remote_hub_path,
        remote_agent_path,
        status,
        reason,
    })
}

/// 从远端 Agent 目录安全移除一个 skill；真实目录会移动到远端备份目录。
pub fn remote_remove_skill(
    name: &str,
    agent: AgentKind,
    skill_name: &str,
    dry_run: bool,
) -> Result<RemoteRemoveResult> {
    let config = load_config()?;
    let remote = config
        .remotes
        .get(name)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("remote not found: {name}"))?;
    let dir_name = safe_skill_dir_name(skill_name)?;
    let remote_dir = remote_agent_dir(agent);
    let remote_path = format!("{remote_dir}/{dir_name}");
    let backup_path = format!("~/.agents/skills-hub-backups/$(date +%Y%m%d-%H%M%S)/{}/{dir_name}", agent.as_str());
    let script = format!(
        r#"set -eu
target={remote_path:?}
eval target="$target"
backup={backup_path:?}
eval backup="$backup"
if [ ! -e "$target" ] && [ ! -L "$target" ]; then
  echo "target does not exist: $target" >&2
  exit 2
fi
if [ -L "$target" ]; then
  rm "$target"
  echo ""
else
  mkdir -p "$(dirname "$backup")"
  mv "$target" "$backup"
  echo "$backup"
fi"#,
    );

    let mut backup = None;
    if !dry_run {
        let mut command = Command::new("ssh");
        if let Some(port) = remote.port {
            command.args(["-p", &port.to_string()]);
        }
        command.arg(remote_spec(&remote));
        command.arg(script);
        let output = command.output()?;
        if !output.status.success() {
            anyhow::bail!(
                "remote remove failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            backup = Some(stdout);
        }
    }

    Ok(RemoteRemoveResult {
        remote,
        agent,
        skill_name: dir_name,
        remote_path,
        backup_path: backup,
        removed: !dry_run,
    })
}

fn remote_agent_dir(agent: AgentKind) -> &'static str {
    match agent {
        AgentKind::Codex => "~/.codex/skills",
        AgentKind::Claude => "~/.claude/skills",
        AgentKind::Cursor => "~/.cursor/skills",
        AgentKind::OpenClaw => "~/.openclaw/skills",
    }
}

fn remote_agent_markers(agent: AgentKind) -> Vec<&'static str> {
    match agent {
        AgentKind::Codex => vec!["~/.codex", "~/.codex/config.toml"],
        AgentKind::Claude => vec!["~/.claude", "~/.claude.json"],
        AgentKind::Cursor => vec!["~/.cursor"],
        AgentKind::OpenClaw => vec!["~/.openclaw"],
    }
}

#[derive(Debug, Deserialize)]
struct RemoteSkillScanPayload {
    available: bool,
    skills: Vec<RemoteSkillInfo>,
}

fn run_remote_skill_scan(
    remote: &RemoteHost,
    agent: AgentKind,
) -> Result<(bool, Vec<RemoteSkillInfo>)> {
    let dir = remote_agent_dir(agent);
    let markers = remote_agent_markers(agent);
    let script = format!(
        r#"
import json, os, re
root = os.path.expanduser({dir:?})
markers = [os.path.expanduser(item) for item in {markers:?}]
available = any(os.path.exists(item) for item in markers)
items = []
if os.path.isdir(root):
    for current, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        if 'SKILL.md' not in files:
            continue
        path = os.path.join(current, 'SKILL.md')
        try:
            content = open(path, 'r', encoding='utf-8').read()
        except Exception:
            continue
        name = os.path.basename(current)
        desc = None
        m = re.match(r'^---\s*\n(.*?)\n---', content, re.S)
        if m:
            for line in m.group(1).splitlines():
                if line.startswith('name:'):
                    name = line.split(':', 1)[1].strip().strip('"\'') or name
                elif line.startswith('description:'):
                    desc = line.split(':', 1)[1].strip().strip('"\'') or None
        items.append({{'name': name, 'dir_name': os.path.basename(current), 'path': current, 'description': desc}})
        dirs[:] = []
print(json.dumps({{'available': available, 'skills': items}}, ensure_ascii=False))
"#
    );
    let mut command = Command::new("ssh");
    if let Some(port) = remote.port {
        command.args(["-p", &port.to_string()]);
    }
    command.arg(remote_spec(remote));
    command.arg(format!("python3 - <<'PY'\n{script}\nPY"));
    let output = command.output()?;
    if !output.status.success() {
        anyhow::bail!(
            "remote scan failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let payload: RemoteSkillScanPayload = serde_json::from_slice(&output.stdout)?;
    Ok((payload.available, payload.skills))
}
