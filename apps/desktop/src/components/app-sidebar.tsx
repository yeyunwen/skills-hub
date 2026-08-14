import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Laptop, Plus, Settings } from "lucide-react";

import skillHubLogo from "@/assets/skill-hub-logo.png";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type EnvironmentSummary } from "@/lib/api";
import { RemoteIcon, StatusDot } from "@/lib/brand";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export type Page = "skills" | "sources" | "settings";

interface AppSidebarProps {
  environments: EnvironmentSummary[];
  selectedEnvironmentId: string;
  page: Page;
  onEnvironmentChange: (id: string) => void;
  onPageChange: (page: Page) => void;
  onEnvironmentAdded: (environment: EnvironmentSummary) => void;
}

export function AppSidebar({
  environments,
  selectedEnvironmentId,
  page,
  onEnvironmentChange,
  onPageChange,
  onEnvironmentAdded,
}: AppSidebarProps) {
  const [addOpen, setAddOpen] = useState(false);
  const queryClient = useQueryClient();
  const preferences = useQuery({
    queryKey: ["preferences"],
    queryFn: api.getPreferences,
    retry: false,
    staleTime: 30_000,
  });
  const selectedEnvironment = environments.find((item) => item.id === selectedEnvironmentId);
  const hubPath = selectedEnvironment?.kind === "local"
    ? preferences.data?.hubDir ?? preferences.data?.hub_dir ?? "~/.cc-switch/skills"
    : "~/.cc-switch/skills";

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
        <img className="brand-mark" src={skillHubLogo} alt="" aria-hidden="true" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Skills Hub</div>
          <div className="truncate text-[11px] text-muted-foreground">Agent Skills</div>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>环境</span>
          <button className="icon-button sidebar-add-button" aria-label="添加 SSH 环境" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
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
      </div>

      <div className="sidebar-section sidebar-secondary-nav">
        <SidebarLink active={page === "sources"} label="安装来源" onClick={() => onPageChange("sources")}>
          <GitBranch className="h-4 w-4" />
        </SidebarLink>
        <SidebarLink active={page === "settings"} label="设置" onClick={() => onPageChange("settings")}>
          <Settings className="h-4 w-4" />
        </SidebarLink>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-footer-label">当前环境</div>
        <div className="truncate text-xs font-medium">{selectedEnvironment?.name ?? "本机"}</div>
        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{hubPath}</div>
      </div>
      <AddEnvironmentDialog open={addOpen} onOpenChange={setAddOpen} onAdded={onEnvironmentAdded} />
    </aside>
  );
}

function SidebarLink({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className={cn("sidebar-link", active && "sidebar-link-active")}
      aria-current={active ? "page" : undefined}
      title={label}
      onClick={onClick}
    >
      {children} {label}
    </button>
  );
}

function EnvironmentNavItem({ environment, selected, onClick, onPrefetch }: {
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
    <button
      className={cn("environment-nav-item", selected && "environment-nav-item-active")}
      aria-current={selected ? "page" : undefined}
      aria-label={environment.name}
      title={environment.name}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onClick={onClick}
    >
      {selected && <span className="environment-selected-background" />}
      <span className="environment-nav-icon">
        {environment.kind === "local" ? <Laptop className="h-4 w-4" /> : <RemoteIcon size={16} />}
      </span>
      <span className="environment-nav-copy">
        <span className="environment-nav-label">{environment.name}</span>
      </span>
      <span className="environment-nav-status">
        <StatusDot tone={connection.isFetching ? "info" : connected ? "success" : "danger"} spinning={connection.isFetching} />
      </span>
    </button>
  );
}

function AddEnvironmentDialog({ open, onOpenChange, onAdded }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (environment: EnvironmentSummary) => void;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("");
  const sshHosts = useQuery({ queryKey: ["ssh-hosts"], queryFn: api.discoverSshHosts, enabled: open, retry: false });
  const add = useMutation({
    mutationFn: () => api.addRemote({
      name: name.trim() || host.trim(),
      host: host.trim(),
      user: user.trim() || undefined,
      port: port.trim() ? Number(port) : undefined,
    }),
    onSuccess: (remote) => {
      onAdded({ id: `remote:${remote.name}`, name: remote.name, kind: "remote", host: remote.host, user: remote.user, port: remote.port });
      showToast({ tone: "success", title: "SSH 环境已添加", description: remote.name });
      onOpenChange(false);
      setName("");
      setHost("");
      setUser("");
      setPort("");
    },
    onError: (error) => showToast({ tone: "error", title: "添加 SSH 环境失败", description: errorMessage(error) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加 SSH 环境</DialogTitle>
          <DialogDescription>添加后会和本机一样直接出现在左侧环境列表。</DialogDescription>
        </DialogHeader>
        {sshHosts.data && sshHosts.data.length > 0 && (
          <div className="space-y-1">
            <div className="field-label">SSH 配置</div>
            {sshHosts.data.map((item) => (
              <button key={item.alias} className="ssh-host-option" disabled={item.added} onClick={() => {
                setName(item.alias);
                setHost(item.alias);
                setUser(item.user ?? "");
                setPort(item.port ? String(item.port) : "");
              }}>
                <span>{item.alias}</span><span className="muted-path">{item.hostname ?? item.alias}</span>
              </button>
            ))}
          </div>
        )}
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (host.trim()) add.mutate(); }}>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="显示名称，可选" />
          <Input value={host} onChange={(event) => setHost(event.target.value)} placeholder="SSH Host / Alias" autoFocus />
          <Input value={user} onChange={(event) => setUser(event.target.value)} placeholder="用户，可选" />
          <Input value={port} onChange={(event) => setPort(event.target.value)} placeholder="端口，可选" />
          <div className="flex justify-end"><Button disabled={!host.trim()} pending={add.isPending} pendingLabel="添加中">添加环境</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}
