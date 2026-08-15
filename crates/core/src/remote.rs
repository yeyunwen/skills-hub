use crate::{
    default_source_id, load_config, parse_git_url, safe_skill_dir_name, save_config, AgentKind,
    InstallOptions, InstallResult, LinkStatus, RemoteHost, SkillSource, SourceScanResult,
    SyncMethod,
};
use anyhow::Result;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

pub const REMOTE_HUB_DIR: &str = "~/.agents/skills";
pub const REMOTE_HUB_SHELL_DIR: &str = "$HOME/.agents/skills";

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
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
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
/// 生成/执行跨环境同步计划；默认通过 SSH、rsync 和远端 helper 工作，不要求远端预装 skh。
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
    let remote_hub_dir = REMOTE_HUB_DIR.to_string();
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
        .map(|agent| format!("{}:{}", agent.as_str(), remote_agent_dir(agent)))
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        r#"set -eu
hub="{}"
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
        REMOTE_HUB_SHELL_DIR,
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
    /// 是否是 Agent 目录中的符号链接。
    #[serde(default)]
    pub is_symlink: bool,
    /// 符号链接解析后的目标路径。
    #[serde(default)]
    pub symlink_target: Option<String>,
    /// Skill 目录内容哈希，用于跨环境比较。
    #[serde(default)]
    pub content_hash: Option<String>,
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

/// 远端独立环境的 Hub 与 Agent 扫描结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteEnvironmentSnapshot {
    /// SSH 环境配置。
    pub remote: RemoteHost,
    /// 远端 Hub 中的 Skill。
    pub hub: Vec<RemoteSkillInfo>,
    /// 各 Agent 目录中的 Skill。
    pub agents: Vec<RemoteAgentScanResult>,
}

/// 远端执行环境能力。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteCapabilities {
    /// SSH 本身是否可连接。
    pub ssh: bool,
    /// 是否存在 rsync。
    pub rsync: bool,
    /// 是否存在 git。
    pub git: bool,
    /// 是否存在 Python3 helper 运行时。
    pub python3: bool,
    /// 是否存在可选的 skh 命令。
    pub skh: bool,
    /// 能力检测失败时的说明。
    pub message: Option<String>,
}

/// 检测远端 helper 所需的命令能力。
pub fn check_remote_capabilities(name: &str) -> Result<RemoteCapabilities> {
    let config = load_config()?;
    let remote = config
        .remotes
        .get(name)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("remote not found: {name}"))?;
    let mut command = Command::new("ssh");
    if let Some(port) = remote.port {
        command.args(["-p", &port.to_string()]);
    }
    command.arg(remote_spec(&remote));
    command.arg("sh -lc 'for tool in rsync git python3 skh; do if command -v \"$tool\" >/dev/null 2>&1; then printf \"%s=1\\n\" \"$tool\"; else printf \"%s=0\\n\" \"$tool\"; fi; done'");
    let output = command.output()?;
    if !output.status.success() {
        return Ok(RemoteCapabilities {
            ssh: false,
            rsync: false,
            git: false,
            python3: false,
            skh: false,
            message: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        });
    }
    let mut values = std::collections::BTreeMap::new();
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some((name, value)) = line.split_once('=') {
            values.insert(name, value == "1");
        }
    }
    Ok(RemoteCapabilities {
        ssh: true,
        rsync: values.get("rsync").copied().unwrap_or(false),
        git: values.get("git").copied().unwrap_or(false),
        python3: values.get("python3").copied().unwrap_or(false),
        skh: values.get("skh").copied().unwrap_or(false),
        message: None,
    })
}

