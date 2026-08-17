import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export type AgentKind = string;
export type SyncMethod = "auto" | "symlink" | "copy";
export type EnvironmentKind = "local" | "remote";

export interface EnvironmentSummary {
  id: string;
  name: string;
  kind: EnvironmentKind;
  host?: string | null;
  user?: string | null;
  port?: number | null;
}

export interface EnvironmentCapabilities {
  ssh: boolean;
  rsync: boolean;
  git: boolean;
  python3: boolean;
  skh: boolean;
  message?: string | null;
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

export interface MigrationRecord {
  agent: AgentKind;
  skill_name?: string;
  skillName?: string;
  original_path?: string;
  originalPath?: string;
  hub_path?: string;
  hubPath?: string;
  backup_path?: string;
  backupPath?: string;
  migrated_at?: string;
  migratedAt?: string;
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
  hub_dir?: string;
  hubDir?: string;
  agents: AgentConfig[];
}

export interface AgentConfig {
  kind: AgentKind;
  label: string;
  skills_dir?: string;
  skillsDir?: string;
  enabled: boolean;
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
  agents?: Record<string, AgentConfig>;
  remotes?: Record<string, unknown>;
  sources?: Record<string, unknown>;
  default_sync_method?: SyncMethod;
  defaultSyncMethod?: SyncMethod;
}

export interface EnvironmentSnapshot {
  environment: EnvironmentSummary;
  capabilities: EnvironmentCapabilities;
  hub: SkillInfo[];
  agents: AgentScanResult[];
  statuses: SkillStatus[];
  sources: SkillSource[];
  config: HubConfig;
}

export type EnvironmentCompareStatus = "identical" | "source-only" | "target-only" | "different";

export interface EnvironmentCompareItem {
  skill_name?: string;
  skillName?: string;
  status: EnvironmentCompareStatus;
  source_path?: string | null;
  sourcePath?: string | null;
  target_path?: string | null;
  targetPath?: string | null;
}

export interface EnvironmentCompareResult {
  source: EnvironmentSummary;
  target: EnvironmentSummary;
  items: EnvironmentCompareItem[];
}

export interface EnvironmentTransferResult {
  source: EnvironmentSummary;
  target: EnvironmentSummary;
  skill_name?: string;
  skillName?: string;
  status: "transferred" | "conflict" | "dry-run";
  backup_path?: string | null;
  backupPath?: string | null;
}

export interface EnvironmentTrashResult {
  environment: EnvironmentSummary;
  skill_name?: string;
  skillName?: string;
  trash_path?: string;
  trashPath?: string;
}

export type SkillImportSourceKind = "directory" | "zip";
export type SkillImportCandidateStatus = "ready" | "conflict" | "invalid";

export interface SkillImportCandidate {
  id: string;
  name: string;
  dirName: string;
  relativePath: string;
  description?: string | null;
  status: SkillImportCandidateStatus;
  reason?: string | null;
}

export interface SkillImportPreview {
  sourcePath: string;
  sourceKind: SkillImportSourceKind;
  skills: SkillImportCandidate[];
}

export interface EnvironmentImportItem {
  skillId: string;
  skillName: string;
  status: "imported" | "conflict" | "dry-run";
  targetPath: string;
  backupPath?: string | null;
}

export interface EnvironmentImportResult {
  environment: EnvironmentSummary;
  items: EnvironmentImportItem[];
}

const isTauriRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const MOCK_HOME = "/mock/home";
const MOCK_HUB_DIR = `${MOCK_HOME}/.agents/skills`;
const mockPath = (path: string) => `${MOCK_HOME}/${path.replace(/^\//, "")}`;

let mockHub: SkillInfo[] = [
  { name: "browser", path: `${MOCK_HUB_DIR}/browser`, description: "浏览器自动化与页面检查" },
  { name: "github", path: `${MOCK_HUB_DIR}/github`, description: "GitHub 仓库、Issue 与 PR 工作流" },
  { name: "documents", path: `${MOCK_HUB_DIR}/documents`, description: "创建和编辑 Word 文档" },
  { name: "product-design", path: `${MOCK_HUB_DIR}/product-design`, description: "产品体验审计与原型设计" },
  { name: "debug", path: `${MOCK_HUB_DIR}/debug`, description: "运行时问题定位与验证" },
];

const mockAgentConfigs: AgentConfig[] = [
  { kind: "claude", label: "Claude", skillsDir: mockPath(".claude/skills"), enabled: true },
  { kind: "codex", label: "Codex", skillsDir: mockPath(".codex/skills"), enabled: true },
  { kind: "continue", label: "Continue", skillsDir: mockPath(".continue/skills"), enabled: true },
  { kind: "cursor", label: "Cursor", skillsDir: mockPath(".cursor/skills"), enabled: false },
  { kind: "hermes", label: "Hermes", skillsDir: mockPath(".hermes/skills"), enabled: true },
  { kind: "openclaw", label: "OpenClaw", skillsDir: mockPath(".openclaw/skills"), enabled: true },
  { kind: "qoder", label: "Qoder", skillsDir: mockPath(".qoder/skills"), enabled: true },
  { kind: "trae", label: "Trae", skillsDir: mockPath(".trae/skills"), enabled: true },
  { kind: "windsurf", label: "Windsurf", skillsDir: mockPath(".codeium/windsurf/skills"), enabled: true },
  { kind: "zode", label: "Zode", skillsDir: mockPath(".zode/skills"), enabled: true },
];

function mockAgentSkillsDir(agent: AgentKind) {
  return mockAgentConfigs.find((item) => item.kind === agent)?.skillsDir ?? mockPath(`.${agent}/skills`);
}

let mockAgents: AgentScanResult[] = [
  {
    agent: "codex",
    skillsDir: mockPath(".codex/skills"),
    skills: [
      { ...mockHub[0], path: mockPath(".codex/skills/browser"), isSymlink: true },
      { ...mockHub[1], path: mockPath(".codex/skills/github"), isSymlink: true },
      { name: "private-release", path: mockPath(".codex/skills/private-release"), description: "尚未迁移的内部发布流程" },
      { name: "workspace-task", path: mockPath(".codex/skills/workspace-task"), description: "由外部项目维护的 Skill", isSymlink: true, symlinkTarget: mockPath("projects/workspace/skills/workspace-task") },
    ],
  },
  {
    agent: "claude",
    skillsDir: mockPath(".claude/skills"),
    skills: [
      { ...mockHub[2], path: mockPath(".claude/skills/documents"), isSymlink: true },
      { name: "prompt-auditor", path: mockPath(".claude/skills/prompt-auditor"), description: "尚未迁移的提示词审计 Skill" },
      { name: "pc-shared-init-entry", path: mockPath(".claude/skills/pc-shared-init-entry"), description: "由外部工作区维护的 Skill", isSymlink: true, symlinkTarget: mockPath("projects/pc-shared/skills/init-entry") },
    ],
  },
  {
    agent: "openclaw",
    skillsDir: mockPath(".openclaw/skills"),
    skills: [],
  },
  ...mockAgentConfigs
    .filter((agent) => agent.enabled && !["codex", "claude", "openclaw"].includes(agent.kind))
    .map((agent) => ({ agent: agent.kind, skillsDir: agent.skillsDir ?? "", skills: [] })),
];

let mockStatuses: SkillStatus[] = mockHub.map((skill) => ({
  skillName: skill.name,
  hubPath: skill.path,
  agents: mockAgents.map(({ agent, skillsDir }) => {
    const linked =
      (skill.name === "browser" && agent === "codex") ||
      (skill.name === "github" && agent === "codex") ||
      (skill.name === "documents" && agent === "claude");
    return {
      agent,
      status: linked ? "linked" : "missing",
      path: `${skillsDir}/${skill.name}`,
      targetPath: skill.path,
    };
  }),
}));

let mockSources: SkillSource[] = [
  { id: "team-skills", url: "git@gitlab.example.com:ai/team-skills.git", kind: "gitlab" },
  { id: "community", url: "https://github.com/example/agent-skills.git", kind: "github" },
  { id: "company-git", url: "ssh://git.example.com/ai/company-skills.git", kind: "generic-git" },
  { id: "local-playground", url: "/mock/home/shared-skills", kind: "local" },
];
const mockRemoteSources: Record<string, SkillSource[]> = {};
const mockInstalledSourceSkills: Record<string, Set<string>> = {};
let mockRemotes: RemoteHost[] = [];
let mockPreferences: HubPreferences = {
  defaultSyncMethod: "auto",
  hubDir: MOCK_HUB_DIR,
  agents: mockAgentConfigs,
};

function mockSourceScan(environmentId: string, sourceRef: string): SourceScanResult {
  const sources = environmentId === "local" ? mockSources : (mockRemoteSources[environmentId] ?? []);
  const source = sources.find((item) => item.id === sourceRef) ?? sources[0] ?? { id: sourceRef, url: "", kind: "generic-git" };
  const installed = mockInstalledSourceSkills[`${environmentId}:${sourceRef}`] ?? new Set<string>();
  return {
    source: {
      ...source,
      skillCount: 3,
      lastScanAt: source?.lastScanAt ?? new Date(Date.now() - 5 * 60_000).toISOString(),
    },
    root: "/tmp/skills-source",
    skills: [
      { name: "react-review", sourcePath: "skills/react-review", description: "React 代码审查", installed: installed.has("react-review") },
      { name: "release-notes", sourcePath: "skills/release-notes", description: "生成发布说明", installed: true },
      { name: "incident-helper", sourcePath: "skills/incident-helper", description: "故障排查流程", installed: installed.has("incident-helper") },
    ],
  };
}

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
        hubDir: MOCK_HUB_DIR,
        configPath: mockPath(".config/skills-hub/config.json"),
        lockPath: mockPath(".config/skills-hub/lock.json"),
        backupsDir: mockPath(".config/skills-hub/backups"),
        cacheDir: mockPath(".cache/skills-hub/sources"),
        logsDir: mockPath(".config/skills-hub/logs"),
      } as T;
    case "get_logs_dir":
      return mockPath(".config/skills-hub/logs") as T;
    case "list_environments":
      return [
        { id: "local", name: "本机", kind: "local" },
        ...mockRemotes.map((remote) => ({
          id: `remote:${remote.name}`,
          name: remote.name,
          kind: "remote",
          host: remote.host,
          user: remote.user,
          port: remote.port,
        })),
      ] as T;
    case "get_environment_snapshot": {
      const environmentId = String(input.environmentId ?? "local");
      const remote = mockRemotes.find((item) => `remote:${item.name}` === environmentId);
      if (!remote) {
        return {
          environment: { id: "local", name: "本机", kind: "local" },
          capabilities: { ssh: true, rsync: true, git: true, python3: true, skh: true },
          hub: mockHub,
          agents: mockAgents,
          statuses: mockStatuses,
          sources: mockSources,
          config: {
            hubDir: MOCK_HUB_DIR,
            configPath: mockPath(".config/skills-hub/config.json"),
            backupsDir: mockPath(".config/skills-hub/backups"),
          },
        } as T;
      }
      const remoteHub = mockHub.map((skill) => ({
        ...skill,
        path: `${MOCK_HUB_DIR}/${dirName(skill)}`,
        skillFile: `${MOCK_HUB_DIR}/${dirName(skill)}/SKILL.md`,
      }));
      return {
        environment: { id: environmentId, name: remote.name, kind: "remote", host: remote.host, user: remote.user, port: remote.port },
        capabilities: { ssh: true, rsync: true, git: true, python3: true, skh: false },
        hub: remoteHub,
        agents: mockAgents.map((group) => ({
          ...group,
          skillsDir: mockAgentSkillsDir(group.agent),
          skills: group.skills.map((skill) => ({ ...skill, path: `${mockAgentSkillsDir(group.agent)}/${dirName(skill)}` })),
        })),
        statuses: mockStatuses.map((status) => ({
          ...status,
          hubPath: `${MOCK_HUB_DIR}/${status.skillName ?? status.skill_name}`,
        })),
        sources: mockRemoteSources[environmentId] ?? [],
        config: {
          hubDir: "~/.agents/skills",
          configPath: "~/.config/skills-hub/config.json",
          backupsDir: "~/.config/skills-hub/backups",
        },
      } as T;
    }
    case "check_environment_connection":
      return { name: String(args?.environmentId ?? "local"), status: "connected", message: null } as T;
    case "compare_environments":
      return {
        source: { id: String(input.sourceEnvironmentId), name: "来源", kind: "local" },
        target: { id: String(input.targetEnvironmentId), name: "目标", kind: "remote" },
        items: mockHub.map((skill, index) => ({
          skillName: dirName(skill),
          status: index === 1 ? "different" : index === 4 ? "source-only" : "identical",
        })),
      } as T;
    case "transfer_skills":
      return ((input.skillNames as string[] | undefined) ?? []).map((skillName) => ({
        source: { id: String(input.sourceEnvironmentId), name: "来源", kind: "local" },
        target: { id: String(input.targetEnvironmentId), name: "目标", kind: "remote" },
        skillName,
        status: "transferred",
      })) as T;
    case "preview_environment_import": {
      const sourcePath = String(input.sourcePath ?? "/mock/shared-skills");
      return {
        sourcePath,
        sourceKind: sourcePath.toLowerCase().endsWith(".zip") ? "zip" : "directory",
        skills: [
          { id: "team-review", name: "team-review", dirName: "team-review", relativePath: "team-review", description: "团队代码审查流程", status: "ready" },
          { id: "github", name: "github", dirName: "github", relativePath: "github", description: "已有同名 Skill 的示例", status: "conflict", reason: "current environment already contains this skill" },
          { id: "release-helper", name: "release-helper", dirName: "release-helper", relativePath: "release-helper", description: "发布辅助流程", status: "ready" },
        ],
      } as T;
    }
    case "import_environment_skills": {
      const skillIds = (input.skillIds as string[] | undefined) ?? [];
      const force = Boolean(input.force);
      const candidates: Record<string, { name: string; description: string }> = {
        "team-review": { name: "team-review", description: "团队代码审查流程" },
        github: { name: "github", description: "已有同名 Skill 的示例" },
        "release-helper": { name: "release-helper", description: "发布辅助流程" },
      };
      const items: EnvironmentImportItem[] = skillIds.map((skillId) => {
        const candidate = candidates[skillId] ?? { name: skillId, description: "导入的 Skill" };
        const conflict = candidate.name === "github" && !force;
        if (!conflict && !mockHub.some((skill) => dirName(skill) === candidate.name)) {
          const skill: SkillInfo = { name: candidate.name, dirName: candidate.name, path: `${MOCK_HUB_DIR}/${candidate.name}`, description: candidate.description };
          mockHub = [...mockHub, skill];
          mockStatuses = [...mockStatuses, {
            skillName: candidate.name,
            hubPath: skill.path,
            agents: mockAgents.map(({ agent, skillsDir }) => ({ agent, status: "missing", path: `${skillsDir}/${candidate.name}`, targetPath: skill.path })),
          }];
        }
        return {
          skillId,
          skillName: candidate.name,
          status: conflict ? "conflict" : "imported",
          targetPath: `${MOCK_HUB_DIR}/${candidate.name}`,
          backupPath: candidate.name === "github" && force ? mockPath(`.config/skills-hub/backups/imports/mock/${candidate.name}`) : null,
        };
      });
      return { environment: { id: String(input.environmentId ?? "local"), name: "当前环境", kind: "local" }, items } as T;
    }
    case "link_environment_skill":
    case "unlink_environment_skill": {
      const skillName = String(input.skillName ?? "");
      const tools = (input.tools as AgentKind[] | undefined) ?? [];
      const nextStatus = command === "link_environment_skill" ? "linked" : "missing";
      mockStatuses = mockStatuses.map((status) => {
        if ((status.skillName ?? status.skill_name) !== skillName) return status;
        return {
          ...status,
          agents: status.agents.map((item) => tools.includes(item.agent) ? { ...item, status: nextStatus } : item),
        };
      });
      return tools.map((agent) => ({
        agent,
        status: command === "link_environment_skill" ? "linked" : "unlinked",
        path: `${mockAgentSkillsDir(agent)}/${skillName}`,
        targetPath: `${MOCK_HUB_DIR}/${skillName}`,
        method: input.syncMethod ?? "auto",
      })) as T;
    }
    case "takeover_environment_skill":
      return {
        agent: ((input.tools as AgentKind[] | undefined) ?? ["codex"])[0],
        skillName: String(input.skillName),
        path: "",
        targetPath: "",
        backupPath: mockPath(".config/skills-hub/backups/conflict"),
        status: "linked",
        method: input.syncMethod ?? "auto",
      } as T;
    case "add_environment_source": {
      const environmentId = String(input.environmentId ?? "local");
      const url = String(input.url ?? "");
      const source = { id: String(input.id || url.split("/").pop()?.replace(/\.git$/, "") || "skills"), url, branch: input.branch as string | undefined, kind: url.includes("gitlab") ? "gitlab" : "github" };
      if (environmentId === "local") mockSources = [...mockSources, source];
      else mockRemoteSources[environmentId] = [...(mockRemoteSources[environmentId] ?? []), source];
      return source as T;
    }
    case "remove_environment_source": {
      const environmentId = String(input.environmentId ?? "local");
      const sourceRef = String(input.sourceRef ?? "");
      const sources = environmentId === "local" ? mockSources : (mockRemoteSources[environmentId] ?? []);
      const source = sources.find((item) => item.id === sourceRef) ?? null;
      if (environmentId === "local") mockSources = sources.filter((item) => item.id !== sourceRef);
      else mockRemoteSources[environmentId] = sources.filter((item) => item.id !== sourceRef);
      return source as T;
    }
    case "get_environment_source_cache": {
      const environmentId = String(input.environmentId ?? "local");
      const sourceRef = String(input.sourceRef ?? "");
      return mockSourceScan(environmentId, sourceRef) as T;
    }
    case "scan_environment_source": {
      const environmentId = String(input.environmentId ?? "local");
      const sourceRef = String(input.sourceRef ?? "");
      const result = mockSourceScan(environmentId, sourceRef);
      result.source.lastScanAt = new Date().toISOString();
      return result as T;
    }
    case "install_environment_source": {
      const environmentId = String(input.environmentId ?? "local");
      const sourceRef = String(input.sourceRef ?? "");
      const names = input.all ? ["react-review", "incident-helper"] : ((input.skills as string[] | undefined) ?? []);
      const installed = mockInstalledSourceSkills[`${environmentId}:${sourceRef}`] ?? new Set<string>();
      names.forEach((name) => installed.add(name));
      mockInstalledSourceSkills[`${environmentId}:${sourceRef}`] = installed;
      return {
        installed: names.map((name) => ({ name, sourcePath: `skills/${name}`, installed: true })),
        skipped: [],
      } as T;
    }
    case "trash_environment_skill": {
      const skillName = String(input.skillName ?? "");
      mockHub = mockHub.filter((skill) => dirName(skill) !== skillName && skill.name !== skillName);
      mockStatuses = mockStatuses.filter((status) => (status.skillName ?? status.skill_name) !== skillName);
      mockAgents = mockAgents.map((group) => ({
        ...group,
        skills: group.skills.filter((skill) => dirName(skill) !== skillName && skill.name !== skillName),
      }));
      return {
        environment: { id: String(input.environmentId ?? "local"), name: "当前环境", kind: "local" },
        skillName,
        trashPath: mockPath(`.config/skills-hub/backups/trash/20260802-120000/${skillName}`),
      } as T;
    }
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
      mockPreferences = { ...mockPreferences, defaultSyncMethod: input.defaultSyncMethod as SyncMethod };
      return mockPreferences as T;
    case "update_hub_dir":
      mockPreferences = { ...mockPreferences, hubDir: String(input.hubDir) };
      return { hubDir: mockPreferences.hubDir } as T;
    case "upsert_agent": {
      const agent: AgentConfig = {
        kind: String(input.id),
        label: String(input.label),
        skillsDir: String(input.skillsDir),
        enabled: Boolean(input.enabled),
      };
      mockPreferences = { ...mockPreferences, agents: [...mockPreferences.agents.filter((item) => item.kind !== agent.kind), agent] };
      return agent as T;
    }
    case "remove_agent": {
      const removed = mockPreferences.agents.find((agent) => agent.kind === input.id) ?? null;
      mockPreferences = { ...mockPreferences, agents: mockPreferences.agents.filter((agent) => agent.kind !== input.id) };
      return removed as T;
    }
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
          skillsDir: mockAgentSkillsDir(agent),
          skills: [],
        })),
        statuses: [
          { skillName: "browser", agent: "codex", status: "synced", remotePath: mockPath(".codex/skills/browser") },
          { skillName: "github", agent: "codex", status: "missing", remotePath: null },
          { skillName: "remote-private", agent: "claude", status: "remote-only", remotePath: mockPath(".claude/skills/remote-private") },
        ],
      } as T;
    case "remote_sync":
      return {
        remote: mockRemotes.find((item) => item.name === input.name) ?? mockRemotes[0],
        agents: input.tools ?? [],
        sourceDir: MOCK_HUB_DIR,
        remoteHubDir: "~/.agents/skills",
        syncMethod: input.syncMethod ?? "auto",
        commands: [["rsync"], ["ssh"]],
      } as T;
    case "sync_agents":
    case "link_skill_to_agents":
    case "unlink_skill_from_agents":
      return [] as T;
    case "takeover_agent_skill":
      return { agent: input.agent, skillName: input.skillName, path: "", backupPath: mockPath(".config/skills-hub/backups/github"), status: "linked", method: input.syncMethod ?? "auto" } as T;
    case "remove_agent_skill":
      return { agent: input.agent, skillName: input.skillName, path: "", backupPath: mockPath(".config/skills-hub/backups/skill"), status: "unlinked" } as T;
    case "migrate_from_agent": {
      const agent = String(input.from);
      const group = mockAgents.find((item) => item.agent === agent);
      const migrated: MigrationRecord[] = [];
      if (!group) return migrated as T;
      const hubNames = new Set(mockHub.flatMap((skill) => [dirName(skill), skill.name]));
      const nextSkills = group.skills.map((skill) => {
        const skillName = dirName(skill);
        if ((skill.isSymlink ?? skill.is_symlink) || skillName.startsWith(".") || hubNames.has(skillName) || hubNames.has(skill.name)) {
          return skill;
        }
        const hubSkill: SkillInfo = {
          ...skill,
          dirName: skillName,
          path: `${MOCK_HUB_DIR}/${skillName}`,
          isSymlink: false,
          symlinkTarget: null,
        };
        mockHub = [...mockHub, hubSkill];
        hubNames.add(skillName);
        hubNames.add(skill.name);
        mockStatuses = [...mockStatuses, {
          skillName,
          hubPath: hubSkill.path,
          agents: mockAgents.map(({ agent: targetAgent, skillsDir }) => ({
            agent: targetAgent,
            status: targetAgent === agent ? "linked" : "missing",
            path: `${skillsDir}/${skillName}`,
            targetPath: hubSkill.path,
          })),
        }];
        migrated.push({
          agent,
          skillName,
          originalPath: skill.path,
          hubPath: hubSkill.path,
          backupPath: mockPath(`.config/skills-hub/backups/migrations/${agent}/${skillName}`),
          migratedAt: new Date().toISOString(),
        });
        return { ...skill, isSymlink: true, symlinkTarget: hubSkill.path };
      });
      mockAgents = mockAgents.map((item) => item.agent === agent ? { ...item, skills: nextSkills } : item);
      return migrated as T;
    }
    case "remote_sync_skill":
      return { remote: mockRemotes[0], agent: input.agent, skillName: input.skillName, status: "linked" } as T;
    case "remote_sync_local_agent_skill":
      return { remote: mockRemotes[0], agent: input.targetAgent, skillName: input.skillName, status: "linked" } as T;
    case "remote_import_skill":
      return { remote: mockRemotes[0], agent: input.agent, skillName: input.skillName, hubPath: `${MOCK_HUB_DIR}/${String(input.skillName)}`, imported: true } as T;
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
  listEnvironments: () => invoke<EnvironmentSummary[]>("list_environments"),
  getEnvironmentSnapshot: (environmentId: string, tools?: AgentKind[]) =>
    invoke<EnvironmentSnapshot>("get_environment_snapshot", { input: { environmentId, tools } }),
  checkEnvironmentConnection: (environmentId: string) =>
    invoke<RemoteConnectionStatus>("check_environment_connection", { environmentId }),
  compareEnvironments: (input: { sourceEnvironmentId: string; targetEnvironmentId: string }) =>
    invoke<EnvironmentCompareResult>("compare_environments", { input }),
  transferSkills: (input: {
    sourceEnvironmentId: string;
    targetEnvironmentId: string;
    skillNames: string[];
    force?: boolean;
    dryRun?: boolean;
  }) => invoke<EnvironmentTransferResult[]>("transfer_skills", { input }),
  previewEnvironmentImport: (input: { environmentId: string; sourcePath: string }) =>
    invoke<SkillImportPreview>("preview_environment_import", { input }),
  importEnvironmentSkills: (input: {
    environmentId: string;
    sourcePath: string;
    skillIds: string[];
    force?: boolean;
    dryRun?: boolean;
  }) => invoke<EnvironmentImportResult>("import_environment_skills", { input }),
  linkEnvironmentSkill: (input: {
    environmentId: string;
    skillName: string;
    tools: AgentKind[];
    force?: boolean;
    dryRun?: boolean;
    syncMethod?: SyncMethod;
  }) => invoke<LinkTargetResult[]>("link_environment_skill", { input }),
  unlinkEnvironmentSkill: (input: {
    environmentId: string;
    skillName: string;
    tools: AgentKind[];
    dryRun?: boolean;
    syncMethod?: SyncMethod;
  }) => invoke<LinkTargetResult[]>("unlink_environment_skill", { input }),
  takeoverEnvironmentSkill: (input: {
    environmentId: string;
    skillName: string;
    tools: AgentKind[];
    dryRun?: boolean;
    syncMethod?: SyncMethod;
  }) => invoke<TakeoverResult>("takeover_environment_skill", { input }),
  trashEnvironmentSkill: (input: { environmentId: string; skillName: string; dryRun?: boolean }) =>
    invoke<EnvironmentTrashResult>("trash_environment_skill", { input }),
  addEnvironmentSource: (input: { environmentId: string; id?: string; url: string; branch?: string; dryRun?: boolean }) =>
    invoke<SkillSource>("add_environment_source", { input }),
  removeEnvironmentSource: (input: { environmentId: string; sourceRef: string; dryRun?: boolean }) =>
    invoke<SkillSource | null>("remove_environment_source", { input }),
  scanEnvironmentSource: (input: { environmentId: string; sourceRef: string; dryRun?: boolean }) =>
    invoke<SourceScanResult>("scan_environment_source", { input }),
  getEnvironmentSourceCache: (input: { environmentId: string; sourceRef: string }) =>
    invoke<SourceScanResult | null>("get_environment_source_cache", { input }),
  installEnvironmentSource: (input: {
    environmentId: string;
    sourceRef: string;
    skills: string[];
    all: boolean;
    force: boolean;
    dryRun?: boolean;
  }) => invoke<InstallResult>("install_environment_source", { input }),
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
    invoke<MigrationRecord[]>("migrate_from_agent", { input }),
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
  updateHubDir: (hubDir: string) => invoke<HubConfig>("update_hub_dir", { input: { hubDir } }),
  upsertAgent: (input: { id: string; label: string; skillsDir: string; enabled: boolean }) =>
    invoke<AgentConfig>("upsert_agent", { input }),
  removeAgent: (id: string) => invoke<AgentConfig | null>("remove_agent", { input: { id } }),
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
