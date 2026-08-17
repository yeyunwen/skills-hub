//! skills-hub 桌面端 Tauri command 层。
//!
//! 这里不写业务逻辑，只负责把前端 DTO 转换为 core API 调用，并把错误转成字符串返回给前端。
//! 注意：Git clone、SSH、rsync、目录扫描都可能耗时，必须放到 blocking 线程，避免卡住 Tauri 主事件循环。

use serde::{Deserialize, Serialize};
use skills_hub_core::{
    add_remote as core_add_remote, add_source as core_add_source, append_operation_log,
    check_remote_capabilities as core_check_remote_capabilities,
    check_remote_connection as core_check_remote_connection,
    compare_environments as core_compare_environments,
    discover_ssh_hosts as core_discover_ssh_hosts, get_environment as core_get_environment,
    get_preferences as core_get_preferences, get_skill_detail as core_get_skill_detail,
    import_environment_skills as core_import_environment_skills, init_hub as core_init_hub,
    install_from_cached_source as core_install_from_cached_source,
    install_from_source as core_install_from_source, link_skill as core_link_skill,
    list_environments as core_list_environments, list_remotes as core_list_remotes,
    list_sources as core_list_sources, list_status as core_list_status,
    migrate_from_agent as core_migrate_from_agent,
    preview_environment_import as core_preview_environment_import,
    remote_add_source as core_remote_add_source,
    remote_environment_snapshot as core_remote_environment_snapshot,
    remote_import_skill as core_remote_import_skill,
    remote_install_from_source as core_remote_install_from_source,
    remote_link_hub_skill as core_remote_link_hub_skill, remote_list as core_remote_list,
    remote_list_sources as core_remote_list_sources,
    remote_remove_skill as core_remote_remove_skill,
    remote_remove_source as core_remote_remove_source, remote_scan as core_remote_scan,
    remote_scan_cached_source as core_remote_scan_cached_source,
    remote_scan_source as core_remote_scan_source,
    remote_sync_local_agent_skill as core_remote_sync_local_agent_skill, remote_sync_plan,
    remote_sync_skill as core_remote_sync_skill, remove_agent as core_remove_agent,
    remove_agent_skill as core_remove_agent_skill, remove_hub_skill as core_remove_hub_skill,
    remove_remote as core_remove_remote, remove_source as core_remove_source, run_remote_sync,
    scan_all as core_scan_all, scan_cached_source as core_scan_cached_source,
    scan_source as core_scan_source, sync_agents as core_sync_agents,
    takeover_agent_skill as core_takeover_agent_skill,
    transfer_environment_skill as core_transfer_environment_skill,
    trash_environment_skill as core_trash_environment_skill, unlink_skill as core_unlink_skill,
    update_hub_dir as core_update_hub_dir, update_preferences as core_update_preferences,
    upsert_agent as core_upsert_agent, AgentKind, EnvironmentKind, InstallOptions,
    RemoteAgentScanResult, RemoteSkillInfo, SyncMethod, REMOTE_HUB_DIR,
};
use std::{
    fs::{self, File},
    io::Read,
    path::{Component, Path},
};

const MAX_FILE_PREVIEW_BYTES: u64 = 512 * 1024;

/// 添加 source 的前端输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddSourceInput {
    id: Option<String>,
    url: String,
    branch: Option<String>,
    dry_run: Option<bool>,
}

/// 安装 source 中 skills 的前端输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallFromSourceInput {
    source_ref: String,
    skills: Vec<String>,
    all: bool,
    force: bool,
    dry_run: Option<bool>,
}

/// Agent 同步输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncAgentsInput {
    tools: Vec<String>,
    force: bool,
    dry_run: Option<bool>,
    sync_method: Option<String>,
}

/// 单个 skill 分发到一个或多个 Agent 的输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkSkillInput {
    skill_name: String,
    tools: Vec<String>,
    force: Option<bool>,
    dry_run: Option<bool>,
    sync_method: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TakeoverSkillInput {
    skill_name: String,
    agent: String,
    dry_run: Option<bool>,
    sync_method: Option<String>,
}

/// 迁移输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MigrateInput {
    from: String,
    force: bool,
    dry_run: Option<bool>,
}