/// 扫描远端自己的 Hub 与 Agent 目录，不读取本机 Hub。
pub fn remote_environment_snapshot(
    name: &str,
    agents: &[AgentKind],
) -> Result<RemoteEnvironmentSnapshot> {
    let config = load_config()?;
    let remote = config
        .remotes
        .get(name)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("remote not found: {name}"))?;
    let (_, hub) = run_remote_skill_scan_at(&remote, REMOTE_HUB_DIR, &[REMOTE_HUB_DIR])?;
    let scan = remote_scan(name, agents)?;
    Ok(RemoteEnvironmentSnapshot {
        remote,
        hub,
        agents: scan.agents,
    })
}

/// 只扫描远端环境自己的 Hub。
pub fn remote_scan_hub(name: &str) -> Result<(RemoteHost, Vec<RemoteSkillInfo>)> {
    let config = load_config()?;
    let remote = config
        .remotes
        .get(name)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("remote not found: {name}"))?;
    let (_, hub) = run_remote_skill_scan_at(&remote, REMOTE_HUB_DIR, &[REMOTE_HUB_DIR])?;
    Ok((remote, hub))
}

/// 列出 SSH 环境自己登记的安装来源。
pub fn remote_list_sources(name: &str) -> Result<Vec<SkillSource>> {
    let remote = get_remote(name)?;
    run_remote_source_helper(&remote, serde_json::json!({ "op": "list" }))
}

/// 在 SSH 环境自己的配置中登记安装来源。
pub fn remote_add_source(
    name: &str,
    id: Option<String>,
    url: String,
    branch: Option<String>,
    dry_run: bool,
) -> Result<SkillSource> {
    let remote = get_remote(name)?;
    let id = id.unwrap_or_else(|| default_source_id(&url));
    let kind = serde_json::to_value(parse_git_url(&url).kind)?;
    run_remote_source_helper(
        &remote,
        serde_json::json!({
            "op": "add",
            "id": id,
            "url": url,
            "branch": branch,
            "kind": kind,
            "dry_run": dry_run,
        }),
    )
}

/// 删除 SSH 环境中的来源登记，不删除已安装 Skill。
pub fn remote_remove_source(
    name: &str,
    source_id: &str,
    dry_run: bool,
) -> Result<Option<SkillSource>> {
    let remote = get_remote(name)?;
    run_remote_source_helper(
        &remote,
        serde_json::json!({
            "op": "remove",
            "source_ref": source_id,
            "dry_run": dry_run,
        }),
    )
}

/// 在 SSH 环境内准备并扫描来源。
pub fn remote_scan_source(name: &str, source_ref: &str, dry_run: bool) -> Result<SourceScanResult> {
    let remote = get_remote(name)?;
    run_remote_source_helper(
        &remote,
        serde_json::json!({
            "op": "scan",
            "source_ref": source_ref,
            "dry_run": dry_run,
        }),
    )
}

/// 读取 SSH 环境中已经存在的来源缓存，不执行远端 Git 网络更新。
pub fn remote_scan_cached_source(name: &str, source_ref: &str) -> Result<Option<SourceScanResult>> {
    let remote = get_remote(name)?;
    run_remote_source_helper(
        &remote,
        serde_json::json!({
            "op": "cached-scan",
            "source_ref": source_ref,
        }),
    )
}

/// 从 SSH 环境自己的来源安装 Skill 到该环境 Hub。
pub fn remote_install_from_source(
    name: &str,
    source_ref: &str,
    options: InstallOptions,
) -> Result<InstallResult> {
    let remote = get_remote(name)?;
    run_remote_source_helper(
        &remote,
        serde_json::json!({
            "op": "install",
            "source_ref": source_ref,
            "skills": options.skills,
            "all": options.all,
            "force": options.force,
            "dry_run": options.dry_run,
        }),
    )
}

fn get_remote(name: &str) -> Result<RemoteHost> {
    load_config()?
        .remotes
        .get(name)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("remote not found: {name}"))
}

