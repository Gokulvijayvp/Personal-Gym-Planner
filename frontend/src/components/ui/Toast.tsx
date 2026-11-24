import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, X } from "lucide-react";

type ToastKind = "success" | "error";
export interface ToastAction { label: string; onClick: () => void }
interface ToastItem { id: number; kind: ToastKind; message: string; action?: ToastAction }

interface ToastApi {
  /** An `action` (e.g. Undo) adds a button and keeps the toast on screen longer. */
  success: (message: string, action?: ToastAction) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DURATION_MS = { success: 4000, error: 7000 } as const;
const ACTION_DURATION_MS = 8000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((kind: ToastKind, message: string, action?: ToastAction) => {
    const id = nextId.current++;
    // keep at most 4 on screen; a new Undo replaces older Undo toasts (only the latest action can sensibly be undone)
    setToasts((t) => [...(action ? t.filter((x) => !x.action) : t).slice(-3), { id, kind, message, action }]);
    setTimeout(() => dismiss(id), action ? ACTION_DURATION_MS : DURATION_MS[kind]);
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({
    success: (m, action) => push("success", m, action),
    error: (m) => push("error", m),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            {t.kind === "success" ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
            <span>{t.message}</span>
            {t.action && (
              <button type="button" className="toast-action" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>{t.action.label}</button>
            )}
            <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
