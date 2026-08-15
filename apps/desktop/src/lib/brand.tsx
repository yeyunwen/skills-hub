import { ClaudeCode, Codex, Cursor, Github, HermesAgent, OpenClaw, Qoder, Trae, Windsurf } from "@lobehub/icons";
import { Bot, Cloud, GitBranch, Globe } from "lucide-react";
import gitlabIcon from "@/assets/icons/gitlab.svg";
import type { AgentKind } from "@/lib/api";
import { cn } from "@/lib/utils";

type LobeIconComponent = React.ComponentType<{ size: number; className?: string; style?: React.CSSProperties }>;
type LobeIcon = LobeIconComponent & { Avatar?: LobeIconComponent; Color?: LobeIconComponent };

const AGENT_ICONS: Record<string, LobeIcon> = {
  claude: ClaudeCode,
  codex: Codex,
  cursor: Cursor,
  hermes: HermesAgent,
  openclaw: OpenClaw,
  qoder: Qoder,
  trae: Trae,
  windsurf: Windsurf,
};

function LobeMark({ Icon, size = 16, className }: { Icon: LobeIconComponent; size?: number; className?: string }) {
  return <Icon size={size} className={cn("shrink-0", className)} />;
}

function LobeAvatar({ Icon, size = 16, className }: { Icon: { Avatar?: LobeIconComponent }; size?: number; className?: string }) {
  const Avatar = Icon.Avatar;
  return Avatar ? <Avatar size={size} className={cn("shrink-0", className)} /> : null;
}

function LocalImageIcon({ src, alt, size = 18, className }: { src: string; alt: string; size?: number; className?: string }) {
  return <img src={src} alt={alt} width={size} height={size} className={cn("shrink-0 rounded-[3px] object-contain", className)} />;
}

export function SourceIcon({ kind, className }: { kind: string; className?: string }) {
  const normalized = kind.toLowerCase();
  if (normalized.includes("github")) return <LobeAvatar Icon={Github} size={18} className={className} />;
  if (normalized.includes("gitlab")) return <LocalImageIcon src={gitlabIcon} alt="GitLab" className={className} />;
  if (normalized.includes("git")) return <GitBranch className={cn("h-[18px] w-[18px] shrink-0 text-[#F05032]", className)} />;
  return <Cloud className={cn("h-[18px] w-[18px] shrink-0 text-blue-500", className)} />;
}

export function AgentIcon({ agent, className, size = 14 }: { agent: AgentKind; className?: string; size?: number }) {
  const icon = AGENT_ICONS[agent];
  if (icon) return <LobeMark Icon={icon.Color ?? icon.Avatar ?? icon} size={size} className={className} />;
  return <Bot size={size} className={cn("shrink-0", className)} />;
}

export function RemoteIcon({ className, size = 16 }: { className?: string; size?: number }) {
  return <Globe size={size} className={cn("shrink-0", className)} aria-hidden="true" />;
}

export function StatusDot({ tone, spinning = false }: { tone: "success" | "danger" | "muted" | "info"; spinning?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        tone === "success" && "bg-emerald-500",
        tone === "danger" && "bg-red-500",
        tone === "muted" && "bg-zinc-300",
        tone === "info" && "bg-blue-500",
        spinning && "animate-pulse",
      )}
    />
  );
}
