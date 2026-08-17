import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ListFilter,
  ChevronLeft,
  Cloud,
  Download,
  ExternalLink,
  FolderInput,
  FolderOpen,
  Loader2,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Save,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  api,
  type AgentKind,
  type AgentConfig,
  type HubConfig,
  type HubPreferences,
  type EnvironmentSnapshot,
  type EnvironmentSummary,
  type MigrationRecord,
  type SkillImportPreview,
  type SourceScanResult,
  type SkillSource,
  type SyncMethod,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { AppSidebar, type Page } from "@/components/app-sidebar";
import { EmptyState, PageError, PageLoading, PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DetailDrawer,
  DetailDrawerCloseButton,
  DetailDrawerContent,
  DetailDrawerDescription,
  DetailDrawerTitle,
} from "@/components/ui/detail-drawer";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AgentIcon, SourceIcon } from "@/lib/brand";
import { useToast } from "@/lib/toast";
import { useEnvironmentSnapshot } from "@/hooks/use-environment-snapshot";
import { useAppUpdater, type AppUpdaterState } from "@/hooks/use-app-updater";
import {
  agentStatus,
  buildSkillRows,
  buildWorkspaceOverview,
  type SkillRowView,
} from "@/lib/view-model";

type Theme = "system" | "light" | "dark";
type StatusFilter = "all" | "synced" | "missing" | "conflict";
type AgentStatusValue = EnvironmentSnapshot["statuses"][number]["agents"][number]["status"];
const PAGE_SIZE = 50;
const WINDOW_DRAG_HEIGHT = 40;
const INTERACTIVE_SELECTOR = "button, input, select, textarea, a, [role='button'], [role='combobox'], [data-no-window-drag]";

function handleWindowDrag(event: ReactMouseEvent<HTMLDivElement>) {
  if (!isTauri() || event.button !== 0 || event.clientY > WINDOW_DRAG_HEIGHT) return;
  if ((event.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
  void getCurrentWindow().startDragging();
}

function updateSnapshotAgentStatus(
  snapshot: EnvironmentSnapshot | undefined,
  skillName: string,
  agent: AgentKind,
  nextStatus: AgentStatusValue,
) {
  if (!snapshot) return snapshot;
  return {
    ...snapshot,
    statuses: snapshot.statuses.map((status) => {
      if ((status.skillName ?? status.skill_name) !== skillName) return status;
      return {
        ...status,
        agents: status.agents.map((item) => item.agent === agent ? { ...item, status: nextStatus } : item),
      };
    }),
  };
}

function configuredAgentLabel(agent: AgentKind, config?: HubConfig) {
  return config?.agents?.[agent]?.label ?? agent;
}

function formatSourceScanTime(value?: string | null) {
  if (!value) return "尚未更新";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "更新时间未知";
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))} 小时前`;
  if (elapsed < 7 * 24 * 60 * 60_000) return `${Math.floor(elapsed / (24 * 60 * 60_000))} 天前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

const statusLabels: Record<string, string> = {
  linked: "已同步",
  copied: "已同步",
  missing: "未同步",
  "hub-only": "未同步",
  conflict: "冲突",
};

function App() {
  const [page, setPage] = useState<Page>("skills");
  const [environmentId, setEnvironmentId] = useState("local");
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("skills-hub-theme") as Theme | null) ?? "system");
  const environments = useQuery({
    queryKey: ["environments"],
    queryFn: api.listEnvironments,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const appUpdater = useAppUpdater();
  const selectedEnvironment = environments.data?.find((item) => item.id === environmentId) ?? environments.data?.[0];

  useEffect(() => {
    if (!environmentId && environments.data?.[0]) setEnvironmentId(environments.data[0].id);
  }, [environmentId, environments.data]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("skills-hub-theme", theme);
  }, [theme]);

  const selectEnvironment = (nextEnvironmentId: string) => {
    setEnvironmentId(nextEnvironmentId);
    setPage("skills");
  };

  return (
    <div className="app-frame" onMouseDownCapture={handleWindowDrag}>
      <AppSidebar
        environments={environments.data ?? []}
        selectedEnvironmentId={selectedEnvironment?.id ?? environmentId}
        page={page}
        onEnvironmentChange={selectEnvironment}
        onPageChange={setPage}
        onEnvironmentAdded={(environment) => {
          void environments.refetch();
          selectEnvironment(environment.id);
        }}
      />
      <main className="app-main">
        {page === "skills" && selectedEnvironment && <SkillsPage environment={selectedEnvironment} environments={environments.data ?? []} />}
        {page === "sources" && selectedEnvironment && <SourcesPage environment={selectedEnvironment} />}
        {page === "settings" && selectedEnvironment && (
          <SettingsPage
            environment={selectedEnvironment}
            theme={theme}
            onThemeChange={setTheme}
            updater={appUpdater.state}
            onCheckForUpdates={() => void appUpdater.checkForUpdates()}
            onInstallUpdate={() => void appUpdater.installUpdate()}
          />
        )}
        {environments.isLoading && <PageLoading />}
        {environments.isError && (
          <PageError
            title="无法读取环境配置"
            message={getErrorMessage(environments.error)}
            onRetry={() => void environments.refetch()}
          />
        )}
        {!environments.isLoading && !environments.isError && !selectedEnvironment && (
          <EmptyState title="没有可用环境" description="添加本机或 SSH 环境后开始管理 Skill。" />
        )}
      </main>
    </div>
  );
}

