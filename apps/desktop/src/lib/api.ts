import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export type AgentKind = "codex" | "claude" | "cursor" | "openclaw";
export type SyncMethod = "auto" | "symlink" | "copy";

export interface DashboardDto {
  hubCount: number;
  sourceCount: number;
  codexCount: number;
  claudeCount: number;
  cursorCount: number;
  openclawCount: number;
  conflictCount: number;
  missingCount: number;
}

export interface SkillSource {
  id: string;
  url: string;
  branch?: string | null;
  kind: string;
  skill_count?: number | null;
  skillCount?: number | null;
  last_scan_at?: string | null;
  lastScanAt?: string | null;
  last_commit?: string | null;
  lastCommit?: string | null;
}

export interface SkillInfo {
  name: string;
  dir_name?: string;
  dirName?: string;
  path: string;
  skill_file?: string;
  skillFile?: string;
  description?: string | null;
  is_symlink?: boolean;
  isSymlink?: boolean;
  symlink_target?: string | null;
  symlinkTarget?: string | null;
}

export interface DiscoveredSkill {
  name: string;
  source_path?: string;
  sourcePath?: string;
  description?: string | null;
  installed: boolean;
  hub_path?: string;
  hubPath?: string;
}

export interface SourceScanResult {
  source: SkillSource;
  root: string;
  skills: DiscoveredSkill[];
}

export interface AgentScanResult {
  agent: AgentKind;
  skills_dir?: string;
  skillsDir?: string;
  skills: SkillInfo[];
}

export interface ScanAllResult {
  hub: SkillInfo[];
  agents: AgentScanResult[];
}

export interface SkillAgentStatus {
  agent: AgentKind;
  status: "hub-only" | "linked" | "copied" | "missing" | "conflict";
  path: string;
  target_path?: string | null;
  targetPath?: string | null;
}

export interface SkillStatus {
  skill_name?: string;
  skillName?: string;
  hub_path?: string;
  hubPath?: string;
  agents: SkillAgentStatus[];
}

export interface SkillFileEntry {
  path: string;
  is_dir?: boolean;
  isDir?: boolean;
}

export interface SkillDetail {
  info: SkillInfo;
  readme: string;
  files: SkillFileEntry[];
  statuses: SkillAgentStatus[];
}

export interface SkillFileContent {
  path: string;
  content: string;
  truncated: boolean;
}

export interface RemoteConnectionStatus {
  name: string;
  status: "connected" | "failed";
  message?: string | null;
  checked_at?: string;
  checkedAt?: string;
}

export interface InstallResult {
  installed: DiscoveredSkill[];
  skipped: [string, string][];
}

export interface LinkTargetResult {
  agent: AgentKind;
  status: "linked" | "copied" | "dry-run" | "conflict" | "skipped" | "unlinked" | "missing";
  path: string;
  target_path?: string;
  targetPath?: string;
  method: SyncMethod;
  reason?: string | null;
}

export interface TakeoverResult {
  agent: AgentKind;
  skill_name?: string;
  skillName?: string;
  path: string;
  target_path?: string;
  targetPath?: string;
  backup_path?: string;
  backupPath?: string;
  status: LinkTargetResult["status"];
  method: SyncMethod;
  reason?: string | null;
}

export interface AgentSkillRemoveResult {
  agent: AgentKind;
  skill_name?: string;
  skillName?: string;
  path: string;
  backup_path?: string | null;
  backupPath?: string | null;
  status: LinkTargetResult["status"];
  reason?: string | null;
}

export interface RemoveHubSkillResult {
  skill?: SkillInfo | null;
  agents: LinkTargetResult[];
}

export interface RemoteHost {
  name: string;
  host: string;
  user?: string | null;
  port?: number | null;
}

export interface DiscoveredSshHost {
  alias: string;
  hostname?: string | null;
  user?: string | null;
  port?: number | null;
  source_file?: string;
  sourceFile?: string;
  added: boolean;
}

export interface HubPreferences {
  default_sync_method?: SyncMethod;
  defaultSyncMethod?: SyncMethod;
}

export interface RemoteSkillStatus {
  skill_name?: string;
  skillName?: string;
  agent: AgentKind;
  status: "synced" | "missing" | "remote-only";
  remote_path?: string | null;
  remotePath?: string | null;
}

export interface RemoteListResult {
  remote: RemoteHost;
  agents: RemoteAgentScanResult[];
  statuses: RemoteSkillStatus[];
}