/// Remote 相关输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddRemoteInput {
    name: String,
    host: String,
    user: Option<String>,
    port: Option<u16>,
    dry_run: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteToolsInput {
    name: String,
    tools: Vec<String>,
    dry_run: Option<bool>,
    sync_method: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteSkillInput {
    name: String,
    agent: String,
    skill_name: String,
    sync_method: Option<String>,
    force: Option<bool>,
    dry_run: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteLocalAgentSkillInput {
    name: String,
    source_agent: String,
    target_agent: String,
    skill_name: String,
    sync_method: Option<String>,
    dry_run: Option<bool>,
}

/// 偏好设置输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePreferencesInput {
    default_sync_method: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateHubDirInput {
    hub_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertAgentInput {
    id: String,
    label: String,
    skills_dir: String,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveAgentConfigInput {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveHubSkillInput {
    skill_name: String,
    force: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveAgentSkillInput {
    skill_name: String,
    agent: String,
    dry_run: Option<bool>,
}

/// 环境上下文输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentInput {
    environment_id: String,
    tools: Option<Vec<String>>,
}

/// 两个环境的比较输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompareEnvironmentsInput {
    source_environment_id: String,
    target_environment_id: String,
}

/// 跨环境传输输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferSkillsInput {
    source_environment_id: String,
    target_environment_id: String,
    skill_names: Vec<String>,
    force: Option<bool>,
    dry_run: Option<bool>,
}

/// 当前环境中的 Skill 与 Agent 操作。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentSkillInput {
    environment_id: String,
    skill_name: String,
    tools: Vec<String>,
    force: Option<bool>,
    dry_run: Option<bool>,
    sync_method: Option<String>,
}

/// 将当前环境中的 Skill 移入回收区。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrashEnvironmentSkillInput {
    environment_id: String,
    skill_name: String,
    dry_run: Option<bool>,
}

/// 本机文件夹或 ZIP 导入预览输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewEnvironmentImportInput {
    environment_id: String,
    source_path: String,
}

/// 把一次性导入来源中的选中 Skill 写入当前环境。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportEnvironmentSkillsInput {
    environment_id: String,
    source_path: String,
    skill_ids: Vec<String>,
    force: Option<bool>,
    dry_run: Option<bool>,
}

/// 环境级来源新增输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentSourceInput {
    environment_id: String,
    id: Option<String>,
    url: String,
    branch: Option<String>,
    dry_run: Option<bool>,
}

/// 环境级来源引用输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentSourceRefInput {
    environment_id: String,
    source_ref: String,
    dry_run: Option<bool>,
}

/// 环境级来源安装输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallEnvironmentSourceInput {
    environment_id: String,
    source_ref: String,
    skills: Vec<String>,
    all: bool,
    force: bool,
    dry_run: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillFileContentDto {
    path: String,
    content: String,
    truncated: bool,
}

/// 环境 helper 能力。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentCapabilitiesDto {
    ssh: bool,
    rsync: bool,
    git: bool,
    python3: bool,
    skh: bool,
    message: Option<String>,
}

/// 统一环境快照。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentSnapshotDto {
    environment: skills_hub_core::EnvironmentSummary,
    capabilities: EnvironmentCapabilitiesDto,
    hub: serde_json::Value,
    agents: serde_json::Value,
    statuses: serde_json::Value,
    sources: serde_json::Value,
    config: serde_json::Value,
}

#[tauri::command]
async fn init_hub() -> Result<serde_json::Value, String> {
    run_blocking(|| log_command("hub.init", "初始化 hub", || core_init_hub(false))).await
}

#[tauri::command]
async fn list_environments() -> Result<serde_json::Value, String> {
    run_blocking(|| to_value(core_list_environments())).await
}

