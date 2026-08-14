use anyhow::Result;
use clap::{Args, Parser, Subcommand};
use console::{style, Term};
use inquire::MultiSelect;
use skills_hub_core::*;

/// skills-hub 的 Rust CLI 入口。
///
/// CLI 只负责参数解析和展示，所有业务逻辑都在 `skills-hub-core`，与 Tauri GUI 共用同一套能力。
#[derive(Debug, Parser)]
#[command(
    name = "skh",
    version,
    about = "Unified skill hub for AI coding agents"
)]
struct Cli {
    /// 输出 JSON，方便脚本和 GUI sidecar 复用。
    #[arg(long, global = true)]
    json: bool,
    /// 只展示计划，不写文件。
    #[arg(long, global = true)]
    dry_run: bool,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Clone, Copy)]
struct CliContext {
    json: bool,
    dry_run: bool,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// 初始化 hub/config/lock/cache/backups。
    Init,
    /// 管理 Git/本地 skill sources。
    Source(SourceCommand),
    /// 从 source 或本地路径安装 skill 到 hub。
    Install(InstallArgs),
    /// 管理本机 Agent 分发。
    Agent(AgentCommand),
    /// 扫描 hub 和各 Agent 目录的 skill 数量与内容。
    Scan,
    /// 列出 hub skills 以及各 Agent 链接状态。
    List,
    /// 从已有 Agent 目录迁移 skills 到 hub。
    Migrate(MigrateArgs),
    /// 管理远程设备同步。
    Remote(RemoteCommand),
    /// 查看 hub。
    Hub(HubCommand),
}

#[derive(Debug, Args)]
struct SourceCommand {
    #[command(subcommand)]
    command: SourceSubcommand,
}

#[derive(Debug, Subcommand)]
enum SourceSubcommand {
    /// 添加一个 Git 或本地 source。
    Add(SourceAddArgs),
    /// 列出 sources。
    List,
    /// 扫描 source 中的 skills。
    Scan(SourceScanArgs),
    /// 更新 Git cache 后重新扫描。
    Update(SourceScanArgs),
    /// 删除 source 配置。
    Remove(SourceRemoveArgs),
}

#[derive(Debug, Args)]
struct SourceAddArgs {
    /// Git URL 或本地路径。
    url: String,
    /// source id；默认从仓库名/目录名推导。
    #[arg(long)]
    name: Option<String>,
    /// Git 分支。
    #[arg(long)]
    branch: Option<String>,
}

#[derive(Debug, Args)]
struct SourceScanArgs {
    /// source id、Git URL 或本地路径。
    source: String,
}

#[derive(Debug, Args)]
struct SourceRemoveArgs {
    /// source id。
    id: String,
}

#[derive(Debug, Args)]
struct InstallArgs {
    /// source id、Git URL 或本地路径。
    source: String,
    /// 指定安装的 skill，可重复传。
    #[arg(long = "skill")]
    skills: Vec<String>,
    /// 安装全部 skill。
    #[arg(long)]
    all: bool,
    /// 覆盖 hub 中已存在的同名 skill。
    #[arg(long)]
    force: bool,
}

#[derive(Debug, Args)]
struct AgentCommand {
    #[command(subcommand)]
    command: AgentSubcommand,
}

#[derive(Debug, Subcommand)]
enum AgentSubcommand {
    /// 同步 hub 中所有 skills 到本机 Agent。
    Sync(AgentSyncArgs),
}

#[derive(Debug, Args)]
struct AgentSyncArgs {
    /// 目标 Agent ID，逗号分隔。
    #[arg(long)]
    tools: String,
    /// 同步方式：auto 优先 symlink 失败 copy；symlink 强制链接；copy 强制复制。
    #[arg(long, default_value = "auto")]
    sync_method: String,
    /// 允许覆盖本工具管理过的旧 symlink。
    #[arg(long)]
    force: bool,
}

#[derive(Debug, Args)]
struct MigrateArgs {
    /// 来源 Agent。
    #[arg(long)]
    from: String,
    /// 覆盖 hub 中已存在的同名 skill。
    #[arg(long)]
    force: bool,
}

#[derive(Debug, Args)]
struct RemoteCommand {
    #[command(subcommand)]
    command: RemoteSubcommand,
}