export interface RemoteAgentScanResult {
  agent: AgentKind;
  available: boolean;
  skills_dir?: string;
  skillsDir?: string;
  skills: Array<{ name: string; dir_name?: string; dirName?: string; path: string; description?: string | null }>;
}

export interface RemoteScanResult {
  remote: RemoteHost;
  agents: RemoteAgentScanResult[];
}

export interface RemoteSyncPlan {
  remote: RemoteHost;
  agents: AgentKind[];
  source_dir?: string;
  sourceDir?: string;
  remote_hub_dir?: string;
  remoteHubDir?: string;
  sync_method?: SyncMethod;
  syncMethod?: SyncMethod;
  commands: string[][];
}

export interface RemoteImportResult {
  remote: RemoteHost;
  agent: AgentKind;
  skill_name?: string;
  skillName?: string;
  remote_path?: string;
  remotePath?: string;
  hub_path?: string;
  hubPath?: string;
  imported: boolean;
}

export interface RemoteSkillSyncResult {
  remote: RemoteHost;
  agent: AgentKind;
  skill_name?: string;
  skillName?: string;
  source_path?: string;
  sourcePath?: string;
  remote_hub_path?: string;
  remoteHubPath?: string;
  remote_agent_path?: string;
  remoteAgentPath?: string;
  status: LinkTargetResult["status"];
  reason?: string | null;
}

export interface RemoteRemoveResult {
  remote: RemoteHost;
  agent: AgentKind;
  skill_name?: string;
  skillName?: string;
  remote_path?: string;
  remotePath?: string;
  backup_path?: string | null;
  backupPath?: string | null;
  removed: boolean;
}

export interface HubConfig {
  hub_dir?: string;
  hubDir?: string;
  config_path?: string;
  configPath?: string;
  lock_path?: string;
  lockPath?: string;
  backups_dir?: string;
  backupsDir?: string;
  cache_dir?: string;
  cacheDir?: string;
  logs_dir?: string;
  logsDir?: string;
}

const isTauriRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let mockHub: SkillInfo[] = [
  { name: "browser", path: "/Users/demo/.agents/skills/browser", description: "浏览器自动化与页面检查" },
  { name: "github", path: "/Users/demo/.agents/skills/github", description: "GitHub 仓库、Issue 与 PR 工作流" },
  { name: "documents", path: "/Users/demo/.agents/skills/documents", description: "创建和编辑 Word 文档" },
  { name: "product-design", path: "/Users/demo/.agents/skills/product-design", description: "产品体验审计与原型设计" },
  { name: "debug", path: "/Users/demo/.agents/skills/debug", description: "运行时问题定位与验证" },
];

let mockAgents: AgentScanResult[] = [
  {
    agent: "codex",
    skillsDir: "/Users/demo/.codex/skills",
    skills: [
      { ...mockHub[0], path: "/Users/demo/.codex/skills/browser", isSymlink: true },
      { ...mockHub[1], path: "/Users/demo/.codex/skills/github", isSymlink: true },
      { name: "private-release", path: "/Users/demo/.codex/skills/private-release", description: "尚未迁移的内部发布流程" },
      { name: "workspace-task", path: "/Users/demo/.codex/skills/workspace-task", description: "由外部项目维护的 Skill", isSymlink: true, symlinkTarget: "/Users/demo/projects/workspace/skills/workspace-task" },
    ],
  },
  {
    agent: "claude",
    skillsDir: "/Users/demo/.claude/skills",
    skills: [
      { ...mockHub[2], path: "/Users/demo/.claude/skills/documents", isSymlink: true },
      { name: "prompt-auditor", path: "/Users/demo/.claude/skills/prompt-auditor", description: "尚未迁移的提示词审计 Skill" },
      { name: "pc-shared-init-entry", path: "/Users/demo/.claude/skills/pc-shared-init-entry", description: "由外部工作区维护的 Skill", isSymlink: true, symlinkTarget: "/Users/demo/projects/pc-shared/skills/init-entry" },
    ],
  },
  {
    agent: "cursor",
    skillsDir: "/Users/demo/.cursor/skills",
    skills: [
      { ...mockHub[0], path: "/Users/demo/.cursor/skills/browser", isSymlink: true },
      { name: "github", path: "/Users/demo/.cursor/skills/github", description: "与 Hub 同名的本地真实目录" },
    ],
  },
  {
    agent: "openclaw",
    skillsDir: "/Users/demo/.openclaw/skills",
    skills: [],
  },
];