#[tauri::command]
async fn get_environment_snapshot(
    input: EnvironmentInput,
) -> Result<EnvironmentSnapshotDto, String> {
    run_blocking(move || {
        let environment = core_get_environment(&input.environment_id).map_err(to_error)?;
        let tools = match input.tools {
            Some(tools) => parse_agents(&tools)?,
            None => skills_hub_core::load_config()
                .map_err(to_error)?
                .agents
                .into_values()
                .filter(|agent| agent.enabled)
                .map(|agent| agent.kind)
                .collect(),
        };
        match environment.kind {
            EnvironmentKind::Local => {
                let config = core_init_hub(false).map_err(to_error)?;
                let scan = core_scan_all().map_err(to_error)?;
                Ok(EnvironmentSnapshotDto {
                    environment,
                    capabilities: EnvironmentCapabilitiesDto {
                        ssh: true,
                        rsync: command_available("rsync"),
                        git: command_available("git"),
                        python3: command_available("python3"),
                        skh: command_available("skh"),
                        message: None,
                    },
                    hub: serde_json::to_value(scan.hub).map_err(to_error)?,
                    agents: serde_json::to_value(scan.agents).map_err(to_error)?,
                    statuses: serde_json::to_value(core_list_status().map_err(to_error)?)
                        .map_err(to_error)?,
                    sources: serde_json::to_value(core_list_sources().map_err(to_error)?)
                        .map_err(to_error)?,
                    config: serde_json::to_value(config).map_err(to_error)?,
                })
            }
            EnvironmentKind::Remote => {
                let name = environment.name.clone();
                let capabilities = core_check_remote_capabilities(&name).map_err(to_error)?;
                if !capabilities.ssh || !capabilities.python3 {
                    return Ok(EnvironmentSnapshotDto {
                        environment,
                        capabilities: EnvironmentCapabilitiesDto {
                            ssh: capabilities.ssh,
                            rsync: capabilities.rsync,
                            git: capabilities.git,
                            python3: capabilities.python3,
                            skh: capabilities.skh,
                            message: capabilities.message,
                        },
                        hub: serde_json::json!([]),
                        agents: serde_json::json!([]),
                        statuses: serde_json::json!([]),
                        sources: serde_json::json!([]),
                        config: serde_json::json!({
                            "hubDir": REMOTE_HUB_DIR,
                            "configPath": "~/.config/skills-hub/config.json",
                            "backupsDir": "~/.config/skills-hub/backups"
                        }),
                    });
                }
                let snapshot = core_remote_environment_snapshot(&name, &tools).map_err(to_error)?;
                let statuses = build_remote_environment_statuses(&snapshot.hub, &snapshot.agents);
                Ok(EnvironmentSnapshotDto {
                    environment,
                    capabilities: EnvironmentCapabilitiesDto {
                        ssh: capabilities.ssh,
                        rsync: capabilities.rsync,
                        git: capabilities.git,
                        python3: capabilities.python3,
                        skh: capabilities.skh,
                        message: capabilities.message,
                    },
                    hub: serde_json::to_value(snapshot.hub).map_err(to_error)?,
                    agents: serde_json::to_value(snapshot.agents).map_err(to_error)?,
                    statuses: serde_json::Value::Array(statuses),
                    sources: serde_json::to_value(
                        core_remote_list_sources(&name).map_err(to_error)?,
                    )
                    .map_err(to_error)?,
                    config: serde_json::json!({
                        "hubDir": REMOTE_HUB_DIR,
                        "configPath": "~/.config/skills-hub/config.json",
                        "backupsDir": "~/.config/skills-hub/backups"
                    }),
                })
            }
        }
    })
    .await
}

#[tauri::command]
async fn check_environment_connection(environment_id: String) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let environment = core_get_environment(&environment_id).map_err(to_error)?;
        if environment.kind == EnvironmentKind::Local {
            return Ok(serde_json::json!({
                "name": environment.name,
                "status": "connected",
                "message": null,
                "checkedAt": null
            }));
        }
        to_value(core_check_remote_connection(&environment.name))
    })
    .await
}

#[tauri::command]
async fn compare_environments(
    input: CompareEnvironmentsInput,
) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        to_value(core_compare_environments(
            &input.source_environment_id,
            &input.target_environment_id,
        ))
    })
    .await
}

#[tauri::command]
async fn transfer_skills(input: TransferSkillsInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let mut results = Vec::new();
        for skill_name in &input.skill_names {
            results.push(
                core_transfer_environment_skill(
                    &input.source_environment_id,
                    &input.target_environment_id,
                    skill_name,
                    input.force.unwrap_or(false),
                    input.dry_run.unwrap_or(false),
                )
                .map_err(to_error)?,
            );
        }
        serde_json::to_value(results).map_err(to_error)
    })
    .await
}

#[tauri::command]
async fn link_environment_skill(input: EnvironmentSkillInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let environment = core_get_environment(&input.environment_id).map_err(to_error)?;
        let tools = parse_agents(&input.tools)?;
        let method = parse_sync_method(input.sync_method.as_deref().unwrap_or("auto"))?;
        match environment.kind {
            EnvironmentKind::Local => to_value(core_link_skill(
                &input.skill_name,
                &tools,
                input.force.unwrap_or(false),
                input.dry_run.unwrap_or(false),
                method,
            )),
            EnvironmentKind::Remote => {
                let mut results = Vec::new();
                for agent in tools {
                    results.push(
                        core_remote_link_hub_skill(
                            &environment.name,
                            agent,
                            &input.skill_name,
                            method,
                            input.dry_run.unwrap_or(false),
                        )
                        .map_err(to_error)?,
                    );
                }
                serde_json::to_value(results).map_err(to_error)
            }
        }
    })
    .await
}

