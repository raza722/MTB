import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { cx } from "../lib/cx";
import { IconButton } from "./button";

export interface ToastOptions {
  tone?: "success" | "danger" | "warning" | "info";
  /** Carries the record number: "Receipt KC-2627-004821 posted". */
  title: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
  /** ms; 0 keeps it until dismissed. Default 4500. */
  duration?: number;
}

type ToastItem = ToastOptions & { id: string };
type ToastFn = (t: ToastOptions | string) => string;

const ToastContext = createContext<ToastFn | null>(null);

/** One per app. Shows at most four toasts, newest last, bottom right; never blocks the next action. */
export function ToastProvider({ children }: { children?: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const remove = useCallback((id: string) => setItems((x) => x.filter((t) => t.id !== id)), []);
  const toast = useCallback<ToastFn>(
    (t) => {
      const id = Math.random().toString(36).slice(2);
      const item: ToastItem = typeof t === "string" ? { id, title: t } : { id, ...t };
      setItems((x) => [...x.slice(-3), item]);
      if (item.duration !== 0) setTimeout(() => remove(id), item.duration ?? 4500);
      return id;
    },
    [remove],
  );
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="mtb-toaster" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <Toast key={t.id} {...t} onDismiss={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  return useContext(ToastContext) ?? (() => "");
}

export function Toast({ tone = "success", title, message, action, onDismiss }: ToastOptions & { onDismiss?: () => void }) {
  const ic: IconName = ({ success: "checkCircle", danger: "alertCircle", warning: "alert", info: "info" } as const)[tone];
  return (
    <div className={cx("mtb-toast", `mtb-toast-${tone}`)} role="status">
      <Icon name={ic} className="mtb-toast-icon" />
      <div className="mtb-toast-text">
        <b>{title}</b>
        {message && <span>{message}</span>}
        {action && <div style={{ marginTop: 6 }}>{action}</div>}
      </div>
      {onDismiss && <IconButton icon="x" label="Dismiss" size="sm" onClick={onDismiss} />}
    </div>
  );
}