let mockStatuses: SkillStatus[] = mockHub.map((skill) => ({
  skillName: skill.name,
  hubPath: skill.path,
  agents: (["codex", "claude", "cursor", "openclaw"] as AgentKind[]).map((agent) => {
    const linked =
      (skill.name === "browser" && (agent === "codex" || agent === "cursor")) ||
      (skill.name === "github" && agent === "codex") ||
      (skill.name === "documents" && agent === "claude");
    const conflict = skill.name === "github" && agent === "cursor";
    return {
      agent,
      status: conflict ? "conflict" : linked ? "linked" : "missing",
      path: `/Users/demo/.${agent}/skills/${skill.name}`,
      targetPath: conflict ? null : skill.path,
    };
  }),
}));

let mockSources: SkillSource[] = [
  { id: "team-skills", url: "git@gitlab.example.com:ai/team-skills.git", kind: "gitlab" },
  { id: "community", url: "https://github.com/example/agent-skills.git", kind: "github" },
];
let mockRemotes: RemoteHost[] = [{ name: "office-mac", host: "office-mac.local", user: "demo" }];
let mockPreferences: HubPreferences = { defaultSyncMethod: "auto" };

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriRuntime) return tauriInvoke<T>(command, args);
  await new Promise((resolve) => window.setTimeout(resolve, 80));
  return mockInvoke<T>(command, args);
}

