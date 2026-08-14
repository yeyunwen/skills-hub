use skills_hub_core::{
    init_hub, link_skill, trash_environment_skill, AgentKind, LinkStatus, SyncMethod,
};
use std::{fs, path::PathBuf};

#[test]
fn local_trash_moves_skill_and_unlinks_managed_agent() {
    let temp = tempfile::tempdir().unwrap();
    std::env::set_var("HOME", temp.path());
    let config = init_hub(false).unwrap();
    let skill_dir = config.hub_dir.join("trash-demo");
    fs::create_dir_all(&skill_dir).unwrap();
    fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: trash-demo\ndescription: trash test\n---\nbody",
    )
    .unwrap();

    let linked = link_skill(
        "trash-demo",
        &[AgentKind::cursor()],
        false,
        false,
        SyncMethod::Auto,
    )
    .unwrap();
    assert!(matches!(
        linked[0].status,
        LinkStatus::Linked | LinkStatus::Copied
    ));

    let result = trash_environment_skill("local", "trash-demo", false).unwrap();
    let trash_path = PathBuf::from(result.trash_path);
    let cursor_path = config.agents[&AgentKind::cursor()]
        .skills_dir
        .join("trash-demo");

    assert!(!skill_dir.exists());
    assert!(trash_path.join("SKILL.md").exists());
    assert!(cursor_path.symlink_metadata().is_err());
}
