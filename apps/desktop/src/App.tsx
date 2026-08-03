import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  CircleAlert,
  ChevronLeft,
  Cloud,
  Database,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Laptop,
  Loader2,
  Moon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  type AgentKind,
  type HubConfig,
  type EnvironmentSnapshot,
  type EnvironmentSummary,
  type SkillSource,
  type SyncMethod,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AgentIcon, RemoteIcon, StatusDot } from "@/lib/brand";
import { useToast } from "@/lib/toast";
import {
  AGENTS,
  agentStatus,
  buildSkillRows,
  buildWorkspaceOverview,
  type SkillRowView,
} from "@/lib/view-model";

type Page = "skills" | "sources" | "settings";
type Theme = "system" | "light" | "dark";
type StatusFilter = "all" | "synced" | "missing" | "conflict";
type AgentStatusValue = EnvironmentSnapshot["statuses"][number]["agents"][number]["status"];
const PAGE_SIZE = 50;

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

const agentLabels: Record<AgentKind, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  openclaw: "OpenClaw",
};

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
    <div className="app-frame">
      <Sidebar
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

function Sidebar({
  environments,
  selectedEnvironmentId,
  page,
  onEnvironmentChange,
  onPageChange,
  onEnvironmentAdded,
}: {
  environments: EnvironmentSummary[];
  selectedEnvironmentId: string;
  page: Page;
  onEnvironmentChange: (id: string) => void;
  onPageChange: (page: Page) => void;
  onEnvironmentAdded: (environment: EnvironmentSummary) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const queryClient = useQueryClient();
  const prefetchEnvironment = (environment: EnvironmentSummary) => {
    void queryClient.prefetchQuery({
      queryKey: ["environment-snapshot", environment.id],
      queryFn: () => api.getEnvironmentSnapshot(environment.id),
      staleTime: environment.kind === "local" ? 10_000 : 20_000,
    });
  };
  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">□</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">skills-hub</div>
          <div className="truncate text-[11px] text-muted-foreground">AI Agent 技能库</div>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>环境</span>
          <button className="icon-button" aria-label="添加 SSH 环境" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <LayoutGroup id="environment-list">
          <div className="space-y-0.5">
            {environments.map((environment) => (
              <EnvironmentNavItem
                key={environment.id}
                environment={environment}
                selected={selectedEnvironmentId === environment.id}
                onClick={() => onEnvironmentChange(environment.id)}
                onPrefetch={() => prefetchEnvironment(environment)}
              />
            ))}
          </div>
        </LayoutGroup>
      </div>

      <div className="sidebar-section sidebar-secondary-nav">
        <button className={cn("sidebar-link", page === "sources" && "sidebar-link-active")} onClick={() => onPageChange("sources")}>
          <GitBranch className="h-4 w-4" /> 安装来源
        </button>
        <button className={cn("sidebar-link", page === "settings" && "sidebar-link-active")} onClick={() => onPageChange("settings")}>
          <Settings className="h-4 w-4" /> 设置
        </button>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-footer-label">当前环境</div>
        <div className="truncate text-xs font-medium">{environments.find((item) => item.id === selectedEnvironmentId)?.name ?? "本机"}</div>
        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
          {selectedEnvironmentId === "local" ? "~/.agents/skills" : "SSH 环境独立技能库"}
        </div>
      </div>
      <AddEnvironmentDialog open={addOpen} onOpenChange={setAddOpen} onAdded={onEnvironmentAdded} />
    </aside>
  );
}

