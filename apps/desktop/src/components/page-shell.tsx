import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Database, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { api, type EnvironmentSummary } from "@/lib/api";
import { StatusDot } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function PageShell({ title, subtitle, environment, actions, children, transitioning = false }: {
  title: string;
  subtitle: string;
  environment: EnvironmentSummary;
  actions?: ReactNode;
  children: ReactNode;
  transitioning?: boolean;
}) {
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
    <div key={`${environment.id}:${title}`} className="page-shell" data-transitioning={transitioning || undefined} aria-busy={transitioning}>
      {transitioning && <div className="environment-loading-line" aria-hidden="true" />}
      <header className="page-header">
        <div className="min-w-0">
          <div className="page-title-row">
            <h1 className="page-title">{title}</h1>
            <StatusDot tone={connection.isFetching ? "info" : connected ? "success" : "danger"} spinning={connection.isFetching} />
          </div>
          <p className="page-subtitle"><span>{environment.name}</span><span className="page-subtitle-separator" />{subtitle}</p>
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      <div className="page-content" inert={transitioning ? true : undefined}>{children}</div>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><div className="empty-state-icon"><Database className="h-4 w-4" /></div><div className="font-medium">{title}</div><div className="mt-1 text-sm text-muted-foreground">{description}</div></div>;
}

export function PageLoading({ compact = false, label = "正在读取环境状态…" }: { compact?: boolean; label?: string }) {
  return <div className={cn("loading-state", compact && "loading-state-compact")} role="status"><Loader2 className="h-4 w-4 animate-spin" /><span>{label}</span></div>;
}

export function PageError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return <div className="error-state" role="alert"><CircleAlert className="h-4 w-4 shrink-0" /><div className="min-w-0 flex-1"><div className="font-medium">{title}</div><div className="mt-1 break-words text-sm">{message}</div></div><Button variant="secondary" size="sm" onClick={onRetry}>重试</Button></div>;
}
