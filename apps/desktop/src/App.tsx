import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { memo, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronRight,
  CircleAlert,
  ListFilter,
  ChevronLeft,
  Cloud,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Loader2,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Save,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  type AgentKind,
  type AgentConfig,
  type HubConfig,
  type EnvironmentSnapshot,
  type EnvironmentSummary,
  type SkillSource,
  type SyncMethod,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { AppSidebar, type Page } from "@/components/app-sidebar";
import { EmptyState, PageError, PageLoading, PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/lib/brand";
import { useToast } from "@/lib/toast";
import { useEnvironmentSnapshot } from "@/hooks/use-environment-snapshot";
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
        {page === "settings" && selectedEnvironment && <SettingsPage environment={selectedEnvironment} theme={theme} onThemeChange={setTheme} />}
        {!selectedEnvironment && <EmptyState title="没有可用环境" description="添加本机或 SSH 环境后开始管理 Skill。" />}
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
      queryClient.setQueryData<EnvironmentSnapshot>(
        ["environment-snapshot", environment.id],
        (current) => updateSnapshotAgentStatus(current, variables.skillName, variables.agent, "linked"),
      );
      updateToast(toastId, { tone: "success", title: "已备份并接管", description: `${variables.skillName} · ${agentLabels[variables.agent]}` });
      await queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environment.id] });
    },
    onError: (error, variables, toastId) => updateToast(toastId ?? "", { tone: "error", title: "接管失败", description: `${variables.skillName} · ${getErrorMessage(error)}` }),
  });
  const handleAgentAction = (skillName: string, agent: AgentKind, status: string) => {
    if (status === "conflict") {
      takeoverMutation.mutate({ skillName, agent });
      return;
    }
    skillMutation.mutate({ skillName, agent, status });
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
  return (
    <PageShell
      title="技能"
      subtitle={pageSubtitle}
      environment={environment}
      transitioning={snapshot.isPlaceholderData}
      actions={
        <div className="flex items-center gap-2">
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
        <StatItem label="冲突" value={overview?.conflicts.length ?? 0} tone="danger" />
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
      <AnimatePresence>
        {selectedSkill && (
          <SkillDrawer
            row={selectedSkill}
            snapshot={snapshot.data}
            onClose={() => setSelectedSkillName(null)}
            onAgentAction={(agent, status) => handleAgentAction(selectedSkill.name, agent, status)}
            onTrash={() => trashMutation.mutate(selectedSkill.name)}
            trashing={trashMutation.isPending}
            agents={agents}
            agentLabels={agentLabels}
          />
        )}
      </AnimatePresence>
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} source={environment} environments={environments} />
    </PageShell>
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
      <button className="skill-row-main" onClick={onOpen}>
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
              title={`${agentLabels[agent]} · ${statusLabels[status] ?? status}`}
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
  const reduceMotion = useReducedMotion();
  const [trashOpen, setTrashOpen] = useState(false);
  const skill = snapshot.hub.find((item) => (item.dirName ?? item.dir_name ?? item.name) === row.name);
  return (
    <>
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0.12 : 0.18, ease: [0.23, 1, 0.32, 1] }}
        className="drawer-overlay"
        aria-label="关闭详情"
        onClick={onClose}
      />
      <motion.aside
        initial={{ opacity: reduceMotion ? 0 : 1, transform: reduceMotion ? "none" : "translateX(100%)" }}
        animate={{ opacity: 1, transform: "translateX(0%)" }}
        exit={{ opacity: reduceMotion ? 0 : 1, transform: reduceMotion ? "none" : "translateX(100%)" }}
        transition={{ duration: reduceMotion ? 0.12 : 0.22, ease: [0.32, 0.72, 0, 1] }}
        className="skill-drawer"
      >
        <div className="drawer-header">
          <div className="min-w-0">
            <div className="drawer-kicker">SKILL</div>
            <h2 className="truncate text-lg font-semibold">{row.displayName}</h2>
            <div className="muted-path">{skill?.path ?? row.path}</div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X className="h-4 w-4" /></button>
        </div>
        <div className="drawer-body">
          <p className="text-sm leading-6 text-muted-foreground">{row.description || "暂无描述"}</p>
          <div className="drawer-section">
            <div className="drawer-section-title">Agent 状态</div>
            <div className="drawer-status-list">
              {agents.map((agent) => {
                const status = agentStatus(row, agent);
                return (
                  <button key={agent} className="drawer-status-row" onClick={() => onAgentAction(agent, status)}>
                    <span className="flex items-center gap-2"><AgentIcon agent={agent} size={15} /> {agentLabels[agent]}</span>
                    <span className={cn("status-text", status === "conflict" && "status-text-danger")}>{status === "conflict" ? "备份并接管" : statusLabels[status] ?? status}</span>
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
          <div className="drawer-section drawer-danger-section">
            <div className="drawer-section-title">移除 Skill</div>
            <p className="mb-3 text-xs leading-5 text-muted-foreground">从当前环境移除，但不物理删除；内容会保存在 skills-hub 回收区中。</p>
            <Button variant="destructive" size="sm" onClick={() => setTrashOpen(true)}><Trash2 className="h-3.5 w-3.5" /> 移入回收站</Button>
          </div>
        </div>
      </motion.aside>
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>将 {row.displayName} 移入回收站？</DialogTitle>
            <DialogDescription>会取消可安全识别的 Agent 同步关系，并把 Hub 中的 Skill 移到当前环境的备份回收区。未受管的冲突目录不会被删除，可从“设置 → 备份与回收站”中找回。</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTrashOpen(false)}>取消</Button>
            <Button variant="destructive" pending={trashing} pendingLabel="正在移除" onClick={onTrash}>移入回收站</Button>
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

function SourcesPage({ environment }: { environment: EnvironmentSummary }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const reduceMotion = useReducedMotion();
  const snapshot = useEnvironmentSnapshot(environment.id);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const sources = snapshot.data?.sources ?? [];
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
    onSuccess: async () => {
      showToast({ tone: "success", title: "来源已移除" });
      setSelectedSource(null);
      await queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environment.id] });
    },
    onError: (error) => showToast({ tone: "error", title: "来源移除失败", description: getErrorMessage(error) }),
  });
  useEffect(() => {
    setSelectedSource(null);
  }, [environment.id]);
  const sourceActions = (
    <Button size="sm" disabled={!canManageSources || snapshot.isLoading} onClick={() => setAddOpen(true)}>
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
        <motion.div
          className="source-workspace-body"
          data-has-scan={Boolean(selectedSource)}
        >
          <div className="source-list">
            <AnimatePresence initial={false} mode="popLayout">
              {sources.map((source) => {
                const removing = removeSource.isPending && removeSource.variables === source.id;
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
                    <span className="source-kind-icon"><SourceIcon kind={source.kind} /></span>
                    <div className="source-copy">
                      <div className="source-name" title={source.id}>{source.id}</div>
                      <div className="muted-path" title={source.url}>{source.url}</div>
                    </div>
                    <div className="source-row-actions">
                      <Badge>{source.kind}</Badge>
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-pressed={selected}
                        onClick={() => setSelectedSource(selected ? null : source.id)}
                      >
                        {selected ? "关闭" : "扫描"}
                      </Button>
                      <button
                        className="icon-button"
                        aria-label={`移除来源 ${source.id}`}
                        disabled={removeSource.isPending}
                        onClick={() => removeSource.mutate(source.id)}
                      >
                        {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
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
          <AnimatePresence initial={false}>
            {canManageSources && selectedSource && (
              <motion.div
                key={selectedSource}
                initial={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(6px)" }}
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                exit={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(6px)" }}
                transition={{ duration: reduceMotion ? 0.12 : 0.18, ease: [0.23, 1, 0.32, 1] }}
                className="source-scan-pane"
              >
                <SourceScanPanel environmentId={environment.id} sourceId={selectedSource} onClose={() => setSelectedSource(null)} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </section>
      {canManageSources && (
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>添加安装来源</DialogTitle><DialogDescription>来源配置绑定当前环境：{environment.name}。</DialogDescription></DialogHeader>
            <SourceForm loading={addSource.isPending} onSubmit={(input) => addSource.mutate(input)} />
          </DialogContent>
        </Dialog>
      )}
    </PageShell>
  );
}

function SourceScanPanel({ environmentId, sourceId, onClose }: { environmentId: string; sourceId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const reduceMotion = useReducedMotion();
  const scan = useQuery({
    queryKey: ["source-scan", environmentId, sourceId],
    queryFn: () => api.scanEnvironmentSource({ environmentId, sourceRef: sourceId }),
    retry: false,
  });
  const install = useMutation({
    mutationFn: ({ skills, all }: { skills: string[]; all: boolean }) => api.installEnvironmentSource({ environmentId, sourceRef: sourceId, skills, all, force: false }),
    onSuccess: async (result) => {
      showToast({ tone: "success", title: "Skill 安装完成", description: `已安装 ${result.installed.length} 个，跳过 ${result.skipped.length} 个。` });
      await Promise.all([
        scan.refetch(),
        queryClient.invalidateQueries({ queryKey: ["environment-snapshot", environmentId] }),
      ]);
    },
    onError: (error) => showToast({ tone: "error", title: "Skill 安装失败", description: getErrorMessage(error) }),
  });
  const pendingSkills = scan.data?.skills.filter((skill) => !skill.installed) ?? [];
  const scanState = scan.isLoading ? "loading" : scan.isError && !scan.data ? "error" : "ready";
  return (
    <div className="source-scan-panel">
      <div className="source-scan-header">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="section-title">来源扫描</div>
            {scan.isFetching && !scan.isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="section-caption truncate" title={sourceId}>{sourceId}</div>
        </div>
        <div className="source-scan-actions">
          {pendingSkills.length > 0 && (
            <Button
              size="sm"
              pending={install.isPending && install.variables?.all}
              pendingLabel="安装中"
              disabled={install.isPending}
              onClick={() => install.mutate({ skills: [], all: true })}
            >
              安装全部
            </Button>
          )}
          <button className="icon-button" aria-label="关闭来源扫描" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
      </div>
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={scanState}
          initial={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(3px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          exit={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(-3px)" }}
          transition={{ duration: reduceMotion ? 0.1 : 0.14, ease: [0.23, 1, 0.32, 1] }}
          className="source-scan-content"
        >
          {scanState === "loading" && <PageLoading compact label="正在扫描来源…" />}
          {scanState === "error" && <PageError title="扫描失败" message={getErrorMessage(scan.error)} onRetry={() => void scan.refetch()} />}
          {scan.data && (
            <div className="source-scan-list">
              {scan.data.skills.map((skill) => {
                const pending = install.isPending && !install.variables?.all && install.variables?.skills.includes(skill.name);
                return (
                  <div key={skill.name} className="source-scan-row">
                    <div className="source-scan-copy">
                      <div className="source-name" title={skill.name}>{skill.name}</div>
                      <div className="source-scan-description">{skill.description || "暂无描述"}</div>
                    </div>
                    <Badge>{skill.installed ? "已纳管" : "待纳管"}</Badge>
                    {!skill.installed && (
                      <Button
                        variant="secondary"
                        size="sm"
                        pending={pending}
                        pendingLabel="安装中"
                        disabled={install.isPending}
                        onClick={() => install.mutate({ skills: [skill.name], all: false })}
                      >
                        安装
                      </Button>
                    )}
                  </div>
                );
              })}
              {!scan.data.skills.length && <EmptyState title="没有可安装的 Skill" description="该来源当前没有识别到 Skill。" />}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
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

function SettingsPage({ environment, theme, onThemeChange }: { environment: EnvironmentSummary; theme: Theme; onThemeChange: (theme: Theme) => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [hubDir, setHubDir] = useState("");
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const preferences = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences, retry: false });
  const updatePreferences = useMutation({
    mutationFn: (defaultSyncMethod: SyncMethod) => api.updatePreferences({ defaultSyncMethod }),
    onSuccess: () => showToast({ tone: "success", title: "设置已保存" }),
    onError: (error) => showToast({ tone: "error", title: "设置保存失败", description: getErrorMessage(error) }),
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

function StatItem({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "muted" | "danger" }) {
  return <div className="stat-item"><div className="kicker">{label}</div><div className={cn("stat-value", tone === "success" && "stat-value-success", tone === "danger" && "stat-value-danger", tone === "muted" && "stat-value-muted")}>{value}</div></div>;
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

function SourceIcon({ kind }: { kind: string }) {
  return kind.toLowerCase().includes("git") ? <GitBranch className="h-4 w-4 text-muted-foreground" /> : <Cloud className="h-4 w-4 text-muted-foreground" />;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

export default App;