function EnvironmentNavItem({
  environment,
  selected,
  onClick,
  onPrefetch,
}: {
  environment: EnvironmentSummary;
  selected: boolean;
  onClick: () => void;
  onPrefetch: () => void;
}) {
  const connection = useQuery({
    queryKey: ["environment-connection", environment.id],
    queryFn: () => api.checkEnvironmentConnection(environment.id),
    enabled: environment.kind === "remote",
    retry: false,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: environment.kind === "remote" ? 30_000 : false,
  });
  const connected = environment.kind === "local" || connection.data?.status === "connected";
  return (
    <button className={cn("environment-nav-item", selected && "environment-nav-item-active")} onMouseEnter={onPrefetch} onFocus={onPrefetch} onClick={onClick}>
      {selected && <motion.span layoutId="environment-selected" className="environment-selected-indicator" />}
      <span className="environment-nav-icon">{environment.kind === "local" ? <Laptop className="h-4 w-4" /> : <RemoteIcon size={16} />}</span>
      <span className="min-w-0 flex-1 truncate text-left">{environment.name}</span>
      <StatusDot tone={connection.isFetching ? "info" : connected ? "success" : "danger"} spinning={connection.isFetching} />
    </button>
  );
}

function SkillsPage({ environment, environments }: { environment: EnvironmentSummary; environments: EnvironmentSummary[] }) {
  const queryClient = useQueryClient();
  const { showToast, updateToast } = useToast();
  const [query, setQuery] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [isSearchComposing, setIsSearchComposing] = useState(false);
  const [agentFilter, setAgentFilter] = useState<AgentKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const snapshot = useEnvironmentSnapshot(environment.id);
  useEffect(() => {
    if (isSearchComposing) return;
    const timeoutId = window.setTimeout(() => setFilterQuery(query), 80);
    return () => window.clearTimeout(timeoutId);
  }, [isSearchComposing, query]);
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
    const normalized = filterQuery.trim().toLowerCase();
    const result = rows.filter((row) => {
      const matchesQuery = !normalized || `${row.displayName} ${row.description ?? ""}`.toLowerCase().includes(normalized);
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
  }, [agentFilter, filterQuery, rows, statusFilter]);
  const animateRows = !query.trim() && agentFilter === "all" && statusFilter === "all";
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

  if (snapshot.isLoading) return <PageLoading />;
  if (snapshot.isError || !snapshot.data) {
    return <PageError title={`${environment.name} 暂时不可用`} message={getErrorMessage(snapshot.error)} onRetry={() => void snapshot.refetch()} />;
  }

  const capabilitiesReady = environment.kind === "local" || (snapshot.data.capabilities.ssh && snapshot.data.capabilities.python3);
  return (
    <PageShell
      title={environment.name}
      subtitle={environment.kind === "local" ? "本机统一管理的 AI Coding Skills。" : "通过 SSH 管理这台电脑自己的 Hub、Agent 和来源。"}
      environment={environment}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void snapshot.refetch()} disabled={snapshot.isFetching}>
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
            onInput={(event) => setQuery(event.currentTarget.value)}
            onCompositionStart={() => setIsSearchComposing(true)}
            onCompositionEnd={(event) => {
              setIsSearchComposing(false);
              setQuery(event.currentTarget.value);
            }}
            placeholder="搜索名称或描述…"
          />
          {query && <button className="search-clear" aria-label="清空搜索" onClick={() => setQuery("")}><X className="h-3.5 w-3.5" /></button>}
        </div>
        <div className="filter-group">
          <FilterButton active={agentFilter === "all"} onClick={() => setAgentFilter("all")}>全部</FilterButton>
          {AGENTS.map((agent) => (
            <FilterButton key={agent} active={agentFilter === agent} onClick={() => setAgentFilter(agent)}>
              <AgentIcon agent={agent} size={13} /> {agentLabels[agent]}
            </FilterButton>
          ))}
          <FilterButton active={statusFilter === "conflict"} onClick={() => setStatusFilter(statusFilter === "conflict" ? "all" : "conflict")}>冲突</FilterButton>
        </div>
      </div>
      <section className="workspace-list">
        <div className="workspace-list-header">
          <div>
            <div className="section-title">Skills</div>
            <div className="section-caption">{filtering ? `${visibleRows.length} / ${rows.length}` : visibleRows.length} 个 Skill · 点击行查看详情，点击 Agent 状态执行同步</div>
          </div>
          <div className="agent-legend">
            {AGENTS.map((agent) => <span key={agent}><AgentIcon agent={agent} size={13} /> {agentLabels[agent]}</span>)}
          </div>
        </div>
        <div className="skill-list">
          {animateRows ? <AnimatePresence initial={false}>
            {pageRows.map((row) => (
              <SkillRow
                key={row.name}
                row={row}
                onOpen={() => setSelectedSkillName(row.name)}
                onAgentAction={(agent, status) => handleAgentAction(row.name, agent, status)}
                animate={animateRows}
                pendingAgent={
                  skillMutation.isPending && skillMutation.variables?.skillName === row.name
                    ? skillMutation.variables.agent
                    : takeoverMutation.isPending && takeoverMutation.variables?.skillName === row.name
                      ? takeoverMutation.variables.agent
                      : null
                }
              />
          ))}
          </AnimatePresence> : pageRows.map((row) => (
            <SkillRow
              key={row.name}
              row={row}
              onOpen={() => setSelectedSkillName(row.name)}
              onAgentAction={(agent, status) => handleAgentAction(row.name, agent, status)}
              animate={false}
              pendingAgent={
                skillMutation.isPending && skillMutation.variables?.skillName === row.name
                  ? skillMutation.variables.agent
                  : takeoverMutation.isPending && takeoverMutation.variables?.skillName === row.name
                    ? takeoverMutation.variables.agent
                    : null
              }
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
          />
        )}
      </AnimatePresence>
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} source={environment} environments={environments} />
    </PageShell>
  );
}

