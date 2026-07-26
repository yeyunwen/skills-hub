import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  Home,
  Laptop,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Server,
  Trash2,
  TriangleAlert,
  X,
  Monitor,
} from "lucide-react";
import {
  api,
  dirName,
  sourcePath,
  type AgentKind,
  type DiscoveredSkill,
  type DiscoveredSshHost,
  type RemoteConnectionStatus,
  type RemoteHost,
  type RemoteSkillStatus,
  type SkillDetail,
  type SkillInfo,
  type SyncMethod,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { agentLabel, copy, statusLabel, syncMethodLabel } from "@/lib/copy";
import { useToast } from "@/lib/toast";
import { AgentIcon, RemoteIcon, SourceIcon, StatusDot } from "@/lib/brand";
import {
  agentStatus,
  AGENTS,
  buildAgentInventory,
  buildMigrationSummaries,
  buildSkillRows,
  buildWorkspaceOverview,
  type ImportableSkillView,
  type MigrationSummary,
  type SkillRowView,
  type ToolConflictView,
} from "@/lib/view-model";

type Page = "dashboard" | "sources" | "hub" | "agents" | "remotes" | "settings";
type HubFilter = "all" | AgentKind | "conflict" | "missing";
type AgentMode = "hub-matrix" | "migration" | "agent-inventory";
type AgentFilter = "all" | AgentKind | "conflict" | "missing" | "importable";
type RouteState = { page: Page; hubFilter?: HubFilter; agentFilter?: AgentFilter; agentMode?: AgentMode };
type AgentSkillRemoveTarget = { agent: AgentKind; skillName: string; path: string };
type RemoteSkillActionTarget = { remoteName: string; agent: AgentKind; skillName: string; remotePath?: string | null };
type RemoteLocalSkillSyncTarget = { remoteName: string; sourceAgent: AgentKind; targetAgents: AgentKind[]; skillName: string };
type SkillDialogKind = "hub" | "enabled" | "missing" | "conflict" | "inventory" | "managed" | "importable" | "external";
type SkillDialogState = { kind: SkillDialogKind; title: string; description: string; agent?: AgentKind };
type PagedSkillItem = {
  id: string;
  name: string;
  description?: string | null;
  path: string;
  agent?: AgentKind;
  status?: string;
  skillName?: string;
  openable?: boolean;
};

const navItems: Array<{ page: Page; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { page: "sources", label: copy.nav.sources, icon: GitBranch },
  { page: "agents", label: copy.nav.agents, icon: Laptop },
  { page: "remotes", label: copy.nav.remotes, icon: Server },
  { page: "settings", label: copy.nav.settings, icon: Settings },
];

function App() {
  const [route, setRoute] = useState<RouteState>({ page: "agents", agentMode: "hub-matrix" });
  const page = route.page;
  const navigate = (next: RouteState | Page) => setRoute(typeof next === "string" ? { page: next } : next);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <RemoteConnectionMonitor />
      <aside className="app-sidebar sticky top-0 flex h-screen w-[248px] shrink-0 flex-col px-3 py-4">
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background">
            <Box className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">skills-hub</div>
            <div className="text-[11px] text-muted-foreground">{copy.app.tagline}</div>
          </div>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto pb-4">
          <SidebarGroup label="Skill 管理" pages={["agents", "remotes", "sources"]} current={page} onChange={(nextPage) => navigate(nextPage)} />
        </nav>
        <button className={cn("sidebar-item mb-2 shrink-0", page === "settings" && "sidebar-item-active")} onClick={() => navigate("settings")}>
          <Settings className="h-3.5 w-3.5" />
          {copy.nav.settings}
        </button>
        <div className="shrink-0 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
          <div className="mb-2 flex items-center justify-between">
            <span className="kicker">统一技能库</span>
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
          </div>
          <div className="font-mono text-foreground">~/.agents/skills</div>
          <div className="mt-1">本机和远程设备都以此目录为真源。</div>
        </div>
      </aside>
      <main className={cn("hide-scrollbar h-screen min-w-0 flex-1 px-7 py-7", page === "remotes" ? "overflow-hidden" : "overflow-y-auto")}>
        {page === "sources" && <SourcesPage />}
        {page === "agents" && <AgentsPage initialMode={route.agentMode} />}
        {page === "remotes" && <RemotesPage />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

function useRemoteConnectionQueries(remotes: RemoteHost[]) {
  return useQueries({
    queries: remotes.map((remote) => ({
      queryKey: ["remote-connection", remote.name],
      queryFn: () => api.checkRemoteConnection(remote.name),
      enabled: Boolean(remote.name),
      retry: false,
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchInterval: (query: { state: { data?: RemoteConnectionStatus } }) =>
        query.state.data?.status === "connected" ? 60_000 : 15_000,
      refetchIntervalInBackground: true,
    })),
  });
}

function RemoteConnectionMonitor() {
  const remotes = useQuery({ queryKey: ["remotes"], queryFn: api.listRemotes, retry: false });
  useRemoteConnectionQueries(remotes.data ?? []);
  return null;
}

function SidebarGroup({ label, pages, current, onChange }: { label: string; pages: Page[]; current: Page; onChange: (page: Page) => void }) {
  return (
    <div className="mb-4">
      <div className="mb-1 px-2 text-[11px] font-medium text-muted-foreground">{label}</div>
      {pages.map((page) => {
        const item = navItems.find((nav) => nav.page === page)!;
        const Icon = item.icon;
        return (
          <button key={page} onClick={() => onChange(page)} className={cn("sidebar-item", current === page && "sidebar-item-active")}>
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function CommandBar() {
  return (
    <div className="mx-auto max-w-[1240px]">
      <div className="command-bar">
        <Search className="h-4 w-4" />
        <span>{copy.common.commandPlaceholder}</span>
        <span className="command-shortcut">⌘K</span>
      </div>
    </div>
  );
}

function DashboardPage({ navigate }: { navigate: (route: RouteState | Page) => void }) {
  const scan = useQuery({ queryKey: ["scan-all"], queryFn: api.scanAll, retry: false });
  const statuses = useQuery({ queryKey: ["list-status"], queryFn: api.listStatus, retry: false });
  const sources = useQuery({ queryKey: ["sources"], queryFn: api.listSources, retry: false });
  const overview = useMemo(() => buildWorkspaceOverview(scan.data, statuses.data), [scan.data, statuses.data]);
  const loading = scan.isLoading || statuses.isLoading || sources.isLoading;
  const error = scan.error ?? statuses.error ?? sources.error;

  if (loading) {
    return <PageShell title={copy.dashboard.title} subtitle={copy.dashboard.subtitle}><LoadingState text={copy.common.loading} /></PageShell>;
  }

  if (error) {
    return <PageShell title={copy.dashboard.title} subtitle={copy.dashboard.subtitle}><ErrorState text={getErrorMessage(error)} onRetry={() => void Promise.all([scan.refetch(), statuses.refetch(), sources.refetch()])} /></PageShell>;
  }

  return (
    <PageShell title={copy.dashboard.title} subtitle={copy.dashboard.subtitle}>
      <div className="grid grid-cols-5 overflow-hidden rounded-lg border border-border bg-card">
        <MetricCard label={copy.dashboard.metrics.hub} value={overview.hubCount} onClick={() => navigate({ page: "hub", hubFilter: "all" })} />
        <MetricCard label="可导入" value={overview.importable.length} onClick={() => navigate({ page: "agents", agentMode: "agent-inventory", agentFilter: "importable" })} />
        <MetricCard label="已启用" value={overview.enabledCount} onClick={() => navigate({ page: "agents", agentMode: "hub-matrix", agentFilter: "all" })} />
        <MetricCard label="待处理" value={overview.conflicts.length} onClick={() => navigate({ page: "agents", agentMode: "hub-matrix", agentFilter: "conflict" })} />
        <MetricCard label={copy.dashboard.metrics.sources} value={sources.data?.length ?? 0} onClick={() => navigate("sources")} />
      </div>
      <div className="grid grid-cols-[1.35fr_0.65fr] gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{copy.dashboard.flowTitle}</CardTitle>
            <CardDescription>{copy.dashboard.flowDescription}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2">
            <ActionTile icon={Search} label={copy.dashboard.scanSkills} onClick={() => navigate({ page: "agents", agentMode: "agent-inventory", agentFilter: "all" })} />
            <ActionTile icon={GitBranch} label={copy.dashboard.addSource} onClick={() => navigate("sources")} />
            <ActionTile icon={Database} label={copy.dashboard.reviewHub} onClick={() => navigate({ page: "hub", hubFilter: "all" })} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{copy.dashboard.attentionTitle}</CardTitle>
            <CardDescription>{copy.dashboard.attentionDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <IssueRow icon={TriangleAlert} label={copy.dashboard.conflicts} value={overview.conflicts.length} tone="error" onClick={() => navigate({ page: "agents", agentMode: "hub-matrix", agentFilter: "conflict" })} />
            <IssueRow icon={CheckCircle2} label={copy.dashboard.missingLinks} value={overview.missingCount} tone="muted" onClick={() => navigate({ page: "agents", agentMode: "hub-matrix", agentFilter: "missing" })} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

function SourcesPage() {
  const queryClient = useQueryClient();
  const { showToast, updateToast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const autoScannedSources = useRef<Set<string>>(new Set());
  const sources = useQuery({ queryKey: ["sources"], queryFn: api.listSources, retry: false });
  const scan = useQuery({
    queryKey: ["source-scan", selectedSource],
    queryFn: () => api.scanSource(selectedSource ?? ""),
    enabled: false,
    retry: false,
  });
  const install = useMutation<Awaited<ReturnType<typeof api.installFromSource>>, Error, { all?: boolean }, string>({
    mutationFn: ({ all = false }) =>
      api.installFromSource({
        sourceRef: selectedSource ?? "",
        skills: all ? [] : selectedSkills,
        all,
        force: false,
      }),
    onMutate: ({ all = false }) =>
      showToast({
        tone: "loading",
        title: copy.sources.installing,
        description: all ? copy.sources.installAll : selectedSkills.join(", "),
      }),
    onSuccess: async (result, _variables, toastId) => {
      const installedKeys = new Set(result.installed.map((skill) => `${skill.name}::${sourcePath(skill)}`));
      const installedNames = new Set(result.installed.map((skill) => skill.name));
      queryClient.setQueryData<Awaited<ReturnType<typeof api.scanSource>>>(["source-scan", selectedSource], (current) => {
        if (!current) return current;
        return {
          ...current,
          skills: current.skills.map((skill) =>
            installedKeys.has(`${skill.name}::${sourcePath(skill)}`) || installedNames.has(skill.name)
              ? { ...skill, installed: true }
              : skill,
          ),
        };
      });
      setSelectedSkills([]);
      updateToast(toastId, {
        tone: "success",
        title: copy.sources.installSuccess,
        description: `已安装 ${result.installed.length} 个，跳过 ${result.skipped.length} 个。`,
      });
      await Promise.all([
        scan.refetch(),
        queryClient.invalidateQueries({ queryKey: ["sources"] }),
        queryClient.invalidateQueries({ queryKey: ["scan-all"] }),
        queryClient.invalidateQueries({ queryKey: ["list-status"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error, _variables, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: copy.sources.installFailed, description: getErrorMessage(error) });
    },
  });
  const removeSource = useMutation<Awaited<ReturnType<typeof api.removeSource>>, Error, string, string>({
    mutationFn: (id) => api.removeSource(id),
    onMutate: (id) => showToast({ tone: "loading", title: copy.sources.deleting, description: id }),
    onSuccess: async (_result, id, toastId) => {
      if (selectedSource === id) {
        setSelectedSource(null);
        setSelectedSkills([]);
      }
      autoScannedSources.current.delete(id);
      updateToast(toastId, { tone: "success", title: copy.sources.deleteSuccess, description: id });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sources"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error, _id, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: copy.sources.deleteFailed, description: getErrorMessage(error) });
    },
  });

  useEffect(() => {
    if (selectedSource || sources.isLoading || sources.isError) return;
    const first = sources.data?.[0];
    if (first) setSelectedSource(first.id);
  }, [selectedSource, sources.data, sources.isError, sources.isLoading]);

  useEffect(() => {
    if (!selectedSource || autoScannedSources.current.has(selectedSource) || scan.isFetching) return;
    autoScannedSources.current.add(selectedSource);
    setSelectedSkills([]);
    void scan.refetch();
  }, [selectedSource, scan]);

  return (
    <PageShell title={copy.sources.title} subtitle={copy.sources.subtitle} actions={<AddSourceDialog open={open} onOpenChange={setOpen} />}>
      <div className="grid min-h-[560px] grid-cols-[340px_minmax(0,1fr)] gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{copy.sources.registered}</CardTitle>
            <CardDescription>{copy.sources.count(sources.data?.length ?? 0)}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {sources.isLoading && <LoadingState text={copy.common.loading} />}
            {sources.isError && <ErrorState text={getErrorMessage(sources.error)} onRetry={() => void sources.refetch()} />}
            {!sources.isLoading &&
              !sources.isError &&
              (sources.data ?? []).map((source) => (
                <div key={source.id} className={cn("list-row", selectedSource === source.id && "list-row-selected")}>
                  <button
                    className="w-full text-left"
                    onClick={() => {
                      setSelectedSource(source.id);
                      setSelectedSkills([]);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 font-medium"><SourceIcon kind={source.kind} /> {source.id}</span>
                      <div className="flex items-center gap-2">
                        <Badge>{source.kind}</Badge>
                        <span
                          role="button"
                          tabIndex={0}
                          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background hover:text-destructive"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeSource.mutate(source.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.stopPropagation();
                              removeSource.mutate(source.id);
                            }
                          }}
                        >
                          {copy.sources.delete}
                        </span>
                      </div>
                    </div>
                    <div className="mt-1 muted-path">{source.url}</div>
                  </button>
                </div>
              ))}
            {!sources.isLoading && !sources.isError && !sources.data?.length && <EmptyState text={copy.sources.empty} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>{selectedSource ? copy.sources.scanTitle(selectedSource) : copy.sources.scanTitle(null)}</CardTitle>
                <CardDescription>{copy.sources.scanDescription}</CardDescription>
              </div>
              <Button
                variant="secondary"
                disabled={!selectedSource || scan.isFetching}
                onClick={() => void refetchSourceScan(scan.refetch, showToast, updateToast)}
              >
                <RefreshCw className={cn("h-4 w-4", scan.isFetching && "animate-spin")} /> {copy.sources.scan}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {scan.isFetching && !scan.data ? (
              <LoadingState text={copy.sources.scanning} />
            ) : scan.isError ? (
              <ErrorState text={getErrorMessage(scan.error)} onRetry={() => void refetchSourceScan(scan.refetch, showToast, updateToast)} />
            ) : scan.data ? (
              <div>
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="text-sm text-muted-foreground">{copy.sources.found(scan.data.skills.length)}</div>
                  <div className="flex gap-2">
                    <Button variant="secondary" disabled={!scan.data.skills.length || install.isPending} onClick={() => install.mutate({ all: true })}>
                      {copy.sources.installAll}
                    </Button>
                    <Button disabled={!selectedSkills.length || install.isPending} onClick={() => install.mutate({})}>
                      {install.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      {copy.sources.installSelected(selectedSkills.length)}
                    </Button>
                  </div>
                </div>
                <div>
                  {scan.data.skills.map((skill) => (
                    <SkillSelectRow
                      key={`${skill.name}-${sourcePath(skill)}`}
                      skill={skill}
                      checked={selectedSkills.includes(skill.name)}
                      onCheckedChange={(checked) =>
                        setSelectedSkills((current) =>
                          checked ? [...current, skill.name] : current.filter((name) => name !== skill.name),
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState text={copy.sources.chooseAndScan} />
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

function AddSourceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { showToast, updateToast } = useToast();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const mutation = useMutation<Awaited<ReturnType<typeof api.addSource>>, Error, void, string>({
    mutationFn: () => api.addSource({ id: name || undefined, url, branch: branch || undefined }),
    onMutate: () => showToast({ tone: "loading", title: copy.sources.adding, description: url }),
    onSuccess: async (source, _variables, toastId) => {
      setUrl("");
      setName("");
      setBranch("");
      onOpenChange(false);
      updateToast(toastId, { tone: "success", title: copy.sources.addSuccess, description: source.id });
      await queryClient.invalidateQueries({ queryKey: ["sources"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error, _variables, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: copy.sources.addFailed, description: getErrorMessage(error) });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" /> {copy.sources.add}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.sources.dialogTitle}</DialogTitle>
          <DialogDescription>{copy.sources.dialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="git@gitlab.example.com:team/skills.git" />
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={copy.sources.namePlaceholder} />
          <Input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder={copy.sources.branchPlaceholder} />
          {mutation.error && <div className="text-sm text-destructive">{String(mutation.error)}</div>}
          <Button disabled={!url || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {copy.sources.add}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HubPage({ initialFilter = "all", navigate }: { initialFilter?: HubFilter; navigate: (route: RouteState | Page) => void }) {
  const queryClient = useQueryClient();
  const { showToast, updateToast } = useToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<HubFilter>(initialFilter);
  useEffect(() => setFilter(initialFilter), [initialFilter]);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const scan = useQuery({ queryKey: ["scan-all"], queryFn: api.scanAll });
  const statuses = useQuery({ queryKey: ["list-status"], queryFn: api.listStatus, retry: false });
  const preferences = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences, retry: false });
  const method = getDefaultSyncMethod(preferences.data);
  const rows = useMemo(() => buildSkillRows(scan.data, statuses.data), [scan.data, statuses.data]);
  const overview = useMemo(() => buildWorkspaceOverview(scan.data, statuses.data), [scan.data, statuses.data]);
  const filteredRows = useMemo(() => filterSkillRows(rows, query, filter), [rows, query, filter]);
  const importableMatches = useMemo(() => filterImportableSkills(overview.importable, query, filter), [overview.importable, query, filter]);
  const linkSkill = useLinkSkillMutation({ force: false, dryRun: false, syncMethod: method });
  const removeSkill = useMutation<Awaited<ReturnType<typeof api.removeHubSkill>>, Error, string, string>({
    mutationFn: (skillName) => api.removeHubSkill({ skillName, force: true }),
    onMutate: (skillName) => showToast({ tone: "loading", title: copy.hub.remove, description: skillName }),
    onSuccess: async (_result, skillName, toastId) => {
      setSelectedSkill(null);
      setRemoveTarget(null);
      updateToast(toastId, { tone: "success", title: copy.hub.removed, description: skillName });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scan-all"] }),
        queryClient.invalidateQueries({ queryKey: ["list-status"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error, _skillName, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: copy.hub.removeFailed, description: getErrorMessage(error) });
    },
  });

  return (
    <PageShell title={copy.hub.title} subtitle={copy.hub.subtitle}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-sm flex-1">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.hub.search} />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>{copy.hub.all}</FilterPill>
          {AGENTS.map((agent) => (
            <FilterPill key={agent} active={filter === agent} onClick={() => setFilter(agent)}>
              <span className="inline-flex items-center gap-1.5"><AgentIcon agent={agent} size={14} /> {agentLabel(agent)}</span>
            </FilterPill>
          ))}
          <FilterPill active={filter === "conflict"} onClick={() => setFilter("conflict")}>{copy.hub.conflict}</FilterPill>
          <FilterPill active={filter === "missing"} onClick={() => setFilter("missing")}>{copy.agents.missing}</FilterPill>
          <Button variant="secondary" disabled={scan.isFetching || statuses.isFetching} onClick={() => void Promise.all([scan.refetch(), statuses.refetch()])}>
            <RefreshCw className={cn("h-4 w-4", (scan.isFetching || statuses.isFetching) && "animate-spin")} /> {copy.hub.refresh}
          </Button>
        </div>
      </div>
      <div className="content-card overflow-hidden">
        {(scan.isLoading || statuses.isLoading) && <LoadingState text={copy.hub.loading} />}
        {(scan.isError || statuses.isError) && (
          <ErrorState text={getErrorMessage(scan.error ?? statuses.error)} onRetry={() => void Promise.all([scan.refetch(), statuses.refetch()])} />
        )}
        {!scan.isLoading && !statuses.isLoading && !scan.isError && !statuses.isError && filteredRows.map((row) => (
          <SkillListRow
            key={row.name}
            row={row}
            pendingAgent={linkSkill.isPending && linkSkill.variables?.skillName === row.name ? linkSkill.variables.agent : null}
            onAgentClick={(agent, status) => linkSkill.mutate({ skillName: row.name, agent, status })}
            onDetails={() => setSelectedSkill(row.name)}
          />
        ))}
        {!scan.isLoading && !statuses.isLoading && !scan.isError && !statuses.isError && !filteredRows.length && importableMatches.length > 0 && (
          <ImportableHint
            skills={importableMatches}
            onOpen={(path) => void api.openPath(path)}
            onViewAll={() => navigate({ page: "agents", agentMode: "agent-inventory", agentFilter: "importable" })}
          />
        )}
        {!scan.isLoading && !statuses.isLoading && !scan.isError && !statuses.isError && !filteredRows.length && !importableMatches.length && <EmptyState text={copy.hub.empty} />}
      </div>
      {selectedSkill && (
        <SkillDetailDrawer
          skillName={selectedSkill}
          removing={removeSkill.isPending}
          onClose={() => setSelectedSkill(null)}
          onRemove={() => setRemoveTarget(selectedSkill)}
        />
      )}
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={copy.hub.remove}
        description={`${removeTarget ?? ""} · ${copy.hub.removeConfirm}`}
        confirmLabel={copy.hub.remove}
        cancelLabel={copy.remotes.cancel}
        loading={removeSkill.isPending}
        onOpenChange={(nextOpen) => !nextOpen && setRemoveTarget(null)}
        onConfirm={() => removeTarget && removeSkill.mutate(removeTarget)}
      />
    </PageShell>
  );
}

function AgentsPage({ initialMode = "agent-inventory" }: { initialMode?: AgentMode }) {
  const queryClient = useQueryClient();
  const { showToast, updateToast } = useToast();
  const [mode, setMode] = useState<AgentMode>(initialMode);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [migrateTarget, setMigrateTarget] = useState<AgentKind[] | null>(null);
  const [takeoverTarget, setTakeoverTarget] = useState<ToolConflictView | null>(null);
  const [removeAgentTarget, setRemoveAgentTarget] = useState<AgentSkillRemoveTarget | null>(null);
  const [removeHubTarget, setRemoveHubTarget] = useState<string | null>(null);
  const [skillDialog, setSkillDialog] = useState<SkillDialogState | null>(null);
  const scan = useQuery({ queryKey: ["scan-all"], queryFn: api.scanAll, retry: false });
  const statuses = useQuery({ queryKey: ["list-status"], queryFn: api.listStatus, retry: false });
  const preferences = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences, retry: false });
  const method = getDefaultSyncMethod(preferences.data);
  const inventory = useMemo(() => buildAgentInventory(scan.data), [scan.data]);
  const summaries = useMemo(() => buildMigrationSummaries(scan.data), [scan.data]);
  const overview = useMemo(() => buildWorkspaceOverview(scan.data, statuses.data), [scan.data, statuses.data]);
  const rows = useMemo(() => buildSkillRows(scan.data, statuses.data), [scan.data, statuses.data]);
  const visibleInventory = inventory;
  const hubNames = useMemo(() => {
    const values = new Set<string>();
    for (const skill of scan.data?.hub ?? []) {
      values.add(dirName(skill));
      values.add(skill.name);
    }
    return values;
  }, [scan.data]);
  const dialogItems = useMemo<PagedSkillItem[]>(() => {
    if (!skillDialog) return [];
    const matchesAgent = (agent?: AgentKind) => !skillDialog.agent || agent === skillDialog.agent;
    if (skillDialog.kind === "hub") {
      return rows.map((row) => ({ id: row.name, name: row.displayName, description: row.description, path: row.path, skillName: row.name }));
    }
    if (skillDialog.kind === "enabled" || skillDialog.kind === "missing" || skillDialog.kind === "conflict") {
      const items: PagedSkillItem[] = [];
      for (const row of rows) {
        for (const status of row.agents) {
          if (!matchesAgent(status.agent)) continue;
          const enabled = status.status === "linked" || status.status === "copied";
          const missing = status.status === "missing" || status.status === "hub-only";
          if (
            (skillDialog.kind === "enabled" && enabled) ||
            (skillDialog.kind === "missing" && missing) ||
            (skillDialog.kind === "conflict" && status.status === "conflict")
          ) {
            items.push({
              id: `${row.name}-${status.agent}`,
              name: row.displayName,
              description: row.description,
              path: status.path,
              agent: status.agent,
              status: status.status,
              skillName: row.name,
              openable: !missing,
            });
          }
        }
      }
      return items;
    }
    if (skillDialog.kind === "importable") {
      return overview.importable
        .filter((skill) => matchesAgent(skill.agent))
        .map((skill) => ({ id: `${skill.agent}-${skill.path}`, name: skill.name, description: skill.description, path: skill.path, agent: skill.agent, skillName: skill.dirName }));
    }
    if (skillDialog.kind === "external") {
      return overview.external
        .filter((skill) => matchesAgent(skill.agent))
        .map((skill) => ({ id: `${skill.agent}-${skill.path}`, name: skill.name, description: skill.description, path: skill.targetPath ?? skill.path, agent: skill.agent, status: "external", skillName: skill.dirName }));
    }
    const groups = inventory.filter((group) => matchesAgent(group.agent));
    return groups.flatMap((group) =>
      group.skills
        .filter((skill) => skillDialog.kind === "inventory" || hubNames.has(dirName(skill)) || hubNames.has(skill.name))
        .map((skill) => ({
          id: `${group.agent}-${skill.path}`,
          name: skill.name,
          description: skill.description,
          path: skill.path,
          agent: group.agent,
          status: (skill.isSymlink ?? skill.is_symlink) ? "linked" : hubNames.has(dirName(skill)) || hubNames.has(skill.name) ? "conflict" : "local",
          skillName: dirName(skill),
        })),
    );
  }, [hubNames, inventory, overview.external, overview.importable, rows, skillDialog]);
  const linkSkill = useLinkSkillMutation({ force: false, dryRun: false, syncMethod: method });
  const removeHubSkill = useMutation<Awaited<ReturnType<typeof api.removeHubSkill>>, Error, string, string>({
    mutationFn: (skillName) => api.removeHubSkill({ skillName, force: true }),
    onMutate: (skillName) => showToast({ tone: "loading", title: "正在全部删除 Skill…", description: skillName }),
    onSuccess: async (result, skillName, toastId) => {
      setRemoveHubTarget(null);
      const removedAgents = result.agents.filter((item) => item.status === "unlinked").length;
      const conflicts = result.agents.filter((item) => item.status === "conflict").length;
      updateToast(toastId, {
        tone: conflicts ? "error" : "success",
        title: conflicts ? "Skill 已删除，部分真实目录已保留" : "Skill 已全部删除",
        description: `${skillName} · 已清理 ${removedAgents} 个 Agent 链接或副本${conflicts ? `，保留 ${conflicts} 个未受管真实目录` : ""}`,
      });
      queryClient.removeQueries({ queryKey: ["skill-detail", skillName] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scan-all"] }),
        queryClient.invalidateQueries({ queryKey: ["list-status"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error, skillName, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: "Skill 删除失败", description: `${skillName} · ${getErrorMessage(error)}` });
    },
  });

  useEffect(() => setMode(initialMode), [initialMode]);

  const syncAgents = useMutation<Awaited<ReturnType<typeof api.syncAgents>>, Error, AgentKind[], string>({
    mutationFn: (agents) => api.syncAgents({ tools: agents, force: false, dryRun: false, syncMethod: method }),
    onMutate: (agents) => showToast({ tone: "loading", title: copy.agents.syncing, description: agents.map(agentLabel).join(", ") }),
    onSuccess: async (results, agents, toastId) => {
      setSyncDialogOpen(false);
      const conflicts = results.filter((result) => result.status === "conflict").length;
      updateToast(toastId, {
        tone: conflicts ? "error" : "success",
        title: conflicts ? copy.agents.conflictTip : copy.agents.syncSuccess,
        description: `目标：${agents.map(agentLabel).join(", ")} · 处理 ${results.length} 项${conflicts ? `，${conflicts} 项待处理` : ""}`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["list-status"] }),
        queryClient.invalidateQueries({ queryKey: ["scan-all"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error, agents, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: copy.agents.syncFailed, description: `${agents.map(agentLabel).join(", ")} · ${getErrorMessage(error)}` });
    },
  });

  const migrate = useMutation<unknown[], Error, AgentKind[], string>({
    mutationFn: async (agents) => {
      const results = [];
      for (const from of agents) {
        results.push(await api.migrateFromAgent({ from, force: false, dryRun: false }));
      }
      return results;
    },
    onMutate: (agents) => showToast({ tone: "loading", title: copy.agents.migrating, description: agents.map(agentLabel).join(", ") }),
    onSuccess: async (_result, agents, toastId) => {
      setMigrateTarget(null);
      updateToast(toastId, { tone: "success", title: copy.agents.migrateSuccess, description: agents.map(agentLabel).join(", ") });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["list-status"] }),
        queryClient.invalidateQueries({ queryKey: ["scan-all"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error, _agents, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: copy.agents.migrateFailed, description: getErrorMessage(error) });
    },
  });
  const takeover = useMutation<Awaited<ReturnType<typeof api.takeoverAgentSkill>>, Error, ToolConflictView, string>({
    mutationFn: (target) => api.takeoverAgentSkill({ skillName: target.skillName, agent: target.agent, syncMethod: method }),
    onMutate: (target) => showToast({ tone: "loading", title: copy.agents.takeover, description: `${target.skillName} → ${agentLabel(target.agent)}` }),
    onSuccess: async (result, target, toastId) => {
      setTakeoverTarget(null);
      updateToast(toastId, {
        tone: "success",
        title: copy.agents.takeoverSuccess,
        description: `${target.skillName} · ${result.backupPath ?? result.backup_path}`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["list-status"] }),
        queryClient.invalidateQueries({ queryKey: ["scan-all"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error, target, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: copy.agents.takeoverFailed, description: `${target.skillName} · ${getErrorMessage(error)}` });
    },
  });
  const removeAgentSkill = useMutation<Awaited<ReturnType<typeof api.removeAgentSkill>>, Error, AgentSkillRemoveTarget, string>({
    mutationFn: (target) => api.removeAgentSkill({ skillName: target.skillName, agent: target.agent, dryRun: false }),
    onMutate: (target) => showToast({ tone: "loading", title: "正在移除 Agent 技能…", description: `${target.skillName} · ${agentLabel(target.agent)}` }),
    onSuccess: async (result, target, toastId) => {
      setRemoveAgentTarget(null);
      updateToast(toastId, {
        tone: "success",
        title: "Agent 技能已移除",
        description: result.backupPath ?? result.backup_path ?? `${target.skillName} · ${statusLabel(result.status)}`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["list-status"] }),
        queryClient.invalidateQueries({ queryKey: ["scan-all"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error, target, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: "Agent 技能移除失败", description: `${target.skillName} · ${agentLabel(target.agent)} · ${getErrorMessage(error)}` });
    },
  });

  const migratableAgents = summaries.filter((summary) => summary.migratableCount > 0).map((summary) => summary.agent);
  const loading = scan.isLoading || statuses.isLoading;
  const error = scan.error ?? statuses.error;

  return (
    <PageShell
      fixed
      title="本机 Skill 管理"
      subtitle="所有 Skill 先进入 ~/.agents/skills，再统一启用到 Codex、Claude、Cursor 和 OpenClaw。"
      actions={
        <Button variant="secondary" disabled={scan.isFetching || statuses.isFetching} onClick={() => void Promise.all([scan.refetch(), statuses.refetch()])}>
          <RefreshCw className={cn("h-4 w-4", (scan.isFetching || statuses.isFetching) && "animate-spin")} /> 刷新状态
        </Button>
      }
    >
      <div className="workflow-tabs" role="tablist" aria-label="本机 Skill 管理视图">
        <button className={cn("workflow-tab", mode === "hub-matrix" && "workflow-tab-active")} onClick={() => setMode("hub-matrix")}>
          <Database className="h-4 w-4" />
          <span><strong>Skills</strong><small>管理 Hub 与 Agent 启用状态</small></span>
        </button>
        <button className={cn("workflow-tab", mode === "migration" && "workflow-tab-active")} onClick={() => setMode("migration")}>
          <Folder className="h-4 w-4" />
          <span><strong>待纳管</strong><small>归并 Agent 自己维护的 Skill</small></span>
          {overview.importable.length > 0 && <Badge>{overview.importable.length}</Badge>}
        </button>
        <button className={cn("workflow-tab", mode === "agent-inventory" && "workflow-tab-active")} onClick={() => setMode("agent-inventory")}>
          <FileText className="h-4 w-4" />
          <span><strong>目录诊断</strong><small>查看真实文件、链接和冲突</small></span>
        </button>
      </div>

      {mode === "hub-matrix" && (
        <div className="grid min-h-0 flex-1 grid-rows-[82px_minmax(0,1fr)] gap-4">
          <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-border bg-card">
            <MetricCard label="统一技能库" value={overview.hubCount} onClick={() => setSkillDialog({ kind: "hub", title: "统一技能库", description: "当前 Hub 中全部 Skill。" })} />
            <MetricCard label="已启用" value={overview.enabledCount} onClick={() => setSkillDialog({ kind: "enabled", title: "已启用 Skill", description: "按 Agent 展示已链接或已复制的 Skill。" })} />
            <MetricCard label="待启用" value={overview.missingCount} onClick={() => setSkillDialog({ kind: "missing", title: "待启用 Skill", description: "Hub 中存在、但尚未启用到对应 Agent 的 Skill。" })} />
            <MetricCard label="冲突" value={overview.conflicts.length} onClick={() => setSkillDialog({ kind: "conflict", title: "待处理冲突", description: "Agent 目录已有同名真实目录，需要保留或备份接管。" })} />
          </div>

          <Card className="min-h-0">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Agent 启用状态</CardTitle>
                  <CardDescription>点击数字查看分页明细；页面本身只保留状态摘要。</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={!rows.length || removeHubSkill.isPending}
                    onClick={() => setSkillDialog({ kind: "hub", title: "删除 Skill", description: "选择一个 Skill，将它从 Hub 和所有受管 Agent 中删除。" })}
                  >
                    <Trash2 className="h-4 w-4" /> 删除 Skill
                  </Button>
                  <Button disabled={syncAgents.isPending} onClick={() => setSyncDialogOpen(true)}>
                    {syncAgents.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    批量启用
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading && <LoadingState text={copy.agents.loadingInventory} />}
              {error && <ErrorState text={getErrorMessage(error)} onRetry={() => void Promise.all([scan.refetch(), statuses.refetch()])} />}
              {!loading && !error && (
                <div className="grid gap-3 md:grid-cols-4">
                  {overview.summaries.map((summary) => (
                    <ToolSummaryCard
                      key={summary.agent}
                      summary={summary}
                      onInspect={(kind) => setSkillDialog({
                        kind,
                        agent: summary.agent,
                        title: `${agentLabel(summary.agent)} · ${kind === "enabled" ? "已启用" : kind === "missing" ? "待启用" : "冲突"}`,
                        description: `仅展示 ${agentLabel(summary.agent)} 的对应 Skill，列表按 6 项分页。`,
                      })}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {mode === "migration" && (
        <div className="min-h-0 flex-1">
          <Card className="h-full">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>待纳管 Skill</CardTitle>
                  <CardDescription>点击任意数字查看分页明细；“外部链接”表示指向 Hub 之外目录的符号链接。</CardDescription>
                </div>
                <Button disabled={!migratableAgents.length || migrate.isPending} onClick={() => setMigrateTarget(migratableAgents)}>
                  {migrate.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  全部纳管
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading && <LoadingState text={copy.agents.loadingInventory} />}
              {error && <ErrorState text={getErrorMessage(error)} onRetry={() => void Promise.all([scan.refetch(), statuses.refetch()])} />}
              {!loading && !error && (
                <div className="grid gap-3 md:grid-cols-4">
                  {summaries.map((summary) => (
                    <MigrationSummaryCard
                      key={summary.agent}
                      summary={summary}
                      loading={migrate.isPending}
                      onMigrate={() => setMigrateTarget([summary.agent])}
                      onInspect={(kind) => setSkillDialog({
                        kind,
                        agent: summary.agent,
                        title: `${agentLabel(summary.agent)} · ${kind === "inventory" ? "全部发现" : kind === "managed" ? "已在 Hub" : kind === "importable" ? "待纳管" : "外部链接"}`,
                        description: kind === "external"
                          ? "这些 Skill 是指向 Hub 之外目录的符号链接，不会被自动迁移。"
                          : `查看 ${agentLabel(summary.agent)} 对应状态的 Skill。`,
                      })}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {mode === "agent-inventory" && (
        <Card className="min-h-0 flex-1">
          <CardHeader>
            <CardTitle>目录诊断</CardTitle>
            <CardDescription>点击 Agent 卡片查看分页目录明细，不在主页面展开文件列表。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            {scan.isLoading && <div className="md:col-span-4"><LoadingState text={copy.agents.loadingInventory} /></div>}
            {scan.isError && <div className="md:col-span-4"><ErrorState text={getErrorMessage(scan.error)} onRetry={() => void scan.refetch()} /></div>}
            {!scan.isLoading && !scan.isError && visibleInventory.map((group) => (
              <DirectorySummaryCard
                key={group.agent}
                agent={group.agent}
                skillsDir={group.skillsDir}
                skills={group.skills}
                externalCount={summaries.find((summary) => summary.agent === group.agent)?.externalCount ?? 0}
                onInspect={() => setSkillDialog({
                  kind: "inventory",
                  agent: group.agent,
                  title: `${agentLabel(group.agent)} · 目录明细`,
                  description: group.skillsDir,
                })}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <PagedSkillDialog
        state={skillDialog}
        items={dialogItems}
        onOpenChange={(open) => !open && setSkillDialog(null)}
        onOpenPath={(path) => void api.openPath(path)}
        actionLabel={(item) => {
          if (skillDialog?.kind === "hub") return "全部删除";
          if (skillDialog?.kind === "missing") return "启用";
          if (skillDialog?.kind === "enabled") return "停用";
          if (skillDialog?.kind === "conflict") return "处理冲突";
          if (skillDialog?.kind === "importable") return "纳管该 Agent";
          return null;
        }}
        actionVariant={() => skillDialog?.kind === "hub" ? "destructive" : "default"}
        onAction={(item) => {
          if (!skillDialog || !item.skillName) return;
          if (skillDialog.kind === "hub") {
            setSkillDialog(null);
            setRemoveHubTarget(item.skillName);
            return;
          }
          if (!item.agent) return;
          if (skillDialog.kind === "missing" || skillDialog.kind === "enabled") {
            linkSkill.mutate({ skillName: item.skillName, agent: item.agent, status: item.status });
            return;
          }
          if (skillDialog.kind === "conflict") {
            const conflict = overview.conflicts.find((value) => value.skillName === item.skillName && value.agent === item.agent);
            if (conflict) {
              setSkillDialog(null);
              setTakeoverTarget(conflict);
            }
            return;
          }
          if (skillDialog.kind === "importable") {
            setSkillDialog(null);
            setMigrateTarget([item.agent]);
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(removeHubTarget)}
        title="从统一管理中删除 Skill？"
        description={`${removeHubTarget ?? ""} · ${copy.hub.removeConfirm}`}
        confirmLabel="全部删除"
        cancelLabel={copy.remotes.cancel}
        loading={removeHubSkill.isPending}
        onOpenChange={(open) => !open && setRemoveHubTarget(null)}
        onConfirm={() => removeHubTarget && removeHubSkill.mutate(removeHubTarget)}
      />
      <SyncAgentsDialog
        open={syncDialogOpen}
        loading={syncAgents.isPending}
        defaultAgents={AGENTS.filter((agent) => overview.summaries.some((summary) => summary.agent === agent && (summary.missing > 0 || summary.conflicts > 0)))}
        summaries={overview.summaries}
        onOpenChange={setSyncDialogOpen}
        onConfirm={(agents) => syncAgents.mutate(agents)}
      />
      <ConfirmDialog
        open={Boolean(migrateTarget)}
        title={copy.agents.migrateConfirmTitle}
        description={`${migrateTarget?.map(agentLabel).join(", ") ?? ""} · ${copy.agents.migrateConfirmDescription}`}
        confirmLabel={migrateTarget && migrateTarget.length > 1 ? copy.agents.migrateAll : `${copy.agents.migrate} ${migrateTarget?.[0] ? agentLabel(migrateTarget[0]) : ""}`}
        cancelLabel={copy.remotes.cancel}
        loading={migrate.isPending}
        onOpenChange={(nextOpen) => !nextOpen && setMigrateTarget(null)}
        onConfirm={() => migrateTarget && migrate.mutate(migrateTarget)}
      />
      <ConfirmDialog
        open={Boolean(takeoverTarget)}
        title={copy.agents.takeoverTitle}
        description={`${takeoverTarget?.skillName ?? ""} → ${takeoverTarget ? agentLabel(takeoverTarget.agent) : ""} · ${copy.agents.takeoverDescription}`}
        confirmLabel={copy.agents.takeover}
        cancelLabel={copy.remotes.cancel}
        loading={takeover.isPending}
        onOpenChange={(nextOpen) => !nextOpen && setTakeoverTarget(null)}
        onConfirm={() => takeoverTarget && takeover.mutate(takeoverTarget)}
      />
      <ConfirmDialog
        open={Boolean(removeAgentTarget)}
        title="移除 Agent 侧 Skill？"
        description={`${removeAgentTarget?.skillName ?? ""} · ${removeAgentTarget ? agentLabel(removeAgentTarget.agent) : ""} · 真实目录会移动到备份目录，symlink 会直接移除。`}
        confirmLabel="移除"
        cancelLabel={copy.remotes.cancel}
        loading={removeAgentSkill.isPending}
        onOpenChange={(nextOpen) => !nextOpen && setRemoveAgentTarget(null)}
        onConfirm={() => removeAgentTarget && removeAgentSkill.mutate(removeAgentTarget)}
      />
    </PageShell>
  );
}


function MigrationSummaryCard({
  summary,
  loading,
  onMigrate,
  onInspect,
}: {
  summary: MigrationSummary;
  loading: boolean;
  onMigrate: () => void;
  onInspect: (kind: "inventory" | "managed" | "importable" | "external") => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold">
          <AgentIcon agent={summary.agent} size={20} />
          {agentLabel(summary.agent)}
        </div>
        <Badge>{summary.migratableCount > 0 ? `${summary.migratableCount} 待纳管` : copy.agents.noMigratable}</Badge>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        <button className="metric-button bg-muted" onClick={() => onInspect("inventory")}>
          <div className="text-lg font-semibold">{summary.totalCount}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{copy.agents.totalSkills}</div>
        </button>
        <button className="metric-button bg-muted" onClick={() => onInspect("managed")}>
          <div className="text-lg font-semibold">{summary.inHubCount}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{copy.agents.inHub}</div>
        </button>
        <button className="metric-button bg-emerald-50 text-emerald-800" onClick={() => onInspect("importable")}>
          <div className="text-lg font-semibold">{summary.migratableCount}</div>
          <div className="mt-0.5 text-[11px] text-emerald-700">{copy.agents.migratable}</div>
        </button>
        <button className="metric-button bg-blue-50 text-blue-800" onClick={() => onInspect("external")}>
          <div className="text-lg font-semibold">{summary.externalCount}</div>
          <div className="mt-0.5 text-[11px] text-blue-700">外部链接</div>
        </button>
      </div>
      <Button className="mt-3 w-full" variant={summary.migratableCount > 0 ? "default" : "secondary"} disabled={!summary.migratableCount || loading} onClick={onMigrate}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {copy.agents.migrate} {agentLabel(summary.agent)}
      </Button>
    </div>
  );
}

function ImportableHint({
  skills,
  onOpen,
  onViewAll,
}: {
  skills: ImportableSkillView[];
  onOpen: (path: string) => void;
  onViewAll: () => void;
}) {
  return (
    <div className="m-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium text-emerald-900">搜到了未导入的工具技能</div>
          <div className="mt-1 text-sm text-emerald-800">它们还不在技能库里，导入后才会出现在这里并支持启用管理。</div>
        </div>
        <Button size="sm" onClick={onViewAll}>查看可导入</Button>
      </div>
      <div className="mt-3 overflow-hidden rounded-lg border border-emerald-100 bg-background">
        {skills.slice(0, 5).map((skill) => (
          <button key={`${skill.agent}-${skill.path}`} className="list-row w-full text-left" onClick={() => onOpen(skill.path)}>
            <div className="flex items-center gap-2 font-medium">
              <AgentIcon agent={skill.agent} size={16} />
              {skill.name}
              <Badge>{agentLabel(skill.agent)}</Badge>
            </div>
            <div className="mt-1 muted-path">{skill.path}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ImportableSkillRow({
  skill,
  loading,
  onOpen,
  onMigrate,
}: {
  skill: ImportableSkillView;
  loading?: boolean;
  onOpen: () => void;
  onMigrate: () => void;
}) {
  return (
    <div className="list-row flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium">
          <AgentIcon agent={skill.agent} size={16} />
          {skill.name}
          <Badge>{agentLabel(skill.agent)}</Badge>
        </div>
        <div className="skill-description" title={skill.description ?? copy.hub.noDescription}>{skill.description || copy.hub.noDescription}</div>
        <div className="mt-1 muted-path">{skill.path}</div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="secondary" onClick={onOpen}>
          <ExternalLink className="h-4 w-4" /> 打开目录
        </Button>
        <Button size="sm" disabled={loading} onClick={onMigrate}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          纳管
        </Button>
      </div>
    </div>
  );
}

function ToolSummaryCard({
  summary,
  onInspect,
}: {
  summary: { agent: AgentKind; total: number; enabled: number; missing: number; conflicts: number };
  onInspect: (kind: "enabled" | "missing" | "conflict") => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="mb-3 flex items-center gap-2 font-semibold">
        <AgentIcon agent={summary.agent} size={18} />
        {agentLabel(summary.agent)}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <button className="metric-button bg-emerald-50 text-emerald-800" onClick={() => onInspect("enabled")}>
          <div className="text-lg font-semibold">{summary.enabled}</div>
          <div className="mt-0.5 text-[11px] text-emerald-700">已启用</div>
        </button>
        <button className="metric-button bg-muted" onClick={() => onInspect("missing")}>
          <div className="text-lg font-semibold">{summary.missing}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{copy.agents.missing}</div>
        </button>
        <button className="metric-button bg-red-50 text-red-700" onClick={() => onInspect("conflict")}>
          <div className="text-lg font-semibold">{summary.conflicts}</div>
          <div className="mt-0.5 text-[11px] text-red-700">{copy.dashboard.conflicts}</div>
        </button>
      </div>
    </div>
  );
}

function ConflictRow({
  conflict,
  loading,
  onOpen,
  onKeep,
  onTakeover,
}: {
  conflict: ToolConflictView;
  loading?: boolean;
  onOpen: () => void;
  onKeep: () => void;
  onTakeover: () => void;
}) {
  return (
    <div className="list-row flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium">
          <AgentIcon agent={conflict.agent} size={16} />
          {conflict.displayName}
          <Badge>{agentLabel(conflict.agent)}</Badge>
        </div>
        <div className="mt-1 muted-path">{conflict.path}</div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="secondary" onClick={onOpen}>
          <ExternalLink className="h-4 w-4" /> {copy.agents.openConflict}
        </Button>
        <Button size="sm" variant="secondary" onClick={onKeep}>
          {copy.agents.keepConflict}
        </Button>
        <Button size="sm" disabled={loading} onClick={onTakeover}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {copy.agents.takeover}
        </Button>
      </div>
    </div>
  );
}

function AgentInventoryGroup({
  agent,
  skillsDir,
  skills,
  removingSkillName,
  onRemove,
}: {
  agent: AgentKind;
  skillsDir: string;
  skills: SkillInfo[];
  removingSkillName?: string | null;
  onRemove: (skill: SkillInfo) => void;
}) {
  const { showToast } = useToast();
  const openLocalPath = (path: string) => {
    void api.openPath(path).catch((error: unknown) => {
      showToast({ tone: "error", title: "打开失败", description: getErrorMessage(error) });
    });
  };

  return (
    <div className="content-card overflow-hidden">
      <button
        className="flex w-full items-start justify-between gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted"
        onClick={() => openLocalPath(skillsDir)}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold">
            <AgentIcon agent={agent} size={18} />
            {agentLabel(agent)}
          </div>
          <div className="muted-path mt-1">{skillsDir}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{skills.length} 个</Badge>
          <ExternalLink className="h-4 w-4 text-muted-foreground" />
        </div>
      </button>
      {skills.map((skill) => (
        <div key={`${agent}-${skill.path}`} className="list-row">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium">
                {skill.name}
                {(skill.isSymlink ?? skill.is_symlink) && <Badge>{copy.common.symlink}</Badge>}
              </div>
              <div className="skill-description" title={skill.description ?? copy.hub.noDescription}>{skill.description || copy.hub.noDescription}</div>
              <div className="mt-1 muted-path">{skill.path}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusDot tone={(skill.isSymlink ?? skill.is_symlink) ? "success" : "muted"} />
              <Button size="sm" variant="secondary" onClick={() => openLocalPath(skill.path)}>
                <ExternalLink className="h-4 w-4" /> 打开
              </Button>
              <Button size="sm" variant="destructive" disabled={removingSkillName === dirName(skill)} onClick={() => onRemove(skill)}>
                {removingSkillName === dirName(skill) && <Loader2 className="h-4 w-4 animate-spin" />}
                移除
              </Button>
            </div>
          </div>
        </div>
      ))}
      {!skills.length && <EmptyState text={copy.agents.inventoryEmpty} />}
    </div>
  );
}

function DirectorySummaryCard({
  agent,
  skillsDir,
  skills,
  externalCount,
  onInspect,
}: {
  agent: AgentKind;
  skillsDir: string;
  skills: SkillInfo[];
  externalCount: number;
  onInspect: () => void;
}) {
  const linkedCount = skills.filter((skill) => skill.isSymlink ?? skill.is_symlink).length;
  const realCount = skills.length - linkedCount;
  return (
    <button className="rounded-xl border border-border bg-background p-4 text-left transition-all hover:-translate-y-px hover:border-emerald-300 hover:shadow-sm" onClick={onInspect}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold"><AgentIcon agent={agent} size={20} /> {agentLabel(agent)}</div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 muted-path">{skillsDir}</div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted px-2 py-2"><div className="text-lg font-semibold">{skills.length}</div><div className="text-[11px] text-muted-foreground">全部</div></div>
        <div className="rounded-lg bg-emerald-50 px-2 py-2 text-emerald-800"><div className="text-lg font-semibold">{linkedCount}</div><div className="text-[11px] text-emerald-700">符号链接</div></div>
        <div className="rounded-lg bg-blue-50 px-2 py-2 text-blue-800"><div className="text-lg font-semibold">{realCount}</div><div className="text-[11px] text-blue-700">真实目录</div></div>
      </div>
      {externalCount > 0 && <div className="mt-3 flex items-center gap-1.5 text-xs text-blue-700"><Link2 className="h-3.5 w-3.5" /> {externalCount} 个外部链接</div>}
    </button>
  );
}

function RemotesPage() {
  const queryClient = useQueryClient();
  const { showToast, updateToast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedRemote, setSelectedRemote] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<import("@/lib/api").RemoteHost | null>(null);
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [remoteRemoveTarget, setRemoteRemoveTarget] = useState<RemoteSkillActionTarget | null>(null);
  const [localSourceAgent, setLocalSourceAgent] = useState<AgentKind>("codex");
  const [localSkillQuery, setLocalSkillQuery] = useState("");
  const [tools, setTools] = useState<AgentKind[]>([]);
  const availabilityRemote = useRef<string | null>(null);
  const remotes = useQuery({ queryKey: ["remotes"], queryFn: api.listRemotes, retry: false });
  const localScan = useQuery({ queryKey: ["scan-all"], queryFn: api.scanAll, retry: false });
  const preferences = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences, retry: false });
  const method = getDefaultSyncMethod(preferences.data);
  const localSourceSkills = useMemo(
    () => localScan.data?.agents.find((group) => group.agent === localSourceAgent)?.skills ?? [],
    [localScan.data, localSourceAgent],
  );
  const connectionQueries = useRemoteConnectionQueries(remotes.data ?? []);
  const connectionByName = useMemo(() => {
    const map = new Map<string, (typeof connectionQueries)[number]>();
    (remotes.data ?? []).forEach((remote, index) => map.set(remote.name, connectionQueries[index]));
    return map;
  }, [connectionQueries, remotes.data]);
  const remoteStatus = useQuery({
    queryKey: ["remote-list", selectedRemote],
    queryFn: () => api.remoteList({ name: selectedRemote ?? "", tools: [...AGENTS] }),
    enabled: Boolean(selectedRemote),
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const invalidateRemoteStatus = (remoteName = selectedRemote) =>
    remoteName ? queryClient.invalidateQueries({ queryKey: ["remote-list", remoteName] }) : Promise.resolve();
  const refreshRemoteStatus = async () => {
    if (!selectedRemote) return;
    const toastId = showToast({ tone: "loading", title: copy.remotes.listing, description: selectedRemote });
    const result = await remoteStatus.refetch();
    if (result.error) {
      updateToast(toastId, { tone: "error", title: copy.remotes.listFailed, description: getErrorMessage(result.error) });
      return;
    }
    updateToast(toastId, { tone: "success", title: copy.remotes.listSuccess, description: selectedRemote });
  };
  const availableAgents = useMemo(
    () => (remoteStatus.data?.agents ?? []).filter((agent) => agent.available).map((agent) => agent.agent),
    [remoteStatus.data],
  );
  const visibleRemoteStatuses = useMemo(
    () => (remoteStatus.data?.statuses ?? []).filter((status) => tools.includes(status.agent)),
    [remoteStatus.data, tools],
  );

  useEffect(() => {
    if (!selectedRemote || !remoteStatus.data) return;
    const initializingRemote = availabilityRemote.current !== selectedRemote;
    availabilityRemote.current = selectedRemote;
    setTools((current) => initializingRemote ? availableAgents : current.filter((agent) => availableAgents.includes(agent)));
  }, [availableAgents, remoteStatus.data, selectedRemote]);

  const remoteSync = useMutation<Awaited<ReturnType<typeof api.remoteSync>>, Error, AgentKind[] | undefined, string>({
    mutationFn: (targetTools) => api.remoteSync({ name: selectedRemote ?? "", tools: targetTools ?? tools, syncMethod: method }),
    onMutate: (targetTools) => showToast({ tone: "loading", title: copy.remotes.syncing, description: `${selectedRemote ?? ""} · ${(targetTools ?? tools).map(agentLabel).join(", ")}` }),
    onSuccess: (plan, targetTools, toastId) => {
      setSyncConfirmOpen(false);
      updateToast(toastId, { tone: "success", title: copy.remotes.syncSuccess, description: `${plan.commands.length} 条命令已执行。` });
      void invalidateRemoteStatus(plan.remote.name);
    },
    onError: (error, _variables, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: copy.remotes.syncFailed, description: getErrorMessage(error) });
    },
  });
  const remoteSyncSkill = useMutation<Awaited<ReturnType<typeof api.remoteSyncSkill>>, Error, RemoteSkillActionTarget, string>({
    mutationFn: (target) => api.remoteSyncSkill({ name: target.remoteName, agent: target.agent, skillName: target.skillName, syncMethod: method }),
    onMutate: (target) => showToast({ tone: "loading", title: "正在同步单个远程 Skill…", description: `${target.skillName} · ${agentLabel(target.agent)}` }),
    onSuccess: (result, target, toastId) => {
      const isConflict = result.status === "conflict";
      updateToast(toastId, {
        tone: isConflict ? "error" : "success",
        title: isConflict ? copy.agents.conflictTip : "远程 Skill 已同步",
        description: result.reason ?? `${target.skillName} · ${agentLabel(target.agent)} · ${statusLabel(result.status)}`,
      });
      void invalidateRemoteStatus(target.remoteName);
    },
    onError: (error, target, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: "远程 Skill 同步失败", description: `${target.skillName} · ${getErrorMessage(error)}` });
    },
  });
  const remoteSyncLocalAgentSkill = useMutation<Awaited<ReturnType<typeof api.remoteSyncLocalAgentSkill>>[], Error, RemoteLocalSkillSyncTarget, string>({
    mutationFn: async (target) => {
      const results = [];
      for (const targetAgent of target.targetAgents) {
        results.push(await api.remoteSyncLocalAgentSkill({
          name: target.remoteName,
          sourceAgent: target.sourceAgent,
          targetAgent,
          skillName: target.skillName,
          syncMethod: method,
        }));
      }
      return results;
    },
    onMutate: (target) =>
      showToast({
        tone: "loading",
        title: "正在传输 Skill…",
        description: `${agentLabel(target.sourceAgent)}:${target.skillName} → ${selectedRemote}`,
      }),
    onSuccess: (results, target, toastId) => {
      const conflicts = results.filter((result) => result.status === "conflict").length;
      updateToast(toastId, {
        tone: conflicts ? "error" : "success",
        title: conflicts ? copy.agents.conflictTip : "Skill 已传输到远端",
        description: `${target.skillName} · ${results.length} 个目标 Agent`,
      });
      setTransferDialogOpen(false);
      void invalidateRemoteStatus(target.remoteName);
    },
    onError: (error, target, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: "Skill 传输失败", description: `${target.skillName} · ${getErrorMessage(error)}` });
    },
  });
  const remoteImportSkill = useMutation<Awaited<ReturnType<typeof api.remoteImportSkill>>, Error, RemoteSkillActionTarget, string>({
    mutationFn: (target) => api.remoteImportSkill({ name: target.remoteName, agent: target.agent, skillName: target.skillName }),
    onMutate: (target) => showToast({ tone: "loading", title: "正在复制远程 Skill…", description: `${target.skillName} · ${agentLabel(target.agent)}` }),
    onSuccess: async (result, target, toastId) => {
      updateToast(toastId, { tone: "success", title: "已复制到本机 Hub", description: result.hubPath ?? result.hub_path ?? target.skillName });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scan-all"] }),
        queryClient.invalidateQueries({ queryKey: ["list-status"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        invalidateRemoteStatus(target.remoteName),
      ]);
    },
    onError: (error, target, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: "远程 Skill 复制失败", description: `${target.skillName} · ${getErrorMessage(error)}` });
    },
  });
  const remoteRemoveSkill = useMutation<Awaited<ReturnType<typeof api.remoteRemoveSkill>>, Error, RemoteSkillActionTarget, string>({
    mutationFn: (target) => api.remoteRemoveSkill({ name: target.remoteName, agent: target.agent, skillName: target.skillName }),
    onMutate: (target) => showToast({ tone: "loading", title: "正在移除远程 Skill…", description: `${target.skillName} · ${agentLabel(target.agent)}` }),
    onSuccess: (result, target, toastId) => {
      setRemoteRemoveTarget(null);
      updateToast(toastId, { tone: "success", title: "远程 Skill 已移除", description: result.backupPath ?? result.backup_path ?? target.skillName });
      void invalidateRemoteStatus(target.remoteName);
    },
    onError: (error, target, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: "远程 Skill 移除失败", description: `${target.skillName} · ${getErrorMessage(error)}` });
    },
  });
  const removeRemote = useMutation<Awaited<ReturnType<typeof api.removeRemote>>, Error, string, string>({
    mutationFn: (name) => api.removeRemote(name),
    onMutate: (name) => showToast({ tone: "loading", title: copy.remotes.deleting, description: name }),
    onSuccess: async (_result, name, toastId) => {
      if (selectedRemote === name) setSelectedRemote(null);
      setDeleteTarget(null);
      updateToast(toastId, { tone: "success", title: copy.remotes.deleteSuccess, description: name });
      await queryClient.invalidateQueries({ queryKey: ["remotes"] });
      queryClient.removeQueries({ queryKey: ["remote-connection", name] });
      queryClient.removeQueries({ queryKey: ["remote-list", name] });
    },
    onError: (error, _name, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: copy.remotes.deleteFailed, description: getErrorMessage(error) });
    },
  });

  useEffect(() => {
    if (selectedRemote || remotes.isLoading || remotes.isError) return;
    const first = remotes.data?.[0];
    if (first) {
      setTools([]);
      setSelectedRemote(first.name);
    }
  }, [selectedRemote, remotes.data, remotes.isError, remotes.isLoading]);

  return (
    <PageShell fixed title={copy.remotes.title} subtitle={copy.remotes.subtitle} actions={<AddRemoteDialog open={open} onOpenChange={setOpen} />}>
      <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] gap-4">
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="shrink-0">
            <CardTitle>{copy.remotes.registered}</CardTitle>
            <CardDescription>{copy.remotes.cardDescription}</CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto p-0">
            {remotes.isLoading && <LoadingState text={copy.common.loading} />}
            {remotes.isError && <ErrorState text={getErrorMessage(remotes.error)} onRetry={() => void remotes.refetch()} />}
            {!remotes.isLoading &&
              !remotes.isError &&
              (remotes.data ?? []).map((remote) => {
                const connection = connectionByName.get(remote.name);
                return (
                  <div key={remote.name} className={cn("list-row", selectedRemote === remote.name && "list-row-selected")}>
                    <button
                      className="w-full text-left"
                      onClick={() => {
                        setTools([]);
                        setSelectedRemote(remote.name);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 font-medium">
                          <RemoteIcon size={16} />
                          <RemoteConnectionDot query={connection} />
                          {remote.name}
                        </span>
                        <div className="flex items-center gap-2">
                          <RemoteConnectionIndicator query={connection} />
                          <span
                            role="button"
                            tabIndex={0}
                            className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background hover:text-destructive"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleteTarget(remote);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.stopPropagation();
                                setDeleteTarget(remote);
                              }
                            }}
                          >
                            {copy.remotes.delete}
                          </span>
                        </div>
                      </div>
                      <div className="mt-1 muted-path">{remoteTargetLabel(remote)}</div>
                    </button>
                  </div>
                );
              })}
            {!remotes.isLoading && !remotes.isError && !remotes.data?.length && <EmptyState text={copy.remotes.empty} />}
          </CardContent>
        </Card>
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>{selectedRemote ? `远程：${selectedRemote}` : copy.remotes.cardTitle}</CardTitle>
                <CardDescription>远端 Hub 与本机 Hub 对比 · 同步方式：{syncMethodLabel(method)}</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={!selectedRemote || !tools.length || remoteStatus.isLoading} onClick={() => setTransferDialogOpen(true)}>传输 Skill</Button>
                <Button variant="secondary" disabled={!selectedRemote || remoteStatus.isFetching} onClick={() => void refreshRemoteStatus()}>
                  {remoteStatus.isFetching && <Loader2 className="h-4 w-4 animate-spin" />}
                  刷新状态
                </Button>
                <Button disabled={!selectedRemote || remoteSync.isPending || !tools.length || remoteStatus.isLoading} onClick={() => setSyncConfirmOpen(true)}>
                  {remoteSync.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  同步到远程
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {AGENTS.map((tool) => (
                <span
                  key={tool}
                  title={remoteStatus.data && !availableAgents.includes(tool) ? "暂未发现该Agent的配置文件" : undefined}
                  className="inline-flex"
                >
                  <TogglePill
                    active={tools.includes(tool)}
                    disabled={Boolean(remoteStatus.data) && !availableAgents.includes(tool)}
                    onClick={() => setTools(toggleValue(tools, tool))}
                  >
                    <span className="inline-flex items-center gap-1.5"><AgentIcon agent={tool} size={14} /> {agentLabel(tool)}</span>
                  </TogglePill>
                </span>
              ))}
            </div>
            {remoteStatus.isLoading ? (
              <LoadingState text={copy.remotes.listing} />
            ) : remoteStatus.isError ? (
              <ErrorState text={getErrorMessage(remoteStatus.error)} onRetry={() => void refreshRemoteStatus()} />
            ) : !tools.length ? (
              <EmptyState text={remoteStatus.data ? "请选择可用的远程 Agent。" : "请选择远程设备。"} />
            ) : remoteStatus.data ? (
              <RemoteCompareResult
                statuses={visibleRemoteStatuses}
                selectedRemote={selectedRemote}
                syncingAgents={remoteSync.isPending ? remoteSync.variables ?? tools : null}
                syncingSkill={remoteSyncSkill.isPending ? remoteSyncSkill.variables : null}
                importing={remoteImportSkill.isPending ? remoteImportSkill.variables : null}
                removing={remoteRemoveSkill.isPending ? remoteRemoveSkill.variables : null}
                onSyncSkill={(target) => remoteSyncSkill.mutate(target)}
                onImport={(target) => remoteImportSkill.mutate(target)}
                onRemove={(target) => setRemoteRemoveTarget(target)}
              />
            ) : (
              <EmptyState text={selectedRemote ? "正在读取远端 Hub，并与本机统一技能库对比。" : copy.remotes.empty} />
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={copy.remotes.deleteConfirmTitle}
        description={`${deleteTarget?.name ?? ""} · ${copy.remotes.deleteConfirmDescription}`}
        confirmLabel={copy.remotes.deleteConfirmAction}
        cancelLabel={copy.remotes.cancel}
        loading={removeRemote.isPending}
        onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}
        onConfirm={() => deleteTarget && removeRemote.mutate(deleteTarget.name)}
      />
      <RemoteSyncConfirmDialog
        open={syncConfirmOpen}
        remoteName={selectedRemote}
        tools={tools}
        statuses={visibleRemoteStatuses}
        loading={remoteSync.isPending}
        onOpenChange={setSyncConfirmOpen}
        onConfirm={() => remoteSync.mutate(tools)}
      />
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="w-[min(92vw,860px)]">
          <DialogHeader>
            <DialogTitle>传输 Skill 到 {selectedRemote}</DialogTitle>
            <DialogDescription>从本机任一 Agent 目录选择 Skill。传输时会写入远端 ~/.agents/skills，再启用到所选远端 Agent。</DialogDescription>
          </DialogHeader>
          <RemoteLocalAgentSkillPanel
            sourceAgent={localSourceAgent}
            sourceSkills={localSourceSkills}
            query={localSkillQuery}
            targetAgents={tools}
            selectedRemote={selectedRemote}
            loading={localScan.isLoading}
            error={localScan.error}
            syncing={remoteSyncLocalAgentSkill.isPending ? remoteSyncLocalAgentSkill.variables : null}
            onRetry={() => void localScan.refetch()}
            onSourceAgentChange={setLocalSourceAgent}
            onQueryChange={setLocalSkillQuery}
            onSync={(skill) => {
              if (!selectedRemote || !tools.length) return;
              remoteSyncLocalAgentSkill.mutate({
                remoteName: selectedRemote,
                sourceAgent: localSourceAgent,
                targetAgents: tools,
                skillName: dirName(skill),
              });
            }}
          />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(remoteRemoveTarget)}
        title="移除远程 Agent 侧 Skill？"
        description={`${remoteRemoveTarget?.skillName ?? ""} · ${remoteRemoveTarget ? agentLabel(remoteRemoveTarget.agent) : ""} · 真实目录会移动到远端 ~/.agents/skills-hub-backups，symlink 会直接移除。`}
        confirmLabel="移除远端 Skill"
        cancelLabel={copy.remotes.cancel}
        loading={remoteRemoveSkill.isPending}
        onOpenChange={(nextOpen) => !nextOpen && setRemoteRemoveTarget(null)}
        onConfirm={() => remoteRemoveTarget && remoteRemoveSkill.mutate(remoteRemoveTarget)}
      />
    </PageShell>
  );
}

function AddRemoteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { showToast, updateToast } = useToast();
  const [mode, setMode] = useState<"config" | "manual">("config");
  const [selectedAliases, setSelectedAliases] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("");
  const sshHosts = useQuery({ queryKey: ["ssh-hosts"], queryFn: api.discoverSshHosts, retry: false, enabled: open });
  const addOne = useMutation<Awaited<ReturnType<typeof api.addRemote>>, Error, { name?: string; host: string; user?: string; port?: number }, string>({
    mutationFn: (input) => api.addRemote(input),
    onMutate: (input) => showToast({ tone: "loading", title: copy.remotes.adding, description: input.host }),
    onSuccess: async (remote, _variables, toastId) => {
      updateToast(toastId, { tone: "success", title: copy.remotes.addSuccess, description: remote.name });
      await queryClient.invalidateQueries({ queryKey: ["remotes"] });
      await queryClient.invalidateQueries({ queryKey: ["ssh-hosts"] });
      await queryClient.invalidateQueries({ queryKey: ["remote-connection", remote.name] });
    },
    onError: (error, _variables, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: copy.remotes.addFailed, description: getErrorMessage(error) });
    },
  });

  const resetAndClose = () => {
    setName("");
    setHost("");
    setUser("");
    setPort("");
    setSelectedAliases([]);
    onOpenChange(false);
  };

  const addSelectedHosts = async () => {
    const hosts = sshHosts.data?.filter((item) => selectedAliases.includes(item.alias)) ?? [];
    for (const item of hosts) {
      await addOne.mutateAsync({ name: item.alias, host: item.alias });
    }
    resetAndClose();
  };

  const addManual = async () => {
    const trimmedHost = host.trim();
    if (!trimmedHost) return;
    await addOne.mutateAsync({
      name: name.trim() || trimmedHost,
      host: trimmedHost,
      user: user.trim() || undefined,
      port: port.trim() ? Number(port) : undefined,
    });
    resetAndClose();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4" /> {copy.remotes.add}</Button>
      </DialogTrigger>
      <DialogContent className="w-[min(92vw,720px)]">
        <DialogHeader>
          <DialogTitle>{copy.remotes.add}</DialogTitle>
          <DialogDescription>{copy.remotes.cardDescription}</DialogDescription>
        </DialogHeader>
        <div className="mb-4 segmented-control">
          <button className={cn("segmented-item", mode === "config" && "segmented-item-active")} onClick={() => setMode("config")}>{copy.remotes.addFromConfig}</button>
          <button className={cn("segmented-item", mode === "manual" && "segmented-item-active")} onClick={() => setMode("manual")}>{copy.remotes.addManual}</button>
        </div>
        {mode === "config" ? (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-semibold">{copy.remotes.sshConfigTitle}</div>
              <div className="mt-1 text-sm text-muted-foreground">{copy.remotes.sshConfigDescription}</div>
            </div>
            {sshHosts.isLoading && <LoadingState text={copy.common.loading} />}
            {sshHosts.isError && <ErrorState text={getErrorMessage(sshHosts.error)} onRetry={() => void sshHosts.refetch()} />}
            {!sshHosts.isLoading && !sshHosts.isError && Boolean(sshHosts.data?.length) && (
              <div className="overflow-hidden rounded-lg border border-border">
                {sshHosts.data?.map((item) => (
                  <SshHostSelectRow
                    key={item.alias}
                    host={item}
                    checked={selectedAliases.includes(item.alias)}
                    onCheckedChange={(checked) => setSelectedAliases(checked ? [...selectedAliases, item.alias] : selectedAliases.filter((alias) => alias !== item.alias))}
                  />
                ))}
              </div>
            )}
            {!sshHosts.isLoading && !sshHosts.isError && !sshHosts.data?.length && <EmptyState text={copy.remotes.noSshHosts} />}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={resetAndClose}>{copy.remotes.cancel}</Button>
              <Button disabled={!selectedAliases.length || addOne.isPending} onClick={() => void addSelectedHosts()}>
                {addOne.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {copy.remotes.add}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={copy.remotes.displayName} />
            <Input value={host} onChange={(event) => setHost(event.target.value)} placeholder={copy.remotes.hostPlaceholder} />
            <Input value={user} onChange={(event) => setUser(event.target.value)} placeholder={copy.remotes.user} />
            <Input value={port} onChange={(event) => setPort(event.target.value)} placeholder={copy.remotes.port} />
            <div className="text-xs leading-5 text-muted-foreground">{copy.remotes.host} 会直接用于 <span className="font-mono">ssh &lt;host&gt;</span>，支持 ~/.ssh/config 中的 Host alias。</div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={resetAndClose}>{copy.remotes.cancel}</Button>
              <Button disabled={!host.trim() || addOne.isPending} onClick={() => void addManual()}>
                {addOne.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {copy.remotes.add}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SshHostSelectRow({ host, checked, onCheckedChange }: { host: DiscoveredSshHost; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <label className={cn("list-row flex cursor-pointer items-center gap-3 hover:bg-muted", host.added && "opacity-60")}>
      <Monitor className="h-4 w-4 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-medium">
          {host.alias}
          {host.added && <Badge>{copy.remotes.enabled}</Badge>}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">{sshHostResolvedLabel(host)}</div>
      </div>
      <input type="checkbox" checked={checked || host.added} disabled={host.added} onChange={(event) => onCheckedChange(event.target.checked)} />
    </label>
  );
}


function SettingsPage() {
  const queryClient = useQueryClient();
  const { showToast, updateToast } = useToast();
  const config = useQuery({ queryKey: ["config"], queryFn: api.initHub });
  const preferences = useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences, retry: false });
  const value = config.data;
  const method = getDefaultSyncMethod(preferences.data);
  const updatePreferences = useMutation<Awaited<ReturnType<typeof api.updatePreferences>>, Error, SyncMethod, string>({
    mutationFn: (defaultSyncMethod) => api.updatePreferences({ defaultSyncMethod }),
    onMutate: (defaultSyncMethod) => showToast({ tone: "loading", title: copy.settings.defaultSyncMethod, description: syncMethodLabel(defaultSyncMethod) }),
    onSuccess: async (_result, _method, toastId) => {
      updateToast(toastId, { tone: "success", title: copy.settings.saveSuccess });
      await queryClient.invalidateQueries({ queryKey: ["preferences"] });
    },
    onError: (error, _method, toastId) => {
      updateToast(toastId ?? "", { tone: "error", title: copy.settings.saveFailed, description: getErrorMessage(error) });
    },
  });
  const rows = [
    [copy.settings.hub, value?.hubDir ?? value?.hub_dir],
    [copy.settings.config, value?.configPath ?? value?.config_path],
    [copy.settings.lock, value?.lockPath ?? value?.lock_path],
    [copy.settings.cache, value?.cacheDir ?? value?.cache_dir],
    [copy.settings.backups, value?.backupsDir ?? value?.backups_dir],
    [copy.settings.logs, value?.logsDir ?? value?.logs_dir],
  ];
  const openPath = (path?: string) => {
    if (!path) return;
    void api.openPath(path).catch((error: unknown) => {
      showToast({ tone: "error", title: "打开失败", description: getErrorMessage(error) });
    });
  };

  return (
    <PageShell title={copy.settings.title} subtitle={copy.settings.subtitle}>
      <Card>
        <CardHeader>
          <CardTitle>{copy.settings.preferences}</CardTitle>
          <CardDescription>{copy.settings.defaultSyncMethodDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          {preferences.isLoading && <LoadingState text={copy.settings.loading} />}
          {preferences.isError && <ErrorState text={getErrorMessage(preferences.error)} onRetry={() => void preferences.refetch()} />}
          {!preferences.isLoading && !preferences.isError && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{copy.settings.defaultSyncMethod}</span>
              {(["auto", "symlink", "copy"] as SyncMethod[]).map((item) => (
                <TogglePill key={item} active={method === item} onClick={() => updatePreferences.mutate(item)}>{syncMethodLabel(item)}</TogglePill>
              ))}
              {updatePreferences.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          {config.isLoading && <LoadingState text={copy.settings.loading} />}
          {config.isError && <ErrorState text={getErrorMessage(config.error)} onRetry={() => void config.refetch()} />}
          {!config.isLoading && !config.isError && rows.map(([label, path]) => (
            <button
              key={label}
              className="list-row grid w-full grid-cols-[120px_1fr_auto] gap-3 text-left"
              disabled={!path}
              onClick={() => openPath(path)}
            >
              <div className="text-sm font-medium">{label}</div>
              <div className="muted-path">{path}</div>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </CardContent>
      </Card>
    </PageShell>
  );
}


function PageShell({ title, subtitle, actions, children, fixed = false }: { title: string; subtitle: string; actions?: React.ReactNode; children: React.ReactNode; fixed?: boolean }) {
  return (
    <div className={cn("mx-auto flex max-w-[1240px] flex-col gap-4", fixed && "h-full min-h-0 overflow-hidden")}>
      <header className="mb-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        {actions && <div className="shrink-0 pt-1">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

function MetricCard({ label, value, icon, onClick }: { label: string; value: number; icon?: React.ReactNode; onClick?: () => void }) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="kicker">{label}</div>
        {onClick ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : icon}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{value}</div>
    </>
  );
  const className = "border-r border-border px-4 py-3 text-left last:border-r-0";
  return onClick ? <button onClick={onClick} className={cn(className, "transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring/20")}>{content}</button> : <div className={className}>{content}</div>;
}

function ActionTile({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group rounded-md border border-border bg-background p-3 text-left transition-colors hover:border-emerald-200 hover:bg-emerald-50/50">
      <Icon className="mb-3 h-4 w-4 text-muted-foreground group-hover:text-[hsl(var(--accent))]" />
      <div className="text-sm font-medium">{label}</div>
    </button>
  );
}

function IssueRow({ icon: Icon, label, value, tone, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; tone: "error" | "muted"; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted/70">
      <div className="flex items-center gap-2 text-sm">
        <Icon className={cn("h-4 w-4", tone === "error" ? "text-destructive" : "text-muted-foreground")} />
        {label}
      </div>
      <span className="font-mono text-sm">{value}</span>
    </button>
  );
}


function RemoteConnectionDot({ query }: { query?: { isFetching: boolean; data?: RemoteConnectionStatus; error?: unknown } }) {
  const connected = query?.data?.status === "connected";
  const message = query?.data?.message ?? (query?.error ? getErrorMessage(query.error) : connected ? copy.remotes.connected : copy.remotes.checking);
  return <span title={message}><StatusDot tone={connected ? "success" : "muted"} /></span>;
}

function RemoteConnectionIndicator({ query }: { query?: { isFetching: boolean; data?: RemoteConnectionStatus; error?: unknown } }) {
  if (query?.data?.status === "connected") return null;
  const message = query?.data?.message ?? (query?.error ? getErrorMessage(query.error) : copy.remotes.checking);
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground" title={message}>
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      监测中
    </span>
  );
}

function RemoteLocalAgentSkillPanel({
  sourceAgent,
  sourceSkills,
  query,
  targetAgents,
  selectedRemote,
  loading,
  error,
  syncing,
  onRetry,
  onSourceAgentChange,
  onQueryChange,
  onSync,
}: {
  sourceAgent: AgentKind;
  sourceSkills: SkillInfo[];
  query: string;
  targetAgents: AgentKind[];
  selectedRemote: string | null;
  loading?: boolean;
  error?: unknown;
  syncing?: RemoteLocalSkillSyncTarget | null;
  onRetry: () => void;
  onSourceAgentChange: (agent: AgentKind) => void;
  onQueryChange: (query: string) => void;
  onSync: (skill: SkillInfo) => void;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSkills = sourceSkills
    .filter((skill) => !normalizedQuery || `${skill.name} ${dirName(skill)} ${skill.description ?? ""}`.toLowerCase().includes(normalizedQuery))
    .slice(0, 8);

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">选择要传输的 Skill</div>
          <div className="mt-1 text-xs text-muted-foreground">
            来源可以是 Hub 链接或尚未纳管的真实目录；目标始终写入远端 Hub，再启用到目标 Agent。
          </div>
        </div>
        <Badge>{targetAgents.length ? `目标 ${targetAgents.map(agentLabel).join(", ")}` : "请选择目标 Agent"}</Badge>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {AGENTS.map((agent) => (
          <TogglePill key={agent} active={sourceAgent === agent} onClick={() => onSourceAgentChange(agent)}>
            <span className="inline-flex items-center gap-1.5"><AgentIcon agent={agent} size={14} /> {agentLabel(agent)}</span>
          </TogglePill>
        ))}
        <div className="min-w-[220px] flex-1">
          <Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索来源 Skill…" />
        </div>
      </div>
      {loading && <LoadingState text="正在读取本机 Agent skills…" />}
      {Boolean(error) && <ErrorState text={getErrorMessage(error)} onRetry={onRetry} />}
      {!loading && !error && (
        <div className="overflow-hidden rounded-lg border border-border">
          {filteredSkills.map((skill) => {
            const skillName = dirName(skill);
            const isSyncing = syncing?.sourceAgent === sourceAgent && syncing.skillName === skillName;
            return (
              <div key={`${sourceAgent}-${skill.path}`} className="list-row flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    {skill.name}
                    {(skill.isSymlink ?? skill.is_symlink) && <Badge>{copy.common.symlink}</Badge>}
                  </div>
                  <div className="skill-description" title={skill.description ?? copy.hub.noDescription}>{skill.description || copy.hub.noDescription}</div>
                  <div className="mt-1 muted-path">{skill.path}</div>
                </div>
                <Button size="sm" disabled={!selectedRemote || !targetAgents.length || isSyncing} onClick={() => onSync(skill)}>
                  {isSyncing && <Loader2 className="h-4 w-4 animate-spin" />}
                  传输到远端
                </Button>
              </div>
            );
          })}
          {!filteredSkills.length && <EmptyState text="这个来源 Agent 下没有匹配的 skill。" />}
        </div>
      )}
    </div>
  );
}

function RemoteCompareResult({
  statuses,
  selectedRemote,
  syncingAgents,
  syncingSkill,
  importing,
  removing,
  onSyncSkill,
  onImport,
  onRemove,
}: {
  statuses: RemoteSkillStatus[];
  selectedRemote: string | null;
  syncingAgents?: AgentKind[] | null;
  syncingSkill?: RemoteSkillActionTarget | null;
  importing?: RemoteSkillActionTarget | null;
  removing?: RemoteSkillActionTarget | null;
  onSyncSkill: (target: RemoteSkillActionTarget) => void;
  onImport: (target: RemoteSkillActionTarget) => void;
  onRemove: (target: RemoteSkillActionTarget) => void;
}) {
  const summary = summarizeRemoteStatuses(statuses);
  if (!statuses.length) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmptyState text={copy.remotes.empty} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid shrink-0 gap-2 md:grid-cols-3">
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
          <div className="text-lg font-semibold">{summary.synced}</div>
          <div className="text-xs text-emerald-700">已同步</div>
        </div>
        <div className="rounded-lg bg-muted px-3 py-2">
          <div className="text-lg font-semibold">{summary.missing}</div>
          <div className="text-xs text-muted-foreground">待同步到远端</div>
        </div>
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
          <div className="text-lg font-semibold">{summary.remoteOnly}</div>
          <div className="text-xs text-amber-700">仅远端</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
        {statuses.map((status) => {
          const skillName = remoteStatusSkillName(status);
          const target = {
            remoteName: selectedRemote ?? "",
            agent: status.agent,
            skillName,
            remotePath: status.remotePath ?? status.remote_path,
          };
          return (
            <RemoteStatusRow
              key={`${status.agent}-${skillName}-${status.status}`}
              status={status}
              target={target}
              syncing={
                Boolean(syncingAgents?.includes(status.agent)) ||
                (syncingSkill?.agent === status.agent && syncingSkill.skillName === skillName)
              }
              importing={importing?.agent === status.agent && importing.skillName === skillName}
              removing={removing?.agent === status.agent && removing.skillName === skillName}
              onSyncSkill={() => onSyncSkill(target)}
              onImport={() => onImport(target)}
              onRemove={() => onRemove(target)}
            />
          );
        })}
      </div>
    </div>
  );
}

function RemoteStatusRow({
  status,
  target,
  syncing,
  importing,
  removing,
  onSyncSkill,
  onImport,
  onRemove,
}: {
  status: RemoteSkillStatus;
  target: RemoteSkillActionTarget;
  syncing?: boolean;
  importing?: boolean;
  removing?: boolean;
  onSyncSkill: () => void;
  onImport: () => void;
  onRemove: () => void;
}) {
  const skillName = remoteStatusSkillName(status);
  const remotePath = status.remotePath ?? status.remote_path;
  return (
    <div className="list-row flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium">
          <AgentIcon agent={status.agent} size={16} />
          {skillName}
          <Badge>{agentLabel(status.agent)}</Badge>
        </div>
        <div className="mt-1 muted-path">{remotePath ?? "远端缺失，等待同步创建"}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge status={status.status} />
        {status.status === "missing" && (
          <Button size="sm" disabled={syncing} onClick={onSyncSkill}>
            {syncing && <Loader2 className="h-4 w-4 animate-spin" />}
            传输到远端
          </Button>
        )}
        {status.status === "synced" && (
          <Button size="sm" variant="secondary" disabled={syncing} onClick={onSyncSkill}>
            {syncing && <Loader2 className="h-4 w-4 animate-spin" />}
            更新远端
          </Button>
        )}
        {status.status === "remote-only" && (
          <Button size="sm" variant="secondary" disabled={importing} onClick={onImport}>
            {importing && <Loader2 className="h-4 w-4 animate-spin" />}
            复制到本机 Hub
          </Button>
        )}
        {remotePath && (
          <Button size="sm" variant="destructive" disabled={removing || !target.remoteName} onClick={onRemove}>
            {removing && <Loader2 className="h-4 w-4 animate-spin" />}
            移除远端
          </Button>
        )}
      </div>
    </div>
  );
}

function RemoteSyncConfirmDialog({
  open,
  remoteName,
  tools,
  statuses,
  loading,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  remoteName: string | null;
  tools: AgentKind[];
  statuses: RemoteSkillStatus[];
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const selectedStatuses = statuses.filter((status) => tools.includes(status.agent));
  const summary = summarizeRemoteStatuses(selectedStatuses);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>同步本机 Hub 到远端？</DialogTitle>
          <DialogDescription>
            {remoteName ? `目标远端：${remoteName}` : "请选择远端设备"}。会先 rsync 本机 hub 到远端 ~/.agents/skills，再在远端启用到所选 Agent；真实同名目录会跳过并进入待处理。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {tools.map((agent) => <Badge key={agent}>{agentLabel(agent)}</Badge>)}
          </div>
          {statuses.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-emerald-50 px-2 py-2 text-emerald-800">
                <div className="text-lg font-semibold">{summary.synced}</div>
                <div className="text-xs">已同步</div>
              </div>
              <div className="rounded-lg bg-muted px-2 py-2">
                <div className="text-lg font-semibold">{summary.missing}</div>
                <div className="text-xs text-muted-foreground">会同步</div>
              </div>
              <div className="rounded-lg bg-amber-50 px-2 py-2 text-amber-800">
                <div className="text-lg font-semibold">{summary.remoteOnly}</div>
                <div className="text-xs">仅远端保留</div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              尚未对比远端状态；仍可直接同步，同步后会刷新对比结果。
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={loading} onClick={() => onOpenChange(false)}>{copy.remotes.cancel}</Button>
          <Button disabled={loading || !remoteName || !tools.length} onClick={onConfirm}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            确认同步
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function summarizeRemoteStatuses(statuses: RemoteSkillStatus[]) {
  return statuses.reduce(
    (summary, status) => {
      if (status.status === "synced") summary.synced += 1;
      if (status.status === "missing") summary.missing += 1;
      if (status.status === "remote-only") summary.remoteOnly += 1;
      return summary;
    },
    { synced: 0, missing: 0, remoteOnly: 0 },
  );
}

function remoteStatusSkillName(status: RemoteSkillStatus) {
  return status.skillName ?? status.skill_name ?? "";
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function SkillListRow({
  row,
  pendingAgent,
  onAgentClick,
  onConflictClick,
  onDetails,
}: {
  row: SkillRowView;
  pendingAgent?: AgentKind | null;
  onAgentClick: (agent: AgentKind, status: string) => void;
  onConflictClick?: (agent: AgentKind) => void;
  onDetails: () => void;
}) {
  const { showToast } = useToast();
  return (
    <div
      role="button"
      tabIndex={0}
      className="list-row flex w-full cursor-pointer items-center gap-4 text-left focus:outline-none focus:ring-2 focus:ring-ring/20"
      onClick={onDetails}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onDetails();
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{row.displayName}</span>
          <span className="text-xs text-muted-foreground">{row.sourceLabel}</span>
        </div>
        <div className="skill-description" title={row.description || copy.hub.noDescription}>{row.description || copy.hub.noDescription}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {AGENTS.map((agent) => {
          const status = agentStatus(row, agent);
          return (
            <AgentStatusButton
              key={agent}
              agent={agent}
              status={status}
              loading={pendingAgent === agent}
              onClick={() => {
                if (status === "conflict") {
                  showToast({ tone: "error", title: copy.agents.conflictTip, description: `${row.displayName} · ${agentLabel(agent)}` });
                  onConflictClick?.(agent) ?? onDetails();
                  return;
                }
                onAgentClick(agent, status);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function AgentStatusButton({ agent, status, loading, onClick }: { agent: AgentKind; status: string; loading?: boolean; onClick: () => void }) {
  const action = status === "conflict" ? copy.hub.detail : status === "linked" || status === "copied" ? copy.agents.alreadySynced : copy.agents.distributeSuccess;
  return (
    <button
      type="button"
      title={`${agentLabel(agent)} · ${statusLabel(status)} · ${action}`}
      className={cn(
        "agent-switch",
        (status === "linked" || status === "copied") && "agent-switch-on",
        status === "conflict" && "agent-switch-conflict",
        (status === "missing" || status === "hub-only") && "agent-switch-off",
        loading && "agent-switch-loading",
      )}
      disabled={loading}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span className="agent-switch-icon"><AgentIcon agent={agent} size={16} /></span>
      <span className="agent-switch-dot" />
      <span className="sr-only">{agentLabel(agent)}</span>
    </button>
  );
}

function useLinkSkillMutation(options: { force?: boolean; dryRun?: boolean; syncMethod?: SyncMethod } = {}) {
  const queryClient = useQueryClient();
  const { showToast, updateToast } = useToast();
  return useMutation<Awaited<ReturnType<typeof api.linkSkillToAgents>>, Error, { skillName: string; agent: AgentKind; status?: string }, string>({
    mutationFn: ({ skillName, agent, status }) => {
      const synced = status === "linked" || status === "copied";
      return synced
        ? api.unlinkSkillFromAgents({
            skillName,
            tools: [agent],
            force: false,
            dryRun: options.dryRun ?? false,
            syncMethod: options.syncMethod ?? "auto",
          })
        : api.linkSkillToAgents({
            skillName,
            tools: [agent],
            force: options.force ?? false,
            dryRun: options.dryRun ?? false,
            syncMethod: options.syncMethod ?? "auto",
          });
    },
    onMutate: ({ skillName, agent, status }) => {
      const synced = status === "linked" || status === "copied";
      return showToast({
        tone: "loading",
        title: synced ? copy.agents.canceling : copy.agents.distributing,
        description: `${skillName} → ${agentLabel(agent)}`,
      });
    },
    onSuccess: async (results, variables, toastId) => {
      const result = results[0];
      const isConflict = result?.status === "conflict";
      const wasSynced = variables.status === "linked" || variables.status === "copied";
      updateToast(toastId, {
        tone: isConflict ? "error" : "success",
        title: isConflict ? copy.agents.conflictTip : wasSynced ? copy.agents.cancelSuccess : copy.agents.distributeSuccess,
        description: result?.reason ?? `${variables.skillName} → ${agentLabel(variables.agent)} · ${statusLabel(result?.status ?? "linked")}`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["list-status"] }),
        queryClient.invalidateQueries({ queryKey: ["scan-all"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error, variables, toastId) => {
      const wasSynced = variables.status === "linked" || variables.status === "copied";
      updateToast(toastId ?? "", {
        tone: "error",
        title: wasSynced ? copy.agents.cancelFailed : copy.agents.distributeFailed,
        description: `${variables.skillName} → ${agentLabel(variables.agent)} · ${getErrorMessage(error)}`,
      });
    },
  });
}

function SkillDetailDrawer({
  skillName,
  removing,
  onClose,
  onRemove,
}: {
  skillName: string;
  removing?: boolean;
  onClose: () => void;
  onRemove: () => void;
}) {
  const { showToast } = useToast();
  const detail = useQuery({ queryKey: ["skill-detail", skillName], queryFn: () => api.getSkillDetail(skillName), retry: false });
  const value = detail.data;
  const path = value?.info.path;

  return (
    <>
      <button className="detail-drawer-overlay" onClick={onClose} aria-label={copy.common.close} />
      <aside className="detail-drawer">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <div className="text-lg font-semibold">{value?.info.name ?? skillName}</div>
            <div className="mt-1 muted-path">{path}</div>
          </div>
          <button className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex gap-2 border-b border-border p-4">
          <Button size="sm" variant="secondary" disabled={!path} onClick={() => path && void api.openPath(path)}>
            <ExternalLink className="h-4 w-4" /> {copy.hub.open}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!path}
            onClick={() => {
              if (!path) return;
              void navigator.clipboard.writeText(path);
              showToast({ tone: "success", title: copy.common.copyPath, description: path });
            }}
          >
            <Copy className="h-4 w-4" /> {copy.common.copyPath}
          </Button>
          <Button size="sm" variant="destructive" disabled={removing} onClick={onRemove}>
            {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {copy.hub.remove}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {detail.isLoading && <LoadingState text={copy.common.loading} />}
          {detail.isError && <ErrorState text={getErrorMessage(detail.error)} onRetry={() => void detail.refetch()} />}
          {value && <SkillDetailContent detail={value} />}
        </div>
      </aside>
    </>
  );
}

function SkillDetailContent({ detail }: { detail: SkillDetail }) {
  const { showToast } = useToast();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const selectedEntry = detail.files.find((file) => file.path === selectedFile);
  const skillKey = dirName(detail.info);
  const filePreview = useQuery({
    queryKey: ["skill-file", skillKey, selectedFile],
    queryFn: () => api.readSkillFile(skillKey, selectedFile ?? ""),
    enabled: Boolean(selectedFile) && !(selectedEntry?.isDir ?? selectedEntry?.is_dir),
    retry: false,
  });
  const openSkillPath = (relativePath: string) => {
    const fullPath = joinPath(detail.info.path, relativePath);
    void api.openPath(fullPath).catch((error: unknown) => {
      showToast({ tone: "error", title: "打开失败", description: getErrorMessage(error) });
    });
  };

  return (
    <div className="space-y-5">
      <section>
        <div className="kicker mb-2">Agent</div>
        <div className="flex flex-wrap gap-2">
          {detail.statuses.map((status) => (
            <AgentStatusButton key={status.agent} agent={status.agent} status={status.status} onClick={() => undefined} />
          ))}
        </div>
      </section>
      <section>
        <div className="kicker mb-2">{copy.hub.detail}</div>
        <p className="text-sm leading-6 text-muted-foreground">{detail.info.description || copy.hub.noDescription}</p>
      </section>
      <section>
        <div className="kicker mb-2">{copy.hub.files}</div>
        <div className="overflow-hidden rounded-lg border border-border">
          {detail.files.slice(0, 80).map((file) => (
            <button
              key={file.path}
              className={cn(
                "flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted",
                selectedFile === file.path && "bg-emerald-50/60",
              )}
              onClick={() => {
                if (file.isDir ?? file.is_dir) {
                  openSkillPath(file.path);
                  return;
                }
                setSelectedFile(file.path);
              }}
            >
              {file.isDir ?? file.is_dir ? <Folder className="h-4 w-4 text-muted-foreground" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
              <span className="text-[11px] text-muted-foreground">{file.isDir ?? file.is_dir ? "打开" : "预览"}</span>
            </button>
          ))}
        </div>
      </section>
      {selectedFile && !(selectedEntry?.isDir ?? selectedEntry?.is_dir) && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="kicker truncate">{selectedFile}</div>
            <Button size="sm" variant="secondary" onClick={() => openSkillPath(selectedFile)}>
              <ExternalLink className="h-4 w-4" /> 打开
            </Button>
          </div>
          {filePreview.isLoading && <LoadingState text={copy.common.loading} />}
          {filePreview.isError && <ErrorState text={getErrorMessage(filePreview.error)} onRetry={() => void filePreview.refetch()} />}
          {filePreview.data && (
            <pre className="max-h-[360px] overflow-auto rounded-lg border border-border bg-muted p-3 text-xs leading-5 text-foreground">
              {filePreview.data.content}
              {filePreview.data.truncated ? "\n\n…文件较大，已截断预览。" : ""}
            </pre>
          )}
        </section>
      )}
      <section>
        <div className="kicker mb-2">{copy.hub.readme}</div>
        <pre className="max-h-[360px] overflow-auto rounded-lg border border-border bg-muted p-3 text-xs leading-5 text-foreground">{detail.readme}</pre>
      </section>
    </div>
  );
}

function joinPath(root: string, relativePath: string) {
  return `${root.replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;
}

function filterSkillRows(rows: SkillRowView[], query: string, filter: HubFilter | AgentFilter) {
  const normalizedQuery = query.trim().toLowerCase();
  return rows.filter((row) => {
    const matchesQuery = !normalizedQuery || `${row.displayName} ${row.description ?? ""} ${row.path}`.toLowerCase().includes(normalizedQuery);
    if (!matchesQuery) return false;
    if (filter === "all") return true;
    if (filter === "importable") return false;
    if (filter === "conflict") return row.agents.some((agent) => agent.status === "conflict");
    if (filter === "missing") return row.agents.some((agent) => agent.status === "missing" || agent.status === "hub-only");
    return ["linked", "copied"].includes(agentStatus(row, filter));
  });
}

function filterImportableSkills(skills: ImportableSkillView[], query: string, filter: HubFilter | AgentFilter) {
  const normalizedQuery = query.trim().toLowerCase();
  return skills.filter((skill) => {
    const matchesQuery = !normalizedQuery || `${skill.name} ${skill.description ?? ""} ${skill.path}`.toLowerCase().includes(normalizedQuery);
    if (!matchesQuery) return false;
    if (filter === "all" || filter === "importable") return true;
    if (filter === "missing" || filter === "conflict") return false;
    return skill.agent === filter;
  });
}

function SkillSelectRow({ skill, checked, onCheckedChange }: { skill: DiscoveredSkill; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <label className="list-row flex cursor-pointer items-start gap-3 hover:bg-muted">
      <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} className="mt-1" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{skill.name}</span>
          {skill.installed && <Badge>{copy.common.installed}</Badge>}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">{skill.description || copy.hub.noDescription}</div>
        <div className="mt-2 muted-path">{sourcePath(skill)}</div>
      </div>
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "linked" || status === "synced"
      ? "bg-emerald-50 text-emerald-700"
      : status === "conflict"
        ? "bg-red-50 text-red-700"
        : status === "missing"
          ? "bg-muted text-muted-foreground"
          : status === "copied"
            ? "bg-blue-50 text-blue-700"
            : "bg-blue-50 text-blue-700";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", color)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {statusLabel(status)}
    </span>
  );
}

function SyncAgentsDialog({
  open,
  loading,
  defaultAgents,
  summaries,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  loading?: boolean;
  defaultAgents: AgentKind[];
  summaries: Array<{ agent: AgentKind; total: number; enabled: number; missing: number; conflicts: number }>;
  onOpenChange: (open: boolean) => void;
  onConfirm: (agents: AgentKind[]) => void;
}) {
  const [selectedAgents, setSelectedAgents] = useState<AgentKind[]>([]);

  useEffect(() => {
    if (!open) return;
    setSelectedAgents(defaultAgents.length ? defaultAgents : [...AGENTS]);
  }, [defaultAgents, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>一键同步到工具</DialogTitle>
          <DialogDescription>把本机技能库中的所有 Skill 同步到选择的 Agent；遇到同名真实目录会标记为待处理，不会覆盖。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {AGENTS.map((agent) => {
            const summary = summaries.find((item) => item.agent === agent);
            const active = selectedAgents.includes(agent);
            return (
              <button
                key={agent}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors",
                  active ? "border-emerald-200 bg-emerald-50/60" : "border-border bg-background hover:bg-muted",
                )}
                onClick={() => setSelectedAgents((current) => toggleValue(current, agent))}
              >
                <span className="flex items-center gap-2 font-medium">
                  <AgentIcon agent={agent} size={18} />
                  {agentLabel(agent)}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge>{summary?.missing ?? 0} 可启用</Badge>
                  <Badge>{summary?.conflicts ?? 0} 待处理</Badge>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={loading} onClick={() => onOpenChange(false)}>{copy.remotes.cancel}</Button>
          <Button disabled={loading || !selectedAgents.length} onClick={() => onConfirm(selectedAgents)}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            同步到 {selectedAgents.length} 个工具
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getDefaultSyncMethod(preferences?: { defaultSyncMethod?: SyncMethod | null; default_sync_method?: SyncMethod | null } | null): SyncMethod {
  return preferences?.defaultSyncMethod ?? preferences?.default_sync_method ?? "auto";
}

function remoteTargetLabel(remote: { host: string; user?: string | null; port?: number | null }) {
  return `${remote.user ? `${remote.user}@` : ""}${remote.host}${remote.port ? `:${remote.port}` : ""}`;
}

function sshHostResolvedLabel(host: DiscoveredSshHost) {
  const target = `${host.user ? `${host.user}@` : ""}${host.hostname ?? host.alias}${host.port ? `:${host.port}` : ""}`;
  const source = host.sourceFile ?? host.source_file;
  return source ? `${target} · ${source}` : target;
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  loading,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={loading} onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
          <Button variant="destructive" disabled={loading} onClick={onConfirm}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PagedSkillDialog({
  state,
  items,
  onOpenChange,
  onOpenPath,
  actionLabel,
  actionVariant,
  onAction,
}: {
  state: SkillDialogState | null;
  items: PagedSkillItem[];
  onOpenChange: (open: boolean) => void;
  onOpenPath: (path: string) => void;
  actionLabel?: (item: PagedSkillItem) => string | null;
  actionVariant?: (item: PagedSkillItem) => "default" | "secondary" | "destructive";
  onAction?: (item: PagedSkillItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 6;
  useEffect(() => {
    setQuery("");
    setPage(1);
  }, [state?.kind, state?.agent]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => `${item.name} ${item.description ?? ""} ${item.path} ${item.agent ?? ""}`.toLowerCase().includes(normalized));
  }, [items, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <Dialog open={Boolean(state)} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(82vh,720px)] w-[min(92vw,960px)] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
          <DialogDescription>{state?.description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索 Skill 名称、描述或路径" />
          <Badge>{filtered.length} 项</Badge>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
          {visibleItems.map((item) => {
            const label = actionLabel?.(item);
            return (
              <div key={item.id} className="flex min-h-[70px] items-center justify-between gap-4 border-b border-border px-4 py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {item.agent && <AgentIcon agent={item.agent} size={16} />}
                    <span className="truncate">{item.name}</span>
                    {item.agent && <Badge>{agentLabel(item.agent)}</Badge>}
                    {item.status === "external" ? <Badge><Link2 className="mr-1 h-3 w-3" />外部链接</Badge> : item.status ? <StatusBadge status={item.status} /> : null}
                  </div>
                  <div className="mt-1 truncate text-sm text-muted-foreground">{item.description || copy.hub.noDescription}</div>
                  <div className="mt-1 muted-path">{item.path}</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  {item.openable !== false && (
                    <Button size="sm" variant="secondary" onClick={() => onOpenPath(item.path)}>
                      <ExternalLink className="h-4 w-4" /> 打开
                    </Button>
                  )}
                  {label && onAction && (
                    <Button size="sm" variant={actionVariant?.(item) ?? "default"} onClick={() => onAction(item)}>
                      {actionVariant?.(item) === "destructive" && <Trash2 className="h-4 w-4" />}
                      {label}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {!visibleItems.length && <EmptyState text="没有匹配的 Skill。" />}
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">第 {currentPage} / {pageCount} 页 · 每页最多 {pageSize} 项</div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              <ChevronLeft className="h-4 w-4" /> 上一页
            </Button>
            <Button size="sm" variant="secondary" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
              下一页 <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TogglePill({
  active,
  disabled = false,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function LoadingState({ text }: { text: string }) {
  return (
    <div className="m-4 rounded-lg border border-dashed border-border bg-background p-4">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--accent))]" />
        {text}
      </div>
      <div className="space-y-3">
        <div className="skeleton-line h-3 w-3/4" />
        <div className="skeleton-line h-3 w-1/2" />
        <div className="skeleton-line h-3 w-2/3" />
      </div>
    </div>
  );
}

function ErrorState({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="m-4 rounded-lg border border-dashed border-red-200 bg-red-50 p-6 text-sm text-red-700">
      <div className="font-medium">加载失败</div>
      <div className="mt-1 break-words text-xs leading-5">{text}</div>
      <Button className="mt-3" size="sm" variant="secondary" onClick={onRetry}>
        {copy.common.retry}
      </Button>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="m-4 rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function toggleValue<T>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

async function refetchSourceScan(
  refetch: () => Promise<unknown>,
  showToast: ReturnType<typeof useToast>["showToast"],
  updateToast: ReturnType<typeof useToast>["updateToast"],
) {
  const toastId = showToast({ tone: "loading", title: copy.sources.scanning });
  try {
    const result = (await refetch()) as { isError?: boolean; error?: unknown };
    if (result.isError) {
      throw result.error;
    }
    updateToast(toastId, { tone: "success", title: copy.sources.scanSuccess });
  } catch (error) {
    updateToast(toastId, { tone: "error", title: copy.sources.scanFailed, description: getErrorMessage(error) });
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default App;