function mockInvoke<T>(command: string, args?: Record<string, unknown>): T {
  const input = (args?.input ?? {}) as Record<string, unknown>;
  switch (command) {
    case "init_hub":
      return {
        hubDir: "/Users/demo/.agents/skills",
        configPath: "/Users/demo/.agents/skills-hub/config.json",
        lockPath: "/Users/demo/.agents/skills-hub/lock.json",
        backupsDir: "/Users/demo/.agents/skills-hub-backups",
        cacheDir: "/Users/demo/.agents/skills-hub/cache",
        logsDir: "/Users/demo/.agents/skills-hub/logs",
      } as T;
    case "get_logs_dir":
      return "/Users/demo/.agents/skills-hub/logs" as T;
    case "scan_all":
      return { hub: mockHub, agents: mockAgents } as T;
    case "list_status":
      return mockStatuses as T;
    case "list_sources":
      return mockSources as T;
    case "add_source": {
      const url = String(input.url ?? "");
      const source = { id: String(input.id || url.split("/").pop()?.replace(/\.git$/, "") || "skills"), url, branch: input.branch as string | undefined, kind: url.includes("gitlab") ? "gitlab" : "github" };
      mockSources = [...mockSources, source];
      return source as T;
    }
    case "remove_source": {
      const id = String(args?.id ?? "");
      const source = mockSources.find((item) => item.id === id) ?? null;
      mockSources = mockSources.filter((item) => item.id !== id);
      return source as T;
    }
    case "scan_source":
      return {
        source: mockSources.find((item) => item.id === args?.sourceRef) ?? mockSources[0],
        root: "/tmp/skills-source",
        skills: [
          { name: "react-review", sourcePath: "skills/react-review", description: "React 代码审查", installed: false },
          { name: "release-notes", sourcePath: "skills/release-notes", description: "生成发布说明", installed: true },
          { name: "incident-helper", sourcePath: "skills/incident-helper", description: "故障排查流程", installed: false },
        ],
      } as T;
    case "install_from_source":
      return { installed: [], skipped: [] } as T;
    case "get_preferences":
      return mockPreferences as T;
    case "update_preferences":
      mockPreferences = { defaultSyncMethod: input.defaultSyncMethod as SyncMethod };
      return mockPreferences as T;
    case "list_remotes":
      return mockRemotes as T;
    case "discover_ssh_hosts":
      return [
        { alias: "office-mac", hostname: "office-mac.local", user: "demo", added: true },
        { alias: "devbox", hostname: "10.0.0.42", user: "dev", added: false },
      ] as T;
    case "add_remote": {
      const remote = { name: String(input.name || input.host), host: String(input.host), user: input.user as string | undefined, port: input.port as number | undefined };
      mockRemotes = [...mockRemotes, remote];
      return remote as T;
    }
    case "remove_remote": {
      const name = String(args?.name ?? "");
      const remote = mockRemotes.find((item) => item.name === name) ?? null;
      mockRemotes = mockRemotes.filter((item) => item.name !== name);
      return remote as T;
    }
    case "check_remote_connection":
      return { name: String(args?.name ?? ""), status: "connected", message: "SSH 连接正常" } as T;
    case "remote_list":
      return {
        remote: mockRemotes.find((item) => item.name === input.name) ?? mockRemotes[0],
        agents: (["codex", "claude", "cursor", "openclaw"] as AgentKind[]).map((agent) => ({
          agent,
          available: agent !== "openclaw",
          skillsDir: `/Users/demo/.${agent}/skills`,
          skills: [],
        })),
        statuses: [
          { skillName: "browser", agent: "codex", status: "synced", remotePath: "/Users/demo/.codex/skills/browser" },
          { skillName: "github", agent: "codex", status: "missing", remotePath: null },
          { skillName: "remote-private", agent: "claude", status: "remote-only", remotePath: "/Users/demo/.claude/skills/remote-private" },
        ],
      } as T;
    case "remote_sync":
      return {
        remote: mockRemotes.find((item) => item.name === input.name) ?? mockRemotes[0],
        agents: input.tools ?? [],
        sourceDir: "/Users/demo/.agents/skills",
        remoteHubDir: "~/.agents/skills",
        syncMethod: input.syncMethod ?? "auto",
        commands: [["rsync"], ["ssh"]],
      } as T;
    case "sync_agents":
    case "link_skill_to_agents":
    case "unlink_skill_from_agents":
      return [] as T;
    case "takeover_agent_skill":
      return { agent: input.agent, skillName: input.skillName, path: "", backupPath: "/Users/demo/.agents/skills-hub-backups/github", status: "linked", method: input.syncMethod ?? "auto" } as T;
    case "remove_agent_skill":
      return { agent: input.agent, skillName: input.skillName, path: "", backupPath: "/Users/demo/.agents/skills-hub-backups/skill", status: "unlinked" } as T;
    case "migrate_from_agent":
      return { from: input.from, migrated: true } as T;
    case "remote_sync_skill":
      return { remote: mockRemotes[0], agent: input.agent, skillName: input.skillName, status: "linked" } as T;
    case "remote_sync_local_agent_skill":
      return { remote: mockRemotes[0], agent: input.targetAgent, skillName: input.skillName, status: "linked" } as T;
    case "remote_import_skill":
      return { remote: mockRemotes[0], agent: input.agent, skillName: input.skillName, hubPath: `/Users/demo/.agents/skills/${String(input.skillName)}`, imported: true } as T;
    case "remote_remove_skill":
      return { remote: mockRemotes[0], agent: input.agent, skillName: input.skillName, removed: true } as T;
    case "remove_hub_skill": {
      const skillName = String(input.skillName ?? "");
      const skill = mockHub.find((item) => (item.dirName ?? item.dir_name ?? item.name) === skillName || item.name === skillName) ?? null;
      if (!skill) return { skill: null, agents: [] } as T;
      const agentResults: LinkTargetResult[] = [];
      mockAgents = mockAgents.map((group) => ({
        ...group,
        skills: group.skills.filter((item) => {
          const itemName = item.dirName ?? item.dir_name ?? item.name;
          if (itemName !== skillName && item.name !== skillName) return true;
          const path = item.path;
          const targetPath = skill.path;
          if (!(item.isSymlink ?? item.is_symlink)) {
            agentResults.push({ agent: group.agent, status: "conflict", path, targetPath, method: "auto", reason: "existing path is not managed by skills-hub" });
            return true;
          }
          agentResults.push({ agent: group.agent, status: "unlinked", path, targetPath, method: "auto" });
          return false;
        }),
      }));
      mockHub = mockHub.filter((item) => item !== skill);
      mockStatuses = mockStatuses.filter((status) => (status.skillName ?? status.skill_name) !== skillName);
      return { skill, agents: agentResults } as T;
    }
    case "open_path":
      return undefined as T;
    default:
      throw new Error(`Web 预览暂不支持命令：${command}`);
  }
}

