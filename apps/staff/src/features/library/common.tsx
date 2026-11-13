// Shared pieces for the operations modules (library, warehouse with the book shop, transport):
// the module page shell with sub-navigation, error banners, the person search, print layers and form validation.
import { ApiError, CURRENT_SESSION, LIBRARY_LANGUAGE_LABEL, operationsQueries, type LibraryLanguage, type OperationsPerson, type OperationsPersonType } from "@mtb/api";
import { formatDate, formatSession, pakistanToday, type IsoDate } from "@mtb/domain";
import { Banner, Button, cx, Icon, Input, Modal, Segmented, Spinner, StatusBadge } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ZodType } from "zod";
import { useAppearance } from "../../app/appearance";
import { useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader, RequireSingleCampus } from "../../app/shell/page";
import { SubNav, type SubNavItem } from "../../app/shell/SubNav";
import "./ops.css";

/**
 * Today in Pakistan (Asia/Karachi). Only for form defaults, date-picker limits, "due today / overdue" badges and
 * "printed on" lines; the server decides due dates, days late and fines (the library is real since module 11).
 */
export const opsToday = (): IsoDate => pakistanToday();

/** A library title's language, or "—" when the old system recorded none. */
export const languageLabel = (l: LibraryLanguage | null): string => (l ? LIBRARY_LANGUAGE_LABEL[l] : "—");

export const addDays = (d: IsoDate, n: number): IsoDate => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
/** "06 Oct" for chart axes. */
export const shortDate = (d: IsoDate) => formatDate(d).slice(0, 6).replace("-", " ");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10" → "Oct" */
export const monthShort = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1] ?? "";

/** Stagger style for list rows (.mtb-slide-in). */
export const slide = (i: number) => ({ "--i": Math.min(i, 12) }) as CSSProperties;

/* ---------------------------------------------------------------- Shell */

export interface ModuleShellProps {
  nav: SubNavItem[];
  navLabel: string;
  title: string;
  context?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  /** What stays available in a closed session, e.g. "Loans and counts stay available to read and print." */
  readOnlyNote: string;
  children: ReactNode;
}

/** Page, header with campus and session, the module's tabs and the notice for a closed session. */
export function ModuleShell({ nav, navLabel, title, context, actions, meta, readOnlyNote, children }: ModuleShellProps) {
  const readOnly = useReadOnly();
  const { session } = useCtx();
  return (
    <Page>
      <PageHeader title={title} {...(context !== undefined ? { context } : {})} {...(actions ? { actions } : {})} {...(meta ? { meta } : {})} />
      <SubNav items={nav} label={navLabel} />
      {readOnly && (
        <Banner tone="neutral" icon="lock" title={`Session ${formatSession(session)} is closed.`}>
          {readOnlyNote} Switch to {formatSession(CURRENT_SESSION)} to make changes.
        </Banner>
      )}
      {children}
    </Page>
  );
}

/** "Choose a campus" hint for a write action while "All campuses" is selected. */
export function useCampusChosen(): boolean {
  return useCtx().campus !== "ALL";
}

/** Opens a form only when one campus is selected; with "All campuses" it asks for the campus first. */
export function RequireSingleCampusOverlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const { campus } = useCtx();
  if (campus !== "ALL") return <>{children}</>;
  return (
    <Modal open onClose={onClose} title="Choose a campus first" footer={<Button onClick={onClose}>Close</Button>}>
      <RequireSingleCampus action="this form">{null}</RequireSingleCampus>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Errors */

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.isNetwork ? "No response from the server; nothing was changed. Try again." : e.message;
  return "Something went wrong. Try again.";
}
export const errorField = (e: unknown) => (e instanceof ApiError ? e.field : undefined);
export const errorCode = (e: unknown) => (e instanceof ApiError ? e.code : undefined);

export function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return (
    <Banner
      tone="danger"
      title={`${what} couldn't be loaded.`}
      actions={
        <Button size="sm" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {errorText(error)}
    </Banner>
  );
}