#[derive(Debug, Subcommand)]
enum RemoteSubcommand {
    /// 添加远程设备。
    Add(RemoteAddArgs),
    /// 不传 host 时列出远程设备；传 host 时对比该设备的 skills。
    List(RemoteListArgs),
    /// 删除远程设备。
    Remove(RemoteRemoveArgs),
    /// 扫描某个远程设备下的 Agent skills。
    Scan(RemoteTargetArgs),
    /// 生成或执行远程同步。
    Sync(RemoteSyncArgs),
}

#[derive(Debug, Args)]
struct RemoteAddArgs {
    /// 远程设备名称。
    name: String,
    /// SSH host。
    #[arg(long)]
    host: String,
    /// SSH user。
    #[arg(long)]
    user: Option<String>,
    /// SSH port。
    #[arg(long)]
    port: Option<u16>,
}

#[derive(Debug, Args)]
struct RemoteRemoveArgs {
    /// 远程设备名称。
    name: String,
}

#[derive(Debug, Args)]
struct RemoteListArgs {
    /// 远程设备名称；不传则列出全部远程设备。
    name: Option<String>,
    /// 目标 Agent，逗号分隔。
    #[arg(long)]
    tools: Option<String>,
}

#[derive(Debug, Args)]
struct RemoteTargetArgs {
    /// 远程设备名称。
    name: String,
    /// 目标 Agent，逗号分隔。
    #[arg(long)]
    tools: Option<String>,
}

#[derive(Debug, Args)]
struct RemoteSyncArgs {
    /// 远程设备名称。
    name: String,
    /// 目标 Agent，逗号分隔。
    #[arg(long)]
    tools: String,
    /// 远端 hub 到远端 agent 的同步方式。
    #[arg(long, default_value = "auto")]
    sync_method: String,
}

#[derive(Debug, Args)]
struct HubCommand {
    #[command(subcommand)]
    command: HubSubcommand,
}

#[derive(Debug, Subcommand)]
enum HubSubcommand {
    /// 列出 hub 中已安装 skills。
    List,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let ctx = CliContext {
        json: cli.json,
        dry_run: cli.dry_run,
    };
    match cli.command {
        Commands::Init => {
            let config = init_hub(ctx.dry_run)?;
            output(&ctx, &config, || {
                println!(
                    "{} hub initialized at {}",
                    ok(),
                    display_path(&config.hub_dir)
                );
            })
        }
        Commands::Source(command) => handle_source(ctx, command),
        Commands::Install(args) => handle_install(ctx, args),
        Commands::Agent(command) => handle_agent(ctx, command),
        Commands::Scan => handle_scan(ctx),
        Commands::List => handle_list(ctx),
        Commands::Migrate(args) => handle_migrate(ctx, args),
        Commands::Remote(command) => handle_remote(ctx, command),
        Commands::Hub(command) => handle_hub(ctx, command),
    }
}

fn handle_source(ctx: CliContext, command: SourceCommand) -> Result<()> {
    match command.command {
        SourceSubcommand::Add(args) => {
            let source = add_source(args.name, args.url, args.branch, ctx.dry_run)?;
            output(&ctx, &source, || {
                println!("{} source added: {}", ok(), style(&source.id).cyan());
            })
        }
        SourceSubcommand::List => {
            let sources = list_sources()?;
            output(&ctx, &sources, || print_sources(&sources))
        }
        SourceSubcommand::Scan(args) | SourceSubcommand::Update(args) => {
            let scan = scan_source(&args.source, ctx.dry_run)?;
            output(&ctx, &scan, || print_scan(&scan))
        }
        SourceSubcommand::Remove(args) => {
            let removed = remove_source(&args.id, ctx.dry_run)?;
            output(&ctx, &removed, || match &removed {
                Some(source) => println!("{} source removed: {}", ok(), style(&source.id).cyan()),
                None => println!("{} source not found", warn()),
            })
        }
    }
}