#[tauri::command]
async fn unlink_environment_skill(
    input: EnvironmentSkillInput,
) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let environment = core_get_environment(&input.environment_id).map_err(to_error)?;
        let tools = parse_agents(&input.tools)?;
        match environment.kind {
            EnvironmentKind::Local => to_value(core_unlink_skill(
                &input.skill_name,
                &tools,
                input.dry_run.unwrap_or(false),
            )),
            EnvironmentKind::Remote => {
                let mut results = Vec::new();
                for agent in tools {
                    results.push(
                        core_remote_remove_skill(
                            &environment.name,
                            agent,
                            &input.skill_name,
                            input.dry_run.unwrap_or(false),
                        )
                        .map_err(to_error)?,
                    );
                }
                serde_json::to_value(results).map_err(to_error)
            }
        }
    })
    .await
}

#[tauri::command]
async fn takeover_environment_skill(
    input: EnvironmentSkillInput,
) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let environment = core_get_environment(&input.environment_id).map_err(to_error)?;
        let agent = input
            .tools
            .first()
            .ok_or_else(|| "takeover requires one agent".to_string())
            .and_then(|agent| parse_agent(agent))?;
        let method = parse_sync_method(input.sync_method.as_deref().unwrap_or("auto"))?;
        match environment.kind {
            EnvironmentKind::Local => to_value(core_takeover_agent_skill(
                &input.skill_name,
                agent,
                input.dry_run.unwrap_or(false),
                method,
            )),
            EnvironmentKind::Remote => {
                let removed = core_remote_remove_skill(
                    &environment.name,
                    agent.clone(),
                    &input.skill_name,
                    input.dry_run.unwrap_or(false),
                )
                .map_err(to_error)?;
                let linked = core_remote_link_hub_skill(
                    &environment.name,
                    agent.clone(),
                    &input.skill_name,
                    method,
                    input.dry_run.unwrap_or(false),
                )
                .map_err(to_error)?;
                Ok(serde_json::json!({
                    "agent": agent,
                    "skillName": input.skill_name,
                    "path": linked.remote_agent_path,
                    "targetPath": linked.remote_hub_path,
                    "backupPath": removed.backup_path,
                    "status": linked.status,
                    "method": method,
                    "reason": linked.reason
                }))
            }
        }
    })
    .await
}

#[tauri::command]
async fn trash_environment_skill(
    input: TrashEnvironmentSkillInput,
) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        to_value(core_trash_environment_skill(
            &input.environment_id,
            &input.skill_name,
            input.dry_run.unwrap_or(false),
        ))
    })
    .await
}

#[tauri::command]
async fn preview_environment_import(
    input: PreviewEnvironmentImportInput,
) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let message = format!("预览 Skill 导入：{}", input.source_path);
        log_command("skill.import.preview", &message, || {
            core_preview_environment_import(&input.environment_id, &input.source_path)
        })
    })
    .await
}

#[tauri::command]
async fn import_environment_skills(
    input: ImportEnvironmentSkillsInput,
) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let message = format!(
            "导入 {} 个 Skill 到环境 {}",
            input.skill_ids.len(),
            input.environment_id
        );
        log_command("skill.import", &message, || {
            core_import_environment_skills(
                &input.environment_id,
                &input.source_path,
                &input.skill_ids,
                input.force.unwrap_or(false),
                input.dry_run.unwrap_or(false),
            )
        })
    })
    .await
}

#[tauri::command]
async fn add_environment_source(
    input: EnvironmentSourceInput,
) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let environment = core_get_environment(&input.environment_id).map_err(to_error)?;
        match environment.kind {
            EnvironmentKind::Local => to_value(core_add_source(
                input.id,
                input.url,
                input.branch,
                input.dry_run.unwrap_or(false),
            )),
            EnvironmentKind::Remote => to_value(core_remote_add_source(
                &environment.name,
                input.id,
                input.url,
                input.branch,
                input.dry_run.unwrap_or(false),
            )),
        }
    })
    .await
}

#[tauri::command]
async fn remove_environment_source(
    input: EnvironmentSourceRefInput,
) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let environment = core_get_environment(&input.environment_id).map_err(to_error)?;
        match environment.kind {
            EnvironmentKind::Local => to_value(core_remove_source(
                &input.source_ref,
                input.dry_run.unwrap_or(false),
            )),
            EnvironmentKind::Remote => to_value(core_remote_remove_source(
                &environment.name,
                &input.source_ref,
                input.dry_run.unwrap_or(false),
            )),
        }
    })
    .await
}

#[tauri::command]
async fn scan_environment_source(
    input: EnvironmentSourceRefInput,
) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let environment = core_get_environment(&input.environment_id).map_err(to_error)?;
        match environment.kind {
            EnvironmentKind::Local => to_value(core_scan_source(
                &input.source_ref,
                input.dry_run.unwrap_or(false),
            )),
            EnvironmentKind::Remote => to_value(core_remote_scan_source(
                &environment.name,
                &input.source_ref,
                input.dry_run.unwrap_or(false),
            )),
        }
    })
    .await
}