function SkillsPage({ environment, environments }: { environment: EnvironmentSummary; environments: EnvironmentSummary[] }) {
  const queryClient = useQueryClient();
  const { showToast, updateToast } = useToast();
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState<AgentKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [conflictResolution, setConflictResolution] = useState<{ skillName: string; agent: AgentKind } | null>(null);
  const [bulkConflictOpen, setBulkConflictOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const snapshot = useEnvironmentSnapshot(environment.id);
  const agents = useMemo(() => snapshot.data?.agents.map((item) => item.agent) ?? [], [snapshot.data?.agents]);
  const agentLabels = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent, configuredAgentLabel(agent, snapshot.data?.config)])),
    [agents, snapshot.data?.config],
  );
  const rows = useMemo(() => {
    if (!snapshot.data) return [];
    return buildSkillRows({ hub: snapshot.data.hub, agents: snapshot.data.agents }, snapshot.data.statuses);
  }, [snapshot.data]);
  const selectedSkill = useMemo(
    () => rows.find((row) => row.name === selectedSkillName) ?? null,
    [rows, selectedSkillName],
  );
  const overview = useMemo(
    () => (snapshot.data ? buildWorkspaceOverview({ hub: snapshot.data.hub, agents: snapshot.data.agents }, snapshot.data.statuses) : null),
    [snapshot.data],
  );
  const selectedConflict = conflictResolution
    ? overview?.conflicts.find((item) => item.skillName === conflictResolution.skillName && item.agent === conflictResolution.agent)
    : null;
  const selectedConflictSkill = conflictResolution
    ? rows.find((row) => row.name === conflictResolution.skillName)
    : null;
  const conflictSkillCount = useMemo(
    () => new Set(overview?.conflicts.map((item) => item.skillName) ?? []).size,
    [overview?.conflicts],
  );
  const conflictAgentCounts = useMemo(() => {
    const counts = new Map<AgentKind, number>();
    for (const conflict of overview?.conflicts ?? []) {
      counts.set(conflict.agent, (counts.get(conflict.agent) ?? 0) + 1);
    }
    return Array.from(counts, ([agent, count]) => ({ agent, count }));
  }, [overview?.conflicts]);
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const result = rows.filter((row) => {
      const matchesQuery = !normalized || `${row.name} ${row.displayName} ${row.description ?? ""}`.toLowerCase().includes(normalized);
      const matchesAgent = agentFilter === "all" || row.agents.some((status) => status.agent === agentFilter);
      const matchesStatus =
        statusFilter === "all" ||
        row.agents.some((status) => {
          if (statusFilter === "synced") return status.status === "linked" || status.status === "copied";
          if (statusFilter === "missing") return status.status === "missing" || status.status === "hub-only";
          return status.status === "conflict";
        });
      return matchesQuery && matchesAgent && matchesStatus;
    });
    return result;
  }, [agentFilter, query, rows, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const pageRows = visibleRows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const filtering = Boolean(query.trim()) || agentFilter !== "all" || statusFilter !== "all";

  useEffect(() => {
    setPageIndex(0);
  }, [agentFilter, environment.id, query, statusFilter]);

  useEffect(() => {
    const scrollElement = document.querySelector(".app-main");
    if (scrollElement instanceof HTMLElement) scrollElement.scrollTop = 0;
  }, [agentFilter, currentPage, environment.id, query, statusFilter]);

  const skillMutation = useMutation({
    mutationFn: async ({ skillName, agent, status }: { skillName: string; agent: AgentKind; status: string }) => {
      const synced = status === "linked" || status === "copied";
      return synced
        ? api.unlinkEnvironmentSkill({ environmentId: environment.id, skillName, tools: [agent] })
        : api.linkEnvironmentSkill({ environmentId: environment.id, skillName, tools: [agent] });
    },
    onMutate: ({ skillName, agent }) => showToast({ tone: "loading", title: "正在更新 Skill", description: `${skillName} · ${agentLabels[agent]}` }),
    onSuccess: async (result, variables, toastId) => {
      const conflict = result.some((item) => item.status === "conflict");
      const wasSynced = variables.status === "linked" || variables.status === "copied";
      const target = result.find((item) => item.agent === variables.agent);
      const nextStatus: AgentStatusValue = conflict
        ? "conflict"
        : wasSynced
          ? "missing"
          : target?.status === "copied"
            ? "copied"
            : "linked";
      queryClient.setQueryData<EnvironmentSnapshot>(
        ["environment-snapshot", environment.id],
        (current) => updateSnapshotAgentStatus(current, variables.skillName, variables.agent, nextStatus),
      );
      updateToast(toastId, {
        tone: conflict ? "error" : "success",
        title: conflict ? "冲突" : "状态已更新",
        description: conflict ? "目标 Agent 已存在未受管目录。" : `${variables.skillName} · ${agentLabels[variables.agent]}`,
      });
      await queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environment.id] });
    },
    onError: (error, variables, toastId) => updateToast(toastId ?? "", { tone: "error", title: "Skill 操作失败", description: `${variables.skillName} · ${getErrorMessage(error)}` }),
  });
  const takeoverMutation = useMutation({
    mutationFn: ({ skillName, agent }: { skillName: string; agent: AgentKind }) =>
      api.takeoverEnvironmentSkill({ environmentId: environment.id, skillName, tools: [agent] }),
    onMutate: ({ skillName, agent }) => showToast({ tone: "loading", title: "正在备份并接管", description: `${skillName} · ${agentLabels[agent]}` }),
    onSuccess: async (_result, variables, toastId) => {
      setConflictResolution(null);
      queryClient.setQueryData<EnvironmentSnapshot>(
        ["environment-snapshot", environment.id],
        (current) => updateSnapshotAgentStatus(current, variables.skillName, variables.agent, "linked"),
      );
      updateToast(toastId, { tone: "success", title: "已备份并接管", description: `${variables.skillName} · ${agentLabels[variables.agent]}` });
      await queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environment.id] });
    },
    onError: (error, variables, toastId) => updateToast(toastId ?? "", { tone: "error", title: "接管失败", description: `${variables.skillName} · ${getErrorMessage(error)}` }),
  });
  const bulkTakeoverMutation = useMutation({
    mutationFn: async (conflicts: NonNullable<typeof overview>["conflicts"]) => {
      const succeeded: typeof conflicts = [];
      const failed: Array<{ conflict: (typeof conflicts)[number]; reason: string }> = [];
      for (const conflict of conflicts) {
        try {
          await api.takeoverEnvironmentSkill({
            environmentId: environment.id,
            skillName: conflict.skillName,
            tools: [conflict.agent],
          });
          succeeded.push(conflict);
        } catch (error) {
          failed.push({ conflict, reason: getErrorMessage(error) });
        }
      }
      return { succeeded, failed };
    },
    onMutate: (conflicts) => showToast({
      tone: "loading",
      title: "正在批量解决冲突",
      description: `正在依次备份并处理 ${conflicts.length} 个冲突项。`,
    }),
    onSuccess: async (result, _conflicts, toastId) => {
      setBulkConflictOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environment.id] });
      const hasFailures = result.failed.length > 0;
      updateToast(toastId, {
        tone: hasFailures ? "error" : "success",
        title: hasFailures ? "部分冲突未解决" : "冲突已全部解决",
        description: hasFailures
          ? `已解决 ${result.succeeded.length} 项，失败 ${result.failed.length} 项；失败项仍保留在冲突列表中。`
          : `已备份并接管 ${result.succeeded.length} 个冲突项。`,
      });
    },
    onError: async (error, _conflicts, toastId) => {
      await queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environment.id] });
      updateToast(toastId ?? "", { tone: "error", title: "批量处理失败", description: getErrorMessage(error) });
    },
  });
  const handleAgentAction = (skillName: string, agent: AgentKind, status: string) => {
    if (status === "conflict") {
      setConflictResolution({ skillName, agent });
      return;
    }
    skillMutation.mutate({ skillName, agent, status });
  };
  const closeSkillDrawer = () => {
    const skillName = selectedSkillName;
    setSelectedSkillName(null);
    if (skillName) restoreFocusToItem("data-skill-id", skillName);
  };
  const trashMutation = useMutation({
    mutationFn: (skillName: string) => api.trashEnvironmentSkill({ environmentId: environment.id, skillName }),
    onMutate: (skillName) => showToast({ tone: "loading", title: "正在移入回收站", description: skillName }),
    onSuccess: async (result, skillName, toastId) => {
      setSelectedSkillName(null);
      updateToast(toastId, {
        tone: "success",
        title: "已移入回收站",
        description: result.trashPath ?? result.trash_path ?? skillName,
      });
      await queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environment.id] });
    },
    onError: (error, skillName, toastId) => updateToast(toastId ?? "", { tone: "error", title: "移入回收站失败", description: `${skillName} · ${getErrorMessage(error)}` }),
  });

  const pageSubtitle = environment.kind === "local" ? "统一管理的 AI Coding Skills。" : "通过 SSH 管理这台电脑自己的 Hub、Agent 和来源。";
  if (snapshot.isLoading) {
    return <PageShell title="技能" subtitle={pageSubtitle} environment={environment}><PageLoading /></PageShell>;
  }
  if (snapshot.isError || !snapshot.data) {
    return <PageShell title="技能" subtitle={pageSubtitle} environment={environment}><PageError title={`${environment.name} 暂时不可用`} message={getErrorMessage(snapshot.error)} onRetry={() => void snapshot.refetch()} /></PageShell>;
  }

  const capabilitiesReady = environment.kind === "local" || (snapshot.data.capabilities.ssh && snapshot.data.capabilities.python3);
  const canImport = environment.kind === "local" || (capabilitiesReady && snapshot.data.capabilities.rsync);
  return (
    <PageShell
      title="技能"
      subtitle={pageSubtitle}
      environment={environment}
      transitioning={snapshot.isPlaceholderData}
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setImportOpen(true)}
            disabled={!canImport}
            title={canImport ? "从文件夹或 ZIP 添加 Skill" : "SSH 环境需要 Python3 和 rsync 才能接收本机 Skill"}
          >
            <Plus className="h-3.5 w-3.5" /> 添加 Skill
          </Button>
          {environment.kind === "local" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setMigrationOpen(true)}
              disabled={!overview?.importable.length}
              title={overview?.importable.length ? "选择 Agent，将其中已有的 Skill 纳入 Hub 管理" : "当前没有待迁移的 Agent Skill"}
            >
              <FolderInput className="h-3.5 w-3.5" /> 迁移已有 Skill
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="refresh-button"
            onClick={() => void snapshot.refetch()}
            disabled={snapshot.isFetching}
            aria-busy={snapshot.isFetching || undefined}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", snapshot.isFetching && "animate-spin")} /> 刷新
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setTransferOpen(true)}>
            <Cloud className="h-3.5 w-3.5" /> 环境工具
          </Button>
        </div>
      }
    >
      {!capabilitiesReady && (
        <div className="capability-banner">
          <CircleAlert className="h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">SSH 环境缺少必要能力</div>
            <div className="mt-0.5 text-xs">{snapshot.data.capabilities.message || "需要 SSH 和 Python3 才能读取远端 Skill。"}</div>
          </div>
        </div>
      )}
      <div className="stats-strip">
        <StatItem label="已纳管" value={overview?.hubCount ?? 0} />
        <StatItem label="待纳管" value={overview?.importable.length ?? 0} tone="muted" />
        <StatItem label="已同步" value={overview?.enabledCount ?? 0} tone="success" />
        <StatItem
          label="冲突项"
          value={overview?.conflicts.length ?? 0}
          tone="danger"
          ariaLabel={`冲突项 ${overview?.conflicts.length ?? 0}，按 Skill × Agent 计数，点击查看并处理`}
          tooltip={{
            title: "按 Skill × Agent 计数",
            description: "同一 Skill 在多个 Agent 中发生冲突时，会分别计为一项。",
          }}
          onClick={overview?.conflicts.length ? () => {
            setQuery("");
            setAgentFilter("all");
            setStatusFilter("conflict");
          } : undefined}
        />
      </div>
      <div className="workspace-toolbar">
        <div className="search-field">
          <Search className="h-4 w-4" />
          <Input
            value={query}
            name="skill-search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="search"
            enterKeyHint="search"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索名称或描述…"
          />
          {query && <button className="search-clear" aria-label="清空搜索" onClick={() => setQuery("")}><X className="h-3.5 w-3.5" /></button>}
        </div>
        <div className="filter-group">
          <Select value={agentFilter} onValueChange={(value) => setAgentFilter(value as AgentKind | "all")}>
            <SelectTrigger className="agent-filter-trigger" aria-label="按 Agent 筛选">
              {agentFilter === "all" ? <><ListFilter className="h-3.5 w-3.5" />所有 Agent</> : <><AgentIcon agent={agentFilter} size={14} /><span className="truncate">{agentLabels[agentFilter]}</span></>}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有 Agent</SelectItem>
              {agents.map((agent) => <SelectItem key={agent} value={agent}><span className="select-option"><AgentIcon agent={agent} size={14} />{agentLabels[agent]}</span></SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger className="status-filter-trigger" aria-label="按状态筛选">
              <ListFilter className="h-3.5 w-3.5" />{statusFilter === "all" ? "所有状态" : statusFilter === "synced" ? "已同步" : statusFilter === "missing" ? "未同步" : "冲突"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有状态</SelectItem>
              <SelectItem value="synced">已同步</SelectItem>
              <SelectItem value="missing">未同步</SelectItem>
              <SelectItem value="conflict">冲突</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <section className="workspace-list">
        <div className="workspace-list-header">
          <div>
            <div className="section-title">技能列表</div>
            <div className="section-caption">{filtering ? `${visibleRows.length} / ${rows.length}` : visibleRows.length} 个 Skill</div>
          </div>
          {statusFilter === "conflict" && Boolean(overview?.conflicts.length) && (
            <Button size="sm" onClick={() => setBulkConflictOpen(true)}>
              <CheckCircle2 className="h-3.5 w-3.5" /> 一键解决 {overview?.conflicts.length} 项
            </Button>
          )}
        </div>
        <div className="skill-list">
          {pageRows.map((row) => (
            <SkillRow
              key={row.name}
              row={row}
              onOpen={() => setSelectedSkillName(row.name)}
              onAgentAction={(agent, status) => handleAgentAction(row.name, agent, status)}
              pendingAgent={
                skillMutation.isPending && skillMutation.variables?.skillName === row.name
                  ? skillMutation.variables.agent
                  : takeoverMutation.isPending && takeoverMutation.variables?.skillName === row.name
                    ? takeoverMutation.variables.agent
                    : null
              }
              agents={agents}
              agentLabels={agentLabels}
            />
          ))}
          {!visibleRows.length && <EmptyState title="没有匹配的 Skill" description="调整搜索或状态筛选后重试。" />}
        </div>
        {pageCount > 1 && (
          <div className="pagination-bar">
            <div className="pagination-summary">{filtering ? `${visibleRows.length} / ${rows.length}` : visibleRows.length} 个 Skill · 每页 {PAGE_SIZE} 个</div>
            <div className="pagination-controls">
              <Button variant="secondary" size="sm" disabled={currentPage === 0} onClick={() => setPageIndex((page) => Math.max(0, page - 1))}>
                <ChevronLeft className="h-3.5 w-3.5" /> 上一页
              </Button>
              <span className="pagination-current">第 {currentPage + 1} / {pageCount} 页</span>
              <Button variant="secondary" size="sm" disabled={currentPage >= pageCount - 1} onClick={() => setPageIndex((page) => Math.min(pageCount - 1, page + 1))}>
                下一页 <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </section>
      {selectedSkill && (
        <SkillDrawer
          row={selectedSkill}
          snapshot={snapshot.data}
          onClose={closeSkillDrawer}
          onAgentAction={(agent, status) => handleAgentAction(selectedSkill.name, agent, status)}
          onTrash={() => trashMutation.mutate(selectedSkill.name)}
          trashing={trashMutation.isPending}
          agents={agents}
          agentLabels={agentLabels}
        />
      )}
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} source={environment} environments={environments} />
      <AgentMigrationDialog
        open={migrationOpen}
        onOpenChange={setMigrationOpen}
        snapshot={snapshot.data}
        agentLabels={agentLabels}
      />
      <Dialog
        open={Boolean(conflictResolution)}
        onOpenChange={(open) => { if (!open && !takeoverMutation.isPending) setConflictResolution(null); }}
      >
        <DialogContent className="conflict-resolution-dialog">
          <DialogHeader>
            <DialogTitle>解决 Skill 冲突</DialogTitle>
            <DialogDescription>
              {conflictResolution
                ? `${conflictResolution.skillName} 在 ${agentLabels[conflictResolution.agent] ?? conflictResolution.agent} 中存在未受 Hub 管理的同名内容。`
                : "当前存在未受 Hub 管理的同名内容。"}
            </DialogDescription>
          </DialogHeader>
          <div className="conflict-resolution-paths">
            <div>
              <span>Hub 版本</span>
              <code title={selectedConflictSkill?.path}>{selectedConflictSkill?.path ?? "—"}</code>
            </div>
            <div>
              <span>Agent 当前版本</span>
              <code title={selectedConflict?.path}>{selectedConflict?.path ?? "—"}</code>
            </div>
          </div>
          <div className="conflict-resolution-note">
            <CircleAlert className="h-4 w-4 shrink-0" />
            <span>继续后会先把 Agent 当前版本移动到备份目录，再创建指向 Hub 版本的链接。Agent 当前内容不会被直接删除。</span>
          </div>
          <div className="conflict-resolution-actions">
            <Button variant="secondary" disabled={takeoverMutation.isPending} onClick={() => setConflictResolution(null)}>取消</Button>
            <Button
              pending={takeoverMutation.isPending}
              pendingLabel="正在备份并接管"
              disabled={!conflictResolution}
              onClick={() => conflictResolution && takeoverMutation.mutate(conflictResolution)}
            >
              备份并使用 Hub 版本
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={bulkConflictOpen}
        onOpenChange={(open) => { if (!bulkTakeoverMutation.isPending) setBulkConflictOpen(open); }}
      >
        <DialogContent className="bulk-conflict-dialog">
          <DialogHeader>
            <DialogTitle>一键解决全部冲突？</DialogTitle>
            <DialogDescription>所有冲突都将以当前 Hub 版本为准，Agent 中的现有版本会分别备份。</DialogDescription>
          </DialogHeader>
          <div className="bulk-conflict-summary">
            <div><span>冲突项</span><strong>{overview?.conflicts.length ?? 0}</strong></div>
            <div><span>涉及 Skill</span><strong>{conflictSkillCount}</strong></div>
            <div><span>涉及 Agent</span><strong>{conflictAgentCounts.length}</strong></div>
          </div>
          <div className="bulk-conflict-agents">
            {conflictAgentCounts.map(({ agent, count }) => (
              <span key={agent}><AgentIcon agent={agent} size={14} />{agentLabels[agent] ?? agent}<strong>{count}</strong></span>
            ))}
          </div>
          <div className="conflict-resolution-note">
            <CircleAlert className="h-4 w-4 shrink-0" />
            <span>该操作会逐项执行。即使某一项失败，其他冲突仍会继续处理；所有被替换的 Agent 内容都会先进入备份目录。</span>
          </div>
          <div className="conflict-resolution-actions">
            <Button variant="secondary" disabled={bulkTakeoverMutation.isPending} onClick={() => setBulkConflictOpen(false)}>取消</Button>
            <Button
              pending={bulkTakeoverMutation.isPending}
              pendingLabel="正在批量处理"
              disabled={!overview?.conflicts.length}
              onClick={() => overview?.conflicts.length && bulkTakeoverMutation.mutate(overview.conflicts)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> 备份并解决全部冲突
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ImportSkillDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        environment={environment}
        agents={agents}
        agentLabels={agentLabels}
      />
    </PageShell>
  );
}

function AgentMigrationDialog({
  open,
  onOpenChange,
  snapshot,
  agentLabels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: EnvironmentSnapshot;
  agentLabels: Record<string, string>;
}) {
  const queryClient = useQueryClient();
  const { showToast, updateToast } = useToast();
  const [selectedAgents, setSelectedAgents] = useState<AgentKind[]>([]);
  const overview = useMemo(
    () => buildWorkspaceOverview({ hub: snapshot.hub, agents: snapshot.agents }, snapshot.statuses),
    [snapshot],
  );
  const agentOptions = useMemo(
    () => snapshot.agents.map((group) => ({
      agent: group.agent,
      skillsDir: group.skillsDir ?? group.skills_dir ?? "",
      skills: overview.importable.filter((skill) => skill.agent === group.agent),
    })),
    [overview.importable, snapshot.agents],
  );
  const migratableAgents = useMemo(
    () => agentOptions.filter((option) => option.skills.length > 0).map((option) => option.agent),
    [agentOptions],
  );
  const selectedSkillCount = agentOptions.reduce(
    (total, option) => total + (selectedAgents.includes(option.agent) ? option.skills.length : 0),
    0,
  );

  useEffect(() => {
    if (open) setSelectedAgents(migratableAgents);
  }, [migratableAgents, open]);

  const migration = useMutation({
    mutationFn: async (agents: AgentKind[]) => {
      const records: MigrationRecord[] = [];
      for (const agent of agents) {
        records.push(...await api.migrateFromAgent({ from: agent, force: false }));
      }
      return records;
    },
    onMutate: (agents) => showToast({
      tone: "loading",
      title: "正在迁移 Agent Skill",
      description: `正在处理 ${agents.length} 个 Agent，请勿移动相关目录。`,
    }),
    onSuccess: async (records, agents, toastId) => {
      await queryClient.invalidateQueries({ queryKey: ["environment-snapshot", snapshot.environment.id] });
      updateToast(toastId, {
        tone: "success",
        title: "迁移完成",
        description: records.length
          ? `已将 ${records.length} 个 Skill 从 ${agents.length} 个 Agent 纳入 Hub 管理。原目录已备份并替换为链接。`
          : "所选 Agent 中没有新的 Skill 需要迁移。",
      });
      onOpenChange(false);
    },
    onError: async (error, _agents, toastId) => {
      await queryClient.invalidateQueries({ queryKey: ["environment-snapshot", snapshot.environment.id] });
      updateToast(toastId ?? "", {
        tone: "error",
        title: "迁移中断",
        description: `已完成的迁移会保留并显示在列表中。${getErrorMessage(error)}`,
      });
    },
  });

  const toggleAgent = (agent: AgentKind) => {
    setSelectedAgents((current) => current.includes(agent)
      ? current.filter((item) => item !== agent)
      : [...current, agent]);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!migration.isPending) onOpenChange(nextOpen); }}>
      <DialogContent className="agent-migration-dialog">
        <DialogHeader>
          <DialogTitle>迁移已有 Agent Skill</DialogTitle>
          <DialogDescription>选择需要迁移的 Agent。Skill 会先复制到 Hub，原目录备份成功后再替换为指向 Hub 的链接。</DialogDescription>
        </DialogHeader>
        <div className="agent-migration-summary">
          <div><span>可迁移 Agent</span><strong>{migratableAgents.length}</strong></div>
          <div><span>待迁移 Skill</span><strong>{overview.importable.length}</strong></div>
          <div><span>本次选择</span><strong>{selectedSkillCount}</strong></div>
        </div>
        <div className="agent-migration-list" aria-label="选择要迁移的 Agent">
          {agentOptions.map((option) => {
            const disabled = option.skills.length === 0;
            const selected = selectedAgents.includes(option.agent);
            return (
              <label key={option.agent} className={cn("agent-migration-row", disabled && "agent-migration-row-disabled")}>
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={disabled || migration.isPending}
                  onChange={() => toggleAgent(option.agent)}
                />
                <span className="agent-migration-icon"><AgentIcon agent={option.agent} size={16} /></span>
                <span className="agent-migration-copy">
                  <strong>{agentLabels[option.agent] ?? option.agent}</strong>
                  <span title={option.skillsDir}>{option.skills.length
                    ? option.skills.map((skill) => skill.name).join("、")
                    : "没有待迁移的 Skill"}</span>
                </span>
                <Badge>{option.skills.length} 个</Badge>
              </label>
            );
          })}
        </div>
        <div className="agent-migration-note">
          同名 Skill 已存在于 Hub 时不会覆盖，迁移后可在技能列表中处理对应冲突。
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={migration.isPending} onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            pending={migration.isPending}
            pendingLabel="迁移中"
            disabled={!selectedAgents.length || selectedSkillCount === 0}
            onClick={() => migration.mutate(selectedAgents)}
          >
            <FolderInput className="h-3.5 w-3.5" /> 迁移 {selectedSkillCount} 个 Skill
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const SkillRow = memo(function SkillRow({
  row,
  onOpen,
  onAgentAction,
  pendingAgent,
  agents,
  agentLabels,
}: {
  row: SkillRowView;
  onOpen: () => void;
  onAgentAction: (agent: AgentKind, status: string) => void;
  pendingAgent?: AgentKind | null;
  agents: AgentKind[];
  agentLabels: Record<string, string>;
}) {
  return (
    <div className="skill-row">
      <button className="skill-row-main" data-skill-id={row.name} onClick={onOpen}>
        <div className="min-w-0">
          <div className="skill-row-title">
            <span className="truncate">{row.displayName}</span>
          </div>
          <div className="skill-row-description">{row.description || "暂无描述"}</div>
        </div>
      </button>
      <div className="skill-agent-status">
        {agents.map((agent) => {
          const status = agentStatus(row, agent);
          const synced = status === "linked" || status === "copied";
          const pending = pendingAgent === agent;
          return (
            <button
              key={agent}
              className={cn("agent-status-cell", status === "conflict" && "agent-status-conflict", synced && "agent-status-synced", pending && "agent-status-loading")}
              title={`${agentLabels[agent]} · ${status === "conflict" ? "冲突，点击处理" : statusLabels[status] ?? status}`}
              onClick={() => onAgentAction(agent, status)}
              disabled={pending}
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AgentIcon agent={agent} size={15} />}
              <span className="agent-status-label">{agentLabels[agent]}</span>
              <span className="sr-only">{agentLabels[agent]} · {statusLabels[status] ?? status}</span>
            </button>
          );
        })}
      </div>
      <button className="skill-row-more" aria-label={`打开 ${row.displayName} 详情`} onClick={onOpen}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}, (previous, next) =>
  previous.row === next.row
  && previous.pendingAgent === next.pendingAgent
  && previous.agents === next.agents
  && previous.agentLabels === next.agentLabels
);

function SkillDrawer({
  row,
  snapshot,
  onClose,
  onAgentAction,
  onTrash,
  trashing,
  agents,
  agentLabels,
}: {
  row: SkillRowView;
  snapshot: EnvironmentSnapshot;
  onClose: () => void;
  onAgentAction: (agent: AgentKind, status: string) => void;
  onTrash: () => void;
  trashing: boolean;
  agents: AgentKind[];
  agentLabels: Record<string, string>;
}) {
  const [trashOpen, setTrashOpen] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const skill = snapshot.hub.find((item) => (item.dirName ?? item.dir_name ?? item.name) === row.name);
  return (
    <>
      <DetailDrawer open onOpenChange={(open) => { if (!open) onClose(); }}>
        <DetailDrawerContent
          className="skill-detail-drawer"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            headerRef.current?.focus();
          }}
        >
          <div ref={headerRef} className="drawer-header" tabIndex={-1}>
            <div className="min-w-0">
              <div className="drawer-kicker">SKILL</div>
              <DetailDrawerTitle>{row.displayName}</DetailDrawerTitle>
              <DetailDrawerDescription>{skill?.path ?? row.path}</DetailDrawerDescription>
            </div>
            <div className="drawer-header-actions">
              <button
                type="button"
                className="icon-button skill-trash-trigger"
                aria-label={`将 ${row.displayName} 移入回收站`}
                title="移入回收站"
                disabled={trashing}
                onClick={() => setTrashOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <DetailDrawerCloseButton />
            </div>
          </div>
          <div className="drawer-body">
            <p className="skill-drawer-description">{row.description || "暂无描述"}</p>
            <div className="drawer-section">
              <div className="drawer-section-title">Agent 状态</div>
              <div className="drawer-status-list">
                {agents.map((agent) => {
                  const status = agentStatus(row, agent);
                  const synced = status === "linked" || status === "copied";
                  return (
                    <button key={agent} className="drawer-status-row" onClick={() => onAgentAction(agent, status)}>
                      <span className="flex items-center gap-2"><AgentIcon agent={agent} size={15} /> {agentLabels[agent]}</span>
                      <span className={cn("status-text", synced && "status-text-success", status === "conflict" && "status-text-danger")}>{status === "conflict" ? "备份并接管" : statusLabels[status] ?? status}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="drawer-section">
              <div className="drawer-section-title">文件位置</div>
              <button className="path-button" onClick={() => skill?.path && void api.openPath(skill.path)}>
                <FolderOpen className="h-4 w-4" /> <span className="truncate">{skill?.path ?? row.path}</span> <ExternalLink className="ml-auto h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </DetailDrawerContent>
      </DetailDrawer>
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>将 {row.displayName} 移入回收站？</DialogTitle>
            <DialogDescription>会取消可安全识别的 Agent 同步关系，并把 Hub 中的 Skill 移到当前环境的备份回收区。未受管的冲突目录不会被删除，可从“设置 → 备份与回收站”中找回。</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setTrashOpen(false)}>取消</Button>
            <Button variant="destructive" size="sm" pending={trashing} pendingLabel="正在移除" onClick={onTrash}>移入回收站</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TransferDialog({
  open,
  onOpenChange,
  source,
  environments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: EnvironmentSummary;
  environments: EnvironmentSummary[];
}) {
  const { showToast } = useToast();
  const [targetId, setTargetId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const compare = useQuery({
    queryKey: ["environment-compare", source.id, targetId],
    queryFn: () => api.compareEnvironments({ sourceEnvironmentId: source.id, targetEnvironmentId: targetId }),
    enabled: open && Boolean(targetId),
    retry: false,
  });
  const transfer = useMutation({
    mutationFn: (force: boolean) => api.transferSkills({ sourceEnvironmentId: source.id, targetEnvironmentId: targetId, skillNames: selected, force }),
    onSuccess: (results) => {
      const conflicts = results.filter((item) => item.status === "conflict").length;
      showToast({ tone: conflicts ? "error" : "success", title: conflicts ? "存在传输冲突" : "Skill 已传输", description: conflicts ? `${conflicts} 个 Skill 需要确认覆盖。` : `${results.length} 个 Skill 已复制到目标环境。` });
      if (!conflicts) onOpenChange(false);
    },
    onError: (error) => showToast({ tone: "error", title: "传输失败", description: getErrorMessage(error) }),
  });
  const availableTargets = useMemo(
    () => environments.filter((item) => item.id !== source.id),
    [environments, source.id],
  );
  useEffect(() => {
    if (open && !targetId && availableTargets[0]) setTargetId(availableTargets[0].id);
    if (!open) setSelected((current) => current.length ? [] : current);
  }, [availableTargets, open, targetId]);
  const items = compare.data?.items ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,760px)]">
        <DialogHeader>
          <DialogTitle>环境对比与传输</DialogTitle>
          <DialogDescription>当前环境独立运行；这里只在你明确选择目标后比较和复制 Skill。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><div className="field-label">来源环境</div><div className="environment-choice">{source.name}</div></div>
            <div><div className="field-label">目标环境</div><select className="select-control" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">选择目标</option>{availableTargets.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}</select></div>
          </div>
          {!targetId && <EmptyState title="选择一个目标环境" description="对比结果会显示在这里。" />}
          {compare.isLoading && <PageLoading compact />}
          {compare.isError && <PageError title="无法比较环境" message={getErrorMessage(compare.error)} onRetry={() => void compare.refetch()} />}
          {items.length > 0 && (
            <div className="compare-list">
              {items.map((item) => {
                const skillName = item.skillName ?? item.skill_name ?? "";
                const selectedSkill = selected.includes(skillName);
                const selectable = item.status === "source-only" || item.status === "different";
                return (
                  <label key={skillName} className={cn("compare-row", !selectable && "compare-row-muted")}>
                    <input type="checkbox" checked={selectedSkill} disabled={!selectable} onChange={(event) => setSelected(event.target.checked ? [...selected, skillName] : selected.filter((itemName) => itemName !== skillName))} />
                    <span className="min-w-0 flex-1 truncate">{skillName}</span>
                    <span className={cn("status-text", item.status === "different" && "status-text-danger")}>{compareStatusLabel(item.status)}</span>
                  </label>
                );
              })}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
            <Button
              variant="secondary"
              disabled={!selected.length || !targetId}
              pending={transfer.isPending && transfer.variables === false}
              pendingLabel="传输中"
              onClick={() => transfer.mutate(false)}
            >
              安全传输
            </Button>
            {items.some((item) => selected.includes(item.skillName ?? item.skill_name ?? "") && item.status === "different") && (
              <Button disabled={!targetId || transfer.isPending} pending={transfer.isPending && transfer.variables === true} pendingLabel="传输中" onClick={() => transfer.mutate(true)}>
                覆盖并备份
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function chooseSkillImportFolder() {
  if (!isTauri()) {
    return "/mock/shared-skills";
  }
  const selected = await openDialog({
    title: "选择 Skill 文件夹",
    directory: true,
    multiple: false,
  });
  return typeof selected === "string" ? selected : null;
}

function ImportSkillDialog({
  open,
  onOpenChange,
  environment,
  agents,
  agentLabels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environment: EnvironmentSummary;
  agents: AgentKind[];
  agentLabels: Record<string, string>;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [preview, setPreview] = useState<SkillImportPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<AgentKind[]>([]);

  const previewMutation = useMutation({
    mutationFn: (sourcePath: string) => api.previewEnvironmentImport({ environmentId: environment.id, sourcePath }),
    onSuccess: (result) => {
      setPreview(result);
      setSelected(result.skills.filter((skill) => skill.status !== "invalid").map((skill) => skill.id));
    },
    onError: (error) => showToast({ tone: "error", title: "无法读取导入内容", description: getErrorMessage(error) }),
  });
  const importMutation = useMutation({
    mutationFn: async (force: boolean) => {
      const result = await api.importEnvironmentSkills({
        environmentId: environment.id,
        sourcePath: preview?.sourcePath ?? "",
        skillIds: selected,
        force,
      });
      const imported = result.items.filter((item) => item.status === "imported");
      const syncResults = selectedAgents.length
        ? await Promise.allSettled(imported.map((item) => api.linkEnvironmentSkill({
            environmentId: environment.id,
            skillName: item.skillName,
            tools: selectedAgents,
          })))
        : [];
      return {
        result,
        syncFailures: syncResults.filter((item) => item.status === "rejected").length,
      };
    },
    onSuccess: async ({ result, syncFailures }) => {
      const imported = result.items.filter((item) => item.status === "imported").length;
      const conflicts = result.items.filter((item) => item.status === "conflict").length;
      const hasWarnings = conflicts > 0 || syncFailures > 0;
      const syncDescription = selectedAgents.length
        ? syncFailures
          ? `；${syncFailures} 个 Skill 未能完成 Agent 同步`
          : `，并同步到 ${selectedAgents.length} 个 Agent`
        : "";
      showToast({
        tone: hasWarnings ? "error" : "success",
        title: syncFailures ? "Skill 已添加，同步未全部完成" : conflicts ? "Skill 已添加，部分同名项被跳过" : "Skill 添加完成",
        description: `已添加 ${imported} 个${conflicts ? `，跳过 ${conflicts} 个同名 Skill` : ""}${syncDescription}。`,
      });
      await queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environment.id] });
      onOpenChange(false);
    },
    onError: (error) => showToast({ tone: "error", title: "Skill 添加失败", description: getErrorMessage(error) }),
  });

  useEffect(() => {
    if (open) return;
    setPreview(null);
    setSelected([]);
    setPicking(false);
    setDragActive(false);
    setSelectedAgents([]);
  }, [open]);

  useEffect(() => {
    if (!open || !isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setDragActive(true);
        return;
      }
      setDragActive(false);
      if (event.payload.type !== "drop") return;
      if (event.payload.paths.length !== 1) {
        showToast({ tone: "error", title: "请一次拖入一个文件夹或 ZIP" });
        return;
      }
      previewMutation.mutate(event.payload.paths[0]);
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [open]);

  const pickSource = async () => {
    setPicking(true);
    try {
      const sourcePath = await chooseSkillImportFolder();
      if (sourcePath) previewMutation.mutate(sourcePath);
    } catch (error) {
      showToast({ tone: "error", title: "无法打开文件选择器", description: getErrorMessage(error) });
    } finally {
      setPicking(false);
    }
  };
  const selectable = preview?.skills.filter((skill) => skill.status !== "invalid") ?? [];
  const selectedCandidates = selectable.filter((skill) => selected.includes(skill.id));
  const selectedConflicts = selectedCandidates.filter((skill) => skill.status === "conflict").length;
  const toggleSkill = (skillId: string) => {
    setSelected((current) => current.includes(skillId) ? current.filter((item) => item !== skillId) : [...current, skillId]);
  };
  const toggleAgent = (agent: AgentKind) => {
    setSelectedAgents((current) => current.includes(agent) ? current.filter((item) => item !== agent) : [...current, agent]);
  };
  const resetSource = () => {
    setPreview(null);
    setSelected([]);
    previewMutation.reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="import-skill-dialog">
        <DialogHeader>
          <DialogTitle>添加 Skill</DialogTitle>
          <DialogDescription>从本机文件夹或 ZIP 添加到“{environment.name}”的 Hub；添加后可再选择同步到 Agent。</DialogDescription>
        </DialogHeader>
        {!preview && !previewMutation.isPending && (
          <button className={cn("import-dropzone", dragActive && "import-dropzone-active")} onClick={() => void pickSource()} disabled={picking}>
            <span className="import-dropzone-icon">
              {picking ? <Loader2 className="h-6 w-6 animate-spin" /> : dragActive ? <Upload className="h-6 w-6" /> : <FolderOpen className="h-6 w-6" />}
            </span>
            <strong>{dragActive ? "松开即可扫描" : "拖入 Skill 文件夹或 ZIP"}</strong>
            <span className="import-dropzone-description">也可以点击这里选择文件夹，系统会自动扫描其中的 Skill</span>
          </button>
        )}
        {previewMutation.isPending && <PageLoading compact label="正在安全扫描 Skill…" />}
        {preview && (
          <div className="import-preview">
            <div className="import-preview-toolbar">
              <div className="min-w-0">
                <div className="section-title">发现 {preview.skills.length} 个 Skill</div>
                <div className="section-caption truncate" title={preview.sourcePath}>{preview.sourcePath}</div>
              </div>
              <Button variant="secondary" size="sm" onClick={resetSource} disabled={importMutation.isPending}>重新选择</Button>
            </div>
            <div className="import-preview-body">
              <div className="import-skill-list">
                {preview.skills.map((skill) => {
                  const disabled = skill.status === "invalid";
                  const checked = selected.includes(skill.id);
                  return (
                    <label key={skill.id} className={cn("import-skill-row", disabled && "import-skill-row-disabled")}>
                      <input type="checkbox" checked={checked} disabled={disabled || importMutation.isPending} onChange={() => toggleSkill(skill.id)} />
                      <div className="import-skill-copy">
                        <div className="source-name">{skill.name}</div>
                        <div className="source-scan-description">{skill.description || "暂无描述"}</div>
                        <div className="muted-path" title={skill.relativePath}>{skill.relativePath}</div>
                        {skill.reason && <div className="import-skill-reason">{skill.reason}</div>}
                      </div>
                      <Badge>{skill.status === "ready" ? "可添加" : skill.status === "conflict" ? "已存在" : "无效"}</Badge>
                    </label>
                  );
                })}
              </div>
              <aside className="import-agent-panel">
                <div className="section-title">添加后同步到</div>
                <div className="section-caption">不选择则只添加到 Hub</div>
                <div className="import-agent-grid">
                  {agents.map((agent) => {
                    const active = selectedAgents.includes(agent);
                    return (
                      <button
                        key={agent}
                        type="button"
                        className={cn("import-agent-option", active && "import-agent-option-active")}
                        aria-pressed={active}
                        title={agentLabels[agent]}
                        disabled={importMutation.isPending}
                        onClick={() => toggleAgent(agent)}
                      >
                        <AgentIcon agent={agent} size={18} />
                        <span>{agentLabels[agent]}</span>
                      </button>
                    );
                  })}
                </div>
              </aside>
            </div>
            {selectedConflicts > 0 && (
              <div className="import-conflict-note">
                <CircleAlert className="h-4 w-4 shrink-0" />
                已选择 {selectedConflicts} 个同名 Skill。默认会跳过；选择覆盖时会先备份当前版本。
              </div>
            )}
            <div className="import-dialog-actions">
              <div className="section-caption">
                已选择 {selectedCandidates.length} 个 Skill{selectedAgents.length ? ` · ${selectedAgents.length} 个 Agent` : ""}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={importMutation.isPending}>取消</Button>
                {selectedConflicts > 0 ? (
                  <>
                    <Button
                      variant="secondary"
                      pending={importMutation.isPending && importMutation.variables === false}
                      pendingLabel="添加中"
                      disabled={!selected.length || importMutation.isPending}
                      onClick={() => importMutation.mutate(false)}
                    >
                      {selectedAgents.length ? "添加新增并同步" : "仅添加新增"}
                    </Button>
                    <Button
                      pending={importMutation.isPending && importMutation.variables === true}
                      pendingLabel="覆盖中"
                      disabled={!selected.length || importMutation.isPending}
                      onClick={() => importMutation.mutate(true)}
                    >
                      {selectedAgents.length ? "覆盖、添加并同步" : "覆盖并备份"}
                    </Button>
                  </>
                ) : (
                  <Button
                    pending={importMutation.isPending}
                    pendingLabel="添加中"
                    disabled={!selected.length || importMutation.isPending}
                    onClick={() => importMutation.mutate(false)}
                  >
                    {selectedAgents.length ? `添加并同步到 ${selectedAgents.length} 个 Agent` : `添加 ${selected.length} 个 Skill`}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SourcesPage({ environment }: { environment: EnvironmentSummary }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const reduceMotion = useReducedMotion();
  const snapshot = useEnvironmentSnapshot(environment.id);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [sourceToRemove, setSourceToRemove] = useState<SkillSource | null>(null);
  const sources = snapshot.data?.sources ?? [];
  const agents = useMemo(() => snapshot.data?.agents.map((item) => item.agent) ?? [], [snapshot.data?.agents]);
  const agentLabels = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent, configuredAgentLabel(agent, snapshot.data?.config)])),
    [agents, snapshot.data?.config],
  );
  const canManageSources = environment.kind === "local" || Boolean(
    snapshot.data?.capabilities.ssh && snapshot.data.capabilities.git && snapshot.data.capabilities.python3,
  );
  const addSource = useMutation({
    mutationFn: (input: { url: string; id?: string; branch?: string }) => api.addEnvironmentSource({ environmentId: environment.id, ...input }),
    onSuccess: async () => {
      setAddOpen(false);
      showToast({ tone: "success", title: "来源已添加" });
      await queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environment.id] });
    },
    onError: (error) => showToast({ tone: "error", title: "来源添加失败", description: getErrorMessage(error) }),
  });
  const removeSource = useMutation({
    mutationFn: (sourceRef: string) => api.removeEnvironmentSource({ environmentId: environment.id, sourceRef }),
    onSuccess: async (_, sourceRef) => {
      const removedIndex = sources.findIndex((source) => source.id === sourceRef);
      const focusSource = sources[removedIndex + 1] ?? sources[removedIndex - 1];
      showToast({ tone: "success", title: "来源已移除" });
      if (selectedSource === sourceRef) setSelectedSource(null);
      setSourceToRemove(null);
      await queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environment.id] });
      if (focusSource) restoreFocusToItem("data-source-id", focusSource.id);
      else requestAnimationFrame(() => document.getElementById("add-source-button")?.focus());
    },
    onError: (error) => showToast({ tone: "error", title: "来源移除失败", description: getErrorMessage(error) }),
  });
  useEffect(() => {
    setSelectedSource(null);
    setSourceToRemove(null);
  }, [environment.id]);
  const closeSourceDrawer = () => {
    const sourceId = selectedSource;
    setSelectedSource(null);
    if (sourceId) restoreFocusToItem("data-source-id", sourceId);
  };
  const closeRemoveDialog = () => {
    const sourceId = sourceToRemove?.id;
    setSourceToRemove(null);
    if (sourceId) restoreFocusToItem("data-source-remove-id", sourceId);
  };
  const selectedSourceData = sources.find((source) => source.id === selectedSource) ?? null;
  const sourceActions = (
    <Button id="add-source-button" size="sm" disabled={!canManageSources || snapshot.isLoading} onClick={() => setAddOpen(true)}>
      <Plus className="h-3.5 w-3.5" /> 添加来源
    </Button>
  );
  const pageSubtitle = "Git、本地目录和 SSH Git 来源。";
  if (snapshot.isLoading) {
    return (
      <PageShell title="安装来源" subtitle={pageSubtitle} environment={environment} actions={sourceActions}>
        <PageLoading />
      </PageShell>
    );
  }
  if (snapshot.isError || !snapshot.data) {
    return (
      <PageShell title="安装来源" subtitle={pageSubtitle} environment={environment} actions={sourceActions}>
        <PageError title="无法读取安装来源" message={getErrorMessage(snapshot.error)} onRetry={() => void snapshot.refetch()} />
      </PageShell>
    );
  }
  return (
    <PageShell
      title="安装来源"
      subtitle={pageSubtitle}
      environment={environment}
      transitioning={snapshot.isPlaceholderData}
      actions={sourceActions}
    >
      {environment.kind === "remote" && snapshot.data && !canManageSources && (
        <div className="capability-banner">
          <CircleAlert className="h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">当前 SSH 环境缺少来源管理能力</div>
            <div className="mt-0.5 text-xs">需要目标机器提供 Git 和 Python3；安装后刷新即可直接管理该环境自己的来源。</div>
          </div>
        </div>
      )}
      <section className="workspace-list source-workspace">
        <div className="workspace-list-header"><div><div className="section-title">来源</div><div className="section-caption">{sources.length} 个来源</div></div></div>
        <div className="source-list">
          <AnimatePresence initial={false} mode="popLayout">
            {sources.map((source) => {
              const selected = selectedSource === source.id;
              return (
                <motion.div
                  key={source.id}
                  initial={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(4px)" }}
                  animate={{ opacity: 1, transform: "translateY(0px)" }}
                  exit={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(-4px)" }}
                  transition={{ duration: reduceMotion ? 0.1 : 0.16, ease: [0.23, 1, 0.32, 1] }}
                  className={cn("source-row", selected && "source-row-selected")}
                >
                  <button
                    type="button"
                    className="source-row-open"
                    aria-haspopup="dialog"
                    data-source-id={source.id}
                    onClick={() => setSelectedSource(source.id)}
                  >
                    <span className="source-kind-icon"><SourceIcon kind={source.kind} /></span>
                    <span className="source-copy">
                      <span className="source-name" title={source.id}>{source.id}</span>
                      <span className="muted-path" title={source.url}>{source.url}</span>
                    </span>
                    <span className="source-row-trailing">
                      <Badge>{sourceKindLabel(source.kind)}</Badge>
                      <ChevronRight className="h-4 w-4" />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="source-row-remove"
                    aria-label={`移除来源 ${source.id}`}
                    title="移除来源"
                    data-source-remove-id={source.id}
                    disabled={removeSource.isPending}
                    onClick={() => setSourceToRemove(source)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {!sources.length && (
            <EmptyState
              title="还没有来源"
              description={canManageSources ? "添加 GitHub、GitLab、SSH Git 或目标机器上的本地目录。" : "补齐 Git 和 Python3 后即可添加来源。"}
            />
          )}
        </div>
      </section>
      {canManageSources && selectedSourceData && (
        <SourceDrawer
          environmentId={environment.id}
          source={selectedSourceData}
          agents={agents}
          agentLabels={agentLabels}
          onClose={closeSourceDrawer}
        />
      )}
      {canManageSources && (
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>添加安装来源</DialogTitle><DialogDescription>来源配置绑定当前环境：{environment.name}。</DialogDescription></DialogHeader>
            <SourceForm loading={addSource.isPending} onSubmit={(input) => addSource.mutate(input)} />
          </DialogContent>
        </Dialog>
      )}
      {canManageSources && (
        <Dialog
          open={Boolean(sourceToRemove)}
          onOpenChange={(open) => {
            if (!open && !removeSource.isPending) closeRemoveDialog();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>移除来源 {sourceToRemove?.id}？</DialogTitle>
              <DialogDescription>只会移除来源配置；已经安装到当前 Hub 的 Skill 会继续保留。</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={removeSource.isPending} onClick={closeRemoveDialog}>取消</Button>
              <Button
                variant="destructive"
                size="sm"
                pending={removeSource.isPending}
                pendingLabel="移除中"
                disabled={!sourceToRemove}
                onClick={() => sourceToRemove && removeSource.mutate(sourceToRemove.id)}
              >
                移除来源
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </PageShell>
  );
}

function SourceDrawer({
  environmentId,
  source,
  agents,
  agentLabels,
  onClose,
}: {
  environmentId: string;
  source: SkillSource;
  agents: AgentKind[];
  agentLabels: Record<string, string>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const reduceMotion = useReducedMotion();
  const [selectedAgents, setSelectedAgents] = useState<AgentKind[]>([]);
  const autoRefreshSource = useRef<string | null>(null);
  const cacheQueryKey = ["source-scan-cache", environmentId, source.id] as const;
  const cachedScan = useQuery({
    queryKey: cacheQueryKey,
    queryFn: () => api.getEnvironmentSourceCache({ environmentId, sourceRef: source.id }),
    retry: false,
    staleTime: Infinity,
  });
  const refreshScan = useMutation({
    mutationFn: () => api.scanEnvironmentSource({ environmentId, sourceRef: source.id }),
    onSuccess: async (result) => {
      queryClient.setQueryData(cacheQueryKey, result);
      await queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environmentId] });
    },
  });
  useEffect(() => {
    if (!cachedScan.isFetched || autoRefreshSource.current === source.id) return;
    autoRefreshSource.current = source.id;
    const lastScanAt = cachedScan.data?.source.lastScanAt ?? cachedScan.data?.source.last_scan_at;
    const lastScanTime = lastScanAt ? Date.parse(lastScanAt) : 0;
    if (!lastScanTime || Date.now() - lastScanTime > 5 * 60_000) refreshScan.mutate();
  }, [cachedScan.isFetched, source.id]);
  const install = useMutation({
    mutationFn: async ({ skills, mode }: { skills: string[]; mode: "single" | "all" }) => {
      const result = await api.installEnvironmentSource({ environmentId, sourceRef: source.id, skills, all: false, force: false });
      const syncResults = selectedAgents.length
        ? await Promise.allSettled(result.installed.map((skill) => api.linkEnvironmentSkill({
            environmentId,
            skillName: skill.name,
            tools: selectedAgents,
          })))
        : [];
      return {
        mode,
        result,
        syncFailures: syncResults.filter((item) => item.status === "rejected").length,
      };
    },
    onSuccess: async ({ result, syncFailures }) => {
      const installedNames = new Set(result.installed.map((skill) => skill.name));
      queryClient.setQueryData<SourceScanResult | null>(cacheQueryKey, (current) => current ? {
        ...current,
        skills: current.skills.map((skill) => installedNames.has(skill.name) ? { ...skill, installed: true } : skill),
      } : current);
      const hasSyncWarnings = syncFailures > 0;
      showToast({
        tone: hasSyncWarnings ? "error" : "success",
        title: hasSyncWarnings ? "Skill 已安装，同步未全部完成" : "Skill 安装完成",
        description: `已安装 ${result.installed.length} 个，跳过 ${result.skipped.length} 个${selectedAgents.length ? `；同步到 ${selectedAgents.length} 个 Agent` : ""}${syncFailures ? `，${syncFailures} 个同步失败` : ""}。`,
      });
      await queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environmentId] });
    },
    onError: (error) => showToast({ tone: "error", title: "Skill 安装失败", description: getErrorMessage(error) }),
  });
  const scanData = cachedScan.data ?? undefined;
  const pendingSkills = scanData?.skills.filter((skill) => !skill.installed) ?? [];
  const installedCount = (scanData?.skills.length ?? 0) - pendingSkills.length;
  const scanError = refreshScan.error ?? cachedScan.error;
  const scanState = scanData ? "ready" : scanError ? "error" : "loading";
  const isRefreshing = refreshScan.isPending && Boolean(scanData);
  const lastScanAt = scanData?.source.lastScanAt ?? scanData?.source.last_scan_at;
  const refreshStatus = isRefreshing
    ? "显示本地缓存 · 正在后台更新"
    : refreshScan.isError && scanData
      ? "显示本地缓存 · 更新失败"
      : `上次更新 ${formatSourceScanTime(lastScanAt)}`;
  const toggleAgent = (agent: AgentKind) => {
    setSelectedAgents((current) => current.includes(agent) ? current.filter((item) => item !== agent) : [...current, agent]);
  };
  return (
    <DetailDrawer open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DetailDrawerContent className="source-drawer">
          <div className="drawer-header source-drawer-header">
            <span className="source-drawer-icon"><SourceIcon kind={source.kind} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="drawer-kicker">安装来源</div>
                <Badge>{sourceKindLabel(source.kind)}</Badge>
              </div>
              <DetailDrawerTitle>{source.id}</DetailDrawerTitle>
              <DetailDrawerDescription title={source.url}>{source.url}</DetailDrawerDescription>
            </div>
            <DetailDrawerCloseButton />
          </div>
          <div className="source-drawer-summary" aria-label="来源扫描摘要">
            <div><span>Skill</span><strong>{scanData?.skills.length ?? "—"}</strong></div>
            <div><span>已安装</span><strong>{scanData ? installedCount : "—"}</strong></div>
            <div><span>待安装</span><strong>{scanData ? pendingSkills.length : "—"}</strong></div>
          </div>
          <div className="drawer-body source-drawer-body">
            <div className="source-drawer-section-header">
              <div>
                <div className="drawer-section-title">来源 Skill</div>
                <div
                  className={cn("section-caption", refreshScan.isError && scanData && "source-refresh-error")}
                  title={refreshScan.isError ? getErrorMessage(refreshScan.error) : undefined}
                  aria-live="polite"
                >
                  {refreshStatus}
                </div>
              </div>
              <Button variant="secondary" size="sm" disabled={refreshScan.isPending || install.isPending} onClick={() => refreshScan.mutate()}>
                <RefreshCw className={cn("h-3.5 w-3.5", refreshScan.isPending && "animate-spin")} /> 更新
              </Button>
            </div>
            {agents.length > 0 && (
              <div className="source-agent-sync" aria-labelledby="source-agent-sync-title">
                <div className="source-agent-sync-copy">
                  <div id="source-agent-sync-title" className="drawer-section-title">安装后同步到</div>
                  <div className="section-caption">{selectedAgents.length ? `已选择 ${selectedAgents.length} 个 Agent` : "不选择则只安装到当前 Hub"}</div>
                </div>
                <div className="source-agent-options">
                  {agents.map((agent) => {
                    const selected = selectedAgents.includes(agent);
                    return (
                      <Button
                        key={agent}
                        type="button"
                        variant={selected ? "default" : "secondary"}
                        size="sm"
                        className="source-agent-option"
                        aria-pressed={selected}
                        disabled={install.isPending}
                        onClick={() => toggleAgent(agent)}
                      >
                        <AgentIcon agent={agent} size={14} />
                        <span>{agentLabels[agent] ?? agent}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key={scanState}
                initial={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(3px)" }}
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                exit={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(-3px)" }}
                transition={{ duration: reduceMotion ? 0.1 : 0.14, ease: [0.23, 1, 0.32, 1] }}
                className="source-scan-content"
              >
                {scanState === "loading" && <PageLoading compact label={refreshScan.isPending ? "首次读取来源…" : "正在读取本地缓存…"} />}
                {scanState === "error" && <PageError title="读取来源失败" message={getErrorMessage(scanError)} onRetry={() => refreshScan.mutate()} />}
                {scanData && (
                  <div className="source-scan-list">
                    {scanData.skills.map((skill) => {
                      const pending = install.isPending && install.variables?.mode === "single" && install.variables.skills.includes(skill.name);
                      return (
                        <div key={skill.name} className="source-scan-row">
                          <div className="source-scan-copy">
                            <div className="source-name" title={skill.name}>{skill.name}</div>
                            <div className="source-scan-description">{skill.description || "暂无描述"}</div>
                          </div>
                          <Badge className={cn("source-scan-status", skill.installed ? "source-scan-status-installed" : "source-scan-status-pending")}>
                            {skill.installed ? "已安装" : "待安装"}
                          </Badge>
                          {!skill.installed && (
                            <Button
                              variant="secondary"
                              size="sm"
                              pending={pending}
                              pendingLabel="安装中"
                              disabled={install.isPending}
                              onClick={() => install.mutate({ skills: [skill.name], mode: "single" })}
                            >
                              {selectedAgents.length ? "安装并同步" : "安装"}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                    {!scanData.skills.length && <EmptyState title="没有可安装的 Skill" description="该来源当前没有识别到 Skill。" />}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          {pendingSkills.length > 0 && (
            <div className="source-drawer-footer">
              <div className="min-w-0">
                <div className="text-sm font-medium">{pendingSkills.length} 个 Skill 待安装</div>
                <div className="section-caption">{selectedAgents.length ? `安装后同步到 ${selectedAgents.length} 个 Agent` : "已存在的 Skill 不会被覆盖"}</div>
              </div>
              <Button
                size="sm"
                pending={install.isPending && install.variables?.mode === "all"}
                pendingLabel={selectedAgents.length ? "安装并同步中" : "安装中"}
                disabled={install.isPending}
                onClick={() => install.mutate({ skills: pendingSkills.map((skill) => skill.name), mode: "all" })}
              >
                {selectedAgents.length ? "安装并同步" : "安装全部"}
              </Button>
            </div>
          )}
      </DetailDrawerContent>
    </DetailDrawer>
  );
}

function SourceForm({ loading, onSubmit }: { loading: boolean; onSubmit: (input: { url: string; id?: string; branch?: string }) => void }) {
  const [url, setUrl] = useState("");
  const [id, setId] = useState("");
  const [branch, setBranch] = useState("");
  return (
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (url.trim()) onSubmit({ url: url.trim(), id: id.trim() || undefined, branch: branch.trim() || undefined }); }}>
      <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="GitHub、GitLab、SSH Git 或本地路径" autoFocus />
      <Input value={id} onChange={(event) => setId(event.target.value)} placeholder="来源名称，可选" />
      <Input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="分支，可选" />
      <div className="flex justify-end"><Button disabled={!url.trim()} pending={loading} pendingLabel="添加中">添加来源</Button></div>
    </form>
  );
}

function SettingsPage({
  environment,
  theme,
  onThemeChange,
  updater,
  onCheckForUpdates,
  onInstallUpdate,
}: {
  environment: EnvironmentSummary;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  updater: AppUpdaterState;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [hubDir, setHubDir] = useState("");
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const preferences = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences, retry: false });
  const updatePreferences = useMutation({
    mutationFn: (defaultSyncMethod: SyncMethod) => api.updatePreferences({ defaultSyncMethod }),
    onMutate: async (defaultSyncMethod) => {
      await queryClient.cancelQueries({ queryKey: ["preferences"] });
      const previous = queryClient.getQueryData<HubPreferences>(["preferences"]);
      queryClient.setQueryData<HubPreferences>(["preferences"], (current) => current
        ? { ...current, defaultSyncMethod, default_sync_method: defaultSyncMethod }
        : current);
      return { previous };
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["preferences"], saved);
      showToast({ tone: "success", title: "设置已保存" });
    },
    onError: (error, _defaultSyncMethod, context) => {
      if (context?.previous) queryClient.setQueryData(["preferences"], context.previous);
      showToast({ tone: "error", title: "设置保存失败", description: getErrorMessage(error) });
    },
  });
  const updateHubDir = useMutation({
    mutationFn: () => api.updateHubDir(hubDir.trim()),
    onSuccess: async () => {
      showToast({ tone: "success", title: "Hub 目录已更新", description: hubDir.trim() });
      await Promise.all([
        preferences.refetch(),
        queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environment.id] }),
      ]);
    },
    onError: (error) => showToast({ tone: "error", title: "Hub 目录更新失败", description: getErrorMessage(error) }),
  });
  const toggleAgent = useMutation({
    mutationFn: (agent: AgentConfig) => api.upsertAgent({
      id: agent.kind,
      label: agent.label,
      skillsDir: agent.skillsDir ?? agent.skills_dir ?? "",
      enabled: !agent.enabled,
    }),
    onSuccess: async (saved) => {
      showToast({ tone: "success", title: saved.enabled ? "Agent 已启用" : "Agent 已停用", description: saved.label });
      await Promise.all([
        preferences.refetch(),
        queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environment.id] }),
      ]);
    },
    onError: (error) => showToast({ tone: "error", title: "Agent 状态更新失败", description: getErrorMessage(error) }),
  });
  const snapshot = useEnvironmentSnapshot(environment.id);
  useEffect(() => {
    const value = preferences.data?.hubDir ?? preferences.data?.hub_dir;
    if (value) setHubDir(value);
  }, [preferences.data?.hubDir, preferences.data?.hub_dir]);
  const configPaths = snapshot.data ? buildConfigPathRows(snapshot.data.config) : [];
  const configSummary = snapshot.data
    ? [
        { label: "Agent", value: `${snapshot.data.agents.length} 个` },
        { label: "安装来源", value: `${snapshot.data.sources.length} 个` },
        { label: "默认同步", value: syncMethodLabel(preferences.data?.defaultSyncMethod ?? preferences.data?.default_sync_method ?? "auto") },
      ]
    : [];
  const updateDescription = updater.status === "unsupported"
    ? "仅打包后的桌面应用支持检查更新"
    : updater.status === "checking"
      ? "正在检查 GitHub Releases"
      : updater.status === "available"
        ? `发现新版本 ${updater.availableVersion}`
        : updater.status === "up-to-date"
          ? "当前已是最新版本"
          : updater.status === "channel-pending"
            ? "更新通道将在下一个正式版本发布后启用"
          : updater.status === "downloading"
            ? updater.progress === null ? "正在下载更新" : `正在下载更新 · ${updater.progress}%`
            : updater.status === "ready"
              ? "更新已安装，正在重新启动"
              : updater.status === "error"
                ? `检查或安装失败：${updater.error ?? "未知错误"}`
                : "启动后会自动检查，也可以手动检查";
  const updatePending = updater.status === "checking" || updater.status === "downloading";
  if (snapshot.isLoading) {
    return (
      <PageShell title="设置" subtitle="应用偏好和当前环境配置。" environment={environment}>
        <PageLoading />
      </PageShell>
    );
  }
  if (snapshot.isError || !snapshot.data) {
    return (
      <PageShell title="设置" subtitle="应用偏好和当前环境配置。" environment={environment}>
        <PageError title="无法读取当前环境配置" message={getErrorMessage(snapshot.error)} onRetry={() => void snapshot.refetch()} />
      </PageShell>
    );
  }
  return (
    <PageShell
      title="设置"
      subtitle="应用偏好和当前环境配置。"
      environment={environment}
      transitioning={snapshot.isPlaceholderData}
    >
      <div className="settings-layout">
      <section className="settings-section">
        <div className="settings-section-header"><div><div className="section-title">应用</div><div className="section-caption">影响所有环境的显示和默认策略</div></div></div>
        <div className="settings-row"><div><div className="font-medium">主题</div><div className="text-xs text-muted-foreground">跟随系统或手动选择</div></div><div className="segmented-control">{(["system", "light", "dark"] as Theme[]).map((item) => <button key={item} className={cn("segmented-item", theme === item && "segmented-item-active")} onClick={() => onThemeChange(item)}>{item === "system" ? "系统" : item === "light" ? <><Sun className="h-3.5 w-3.5" />浅色</> : <><Moon className="h-3.5 w-3.5" />深色</>}</button>)}</div></div>
        <div className="settings-row"><div><div className="font-medium">默认同步方式</div><div className="text-xs text-muted-foreground">本机和 SSH 环境 Agent 的默认同步方式</div></div><div className="segmented-control" aria-busy={updatePreferences.isPending}>{(["auto", "symlink", "copy"] as SyncMethod[]).map((item) => <button key={item} disabled={updatePreferences.isPending} className={cn("segmented-item", (preferences.data?.defaultSyncMethod ?? preferences.data?.default_sync_method ?? "auto") === item && "segmented-item-active")} onClick={() => updatePreferences.mutate(item)}>{item === "auto" ? "自动" : item === "symlink" ? "链接" : "复制"}</button>)}</div></div>
        <div className="settings-row settings-update-row">
          <div>
            <div className="font-medium">应用更新</div>
            <div className={cn("text-xs text-muted-foreground", updater.status === "error" && "settings-update-error")}>{updateDescription}</div>
            {updater.notes && updater.status === "available" && <div className="settings-update-notes">{updater.notes}</div>}
          </div>
          <div className="settings-update-actions">
            <code>v{updater.currentVersion ?? "—"}</code>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              pending={updatePending}
              pendingLabel={updater.status === "downloading" && updater.progress !== null ? `${updater.progress}%` : "检查中"}
              disabled={updater.status === "unsupported" || updater.status === "ready"}
              onClick={updater.status === "available" ? onInstallUpdate : onCheckForUpdates}
            >
              {updater.status === "available" ? <><Download className="h-3.5 w-3.5" /> 安装 {updater.availableVersion}</> : <><RefreshCw className="h-3.5 w-3.5" /> 检查更新</>}
            </Button>
          </div>
        </div>
      </section>
      {environment.kind === "local" && <section className="settings-section">
        <div className="settings-section-header"><div><div className="section-title">统一技能库</div><div className="section-caption">只更新管理路径，不搬运原目录内容</div></div></div>
        <form className="settings-form-row" onSubmit={(event) => { event.preventDefault(); if (hubDir.trim()) updateHubDir.mutate(); }}>
          <div className="settings-form-copy">
            <label className="font-medium" htmlFor="hub-directory">Hub 目录</label>
            <div className="text-xs leading-5 text-muted-foreground">所有 Agent 统一引用的技能目录</div>
          </div>
          <div className="settings-form-control">
            <div className="settings-input-row">
              <Input id="hub-directory" value={hubDir} onChange={(event) => setHubDir(event.target.value)} placeholder="~/.agents/skills" />
              <Button pending={updateHubDir.isPending} pendingLabel="保存中" disabled={!hubDir.trim()}><Save className="h-3.5 w-3.5" /> 保存</Button>
            </div>
            <div className="settings-help">默认使用 `~/.agents/skills`，也支持自定义路径。不能与已启用的 Agent 目录相同。</div>
          </div>
        </form>
      </section>}
      {environment.kind === "local" && <section className="settings-section">
        <div className="settings-section-header settings-section-header-actions">
          <div><div className="section-title">Agent 目录</div><div className="section-caption">配置本机 Agent 的名称、技能目录和启用状态</div></div>
          <Button size="sm" onClick={() => { setEditingAgent(null); setAgentDialogOpen(true); }}><Plus className="h-3.5 w-3.5" /> 添加 Agent</Button>
        </div>
        <div className="agent-config-list">
          {(preferences.data?.agents ?? []).map((agent) => {
            const editing = () => { setEditingAgent(agent); setAgentDialogOpen(true); };
            const pending = toggleAgent.isPending && toggleAgent.variables?.kind === agent.kind;
            return (
              <div key={agent.kind} className="agent-config-row">
                <button className="agent-config-main" onClick={editing}>
                  <span className="agent-config-icon"><AgentIcon agent={agent.kind} size={16} /></span>
                  <span className="agent-config-copy"><strong>{agent.label}</strong><code>{agent.skillsDir ?? agent.skills_dir}</code></span>
                </button>
                <div className="agent-config-actions">
                  <button
                    className="agent-toggle"
                    role="switch"
                    aria-checked={agent.enabled}
                    aria-label={`${agent.enabled ? "停用" : "启用"} ${agent.label}`}
                    title={`${agent.enabled ? "停用" : "启用"} ${agent.label}`}
                    disabled={toggleAgent.isPending}
                    data-enabled={agent.enabled || undefined}
                    data-pending={pending || undefined}
                    onClick={() => toggleAgent.mutate(agent)}
                  >
                    <span className="agent-toggle-knob" />
                  </button>
                  <button className="icon-button" aria-label={`编辑 ${agent.label}`} title={`编辑 ${agent.label}`} onClick={editing}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>}
      <section className="settings-section">
        <div className="settings-section-header"><div><div className="section-title">当前环境</div><div className="section-caption">{environment.name}</div></div></div>
        {configSummary.length > 0 && <div className="config-summary-grid">{configSummary.map((item) => <div key={item.label} className="config-summary-item"><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>}
        {configPaths.map(({ label, value }) => <button key={label} className="settings-path-row" onClick={() => void api.openPath(value)}><span className="font-medium">{settingsLabel(label)}</span><span className="muted-path">{value}</span><ExternalLink className="h-3.5 w-3.5" /></button>)}
        {environment.kind === "remote" && snapshot.data && <div className="capability-grid">{Object.entries(snapshot.data.capabilities).filter(([key]) => key !== "message").map(([key, value]) => <div key={key} className="capability-item"><span>{key}</span><span className={value ? "capability-ok" : "capability-missing"}>{value ? "可用" : "缺少"}</span></div>)}</div>}
      </section>
      </div>
      <AgentConfigDialog
        open={agentDialogOpen}
        agent={editingAgent}
        onOpenChange={setAgentDialogOpen}
        onSaved={async () => {
          setAgentDialogOpen(false);
          await Promise.all([
            preferences.refetch(),
            queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environment.id] }),
          ]);
        }}
      />
    </PageShell>
  );
}

function AgentConfigDialog({ open, agent, onOpenChange, onSaved }: { open: boolean; agent: AgentConfig | null; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) {
  const { showToast } = useToast();
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [skillsDir, setSkillsDir] = useState("");
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    if (!open) return;
    setId(agent?.kind ?? "");
    setLabel(agent?.label ?? "");
    setSkillsDir(agent?.skillsDir ?? agent?.skills_dir ?? "");
    setEnabled(agent?.enabled ?? true);
  }, [agent, open]);
  const save = useMutation({
    mutationFn: () => api.upsertAgent({ id: id.trim(), label: label.trim(), skillsDir: skillsDir.trim(), enabled }),
    onSuccess: async () => {
      showToast({ tone: "success", title: "Agent 配置已保存", description: label.trim() });
      await onSaved();
    },
    onError: (error) => showToast({ tone: "error", title: "Agent 配置保存失败", description: getErrorMessage(error) }),
  });
  const remove = useMutation({
    mutationFn: () => api.removeAgent(id),
    onSuccess: async () => {
      showToast({ tone: "success", title: "Agent 配置已移除", description: "目录和已有链接未被删除" });
      await onSaved();
    },
    onError: (error) => showToast({ tone: "error", title: "Agent 配置移除失败", description: getErrorMessage(error) }),
  });
  const valid = Boolean(id.trim() && label.trim() && skillsDir.trim());
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>{agent ? "编辑 Agent" : "添加 Agent"}</DialogTitle><DialogDescription>保存配置不会立即同步、移动或删除技能。</DialogDescription></DialogHeader>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (valid) save.mutate(); }}>
        <div><div className="field-label">Agent ID</div><Input value={id} disabled={Boolean(agent)} onChange={(event) => setId(event.target.value)} placeholder="例如 hermes" /></div>
        <div><div className="field-label">显示名称</div><Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如 Hermes" /></div>
        <div><div className="field-label">技能目录</div><Input value={skillsDir} onChange={(event) => setSkillsDir(event.target.value)} placeholder="~/.hermes/skills" /></div>
        <label className="agent-enabled-control"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>启用扫描与同步</span></label>
        <div className="flex justify-between gap-2">
          <div>{agent && <Button type="button" variant="destructive" pending={remove.isPending} pendingLabel="移除中" onClick={() => remove.mutate()}><Trash2 className="h-3.5 w-3.5" /> 移除配置</Button>}</div>
          <div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>取消</Button><Button pending={save.isPending} pendingLabel="保存中" disabled={!valid}><Save className="h-3.5 w-3.5" /> 保存</Button></div>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

function StatItem({
  label,
  value,
  tone = "default",
  ariaLabel,
  tooltip,
  onClick,
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "muted" | "danger";
  ariaLabel?: string;
  tooltip?: { title: string; description: string };
  onClick?: () => void;
}) {
  const content = <>
    <div className="stat-item-heading">
      <div className="kicker">{label}</div>
      {onClick && <span className="stat-item-action-label">查看 <ChevronRight className="h-3 w-3" /></span>}
    </div>
    <div className={cn("stat-value", tone === "success" && "stat-value-success", tone === "danger" && "stat-value-danger", tone === "muted" && "stat-value-muted")}>{value}</div>
  </>;
  return onClick
    ? <button type="button" className="stat-item stat-item-action" aria-label={ariaLabel} onClick={onClick}>
      {content}
      {tooltip && (
        <span className="stat-item-tooltip" role="tooltip">
          <strong>{tooltip.title}</strong>
          <span>{tooltip.description}</span>
        </span>
      )}
    </button>
    : <div className="stat-item">{content}</div>;
}

function compareStatusLabel(status: string) {
  if (status === "identical") return "一致";
  if (status === "source-only") return "仅来源";
  if (status === "target-only") return "仅目标";
  return "内容不同";
}

function settingsLabel(label: string) {
  const labels: Record<string, string> = {
    hubDir: "统一技能库",
    hub_dir: "统一技能库",
    configPath: "配置",
    config_path: "配置",
    lockPath: "锁文件",
    lock_path: "锁文件",
    backupsDir: "备份与回收站",
    backups_dir: "备份与回收站",
    cacheDir: "缓存",
    cache_dir: "缓存",
    logsDir: "日志",
    logs_dir: "日志",
  };
  return labels[label] ?? label;
}

function buildConfigPathRows(config: HubConfig) {
  return [
    { label: "hubDir", value: config.hubDir ?? config.hub_dir },
    { label: "configPath", value: config.configPath ?? config.config_path },
    { label: "lockPath", value: config.lockPath ?? config.lock_path },
    { label: "backupsDir", value: config.backupsDir ?? config.backups_dir },
    { label: "cacheDir", value: config.cacheDir ?? config.cache_dir },
    { label: "logsDir", value: config.logsDir ?? config.logs_dir },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));
}

function syncMethodLabel(method: SyncMethod) {
  if (method === "symlink") return "链接";
  if (method === "copy") return "复制";
  return "自动";
}

function sourceKindLabel(kind: string) {
  if (kind === "github") return "GitHub";
  if (kind === "gitlab") return "GitLab";
  if (kind === "generic-git") return "Git";
  if (kind === "local") return "本地目录";
  return kind;
}

function restoreFocusToItem(attribute: "data-skill-id" | "data-source-id" | "data-source-remove-id", value: string) {
  requestAnimationFrame(() => {
    const elements = document.querySelectorAll<HTMLButtonElement>(`button[${attribute}]`);
    Array.from(elements).find((element) => element.getAttribute(attribute) === value)?.focus();
  });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

export default App;