function useEnvironmentSnapshot(environmentId: string) {
  return useQuery({
    queryKey: ["environment-snapshot", environmentId],
    queryFn: () => api.getEnvironmentSnapshot(environmentId),
    retry: false,
    staleTime: environmentId === "local" ? 10_000 : 20_000,
    gcTime: 5 * 60_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    refetchInterval: environmentId === "local" ? false : 60_000,
  });
}

const SkillRow = memo(function SkillRow({
  row,
  onOpen,
  onAgentAction,
  pendingAgent,
  animate,
}: {
  row: SkillRowView;
  onOpen: () => void;
  onAgentAction: (agent: AgentKind, status: string) => void;
  pendingAgent?: AgentKind | null;
  animate: boolean;
}) {
  return (
    <motion.div
      layout={animate}
      initial={animate ? { opacity: 0, y: 4 } : false}
      animate={animate ? { opacity: 1, y: 0 } : undefined}
      exit={animate ? { opacity: 0, height: 0 } : undefined}
      className="skill-row"
    >
      <button className="skill-row-main" onClick={onOpen}>
        <div className="min-w-0">
          <div className="skill-row-title">
            <span className="truncate">{row.displayName}</span>
          </div>
          <div className="skill-row-description">{row.description || "暂无描述"}</div>
        </div>
      </button>
      <div className="skill-agent-status">
        {AGENTS.map((agent) => {
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
              <span className="sr-only">{agentLabels[agent]} · {statusLabels[status] ?? status}</span>
            </button>
          );
        })}
      </div>
      <button className="skill-row-more" aria-label={`打开 ${row.displayName} 详情`} onClick={onOpen}>
        <MoreHorizontal className="h-4 w-4" />
      </button>
    </motion.div>
  );
}, (previous, next) => previous.row === next.row && previous.pendingAgent === next.pendingAgent && previous.animate === next.animate);