fn handle_install(ctx: CliContext, args: InstallArgs) -> Result<()> {
    let mut skills = args.skills;
    let all = args.all;

    if !all && skills.is_empty() && Term::stdout().is_term() && !ctx.json {
        let scan = scan_source(&args.source, ctx.dry_run)?;
        let items: Vec<String> = scan
            .skills
            .iter()
            .map(|skill| {
                format!(
                    "{} — {}",
                    skill.name,
                    skill.description.clone().unwrap_or_default()
                )
            })
            .collect();
        let selected = MultiSelect::new("选择要安装到 hub 的 skills", items).prompt()?;
        skills = selected
            .into_iter()
            .filter_map(|item| {
                item.split_once('—')
                    .map(|(name, _)| name.trim().to_string())
            })
            .collect();
    }

    let result = install_from_source(
        &args.source,
        InstallOptions {
            skills,
            all,
            force: args.force,
            dry_run: ctx.dry_run,
        },
    )?;
    output(&ctx, &result, || {
        println!(
            "{} installed {} skill(s)",
            if ctx.dry_run { dry() } else { ok() },
            style(result.installed.len()).cyan()
        );
        for skill in &result.installed {
            println!("  {} {}", style("●").green(), style(&skill.name).cyan());
        }
        for (name, reason) in &result.skipped {
            println!(
                "  {} {} {}",
                warn(),
                style(name).cyan(),
                style(reason).dim()
            );
        }
    })
}

fn handle_agent(ctx: CliContext, command: AgentCommand) -> Result<()> {
    match command.command {
        AgentSubcommand::Sync(args) => {
            let agents = parse_agents(&args.tools)?;
            let method = parse_sync_method(&args.sync_method)?;
            let results = sync_agents(&agents, args.force, ctx.dry_run, method)?;
            output(&ctx, &results, || print_link_results(&results))
        }
    }
}

fn handle_scan(ctx: CliContext) -> Result<()> {
    let scan = scan_all()?;
    let hub_dir = load_config()?.hub_dir;
    output(&ctx, &scan, || {
        let total = scan.hub.len()
            + scan
                .agents
                .iter()
                .map(|agent| agent.skills.len())
                .sum::<usize>();
        println!(
            "{} {} entries",
            style("Skills scan").bold(),
            style(total).cyan()
        );
        println!(
            "  {:9} {:3} {}",
            "hub",
            scan.hub.len(),
            style(display_path(&hub_dir)).dim()
        );
        for agent in &scan.agents {
            println!(
                "  {:9} {:3} {}",
                agent.agent.as_str(),
                agent.skills.len(),
                style(display_path(&agent.skills_dir)).dim()
            );
        }
        print_skill_group("Hub", &scan.hub);
        for agent in &scan.agents {
            print_skill_group(agent.agent.as_str(), &agent.skills);
        }
    })
}

fn print_skill_group(title: &str, skills: &[SkillInfo]) {
    println!(
        "\n{} {}",
        style(title).bold(),
        style(format!("({})", skills.len())).dim()
    );
    if skills.is_empty() {
        println!("  {}", style("(empty)").dim());
        return;
    }
    for skill in skills {
        let link = if skill.is_symlink {
            style(" symlink").blue().to_string()
        } else {
            String::new()
        };
        println!(
            "  {} {}{}",
            style(&skill.name).cyan(),
            style(
                skill
                    .description
                    .clone()
                    .unwrap_or_else(|| "no description".to_string())
            )
            .dim(),
            link
        );
    }
}

fn handle_list(ctx: CliContext) -> Result<()> {
    let statuses = list_status()?;
    output(&ctx, &statuses, || {
        if statuses.is_empty() {
            println!("{}", style("No skills found in hub.").bold());
            println!(
                "{}",
                style("Try: skh install <source> --all or skh migrate --from codex").dim()
            );
            return;
        }
        println!(
            "{} {} skill(s)",
            style("Skills").bold(),
            style(statuses.len()).cyan()
        );
        for skill in &statuses {
            println!(
                "\n{} {}",
                style("◆").cyan(),
                style(&skill.skill_name).cyan().bold()
            );
            println!("  {}", style(display_path(&skill.hub_path)).dim());
            for agent in &skill.agents {
                let status = match agent.status {
                    SkillAgentStatusKind::Linked => style("● linked").green(),
                    SkillAgentStatusKind::Copied => style("● copied").blue(),
                    SkillAgentStatusKind::Missing => style("○ missing").dim(),
                    SkillAgentStatusKind::Conflict => style("▲ conflict").red(),
                    SkillAgentStatusKind::HubOnly => style("◆ hub-only").blue(),
                };
                println!(
                    "  {:9} {} {}",
                    agent.agent.as_str(),
                    status,
                    style(display_path(&agent.path)).dim()
                );
            }
        }
    })
}