/** Field errors from zod, keyed by path ("lines.0.qty"), in the schema's own plain words. */
export function validate<T>(schema: ZodType<T>, value: unknown): { ok: true; data: T } | { ok: false; errors: Record<string, string> } {
  const r = schema.safeParse(value);
  if (r.success) return { ok: true, data: r.data };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.map(String).join(".");
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}

/** Puts a server error on its field when it names one; otherwise returns it for a banner. */
export function splitServerError(e: unknown): { field?: string; message: string } {
  const field = errorField(e);
  return field ? { field, message: errorText(e) } : { message: errorText(e) };
}

/* ---------------------------------------------------------------- Small views */

export function ViewToggle({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Segmented
      aria-label={label}
      value={value}
      onChange={onChange}
      options={[
        { value: "chart", label: "Chart" },
        { value: "table", label: "Table" },
      ]}
    />
  );
}

/** A thin bar for a share: seats filled, stock against its reorder level. */
export function Meter({ value, max, label, tone }: { value: number; max: number; label: string; tone?: "warn" | "full" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={cx("ops-meter", tone === "warn" && "is-warn", tone === "full" && "is-full")} role="img" aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Spine({ children }: { children: ReactNode }) {
  return <span className="ops-spine">{children}</span>;
}

export function CampusNote() {
  const { campus } = useCtx();
  return campus === "ALL" ? <span className="text-small text-ink-muted">Showing every campus. Choose one campus to add or change records.</span> : null;
}

/* ---------------------------------------------------------------- Person search */

export interface PersonPickerProps {
  label: string;
  value: OperationsPerson | null;
  onChange: (p: OperationsPerson | null) => void;
  type?: OperationsPersonType | "";
  error?: string | undefined;
  disabled?: boolean;
  /** Extra line under the chosen person (open loans, current route …). */
  hint?: ReactNode;
  autoFocus?: boolean;
}

/** Find a student by name, father or G.R. number, or a staff member by name or staff number. */
export function PersonPicker({ label, value, onChange, type = "", error, disabled, hint, autoFocus }: PersonPickerProps) {
  const ctx = useCtx();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  const listId = useId();
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q), 220);
    return () => window.clearTimeout(t);
  }, [q]);
  const res = useQuery(operationsQueries.people(ctx, debounced, type));
  const rows = res.data ?? [];
  if (value) {
    return (
      <div className="grid gap-1">
        <span className="mtb-label">{label}</span>
        <div className="ops-picker-chosen">
          <Icon name={value.type === "STUDENT" ? "students" : "user"} />
          <span className="grid min-w-0 flex-1">
            <span className="truncate font-medium">{value.name}</span>
            <span className="truncate text-small text-ink-muted">
              {value.id} · {value.detail}
              {value.father ? ` · ${value.relation} ${value.father}` : ""}
            </span>
          </span>
          {!value.active && (
            <StatusBadge status="neutral" dot={false}>
              Left
            </StatusBadge>
          )}
          {!disabled && (
            <Button size="sm" variant="quiet" onClick={() => onChange(null)}>
              Change
            </Button>
          )}
        </div>
        {hint}
        {error && (
          <div className="mtb-error" role="alert">
            <Icon name="alertCircle" />
            <span>{error}</span>
          </div>
        )}
      </div>
    );
  }
  const placeholder = type === "STAFF" ? "Staff name or number" : type === "STUDENT" ? "Student name, father or G.R. number" : "Name, G.R. number or staff number";
  return (
    <div className="ops-picker">
      <Input
        label={label}
        icon="search"
        value={q}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        error={error}
        role="combobox"
        aria-expanded={open && q.trim().length >= 2}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 160)}
        help={q.trim().length > 0 && q.trim().length < 2 ? "Type at least 2 letters." : undefined}
      />
      {open && debounced.trim().length >= 2 && (
        <ul className="ops-picker-list" id={listId} role="listbox" aria-label={`${label} results`}>
          {res.isFetching && rows.length === 0 ? (
            <li className="p-3">
              <Spinner label="Searching" />
            </li>
          ) : rows.length === 0 ? (
            <li className="p-3 text-small text-ink-muted">No one found for “{debounced}”. Check the spelling or try the G.R. number.</li>
          ) : (
            rows.map((p) => (
              <li key={`${p.type}-${p.id}`} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(p);
                    setQ("");
                    setOpen(false);
                  }}
                >
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="text-small text-ink-muted">{p.type === "STUDENT" ? p.detail : "Staff"}</span>
                  <span className="col-span-2 truncate text-small text-ink-muted">
                    {p.id}
                    {p.father ? ` · ${p.relation} ${p.father}` : ` · ${p.detail}`}
                    {ctx.campus === "ALL" ? ` · ${campusLabel(p.campus)}` : ""}
                    {!p.active ? " · left the school" : ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Printing */

/**
 * Mounts a printable document on <body>, prints it in the light theme on the paper given, and calls onDone
 * after the print dialog closes. Only this layer prints (see styles.css).
 */
export function PrintLayer({ paper, children, onDone }: { paper: "A4" | "A4L" | "A5"; children: ReactNode; onDone: () => void }) {
  const { accent } = useAppearance();
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    const done = () => doneRef.current();
    window.addEventListener("afterprint", done);
    const t = window.setTimeout(() => window.print(), 150);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, []);
  const page = paper === "A5" ? "A5 portrait; margin: 6mm" : paper === "A4L" ? "A4 landscape; margin: 10mm" : "A4 portrait; margin: 12mm";
  return createPortal(
    <div className="mtb-print-area ops-print-layer" data-theme="light" data-accent={accent}>
      <style>{`@page { size: ${page}; }`}</style>
      {children}
    </div>,
    document.body,
  );
}

/** Heading of a printed list: school, campus, title, what it covers and when it was printed. */
export function DocHead({ title, subtitle, campus }: { title: string; subtitle?: ReactNode; campus: string }) {
  return (
    <header className="ops-doc-head">
      <div>
        <p>MTB · {campus}</p>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <p>Printed {formatDate(opsToday())}</p>
    </header>
  );
}

/** Signature lines at the foot of a register (the legacy store reports are signed by these three). */
export function SignLines({ labels = ["Store keeper", "Sr. Vice Principal", "Principal"] }: { labels?: string[] }) {
  return (
    <div className="ops-doc-sign">
      {labels.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

/** "01-Oct-2026 to 31-Oct-2026", "From 01-Oct-2026", or the whole session. */
export function periodText(from: IsoDate | null, to: IsoDate | null, session: number): string {
  if (from && to) return from === to ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`;
  if (from) return `From ${formatDate(from)}`;
  if (to) return `Up to ${formatDate(to)}`;
  return `Session ${formatSession(session)}`;
}

/** True when the date is inside the optional range. */
export const inRange = (d: IsoDate, from: IsoDate | null, to: IsoDate | null) => (!from || d >= from) && (!to || d <= to);

/**
 * A save refused because someone else saved the record after the form was opened (409 CONCURRENCY).
 * Reload fetches the latest version; the person then makes their change again.
 */
export function StaleNote({ error, onReload }: { error: unknown; onReload: () => void }) {
  if (errorCode(error) !== "CONCURRENCY") return null;
  return (
    <Banner
      tone="warning"
      icon="refresh"
      title="Changed by someone else"
      actions={
        <Button size="sm" icon="refresh" onClick={onReload}>
          Reload
        </Button>
      }
    >
      {errorText(error)}
    </Banner>
  );
}

/** Holds a document to print; render <Printer /> once in the page. */
export function usePrinter() {
  const [doc, setDoc] = useState<{ paper: "A4" | "A4L" | "A5"; node: ReactNode } | null>(null);
  return {
    print: (node: ReactNode, paper: "A4" | "A4L" | "A5" = "A4") => setDoc({ paper, node }),
    printing: doc !== null,
    element: doc ? (
      <PrintLayer paper={doc.paper} onDone={() => setDoc(null)}>
        {doc.node}
      </PrintLayer>
    ) : null,
  };
}