fn run_remote_source_helper<T: DeserializeOwned>(
    remote: &RemoteHost,
    payload: serde_json::Value,
) -> Result<T> {
    let encoded = serde_json::to_vec(&payload)?
        .into_iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let helper = REMOTE_SOURCE_HELPER.replace("__REMOTE_HUB_DIR__", REMOTE_HUB_DIR);
    let script = format!(
        "import json\npayload = json.loads(bytes.fromhex({encoded:?}).decode('utf-8'))\n{helper}"
    );
    let output = run_remote_shell(remote, &format!("python3 - <<'PY'\n{script}\nPY"))?;
    serde_json::from_slice(&output.stdout).map_err(Into::into)
}

const REMOTE_SOURCE_HELPER: &str = r#"
import datetime
import json
import os
import re
import shutil
import subprocess

config_path = os.path.expanduser('~/.config/skills-hub/config.json')
cache_root = os.path.expanduser('~/.cache/skills-hub/sources')
hub_root = os.path.expanduser('__REMOTE_HUB_DIR__')

def load_config():
    if not os.path.isfile(config_path):
        return {'sources': {}}
    with open(config_path, 'r', encoding='utf-8') as handle:
        data = json.load(handle)
    data.setdefault('sources', {})
    return data

def save_config(data):
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    with open(config_path, 'w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write('\n')

def run_git(args, cwd=None):
    result = subprocess.run(['git', *args], cwd=cwd, text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or 'git command failed')
    return result.stdout.strip()

def prepare_source(source, refresh=True):
    expanded = os.path.expanduser(source['url'])
    if os.path.isdir(expanded):
        return os.path.realpath(expanded)
    root = os.path.join(cache_root, source['id'])
    branch = source.get('branch')
    if os.path.isdir(os.path.join(root, '.git')):
        if refresh:
            run_git(['fetch', '--prune'], root)
            if branch:
                run_git(['checkout', branch], root)
            run_git(['pull', '--ff-only'], root)
    else:
        if not refresh:
            return None
        os.makedirs(cache_root, exist_ok=True)
        args = ['clone', '--depth', '1']
        if branch:
            args.extend(['--branch', branch])
        args.extend([source['url'], root])
        run_git(args)
    return root

def parse_skill(root, current):
    skill_file = os.path.join(current, 'SKILL.md')
    try:
        content = open(skill_file, 'r', encoding='utf-8').read()
    except Exception:
        return None
    dir_name = os.path.basename(current)
    name = dir_name
    description = None
    frontmatter = re.match(r'^---\s*\n(.*?)\n---', content, re.S)
    if frontmatter:
        for line in frontmatter.group(1).splitlines():
            if line.startswith('name:'):
                name = line.split(':', 1)[1].strip().strip('\"\'') or dir_name
            elif line.startswith('description:'):
                description = line.split(':', 1)[1].strip().strip('\"\'') or None
    return {
        'name': name,
        'source_path': os.path.relpath(current, root),
        'description': description,
        'installed': os.path.lexists(os.path.join(hub_root, dir_name)),
        'hub_path': os.path.join(hub_root, dir_name),
    }

def scan_source(config, source, persist, refresh=True):
    root = prepare_source(source, refresh)
    if root is None:
        return None
    skills = []
    for current, dirs, files in os.walk(root):
        dirs[:] = [item for item in dirs if not item.startswith('.')]
        if 'SKILL.md' in files:
            item = parse_skill(root, current)
            if item:
                skills.append(item)
            dirs[:] = []
    skills.sort(key=lambda item: item['name'].lower())
    if refresh:
        source['skill_count'] = len(skills)
        source['last_scan_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        source['last_commit'] = None
        if os.path.isdir(os.path.join(root, '.git')):
            try:
                source['last_commit'] = run_git(['rev-parse', 'HEAD'], root)
            except Exception:
                pass
        if persist:
            config['sources'][source['id']] = source
            save_config(config)
    return {'source': source, 'root': root, 'skills': skills}

config = load_config()
op = payload['op']
dry_run = bool(payload.get('dry_run', False))

if op == 'list':
    result = sorted(config['sources'].values(), key=lambda item: item['id'].lower())
elif op == 'add':
    source = {
        'id': payload['id'],
        'url': payload['url'],
        'branch': payload.get('branch'),
        'kind': payload['kind'],
        'skill_count': None,
        'last_scan_at': None,
        'last_commit': None,
    }
    if not dry_run:
        config['sources'][source['id']] = source
        save_config(config)
    result = source
elif op == 'remove':
    result = config['sources'].get(payload['source_ref'])
    if result is not None and not dry_run:
        del config['sources'][payload['source_ref']]
        save_config(config)
elif op in ('scan', 'cached-scan', 'install'):
    source_ref = payload['source_ref']
    if source_ref not in config['sources']:
        raise RuntimeError('source not found: ' + source_ref)
    source = dict(config['sources'][source_ref])
    if op == 'cached-scan':
        result = scan_source(config, source, False, False)
        print(json.dumps(result, ensure_ascii=False))
        raise SystemExit(0)
    if op == 'scan':
        scan = scan_source(config, source, not dry_run, True)
    else:
        scan = scan_source(config, source, False, False)
        if scan is None:
            scan = scan_source(config, source, not dry_run, True)
    if op == 'scan':
        result = scan
    else:
        wanted = {item.lower() for item in payload.get('skills', [])}
        selected = scan['skills'] if payload.get('all') else [item for item in scan['skills'] if item['name'].lower() in wanted]
        if not selected:
            raise RuntimeError('no skills selected')
        installed = []
        skipped = []
        os.makedirs(hub_root, exist_ok=True)
        for item in selected:
            source_dir = os.path.join(scan['root'], item['source_path'])
            target = item['hub_path']
            if os.path.lexists(target) and not payload.get('force'):
                skipped.append([item['name'], 'hub already contains this skill'])
                continue
            if not dry_run:
                if os.path.lexists(target):
                    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
                    backup = os.path.expanduser(f'~/.config/skills-hub/backups/source-install/{stamp}/{os.path.basename(target)}')
                    os.makedirs(os.path.dirname(backup), exist_ok=True)
                    shutil.move(target, backup)
                shutil.copytree(source_dir, target, symlinks=True)
            item['installed'] = True
            installed.append(item)
        result = {'installed': installed, 'skipped': skipped}
else:
    raise RuntimeError('unsupported source operation: ' + op)

print(json.dumps(result, ensure_ascii=False))
"#;

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
/// 默认通过 SSH 执行 Python3 helper 解析远端 `SKILL.md`。
/// 如果远端缺少 Python3，会返回能力错误；远端 skh 作为可选执行器保留。
pub fn remote_scan(name: &str, agents: &[AgentKind]) -> Result<RemoteScanResult> {
    let config = load_config()?;
    let remote = config
        .remotes
        .get(name)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("remote not found: {name}"))?;
    let mut results = Vec::new();
    for agent in agents {
        let dir = remote_agent_dir(agent);
        let (available, skills) = run_remote_skill_scan(&remote, agent)?;
        results.push(RemoteAgentScanResult {
            agent: agent.clone(),
            available,
            skills_dir: dir,
            skills,
        });
    }
    Ok(RemoteScanResult {
        remote,
        agents: results,
    })
}

/// 兼容旧 CLI 的远端对比接口。
///
/// 新 GUI 应通过环境快照和显式跨环境对比接口使用，不把本机 Hub 默认视为远端真源。
pub fn remote_list(name: &str, agents: &[AgentKind]) -> Result<RemoteListResult> {
    let config = load_config()?;
    let hub_skills = crate::scan_skill_root(&config.hub_dir)?;
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
                    agent: agent_scan.agent.clone(),
                    status: RemoteSkillStatusKind::Synced,
                    remote_path: Some(path.clone()),
                });
            } else {
                statuses.push(RemoteSkillStatus {
                    skill_name: hub_name.clone(),
                    agent: agent_scan.agent.clone(),
                    status: RemoteSkillStatusKind::Missing,
                    remote_path: None,
                });
            }
        }
        for (remote_name, path) in remote_names {
            if !hub_names.contains(&remote_name) {
                statuses.push(RemoteSkillStatus {
                    skill_name: remote_name,
                    agent: agent_scan.agent.clone(),
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
    let scan = remote_scan(name, std::slice::from_ref(&agent))?;
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
    let hub_skill = crate::scan_skill_root(&config.hub_dir)?
        .into_iter()
        .find(|skill| skill.dir_name == dir_name || skill.name == skill_name)
        .ok_or_else(|| anyhow::anyhow!("skill not found in hub: {skill_name}"))?;

    remote_sync_skill_from_path(remote, agent, &hub_skill, sync_method, dry_run)
}

/// 将远端环境 Hub 中已有的 Skill 分发到该环境的 Agent，不经过本机 Hub。
pub fn remote_link_hub_skill(
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
    let (_, hub_skills) = remote_scan_hub(name)?;
    let hub_skill = hub_skills
        .into_iter()
        .find(|skill| skill.dir_name == dir_name || skill.name == skill_name)
        .ok_or_else(|| anyhow::anyhow!("skill not found in remote hub: {skill_name}"))?;
    let remote_hub_path = hub_skill.symlink_target.unwrap_or(hub_skill.path);
    let remote_agent_path = format!("{}/{}", remote_agent_dir(&agent), hub_skill.dir_name);
    if dry_run {
        return Ok(RemoteSkillSyncResult {
            remote,
            agent: agent.clone(),
            skill_name: hub_skill.dir_name,
            source_path: PathBuf::from(&remote_hub_path),
            remote_hub_path,
            remote_agent_path,
            status: LinkStatus::DryRun,
            reason: None,
        });
    }
    let output = run_remote_shell(
        &remote,
        &remote_single_skill_link_shell(
            agent.clone(),
            &hub_skill.dir_name,
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
        skill_name: hub_skill.dir_name,
        source_path: PathBuf::from(&remote_hub_path),
        remote_hub_path,
        remote_agent_path,
        status,
        reason,
    })
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
    let skill = crate::scan_skill_root(source_dir)?
        .into_iter()
        .find(|skill| skill.dir_name == dir_name || skill.name == skill_name)
        .ok_or_else(|| {
            anyhow::anyhow!("skill not found in local agent: {source_agent:?}/{skill_name}")
        })?;

    remote_sync_skill_from_path(remote, target_agent, &skill, sync_method, dry_run)
}

fn remote_sync_skill_from_path(
    remote: RemoteHost,
    agent: AgentKind,
    skill: &crate::SkillInfo,
    sync_method: SyncMethod,
    dry_run: bool,
) -> Result<RemoteSkillSyncResult> {
    let source_path = skill
        .symlink_target
        .clone()
        .unwrap_or_else(|| skill.path.clone());
    let remote_hub_path = format!("{REMOTE_HUB_DIR}/{}", skill.dir_name);
    let remote_agent_path = format!("{}/{}", remote_agent_dir(&agent), skill.dir_name);

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
            agent.clone(),
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
    let remote_dir = remote_agent_dir(&agent);
    let remote_path = format!("{remote_dir}/{dir_name}");
    let backup_path = format!(
        "~/.agents/skills-hub-backups/$(date +%Y%m%d-%H%M%S)/{}/{dir_name}",
        agent.as_str()
    );
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

fn remote_agent_dir(agent: &AgentKind) -> String {
    match agent.as_str() {
        "codex" => "~/.codex/skills".into(),
        "claude" => "~/.claude/skills".into(),
        "cursor" => "~/.cursor/skills".into(),
        "openclaw" => "~/.openclaw/skills".into(),
        "agents" => "~/.agents/skills".into(),
        "hermes" => "~/.hermes/skills".into(),
        "continue" => "~/.continue/skills".into(),
        "windsurf" => "~/.codeium/windsurf/skills".into(),
        "trae" => "~/.trae/skills".into(),
        "qoder" => "~/.qoder/skills".into(),
        "zode" => "~/.zode/skills".into(),
        id => format!("~/.{id}/skills"),
    }
}

fn remote_agent_markers(agent: &AgentKind) -> Vec<String> {
    match agent.as_str() {
        "codex" => vec!["~/.codex".into(), "~/.codex/config.toml".into()],
        "claude" => vec!["~/.claude".into(), "~/.claude.json".into()],
        "cursor" => vec!["~/.cursor".into()],
        _ => vec![remote_agent_dir(agent)],
    }
}

#[derive(Debug, Deserialize)]
struct RemoteSkillScanPayload {
    available: bool,
    skills: Vec<RemoteSkillInfo>,
}

fn run_remote_skill_scan(
    remote: &RemoteHost,
    agent: &AgentKind,
) -> Result<(bool, Vec<RemoteSkillInfo>)> {
    let dir = remote_agent_dir(agent);
    let markers = remote_agent_markers(agent);
    let marker_refs = markers.iter().map(String::as_str).collect::<Vec<_>>();
    run_remote_skill_scan_at(remote, &dir, &marker_refs)
}

fn run_remote_skill_scan_at(
    remote: &RemoteHost,
    dir: &str,
    markers: &[&str],
) -> Result<(bool, Vec<RemoteSkillInfo>)> {
    let script = format!(
        r#"
import hashlib, json, os, re
root = os.path.expanduser({dir:?})
markers = [os.path.expanduser(item) for item in {markers:?}]
available = any(os.path.exists(item) for item in markers)
items = []
seen = set()
def append_skill(current):
    real_root = os.path.realpath(current)
    if real_root in seen:
        return
    seen.add(real_root)
    path = os.path.join(real_root, 'SKILL.md')
    if not os.path.isfile(path):
        return
    try:
        content = open(path, 'r', encoding='utf-8').read()
    except Exception:
        return
    name = os.path.basename(current)
    desc = None
    m = re.match(r'^---\s*\n(.*?)\n---', content, re.S)
    if m:
        for line in m.group(1).splitlines():
            if line.startswith('name:'):
                name = line.split(':', 1)[1].strip().strip('"\'') or name
            elif line.startswith('description:'):
                desc = line.split(':', 1)[1].strip().strip('"\'') or None
    digest = hashlib.sha256()
    for hash_root, hash_dirs, hash_files in os.walk(real_root):
        hash_dirs[:] = sorted(d for d in hash_dirs if d != '.git')
        for filename in sorted(hash_files):
            file_path = os.path.join(hash_root, filename)
            relative = os.path.relpath(file_path, real_root)
            digest.update(relative.encode('utf-8', errors='replace'))
            try:
                with open(file_path, 'rb') as handle:
                    while True:
                        chunk = handle.read(65536)
                        if not chunk:
                            break
                        digest.update(chunk)
            except Exception:
                continue
    items.append({{
        'name': name,
        'dir_name': os.path.basename(current),
        'path': current,
        'description': desc,
        'is_symlink': os.path.islink(current),
        'symlink_target': os.path.realpath(current) if os.path.islink(current) else None,
        'content_hash': digest.hexdigest(),
    }})

if os.path.isdir(root):
    for entry in os.scandir(root):
        if entry.name.startswith('.'):
            continue
        if entry.is_symlink() or entry.is_dir():
            append_skill(entry.path)
            if not entry.is_symlink():
                for current, dirs, files in os.walk(entry.path):
                    dirs[:] = [d for d in dirs if not d.startswith('.')]
                    if 'SKILL.md' in files:
                        append_skill(current)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_hub_uses_default_agents_directory() {
        assert_eq!(REMOTE_HUB_DIR, "~/.agents/skills");
        assert_eq!(REMOTE_HUB_SHELL_DIR, "$HOME/.agents/skills");
    }
}
