import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckCircle2, Info, Loader2, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
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
    <div className="toast-viewport" aria-live="polite" aria-relevant="additions removals">
      <AnimatePresence initial={false} mode="popLayout">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const reduceMotion = useReducedMotion();
  const Icon = toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? TriangleAlert : toast.tone === "loading" ? Loader2 : Info;
  return (
    <motion.div
      layout={reduceMotion ? false : "position"}
      initial={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(-8px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      exit={{ opacity: 0, transform: reduceMotion ? "none" : "translateY(-8px)" }}
      transition={{ duration: reduceMotion ? 0.12 : 0.18, ease: [0.23, 1, 0.32, 1] }}
      className="toast-card"
      role={toast.tone === "error" ? "alert" : "status"}
    >
      <div className="flex items-start gap-3">
        <AnimatePresence initial={false} mode="wait">
          <motion.span
            key={toast.tone}
            initial={{ opacity: 0, transform: reduceMotion ? "none" : "scale(0.96)" }}
            animate={{ opacity: 1, transform: "scale(1)" }}
            exit={{ opacity: 0, transform: reduceMotion ? "none" : "scale(0.96)" }}
            transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
            className="toast-icon"
          >
            <Icon
              className={cn(
                "h-4 w-4",
                toast.tone === "success" && "text-[hsl(var(--success))]",
                toast.tone === "error" && "text-[hsl(var(--destructive))]",
                toast.tone === "info" && "text-[hsl(var(--info))]",
                toast.tone === "loading" && "animate-spin text-muted-foreground",
              )}
            />
          </motion.span>
        </AnimatePresence>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">{toast.title}</div>
          {toast.description && <div className="toast-description">{toast.description}</div>}
        </div>
        <button className="toast-close" aria-label="关闭通知" onClick={onDismiss}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