fn handle_migrate(ctx: CliContext, args: MigrateArgs) -> Result<()> {
    let agent = parse_agents(&args.from)?
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("agent is required"))?;
    let records = migrate_from_agent(agent, args.force, ctx.dry_run)?;
    output(&ctx, &records, || {
        println!(
            "{} migrated {} skill(s)",
            if ctx.dry_run { dry() } else { ok() },
            style(records.len()).cyan()
        );
        for record in &records {
            println!(
                "  {} -> {}",
                display_path(&record.original_path),
                display_path(&record.hub_path)
            );
        }
    })
}

fn handle_remote(ctx: CliContext, command: RemoteCommand) -> Result<()> {
    match command.command {
        RemoteSubcommand::Add(args) => {
            let remote = add_remote(args.name, args.host, args.user, args.port, ctx.dry_run)?;
            output(&ctx, &remote, || {
                println!("{} remote added: {}", ok(), style(&remote.name).cyan())
            })
        }
        RemoteSubcommand::List(args) => {
            if let Some(name) = args.name {
                let agents = parse_agents_or_enabled(args.tools.as_deref())?;
                let list = remote_list(&name, &agents)?;
                output(&ctx, &list, || print_remote_list(&list))
            } else {
                let remotes = list_remotes()?;
                output(&ctx, &remotes, || {
                    for remote in &remotes {
                        println!(
                            "{} {}",
                            style(remote.name.clone()).cyan(),
                            style(remote.host.clone()).dim()
                        );
                    }
                })
            }
        }
        RemoteSubcommand::Scan(args) => {
            let agents = parse_agents_or_enabled(args.tools.as_deref())?;
            let scan = remote_scan(&args.name, &agents)?;
            output(&ctx, &scan, || print_remote_scan(&scan))
        }
        RemoteSubcommand::Remove(args) => {
            let removed = remove_remote(&args.name, ctx.dry_run)?;
            output(&ctx, &removed, || match &removed {
                Some(remote) => println!("{} remote removed: {}", ok(), style(&remote.name).cyan()),
                None => println!("{} remote not found", warn()),
            })
        }
        RemoteSubcommand::Sync(args) => {
            let agents = parse_agents(&args.tools)?;
            let method = parse_sync_method(&args.sync_method)?;
            let plan = remote_sync_plan(&args.name, &agents, method)?;
            run_remote_sync(&plan, ctx.dry_run)?;
            output(&ctx, &plan, || {
                println!(
                    "{} remote sync plan: {} {} {}",
                    if ctx.dry_run { dry() } else { ok() },
                    style(&plan.remote.name).cyan(),
                    style("method").dim(),
                    style(plan.sync_method.as_str()).cyan()
                );
                println!(
                    "  {} {}",
                    style("remote hub").dim(),
                    style(&plan.remote_hub_dir).cyan()
                );
                for command in &plan.commands {
                    println!("  {}", style(command.join(" ")).dim());
                }
            })
        }
    }
}

fn handle_hub(ctx: CliContext, command: HubCommand) -> Result<()> {
    match command.command {
        HubSubcommand::List => {
            let skills = scan_hub()?;
            output(&ctx, &skills, || {
                println!(
                    "{} {} skill(s) in hub",
                    style("Hub").bold(),
                    style(skills.len()).cyan()
                );
                for skill in &skills {
                    println!(
                        "  {} {} {}",
                        style("●").green(),
                        style(&skill.name).cyan(),
                        style(skill.description.clone().unwrap_or_default()).dim()
                    );
                }
            })
        }
    }
}

fn print_remote_scan(scan: &RemoteScanResult) {
    println!(
        "{} {}",
        style("Remote scan").bold(),
        style(&scan.remote.name).cyan()
    );
    for agent in &scan.agents {
        println!(
            "\n{} {}",
            style(agent.agent.as_str()).bold(),
            style(format!("({})", agent.skills.len())).dim()
        );
        if agent.skills.is_empty() {
            println!("  {}", style("(empty)").dim());
            continue;
        }
        for skill in &agent.skills {
            println!(
                "  {} {}",
                style(&skill.name).cyan(),
                style(skill.description.clone().unwrap_or_default()).dim()
            );
            println!("    {}", style(&skill.path).dim());
        }
    }
}