#[tauri::command]
async fn get_environment_source_cache(
    input: EnvironmentSourceRefInput,
) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let environment = core_get_environment(&input.environment_id).map_err(to_error)?;
        match environment.kind {
            EnvironmentKind::Local => to_value(core_scan_cached_source(&input.source_ref)),
            EnvironmentKind::Remote => to_value(core_remote_scan_cached_source(
                &environment.name,
                &input.source_ref,
            )),
        }
    })
    .await
}

#[tauri::command]
async fn install_environment_source(
    input: InstallEnvironmentSourceInput,
) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let environment = core_get_environment(&input.environment_id).map_err(to_error)?;
        let options = InstallOptions {
            skills: input.skills,
            all: input.all,
            force: input.force,
            dry_run: input.dry_run.unwrap_or(false),
        };
        match environment.kind {
            EnvironmentKind::Local => {
                to_value(core_install_from_cached_source(&input.source_ref, options))
            }
            EnvironmentKind::Remote => to_value(core_remote_install_from_source(
                &environment.name,
                &input.source_ref,
                options,
            )),
        }
    })
    .await
}

#[tauri::command]
async fn list_sources() -> Result<serde_json::Value, String> {
    run_blocking(|| to_value(core_list_sources())).await
}

#[tauri::command]
async fn add_source(input: AddSourceInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let message = format!("导入来源：{}", input.url);
        log_command("source.add", &message, || {
            core_add_source(
                input.id,
                input.url,
                input.branch,
                input.dry_run.unwrap_or(false),
            )
        })
    })
    .await
}

#[tauri::command]
async fn remove_source(id: String) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let message = format!("删除来源：{id}");
        log_command("source.remove", &message, || core_remove_source(&id, false))
    })
    .await
}

#[tauri::command]
async fn scan_source(source_ref: String) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let message = format!("扫描来源：{source_ref}");
        log_command("source.scan", &message, || {
            core_scan_source(&source_ref, false)
        })
    })
    .await
}

#[tauri::command]
async fn install_from_source(input: InstallFromSourceInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let message = format!("从来源安装技能：{}", input.source_ref);
        log_command("source.install", &message, || {
            core_install_from_source(
                &input.source_ref,
                InstallOptions {
                    skills: input.skills,
                    all: input.all,
                    force: input.force,
                    dry_run: input.dry_run.unwrap_or(false),
                },
            )
        })
    })
    .await
}

#[tauri::command]
async fn get_skill_detail(skill_name: String) -> Result<serde_json::Value, String> {
    run_blocking(move || to_value(core_get_skill_detail(&skill_name))).await
}

#[tauri::command]
async fn read_skill_file(
    skill_name: String,
    file_path: String,
) -> Result<SkillFileContentDto, String> {
    run_blocking(move || {
        let detail = core_get_skill_detail(&skill_name).map_err(to_error)?;
        let relative = Path::new(&file_path);
        if relative.is_absolute()
            || relative.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(format!("invalid skill file path: {file_path}"));
        }

        let root = fs::canonicalize(&detail.info.path).map_err(to_error)?;
        let target = fs::canonicalize(detail.info.path.join(relative)).map_err(to_error)?;
        if !target.starts_with(&root) {
            return Err(format!("refuse to read file outside skill: {file_path}"));
        }

        let metadata = fs::metadata(&target).map_err(to_error)?;
        if !metadata.is_file() {
            return Err(format!("not a file: {file_path}"));
        }

        let mut bytes = Vec::new();
        File::open(&target)
            .map_err(to_error)?
            .take(MAX_FILE_PREVIEW_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(to_error)?;
        let truncated = bytes.len() as u64 > MAX_FILE_PREVIEW_BYTES;
        if truncated {
            bytes.truncate(MAX_FILE_PREVIEW_BYTES as usize);
        }
        let content = String::from_utf8(bytes)
            .map_err(|_| format!("暂不支持预览非 UTF-8 文件：{file_path}"))?;

        Ok(SkillFileContentDto {
            path: file_path,
            content,
            truncated,
        })
    })
    .await
}

#[tauri::command]
async fn remove_hub_skill(input: RemoveHubSkillInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let message = format!("删除 hub skill：{}", input.skill_name);
        log_command("skill.remove", &message, || {
            core_remove_hub_skill(&input.skill_name, input.force)
        })
    })
    .await
}

#[tauri::command]
async fn open_path(path: String) -> Result<(), String> {
    run_blocking(move || opener::open(path).map_err(to_error)).await
}

