import type { AgentKind, ScanAllResult, SkillAgentStatus, SkillInfo, SkillStatus } from "@/lib/api";

export const AGENTS = ["codex", "claude", "cursor", "openclaw"] as AgentKind[];

export interface SkillRowView {
  name: string;
  displayName: string;
  description?: string | null;
  path: string;
  skillFile?: string;
  agents: SkillAgentStatus[];
}

export function buildSkillRows(scan?: ScanAllResult, statuses?: SkillStatus[]): SkillRowView[] {
  const statusByName = new Map<string, SkillStatus>();
  for (const status of statuses ?? []) {
    statusByName.set(status.skillName ?? status.skill_name ?? "", status);
  }
  return (scan?.hub ?? []).map((skill) => {
    const name = skill.dirName ?? skill.dir_name ?? skill.name;
    const status = statusByName.get(name);
    return {
      name,
      displayName: skill.name,
      description: skill.description,
      path: skill.path,
      skillFile: skill.skillFile ?? skill.skill_file,
      agents: status?.agents ?? [],
    };
  });
}

export function agentStatus(row: SkillRowView, agent: AgentKind) {
  return row.agents.find((item) => item.agent === agent)?.status ?? "missing";
}

export interface MigrationSummary {
  agent: AgentKind;
  totalCount: number;
  inHubCount: number;
  migratableCount: number;
  externalCount: number;
}

export function buildMigrationSummaries(scan?: ScanAllResult): MigrationSummary[] {
  const hubNames = new Set<string>();
  for (const skill of scan?.hub ?? []) {
    const name = skill.dirName ?? skill.dir_name ?? skill.name;
    hubNames.add(name);
    hubNames.add(skill.name);
  }

  return AGENTS.map((agent) => {
    const result = scan?.agents.find((item) => item.agent === agent);
    const skills = result?.skills ?? [];
    const inHubCount = skills.filter((skill) => {
      const name = skill.dirName ?? skill.dir_name ?? skill.name;
      return hubNames.has(name) || hubNames.has(skill.name);
    }).length;
    const migratableCount = skills.filter((skill) => {
      const name = skill.dirName ?? skill.dir_name ?? skill.name;
      const isSymlink = skill.isSymlink ?? skill.is_symlink;
      return !isSymlink && !name.startsWith(".") && !hubNames.has(name) && !hubNames.has(skill.name);
    }).length;
    const externalCount = skills.filter((skill) => {
      const name = skill.dirName ?? skill.dir_name ?? skill.name;
      const isSymlink = skill.isSymlink ?? skill.is_symlink;
      return Boolean(isSymlink) && !hubNames.has(name) && !hubNames.has(skill.name);
    }).length;
    return {
      agent,
      totalCount: skills.length,
      inHubCount,
      migratableCount,
      externalCount,
    };
  });
}

export function buildAgentInventory(scan?: ScanAllResult) {
  return AGENTS.map((agent) => {
    const result = scan?.agents.find((item) => item.agent === agent);
    return {
      agent,
      skillsDir: result?.skillsDir ?? result?.skills_dir ?? "",
      skills: result?.skills ?? [],
    };
  });
}

export interface ImportableSkillView {
  agent: AgentKind;
  name: string;
  dirName: string;
  description?: string | null;
  path: string;
}

export interface ExternalSkillView extends ImportableSkillView {
  targetPath?: string | null;
}

export interface ToolConflictView {
  skillName: string;
  displayName: string;
  agent: AgentKind;
  path: string;
  targetPath?: string | null;
}

export interface ToolEnablementSummary {
  agent: AgentKind;
  total: number;
  enabled: number;
  missing: number;
  conflicts: number;
}

export interface WorkspaceOverview {
  hubCount: number;
  importable: ImportableSkillView[];
  external: ExternalSkillView[];
  conflicts: ToolConflictView[];
  summaries: ToolEnablementSummary[];
  missingCount: number;
  enabledCount: number;
}

export function buildWorkspaceOverview(scan?: ScanAllResult, statuses?: SkillStatus[]): WorkspaceOverview {
  const hubNames = new Set<string>();
  for (const skill of scan?.hub ?? []) {
    const name = skill.dirName ?? skill.dir_name ?? skill.name;
    hubNames.add(name);
    hubNames.add(skill.name);
  }

  const importable: ImportableSkillView[] = [];
  const external: ExternalSkillView[] = [];
  for (const group of scan?.agents ?? []) {
    for (const skill of group.skills) {
      const name = skill.dirName ?? skill.dir_name ?? skill.name;
      const isSymlink = skill.isSymlink ?? skill.is_symlink;
      if (!isSymlink && !name.startsWith(".") && !hubNames.has(name) && !hubNames.has(skill.name)) {
        importable.push({
          agent: group.agent,
          name: skill.name,
          dirName: name,
          description: skill.description,
          path: skill.path,
        });
      }
      if (isSymlink && !hubNames.has(name) && !hubNames.has(skill.name)) {
        external.push({
          agent: group.agent,
          name: skill.name,
          dirName: name,
          description: skill.description,
          path: skill.path,
          targetPath: skill.symlinkTarget ?? skill.symlink_target,
        });
      }
    }
  }

  const conflicts: ToolConflictView[] = [];
  const summaryByAgent = new Map<AgentKind, ToolEnablementSummary>();
  for (const agent of AGENTS) {
    summaryByAgent.set(agent, { agent, total: scan?.hub.length ?? 0, enabled: 0, missing: 0, conflicts: 0 });
  }

  for (const status of statuses ?? []) {
    const skillName = status.skillName ?? status.skill_name ?? "";
    for (const agentStatus of status.agents) {
      const summary = summaryByAgent.get(agentStatus.agent);
      if (!summary) continue;
      if (agentStatus.status === "linked" || agentStatus.status === "copied") summary.enabled += 1;
      if (agentStatus.status === "missing" || agentStatus.status === "hub-only") summary.missing += 1;
      if (agentStatus.status === "conflict") {
        summary.conflicts += 1;
        conflicts.push({
          skillName,
          displayName: skillName,
          agent: agentStatus.agent,
          path: agentStatus.path,
          targetPath: agentStatus.targetPath ?? agentStatus.target_path,
        });
      }
    }
  }

  const summaries = Array.from(summaryByAgent.values());
  return {
    hubCount: scan?.hub.length ?? 0,
    importable,
    external,
    conflicts,
    summaries,
    missingCount: summaries.reduce((total, item) => total + item.missing, 0),
    enabledCount: summaries.reduce((total, item) => total + item.enabled, 0),
  };
}