fn print_remote_list(list: &RemoteListResult) {
    println!(
        "{} {}",
        style("Remote list").bold(),
        style(&list.remote.name).cyan()
    );
    for item in &list.statuses {
        let status = match item.status {
            RemoteSkillStatusKind::Synced => style("● synced").green(),
            RemoteSkillStatusKind::Missing => style("○ missing").dim(),
            RemoteSkillStatusKind::RemoteOnly => style("▲ remote-only").yellow(),
        };
        println!(
            "  {:9} {} {} {}",
            item.agent.as_str(),
            status,
            style(&item.skill_name).cyan(),
            style(item.remote_path.clone().unwrap_or_default()).dim()
        );
    }
}

fn output<T: serde::Serialize>(ctx: &CliContext, value: &T, render: impl FnOnce()) -> Result<()> {
    if ctx.json {
        println!("{}", serde_json::to_string_pretty(value)?);
    } else {
        render();
    }
    Ok(())
}

fn print_sources(sources: &[SkillSource]) {
    println!(
        "{} {} source(s)",
        style("Sources").bold(),
        style(sources.len()).cyan()
    );
    for source in sources {
        println!(
            "  {} {} {}",
            style("●").green(),
            style(&source.id).cyan(),
            style(&source.url).dim()
        );
    }
}

fn print_scan(scan: &SourceScanResult) {
    println!(
        "{} {} skill(s) found in {}",
        style("Scan").bold(),
        style(scan.skills.len()).cyan(),
        style(&scan.source.id).cyan()
    );
    for skill in &scan.skills {
        let status = if skill.installed {
            style("installed").green()
        } else {
            style("not-installed").dim()
        };
        println!(
            "  {} {} {} {}",
            style("●").green(),
            style(&skill.name).cyan(),
            style(skill.description.clone().unwrap_or_default()).dim(),
            status
        );
        println!("    {}", style(skill.source_path.display()).dim());
    }
}

fn print_link_results(results: &[LinkTargetResult]) {
    println!(
        "{} {} link result(s)",
        style("Agent sync").bold(),
        style(results.len()).cyan()
    );
    for result in results {
        let status = match result.status {
            LinkStatus::Linked | LinkStatus::DryRun | LinkStatus::Copied => {
                style(format!("{:?}", result.status)).green()
            }
            LinkStatus::Conflict => style("Conflict".to_string()).red(),
            LinkStatus::Skipped => style("Skipped".to_string()).dim(),
            LinkStatus::Unlinked => style("Unlinked".to_string()).blue(),
            LinkStatus::Missing => style("Missing".to_string()).yellow(),
        };
        println!(
            "  {} {:9} {}",
            style(result.agent.as_str()).cyan(),
            status,
            style(display_path(&result.path)).dim()
        );
    }
}

fn parse_sync_method(value: &str) -> Result<SyncMethod> {
    SyncMethod::parse(value)
        .ok_or_else(|| anyhow::anyhow!("unknown sync method: {value}; expected auto,symlink,copy"))
}

fn parse_agents(value: &str) -> Result<Vec<AgentKind>> {
    let config = load_config()?;
    value
        .split(',')
        .map(|item| {
            let agent = AgentKind::parse(item)
                .ok_or_else(|| anyhow::anyhow!("invalid agent id: {item}"))?;
            if !config.agents.contains_key(&agent) {
                anyhow::bail!("agent is not configured: {item}");
            }
            Ok(agent)
        })
        .collect()
}

fn parse_agents_or_enabled(value: Option<&str>) -> Result<Vec<AgentKind>> {
    match value {
        Some(value) => parse_agents(value),
        None => Ok(load_config()?
            .agents
            .into_values()
            .filter(|agent| agent.enabled)
            .map(|agent| agent.kind)
            .collect()),
    }
}

fn ok() -> console::StyledObject<&'static str> {
    style("✓").green()
}

fn warn() -> console::StyledObject<&'static str> {
    style("!").yellow()
}

fn dry() -> console::StyledObject<&'static str> {
    style("◇ dry-run").yellow()
}