function SkillDrawer({
  row,
  snapshot,
  onClose,
  onAgentAction,
  onTrash,
  trashing,
}: {
  row: SkillRowView;
  snapshot: EnvironmentSnapshot;
  onClose: () => void;
  onAgentAction: (agent: AgentKind, status: string) => void;
  onTrash: () => void;
  trashing: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [trashOpen, setTrashOpen] = useState(false);
  const skill = snapshot.hub.find((item) => (item.dirName ?? item.dir_name ?? item.name) === row.name);
  return (
    <>
      <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="drawer-overlay" aria-label="关闭详情" onClick={onClose} />
      <motion.aside
        initial={{ x: reduceMotion ? 0 : 480 }}
        animate={{ x: 0 }}
        exit={{ x: reduceMotion ? 0 : 480 }}
        transition={{ duration: reduceMotion ? 0 : 0.2 }}
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
              {AGENTS.map((agent) => {
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
            <Button variant="destructive" disabled={trashing} onClick={onTrash}>{trashing && <Loader2 className="h-4 w-4 animate-spin" />} 移入回收站</Button>
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
  const availableTargets = environments.filter((item) => item.id !== source.id);
  useEffect(() => {
    if (open && !targetId && availableTargets[0]) setTargetId(availableTargets[0].id);
    if (!open) setSelected([]);
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
            <Button variant="secondary" disabled={!selected.length || transfer.isPending || !targetId} onClick={() => transfer.mutate(false)}>
              {transfer.isPending && <Loader2 className="h-4 w-4 animate-spin" />} 安全传输
            </Button>
            {items.some((item) => selected.includes(item.skillName ?? item.skill_name ?? "") && item.status === "different") && (
              <Button disabled={transfer.isPending || !targetId} onClick={() => transfer.mutate(true)}>
                {transfer.isPending && <Loader2 className="h-4 w-4 animate-spin" />} 覆盖并备份
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
  return (
    <PageShell
      title="安装来源"
      subtitle={`${environment.name} 的 Git、本地目录和 SSH Git 来源。`}
      environment={environment}
      actions={
        <Button size="sm" disabled={!canManageSources || snapshot.isLoading} onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> 添加来源</Button>
      }
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
      <section className="workspace-list">
        <div className="workspace-list-header"><div><div className="section-title">来源</div><div className="section-caption">{sources.length} 个来源</div></div></div>
        <div className="source-list">
          {sources.map((source) => (
            <div key={source.id} className={cn("source-row", selectedSource === source.id && "source-row-selected")}>
              <SourceIcon kind={source.kind} />
              <div className="min-w-0 flex-1"><div className="font-medium">{source.id}</div><div className="muted-path">{source.url}</div></div>
              <Badge>{source.kind}</Badge>
              <Button variant="secondary" size="sm" onClick={() => setSelectedSource(source.id)}>扫描</Button>
              <button className="icon-button" aria-label={`移除来源 ${source.id}`} onClick={() => removeSource.mutate(source.id)}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {!sources.length && (
            <EmptyState
              title="还没有来源"
              description={canManageSources ? "添加 GitHub、GitLab、SSH Git 或目标机器上的本地目录。" : "补齐 Git 和 Python3 后即可添加来源。"}
            />
          )}
        </div>
      </section>
      {canManageSources && (
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>添加安装来源</DialogTitle><DialogDescription>来源配置绑定当前环境：{environment.name}。</DialogDescription></DialogHeader>
            <SourceForm loading={addSource.isPending} onSubmit={(input) => addSource.mutate(input)} />
          </DialogContent>
        </Dialog>
      )}
      {canManageSources && selectedSource && <SourceScanPanel environmentId={environment.id} sourceId={selectedSource} onClose={() => setSelectedSource(null)} />}
    </PageShell>
  );
}

function SourceScanPanel({ environmentId, sourceId, onClose }: { environmentId: string; sourceId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
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
  return (
    <div className="inline-drawer">
      <div className="flex items-center justify-between gap-3"><div><div className="section-title">来源扫描</div><div className="section-caption">{sourceId}</div></div><div className="flex items-center gap-2">{pendingSkills.length > 0 && <Button size="sm" disabled={install.isPending} onClick={() => install.mutate({ skills: [], all: true })}>{install.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} 安装全部</Button>}<button className="icon-button" onClick={onClose}><X className="h-4 w-4" /></button></div></div>
      {scan.isLoading && <PageLoading compact />}
      {scan.isError && <PageError title="扫描失败" message={getErrorMessage(scan.error)} onRetry={() => void scan.refetch()} />}
      {scan.data && <div className="source-scan-list">{scan.data.skills.map((skill) => <div key={skill.name} className="source-scan-row"><div className="min-w-0 flex-1"><div className="font-medium">{skill.name}</div><div className="text-xs text-muted-foreground">{skill.description || "暂无描述"}</div></div><Badge>{skill.installed ? "已纳管" : "待纳管"}</Badge>{!skill.installed && <Button variant="secondary" size="sm" disabled={install.isPending} onClick={() => install.mutate({ skills: [skill.name], all: false })}>安装</Button>}</div>)}</div>}
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
      <div className="flex justify-end"><Button disabled={!url.trim() || loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />} 添加来源</Button></div>
    </form>
  );
}

function SettingsPage({ environment, theme, onThemeChange }: { environment: EnvironmentSummary; theme: Theme; onThemeChange: (theme: Theme) => void }) {
  const { showToast } = useToast();
  const preferences = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences, retry: false });
  const updatePreferences = useMutation({
    mutationFn: (defaultSyncMethod: SyncMethod) => api.updatePreferences({ defaultSyncMethod }),
    onSuccess: () => showToast({ tone: "success", title: "设置已保存" }),
    onError: (error) => showToast({ tone: "error", title: "设置保存失败", description: getErrorMessage(error) }),
  });
  const snapshot = useEnvironmentSnapshot(environment.id);
  const configPaths = snapshot.data ? buildConfigPathRows(snapshot.data.config) : [];
  const configSummary = snapshot.data
    ? [
        { label: "Agent", value: `${snapshot.data.agents.length} 个` },
        { label: "安装来源", value: `${snapshot.data.sources.length} 个` },
        { label: "默认同步", value: syncMethodLabel(preferences.data?.defaultSyncMethod ?? preferences.data?.default_sync_method ?? "auto") },
      ]
    : [];
  return (
    <PageShell title="设置" subtitle="应用偏好和当前环境配置。" environment={environment}>
      <section className="settings-section">
        <div className="settings-section-header"><div><div className="section-title">应用</div><div className="section-caption">影响所有环境的显示和默认策略</div></div></div>
        <div className="settings-row"><div><div className="font-medium">主题</div><div className="text-xs text-muted-foreground">跟随系统或手动选择</div></div><div className="segmented-control">{(["system", "light", "dark"] as Theme[]).map((item) => <button key={item} className={cn("segmented-item", theme === item && "segmented-item-active")} onClick={() => onThemeChange(item)}>{item === "system" ? "系统" : item === "light" ? <><Sun className="h-3.5 w-3.5" />浅色</> : <><Moon className="h-3.5 w-3.5" />深色</>}</button>)}</div></div>
        <div className="settings-row"><div><div className="font-medium">默认同步方式</div><div className="text-xs text-muted-foreground">本机和 SSH 环境 Agent 的默认同步方式</div></div><div className="segmented-control">{(["auto", "symlink", "copy"] as SyncMethod[]).map((item) => <button key={item} className={cn("segmented-item", (preferences.data?.defaultSyncMethod ?? preferences.data?.default_sync_method ?? "auto") === item && "segmented-item-active")} onClick={() => updatePreferences.mutate(item)}>{item === "auto" ? "自动" : item === "symlink" ? "链接" : "复制"}</button>)}</div></div>
      </section>
      <section className="settings-section">
        <div className="settings-section-header"><div><div className="section-title">当前环境</div><div className="section-caption">{environment.name}</div></div></div>
        {configSummary.length > 0 && <div className="config-summary-grid">{configSummary.map((item) => <div key={item.label} className="config-summary-item"><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>}
        {configPaths.map(({ label, value }) => <button key={label} className="settings-path-row" onClick={() => void api.openPath(value)}><span className="font-medium">{settingsLabel(label)}</span><span className="muted-path">{value}</span><ExternalLink className="h-3.5 w-3.5" /></button>)}
        {environment.kind === "remote" && snapshot.data && <div className="capability-grid">{Object.entries(snapshot.data.capabilities).filter(([key]) => key !== "message").map(([key, value]) => <div key={key} className="capability-item"><span>{key}</span><span className={value ? "capability-ok" : "capability-missing"}>{value ? "可用" : "缺少"}</span></div>)}</div>}
      </section>
    </PageShell>
  );
}

function AddEnvironmentDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (open: boolean) => void; onAdded: (environment: EnvironmentSummary) => void }) {
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("");
  const sshHosts = useQuery({ queryKey: ["ssh-hosts"], queryFn: api.discoverSshHosts, enabled: open, retry: false });
  const add = useMutation({
    mutationFn: () => api.addRemote({ name: name.trim() || host.trim(), host: host.trim(), user: user.trim() || undefined, port: port.trim() ? Number(port) : undefined }),
    onSuccess: (remote) => {
      const environment = { id: `remote:${remote.name}`, name: remote.name, kind: "remote" as const, host: remote.host, user: remote.user, port: remote.port };
      showToast({ tone: "success", title: "SSH 环境已添加", description: remote.name });
      onAdded(environment);
      onOpenChange(false);
      setName(""); setHost(""); setUser(""); setPort("");
    },
    onError: (error) => showToast({ tone: "error", title: "添加 SSH 环境失败", description: getErrorMessage(error) }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>添加 SSH 环境</DialogTitle><DialogDescription>添加后会和本机一样直接出现在左侧环境列表。</DialogDescription></DialogHeader>
        {sshHosts.data && sshHosts.data.length > 0 && <div className="space-y-1"><div className="field-label">SSH 配置</div>{sshHosts.data.map((item) => <button key={item.alias} className="ssh-host-option" disabled={item.added} onClick={() => { setName(item.alias); setHost(item.alias); setUser(item.user ?? ""); setPort(item.port ? String(item.port) : ""); }}><span>{item.alias}</span><span className="muted-path">{item.hostname ?? item.alias}</span></button>)}</div>}
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (host.trim()) add.mutate(); }}>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="显示名称，可选" />
          <Input value={host} onChange={(event) => setHost(event.target.value)} placeholder="SSH Host / Alias" autoFocus />
          <Input value={user} onChange={(event) => setUser(event.target.value)} placeholder="用户，可选" />
          <Input value={port} onChange={(event) => setPort(event.target.value)} placeholder="端口，可选" />
          <div className="flex justify-end"><Button disabled={!host.trim() || add.isPending}>{add.isPending && <Loader2 className="h-4 w-4 animate-spin" />} 添加环境</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PageShell({ title, subtitle, environment, actions, children }: { title: string; subtitle: string; environment: EnvironmentSummary; actions?: ReactNode; children: ReactNode }) {
  const connection = useQuery({
    queryKey: ["environment-connection", environment.id],
    queryFn: () => api.checkEnvironmentConnection(environment.id),
    enabled: environment.kind === "remote",
    retry: false,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const connected = environment.kind === "local" || connection.data?.status === "connected";
  return (
    <div className="page-shell">
      <header className="page-header">
        <div className="min-w-0">
          <div className="environment-breadcrumb"><span>{environment.kind === "local" ? "本机环境" : "SSH 环境"}</span><ChevronRight className="h-3.5 w-3.5" /><span className="truncate">{environment.name}</span><StatusDot tone={connection.isFetching ? "info" : connected ? "success" : "danger"} spinning={connection.isFetching} /></div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

function StatItem({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "muted" | "danger" }) {
  return <div className="stat-item"><div className="kicker">{label}</div><div className={cn("stat-value", tone === "success" && "text-emerald-600", tone === "danger" && "text-red-600")}>{value}</div></div>;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button className={cn("filter-button", active && "filter-button-active")} onClick={onClick}>{children}</button>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><div className="empty-state-icon"><Database className="h-4 w-4" /></div><div className="font-medium">{title}</div><div className="mt-1 text-sm text-muted-foreground">{description}</div></div>;
}

function PageLoading({ compact = false }: { compact?: boolean }) {
  return <div className={cn("loading-state", compact && "loading-state-compact")}><Loader2 className="h-4 w-4 animate-spin" /><span>正在读取环境状态…</span></div>;
}

function PageError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return <div className="error-state"><CircleAlert className="h-4 w-4 shrink-0" /><div className="min-w-0 flex-1"><div className="font-medium">{title}</div><div className="mt-1 text-sm">{message}</div></div><Button variant="secondary" size="sm" onClick={onRetry}>重试</Button></div>;
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
