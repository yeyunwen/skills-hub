use skills_hub_core::*;
use std::fs;

#[test]
fn parses_git_urls() {
    let gitlab = parse_git_url("git@gitlab.example.com:team/agent-skills.git");
    assert_eq!(gitlab.kind, SourceKind::Gitlab);
    assert_eq!(gitlab.repo_path.as_deref(), Some("team/agent-skills"));

    let github = parse_git_url("https://github.com/foo/bar.git");
    assert_eq!(github.kind, SourceKind::Github);
    assert_eq!(default_source_id("https://github.com/foo/bar.git"), "foo-bar");
}

#[test]
fn scans_nested_skills() {
    let temp = tempfile::tempdir().unwrap();
    let skill_dir = temp.path().join("skills/demo");
    fs::create_dir_all(&skill_dir).unwrap();
    fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: demo\ndescription: nested skill\n---\nbody",
    )
    .unwrap();

    let skills = scan_skill_directory(temp.path()).unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "demo");
    assert_eq!(skills[0].description.as_deref(), Some("nested skill"));
}

#[test]
fn claude_agent_uses_default_skills_dir() {
    let config = default_config();

    assert_eq!(AgentKind::parse("claude"), Some(AgentKind::Claude));
    assert_eq!(AgentKind::Claude.as_str(), "claude");
    assert!(config.agents[&AgentKind::Claude]
        .skills_dir
        .ends_with(".claude/skills"));
}

#[test]
fn takeover_and_remove_hub_skill_cleans_managed_agent() {
    let temp = tempfile::tempdir().unwrap();
    std::env::set_var("HOME", temp.path());
    let config = init_hub(false).unwrap();

    let hub_skill = config.hub_dir.join("demo");
    fs::create_dir_all(&hub_skill).unwrap();
    fs::write(
        hub_skill.join("SKILL.md"),
        "---\nname: demo\ndescription: hub skill\n---\nbody",
    )
    .unwrap();

    let cursor_skill = config.agents[&AgentKind::Cursor].skills_dir.join("demo");
    fs::create_dir_all(&cursor_skill).unwrap();
    fs::write(
        cursor_skill.join("SKILL.md"),
        "---\nname: demo\ndescription: cursor skill\n---\nbody",
    )
    .unwrap();

    let result = takeover_agent_skill("demo", AgentKind::Cursor, false, SyncMethod::Auto).unwrap();

    assert!(result.backup_path.join("SKILL.md").exists());
    assert!(cursor_skill.exists() || cursor_skill.symlink_metadata().is_ok());
    assert!(matches!(
        result.status,
        LinkStatus::Linked | LinkStatus::Copied
    ));

    let statuses = list_status().unwrap();
    let demo = statuses
        .iter()
        .find(|status| status.skill_name == "demo")
        .unwrap();
    let cursor = demo
        .agents
        .iter()
        .find(|status| status.agent == AgentKind::Cursor)
        .unwrap();
    assert!(matches!(
        cursor.status,
        SkillAgentStatusKind::Linked | SkillAgentStatusKind::Copied
    ));

    let removed = remove_hub_skill("demo", true).unwrap();
    assert_eq!(removed.skill.as_ref().map(|skill| skill.dir_name.as_str()), Some("demo"));
    assert!(!hub_skill.exists());
    assert!(!cursor_skill.exists());
    assert!(cursor_skill.symlink_metadata().is_err());
    assert!(removed
        .agents
        .iter()
        .any(|result| result.agent == AgentKind::Cursor && result.status == LinkStatus::Unlinked));
}