#[tauri::command]
async fn scan_all() -> Result<serde_json::Value, String> {
    run_blocking(|| to_value(core_scan_all())).await
}

#[tauri::command]
async fn list_status() -> Result<serde_json::Value, String> {
    run_blocking(|| to_value(core_list_status())).await
}

#[tauri::command]
async fn sync_agents(input: SyncAgentsInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let tools = parse_agents(&input.tools)?;
        let method = parse_sync_method(input.sync_method.as_deref().unwrap_or("auto"))?;
        let message = format!("同步 Agent：{}", input.tools.join(","));
        log_command("agents.sync", &message, || {
            core_sync_agents(&tools, input.force, input.dry_run.unwrap_or(false), method)
        })
    })
    .await
}

#[tauri::command]
async fn link_skill_to_agents(input: LinkSkillInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let tools = parse_agents(&input.tools)?;
        let method = parse_sync_method(input.sync_method.as_deref().unwrap_or("auto"))?;
        let message = format!(
            "分发 Skill：{} -> {}",
            input.skill_name,
            input.tools.join(",")
        );
        log_command("agents.link_skill", &message, || {
            core_link_skill(
                &input.skill_name,
                &tools,
                input.force.unwrap_or(false),
                input.dry_run.unwrap_or(false),
                method,
            )
        })
    })
    .await
}

#[tauri::command]
async fn unlink_skill_from_agents(input: LinkSkillInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let tools = parse_agents(&input.tools)?;
        let message = format!(
            "取消分发 Skill：{} -> {}",
            input.skill_name,
            input.tools.join(",")
        );
        log_command("agents.unlink_skill", &message, || {
            core_unlink_skill(&input.skill_name, &tools, input.dry_run.unwrap_or(false))
        })
    })
    .await
}

#[tauri::command]
async fn remove_agent_skill(input: RemoveAgentSkillInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let agent = parse_agent(&input.agent)?;
        let message = format!("移除 Agent Skill：{} -> {}", input.skill_name, input.agent);
        log_command("agents.remove_skill", &message, || {
            core_remove_agent_skill(&input.skill_name, agent, input.dry_run.unwrap_or(false))
        })
    })
    .await
}

#[tauri::command]
async fn takeover_agent_skill(input: TakeoverSkillInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let agent = parse_agent(&input.agent)?;
        let method = parse_sync_method(input.sync_method.as_deref().unwrap_or("auto"))?;
        let message = format!("备份并接管 Skill：{} -> {}", input.skill_name, input.agent);
        log_command("agents.takeover_skill", &message, || {
            core_takeover_agent_skill(
                &input.skill_name,
                agent,
                input.dry_run.unwrap_or(false),
                method,
            )
        })
    })
    .await
}

#[tauri::command]
async fn migrate_from_agent(input: MigrateInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let from = parse_agent(&input.from)?;
        let message = format!("迁移 Agent：{}", input.from);
        log_command("agents.migrate", &message, || {
            core_migrate_from_agent(from, input.force, input.dry_run.unwrap_or(false))
        })
    })
    .await
}

#[tauri::command]
async fn list_remotes() -> Result<serde_json::Value, String> {
    run_blocking(|| to_value(core_list_remotes())).await
}

#[tauri::command]
async fn add_remote(input: AddRemoteInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let message = format!("添加远程设备：{}", input.name);
        log_command("remote.add", &message, || {
            core_add_remote(
                input.name,
                input.host,
                input.user,
                input.port,
                input.dry_run.unwrap_or(false),
            )
        })
    })
    .await
}

#[tauri::command]
async fn remove_remote(name: String) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let message = format!("删除远程设备：{name}");
        log_command("remote.remove", &message, || {
            core_remove_remote(&name, false)
        })
    })
    .await
}

#[tauri::command]
async fn check_remote_connection(name: String) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let message = format!("检测远程连接：{name}");
        log_command("remote.check", &message, || {
            core_check_remote_connection(&name)
        })
    })
    .await
}

#[tauri::command]
async fn remote_scan(input: RemoteToolsInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let tools = parse_agents(&input.tools)?;
        let message = format!("扫描远程设备：{}", input.name);
        log_command("remote.scan", &message, || {
            core_remote_scan(&input.name, &tools)
        })
    })
    .await
}

#[tauri::command]
async fn remote_list(input: RemoteToolsInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let tools = parse_agents(&input.tools)?;
        let message = format!("列出远程设备：{}", input.name);
        log_command("remote.list", &message, || {
            core_remote_list(&input.name, &tools)
        })
    })
    .await
}