export const api = {
  initHub: () => invoke<HubConfig>("init_hub"),
  getLogsDir: () => invoke<string>("get_logs_dir"),
  dashboard: () => invoke<DashboardDto>("get_dashboard"),
  listSources: () => invoke<SkillSource[]>("list_sources"),
  addSource: (input: { id?: string; url: string; branch?: string }) =>
    invoke<SkillSource>("add_source", { input }),
  removeSource: (id: string) => invoke<SkillSource | null>("remove_source", { id }),
  scanSource: (sourceRef: string) => invoke<SourceScanResult>("scan_source", { sourceRef }),
  installFromSource: (input: {
    sourceRef: string;
    skills: string[];
    all: boolean;
    force: boolean;
    dryRun?: boolean;
  }) => invoke<InstallResult>("install_from_source", { input }),
  getSkillDetail: (skillName: string) => invoke<SkillDetail>("get_skill_detail", { skillName }),
  readSkillFile: (skillName: string, filePath: string) =>
    invoke<SkillFileContent>("read_skill_file", { skillName, filePath }),
  removeHubSkill: (input: { skillName: string; force: boolean }) =>
    invoke<RemoveHubSkillResult>("remove_hub_skill", { input }),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  scanAll: () => invoke<ScanAllResult>("scan_all"),
  listStatus: () => invoke<SkillStatus[]>("list_status"),
  syncAgents: (input: {
    tools: AgentKind[];
    force: boolean;
    dryRun?: boolean;
    syncMethod: SyncMethod;
  }) => invoke<LinkTargetResult[]>("sync_agents", { input }),
  linkSkillToAgents: (input: {
    skillName: string;
    tools: AgentKind[];
    force: boolean;
    dryRun?: boolean;
    syncMethod: SyncMethod;
  }) => invoke<LinkTargetResult[]>("link_skill_to_agents", { input }),
  unlinkSkillFromAgents: (input: {
    skillName: string;
    tools: AgentKind[];
    force?: boolean;
    dryRun?: boolean;
    syncMethod?: SyncMethod;
  }) => invoke<LinkTargetResult[]>("unlink_skill_from_agents", { input }),
  removeAgentSkill: (input: {
    skillName: string;
    agent: AgentKind;
    dryRun?: boolean;
  }) => invoke<AgentSkillRemoveResult>("remove_agent_skill", { input }),
  takeoverAgentSkill: (input: {
    skillName: string;
    agent: AgentKind;
    dryRun?: boolean;
    syncMethod?: SyncMethod;
  }) => invoke<TakeoverResult>("takeover_agent_skill", { input }),
  migrateFromAgent: (input: { from: AgentKind; force: boolean; dryRun?: boolean }) =>
    invoke<unknown>("migrate_from_agent", { input }),
  listRemotes: () => invoke<RemoteHost[]>("list_remotes"),
  discoverSshHosts: () => invoke<DiscoveredSshHost[]>("discover_ssh_hosts"),
  addRemote: (input: { name?: string; host: string; user?: string; port?: number; dryRun?: boolean }) =>
    invoke<RemoteHost>("add_remote", { input: { ...input, name: input.name ?? "" } }),
  removeRemote: (name: string) => invoke<RemoteHost | null>("remove_remote", { name }),
  checkRemoteConnection: (name: string) => invoke<RemoteConnectionStatus>("check_remote_connection", { name }),
  remoteScan: (input: { name: string; tools: AgentKind[]; dryRun?: boolean; syncMethod?: SyncMethod }) =>
    invoke<RemoteScanResult>("remote_scan", { input }),
  remoteList: (input: { name: string; tools: AgentKind[]; dryRun?: boolean; syncMethod?: SyncMethod }) =>
    invoke<RemoteListResult>("remote_list", { input }),
  remoteSync: (input: { name: string; tools: AgentKind[]; dryRun?: boolean; syncMethod?: SyncMethod }) =>
    invoke<RemoteSyncPlan>("remote_sync", { input }),
  remoteSyncSkill: (input: { name: string; agent: AgentKind; skillName: string; dryRun?: boolean; syncMethod?: SyncMethod }) =>
    invoke<RemoteSkillSyncResult>("remote_sync_skill", { input }),
  remoteSyncLocalAgentSkill: (input: { name: string; sourceAgent: AgentKind; targetAgent: AgentKind; skillName: string; dryRun?: boolean; syncMethod?: SyncMethod }) =>
    invoke<RemoteSkillSyncResult>("remote_sync_local_agent_skill", { input }),
  remoteImportSkill: (input: { name: string; agent: AgentKind; skillName: string; force?: boolean; dryRun?: boolean }) =>
    invoke<RemoteImportResult>("remote_import_skill", { input }),
  remoteRemoveSkill: (input: { name: string; agent: AgentKind; skillName: string; dryRun?: boolean }) =>
    invoke<RemoteRemoveResult>("remote_remove_skill", { input }),
  getPreferences: () => invoke<HubPreferences>("get_preferences"),
  updatePreferences: (input: { defaultSyncMethod: SyncMethod }) =>
    invoke<HubPreferences>("update_preferences", { input }),
};

export function dirName(skill: SkillInfo) {
  return skill.dirName ?? skill.dir_name ?? skill.name;
}

export function sourcePath(skill: DiscoveredSkill) {
  return skill.sourcePath ?? skill.source_path ?? "";
}

export function hubPath(skill: SkillStatus | DiscoveredSkill) {
  return "hubPath" in skill ? skill.hubPath : undefined;
}
