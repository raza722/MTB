import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { cx } from "../lib/cx";

export interface Tab {
  id: string;
  label: ReactNode;
  count?: number;
  icon?: IconName;
}

export interface TabsProps {
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
  /** 44px tabs for mobile. */
  touch?: boolean;
  /** MTB addition: prefix for element ids when a page has more than one tab set. */
  idPrefix?: string;
  className?: string;
  "aria-label"?: string;
}

/** Arrow keys, Home and End move between tabs; the selected tab takes focus. */
export function Tabs({ tabs, value, onChange, touch, idPrefix = "", className, "aria-label": ariaLabel }: TabsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    const selectedTab = ref.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    selectedTab?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    if (moved.current) {
      selectedTab?.focus();
      moved.current = false;
    }
  }, [value]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === value);
    if (i < 0) return;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    const target = next === null ? undefined : tabs[next];
    if (target) {
      e.preventDefault();
      moved.current = true;
      onChange(target.id);
    }
  };

  return (
    <div ref={ref} className={cx("mtb-tabs", touch && "mtb-tabs-touch", className)} role="tablist" aria-label={ariaLabel} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${idPrefix}tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`${idPrefix}panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          className="mtb-tab"
          onClick={() => onChange(t.id)}
        >
          {t.icon && <Icon name={t.icon} size={16} />}
          {t.label}
          {t.count !== undefined && <span className="mtb-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ id, active, idPrefix = "", className, children }: { id: string; active: boolean; idPrefix?: string; className?: string; children?: ReactNode }) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={`${idPrefix}panel-${id}`} aria-labelledby={`${idPrefix}tab-${id}`} className={cx("mtb-tabpanel", className)} tabIndex={0}>
      {children}
    </div>
  );
}