#[tauri::command]
async fn remote_sync(input: RemoteToolsInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let tools = parse_agents(&input.tools)?;
        let method = parse_sync_method(input.sync_method.as_deref().unwrap_or("auto"))?;
        let message = format!("同步远程设备：{}", input.name);
        log_command("remote.sync", &message, || {
            let plan = remote_sync_plan(&input.name, &tools, method)?;
            run_remote_sync(&plan, input.dry_run.unwrap_or(false))?;
            Ok(plan)
        })
    })
    .await
}

#[tauri::command]
async fn remote_sync_skill(input: RemoteSkillInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let agent = parse_agent(&input.agent)?;
        let method = parse_sync_method(input.sync_method.as_deref().unwrap_or("auto"))?;
        let message = format!(
            "同步远程单个 Skill：{} {} {}",
            input.name, input.agent, input.skill_name
        );
        log_command("remote.sync_skill", &message, || {
            core_remote_sync_skill(
                &input.name,
                agent,
                &input.skill_name,
                method,
                input.dry_run.unwrap_or(false),
            )
        })
    })
    .await
}

#[tauri::command]
async fn remote_sync_local_agent_skill(
    input: RemoteLocalAgentSkillInput,
) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let source_agent = parse_agent(&input.source_agent)?;
        let target_agent = parse_agent(&input.target_agent)?;
        let method = parse_sync_method(input.sync_method.as_deref().unwrap_or("auto"))?;
        let message = format!(
            "同步本机 Agent Skill 到远端：{} {}:{} -> {}",
            input.name, input.source_agent, input.skill_name, input.target_agent
        );
        log_command("remote.sync_local_agent_skill", &message, || {
            core_remote_sync_local_agent_skill(
                &input.name,
                source_agent,
                target_agent,
                &input.skill_name,
                method,
                input.dry_run.unwrap_or(false),
            )
        })
    })
    .await
}

#[tauri::command]
async fn remote_import_skill(input: RemoteSkillInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let agent = parse_agent(&input.agent)?;
        let message = format!(
            "导入远程 Skill：{} {} {}",
            input.name, input.agent, input.skill_name
        );
        log_command("remote.import_skill", &message, || {
            core_remote_import_skill(
                &input.name,
                agent,
                &input.skill_name,
                input.force.unwrap_or(false),
                input.dry_run.unwrap_or(false),
            )
        })
    })
    .await
}

#[tauri::command]
async fn remote_remove_skill(input: RemoteSkillInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let agent = parse_agent(&input.agent)?;
        let message = format!(
            "移除远程 Skill：{} {} {}",
            input.name, input.agent, input.skill_name
        );
        log_command("remote.remove_skill", &message, || {
            core_remote_remove_skill(
                &input.name,
                agent,
                &input.skill_name,
                input.dry_run.unwrap_or(false),
            )
        })
    })
    .await
}

#[tauri::command]
async fn discover_ssh_hosts() -> Result<serde_json::Value, String> {
    run_blocking(|| to_value(core_discover_ssh_hosts())).await
}

#[tauri::command]
async fn get_preferences() -> Result<serde_json::Value, String> {
    run_blocking(|| to_value(core_get_preferences())).await
}

#[tauri::command]
async fn update_preferences(input: UpdatePreferencesInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let method = parse_sync_method(&input.default_sync_method)?;
        log_command("preferences.update", "更新偏好设置", || {
            core_update_preferences(method)
        })
    })
    .await
}

#[tauri::command]
async fn update_hub_dir(input: UpdateHubDirInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        log_command("hub.directory.update", "更新 Hub 目录", || {
            core_update_hub_dir(&input.hub_dir)
        })
    })
    .await
}

#[tauri::command]
async fn upsert_agent(input: UpsertAgentInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        log_command("agent.config.upsert", "保存 Agent 配置", || {
            core_upsert_agent(&input.id, &input.label, &input.skills_dir, input.enabled)
        })
    })
    .await
}

#[tauri::command]
async fn remove_agent(input: RemoveAgentConfigInput) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        log_command("agent.config.remove", "删除 Agent 配置", || {
            core_remove_agent(&input.id)
        })
    })
    .await
}

#[tauri::command]
async fn get_logs_dir() -> Result<String, String> {
    run_blocking(|| {
        skills_hub_core::logs_dir()
            .map(|path| path.display().to_string())
            .map_err(to_error)
    })
    .await
}

