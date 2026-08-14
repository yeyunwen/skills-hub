use crate::SourceKind;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

/// 解析后的 Git URL 信息，用于判断来源类型和生成默认 source id。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedGitUrl {
    /// 原始 URL。
    pub original: String,
    /// host，例如 `github.com` 或 `gitlab.example.com`。
    pub host: Option<String>,
    /// 仓库路径，例如 `team/agent-skills`。
    pub repo_path: Option<String>,
    /// 来源类型。
    pub kind: SourceKind,
    /// 是否是 Git URL。
    pub is_git: bool,
}

/// 判断并解析 Git URL。
///
/// v1 不实现 libgit2，而是调用系统 `git`，这样 SSH、公司内网 GitLab、credential helper 都能复用用户现有配置。
pub fn parse_git_url(input: &str) -> ParsedGitUrl {
    let input = input.trim().trim_end_matches('/');
    if input.starts_with("git@") {
        let rest = input.trim_start_matches("git@");
        let mut parts = rest.splitn(2, ':');
        let host = parts.next().map(str::to_string);
        let repo_path = parts
            .next()
            .map(|value| value.trim_end_matches(".git").to_string());
        let kind = classify_host(host.as_deref());
        return ParsedGitUrl {
            original: input.to_string(),
            host,
            repo_path,
            kind,
            is_git: true,
        };
    }

    if input.starts_with("ssh://") || input.starts_with("https://") || input.starts_with("http://")
    {
        let without_scheme = input
            .split_once("://")
            .map(|(_, rest)| rest)
            .unwrap_or(input);
        let mut parts = without_scheme.splitn(2, '/');
        let host = parts.next().map(str::to_string);
        let repo_path = parts
            .next()
            .map(|value| value.trim_end_matches(".git").to_string());
        let kind = classify_host(host.as_deref());
        return ParsedGitUrl {
            original: input.to_string(),
            host,
            repo_path,
            kind,
            is_git: true,
        };
    }

    ParsedGitUrl {
        original: input.to_string(),
        host: None,
        repo_path: None,
        kind: SourceKind::Local,
        is_git: false,
    }
}

fn classify_host(host: Option<&str>) -> SourceKind {
    match host.unwrap_or_default() {
        "github.com" => SourceKind::Github,
        host if host.contains("gitlab") => SourceKind::Gitlab,
        _ => SourceKind::GenericGit,
    }
}

/// 从 URL 推导默认 source id。
///
/// Git 仓库优先取 `namespace-repo`，比如 `foo/bar.git` -> `foo-bar`，
/// 这样比只用 repo 名更不容易撞名。
pub fn default_source_id(input: &str) -> String {
    let parsed = parse_git_url(input);
    if let Some(repo_path) = parsed.repo_path {
        let mut parts = repo_path.split('/').filter(|part| !part.is_empty());
        if let Some(first) = parts.next() {
            let mut id = first.to_string();
            for part in parts {
                id.push('-');
                id.push_str(part);
            }
            return id;
        }
    }
    Path::new(input)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "source".to_string())
}

/// clone 或更新 Git repo cache。
///
/// 这里故意使用系统 `git`：SSH key、GitLab token、企业代理都交给用户现有 Git 环境处理。
pub fn clone_or_update_repo(url: &str, branch: Option<&str>, cache_dir: &Path) -> Result<()> {
    if cache_dir.join(".git").exists() {
        run_git(cache_dir, &["fetch", "--prune"])?;
        if let Some(branch) = branch {
            run_git(cache_dir, &["checkout", branch])?;
            run_git(cache_dir, &["pull", "--ff-only"])?;
        } else {
            run_git(cache_dir, &["pull", "--ff-only"])?;
        }
        return Ok(());
    }

    if let Some(parent) = cache_dir.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut args = vec!["clone", "--depth", "1"];
    if let Some(branch) = branch {
        args.extend(["--branch", branch]);
    }
    args.push(url);
    let target = cache_dir.to_string_lossy().to_string();
    args.push(&target);
    run_command("git", &args, None)
}

/// 读取 Git repo 当前 HEAD commit；本地 source 允许返回 None。
pub fn current_commit(repo_dir: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(repo_dir)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<()> {
    run_command("git", args, Some(cwd))
}

fn run_command(bin: &str, args: &[&str], cwd: Option<&Path>) -> Result<()> {
    let mut command = Command::new(bin);
    command.args(args);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let output = command
        .output()
        .with_context(|| format!("run {bin} {}", args.join(" ")))?;
    if !output.status.success() {
        anyhow::bail!(
            "command failed: {bin} {}\n{}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gitlab_ssh_url() {
        let parsed = parse_git_url("git@gitlab.example.com:team/agent-skills.git");
        assert_eq!(parsed.host.as_deref(), Some("gitlab.example.com"));
        assert_eq!(parsed.repo_path.as_deref(), Some("team/agent-skills"));
        assert_eq!(parsed.kind, SourceKind::Gitlab);
    }

    #[test]
    fn parses_github_https_url() {
        let parsed = parse_git_url("https://github.com/a/b.git");
        assert_eq!(parsed.kind, SourceKind::Github);
        assert_eq!(default_source_id("https://github.com/a/b.git"), "a-b");
    }

    #[test]
    fn default_source_id_keeps_namespace_for_gitlab() {
        assert_eq!(
            default_source_id("git@gitlab.example.com:team/subgroup/agent-skills.git"),
            "team-subgroup-agent-skills"
        );
    }
}
