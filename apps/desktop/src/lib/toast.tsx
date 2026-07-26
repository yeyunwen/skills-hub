import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckCircle2, Info, Loader2, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "info" | "success" | "error" | "loading";

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toasts: ToastItem[];
  showToast: (toast: Omit<ToastItem, "id"> & { id?: string }) => string;
  updateToast: (id: string, toast: Partial<Omit<ToastItem, "id">>) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: Omit<ToastItem, "id"> & { id?: string }) => {
      const id = toast.id ?? crypto.randomUUID();
      const next = { ...toast, id };
      setToasts((current) => [next, ...current.filter((item) => item.id !== id)].slice(0, 5));
      if (toast.tone !== "loading") {
        window.setTimeout(() => dismissToast(id), 4500);
      }
      return id;
    },
    [dismissToast],
  );

  const updateToast = useCallback(
    (id: string, toast: Partial<Omit<ToastItem, "id">>) => {
      setToasts((current) => current.map((item) => (item.id === id ? { ...item, ...toast } : item)));
      if (toast.tone && toast.tone !== "loading") {
        window.setTimeout(() => dismissToast(id), 4500);
      }
    },
    [dismissToast],
  );

  const value = useMemo(() => ({ toasts, showToast, updateToast, dismissToast }), [toasts, showToast, updateToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return context;
}

function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed right-4 top-4 z-[100] flex w-[360px] flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const Icon = toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? TriangleAlert : toast.tone === "loading" ? Loader2 : Info;
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-sm shadow-2xl shadow-black/10">
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            toast.tone === "success" && "text-[hsl(var(--accent))]",
            toast.tone === "error" && "text-red-600",
            toast.tone === "info" && "text-blue-600",
            toast.tone === "loading" && "animate-spin text-muted-foreground",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">{toast.title}</div>
          {toast.description && <div className="mt-1 text-xs leading-5 text-muted-foreground">{toast.description}</div>}
        </div>
        <button className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onDismiss}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