/// 启动 Tauri 应用。
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            init_hub,
            list_environments,
            get_environment_snapshot,
            check_environment_connection,
            compare_environments,
            transfer_skills,
            link_environment_skill,
            unlink_environment_skill,
            takeover_environment_skill,
            trash_environment_skill,
            preview_environment_import,
            import_environment_skills,
            add_environment_source,
            remove_environment_source,
            get_environment_source_cache,
            scan_environment_source,
            install_environment_source,
            list_sources,
            add_source,
            remove_source,
            scan_source,
            install_from_source,
            get_skill_detail,
            read_skill_file,
            remove_hub_skill,
            open_path,
            scan_all,
            list_status,
            sync_agents,
            link_skill_to_agents,
            unlink_skill_from_agents,
            remove_agent_skill,
            takeover_agent_skill,
            migrate_from_agent,
            list_remotes,
            add_remote,
            remove_remote,
            discover_ssh_hosts,
            check_remote_connection,
            remote_scan,
            remote_list,
            remote_sync,
            remote_sync_skill,
            remote_sync_local_agent_skill,
            remote_import_skill,
            remote_remove_skill,
            get_preferences,
            update_preferences,
            update_hub_dir,
            upsert_agent,
            remove_agent,
            get_logs_dir,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run skills-hub desktop");
}

fn parse_agents(values: &[String]) -> Result<Vec<AgentKind>, String> {
    values.iter().map(|value| parse_agent(value)).collect()
}

fn parse_agent(value: &str) -> Result<AgentKind, String> {
    let agent = AgentKind::parse(value).ok_or_else(|| format!("invalid agent id: {value}"))?;
    let config = skills_hub_core::load_config().map_err(to_error)?;
    config
        .agents
        .contains_key(&agent)
        .then_some(agent)
        .ok_or_else(|| format!("agent is not configured: {value}"))
}

fn parse_sync_method(value: &str) -> Result<SyncMethod, String> {
    SyncMethod::parse(value).ok_or_else(|| format!("unknown sync method: {value}"))
}

fn command_available(command: &str) -> bool {
    std::process::Command::new("sh")
        .args(["-lc", &format!("command -v {command} >/dev/null 2>&1")])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn build_remote_environment_statuses(
    hub: &[RemoteSkillInfo],
    agents: &[RemoteAgentScanResult],
) -> Vec<serde_json::Value> {
    hub.iter()
        .map(|hub_skill| {
            let agent_statuses = agents
                .iter()
                .map(|agent| {
                    let found = agent.skills.iter().find(|skill| {
                        skill.dir_name == hub_skill.dir_name || skill.name == hub_skill.name
                    });
                    let (status, path, target_path) = match found {
                        None => (
                            "missing",
                            format!("{}/{}", agent.skills_dir, hub_skill.dir_name),
                            None,
                        ),
                        Some(skill)
                            if skill.is_symlink
                                && skill.symlink_target.as_deref()
                                    == Some(hub_skill.path.as_str()) =>
                        {
                            ("linked", skill.path.clone(), Some(hub_skill.path.clone()))
                        }
                        Some(skill) => ("conflict", skill.path.clone(), None),
                    };
                    serde_json::json!({
                        "agent": agent.agent,
                        "status": status,
                        "path": path,
                        "targetPath": target_path,
                    })
                })
                .collect::<Vec<_>>();
            let all_missing = agent_statuses.iter().all(|status| {
                status.get("status").and_then(serde_json::Value::as_str) == Some("missing")
            });
            let normalized_statuses = if all_missing {
                agent_statuses
                    .into_iter()
                    .map(|mut status| {
                        status["status"] = serde_json::Value::String("hub-only".to_string());
                        status
                    })
                    .collect()
            } else {
                agent_statuses
            };
            serde_json::json!({
                "skillName": hub_skill.dir_name,
                "hubPath": hub_skill.path,
                "agents": normalized_statuses,
            })
        })
        .collect()
}

fn log_command<T: Serialize>(
    operation: &str,
    message: &str,
    action: impl FnOnce() -> anyhow::Result<T>,
) -> Result<serde_json::Value, String> {
    let _ = append_operation_log("info", operation, message);
    match action() {
        Ok(value) => {
            let _ = append_operation_log("info", operation, "完成");
            serde_json::to_value(value).map_err(to_error)
        }
        Err(error) => {
            let error_message = error.to_string();
            let _ = append_operation_log("error", operation, &error_message);
            Err(error_message)
        }
    }
}

fn to_value<T: Serialize>(result: anyhow::Result<T>) -> Result<serde_json::Value, String> {
    result
        .map_err(to_error)
        .and_then(|value| serde_json::to_value(value).map_err(to_error))
}

async fn run_blocking<T: Send + 'static>(action: impl FnOnce() -> T + Send + 'static) -> T {
    tauri::async_runtime::spawn_blocking(action)
        .await
        .expect("blocking command panicked")
}

fn to_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
