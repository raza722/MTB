import {
  ACCOUNTS_STATUS_LABEL,
  ACCOUNTS_VOUCHER_TYPE_LABEL,
  accountsQueries,
  accountsSideOf,
  ApiError,
  CURRENT_SESSION,
  type AccountsAccount,
  type AccountsVoucherStatus,
  type AccountsVoucherType,
} from "@mtb/api";
import { formatDate, formatRs, formatSession, pakistanToday, type IsoDate } from "@mtb/domain";
import { Banner, Button, cx, Icon, StatusBadge, Tooltip, type ComboboxOption, type IconName } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { SubNav, type SubNavItem } from "../../app/shell/SubNav";
import "./accounts.css";

/**
 * Today in Pakistan (Asia/Karachi). Only for form defaults, date-picker limits and "printed on" lines; the server
 * decides what the books cover (and sends `asOf` / `from` / `to` back on the reports, which the pages show).
 */
export const accToday = (): IsoDate => pakistanToday();
/**
 * The session runs 1 April to 31 March at every campus today. The responses don't carry the session's dates yet
 * (contract change C10, 07_accounts.md §5.2); change these three when they do.
 */
export const sessionStartOf = (session: number): IsoDate => `${session}-04-01`;
export const sessionEndOf = (session: number): IsoDate => `${session + 1}-03-31`;
/** The last day the books cover: today, or the last day of a past session. */
export const asOfFor = (session: number): IsoDate => {
  const today = accToday();
  return session === CURRENT_SESSION && today <= sessionEndOf(session) ? today : sessionEndOf(session);
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-10" → "October 2026" */
export const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ""} ${m.slice(0, 4)}`;
/** "2026-10" → "Oct" */
export const monthShort = (m: string) => (MONTHS[Number(m.slice(5, 7)) - 1] ?? "").slice(0, 3);
export const monthEnd = (m: string): IsoDate => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
/** April to March of a session (C10: from the session's dates once the responses carry them). */
export const sessionMonths = (session: number) => Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(session, 3 + i, 1)).toISOString().slice(0, 7));
/** Months of the session that have started. */
export const monthsSoFar = (session: number) => sessionMonths(session).filter((m) => `${m}-01` <= asOfFor(session));
export const addDays = (d: IsoDate, n: number): IsoDate => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
/** "06 Oct" for chart axes. */
export const shortDate = (d: IsoDate) => formatDate(d).slice(0, 6).replace("-", " ");
/** Axis ticks in lakh, the unit people at MTB count money in. */
export const lakhTick = (v: number) => {
  if (v === 0) return "0";
  const lakh = v / 100_000;
  if (Math.abs(lakh) >= 100) return `${(lakh / 100).toFixed(1).replace(/\.0$/, "")} crore`;
  return `${Number.isInteger(lakh) ? lakh : lakh.toFixed(1).replace(/\.0$/, "")} lakh`;
};

/** Stagger style for list rows (.mtb-slide-in). */
export const slide = (i: number) => ({ "--i": Math.min(i, 12) }) as CSSProperties;

/* ---------------------------------------------------------------- Shell */

const NAV: SubNavItem[] = [
  { to: "/accounts", label: "Overview", icon: "dashboard", exact: true },
  { to: "/accounts/vouchers", label: "Vouchers", icon: "file" },
  { to: "/accounts/chart", label: "Chart of accounts", icon: "layers" },
  { to: "/accounts/ledger", label: "Ledger", icon: "book" },
  { to: "/accounts/trial-balance", label: "Trial balance", icon: "listChecks" },
  { to: "/accounts/statements", label: "Statements", icon: "trendUp" },
  { to: "/accounts/fee-posting", label: "Fee posting", icon: "fees" },
  { to: "/accounts/bank", label: "Bank reconciliation", icon: "building" },
  { to: "/accounts/periods", label: "Month close", icon: "lock" },
];

/** Page, header with campus and session, the module's tabs and the read-only notice for a past session. */
export function AccountsShell({ title, context, actions, meta, children }: { title: string; context?: ReactNode; actions?: ReactNode; meta?: ReactNode; children: ReactNode }) {
  const readOnly = useReadOnly();
  const { session } = useCtx();
  return (
    <Page>
      <PageHeader title={title} {...(context !== undefined ? { context } : {})} {...(actions ? { actions } : {})} {...(meta ? { meta } : {})} />
      <SubNav items={NAV} label="Accounts" />
      {readOnly && (
        <Banner tone="neutral" icon="lock" title={`Session ${formatSession(session)} is closed.`}>
          Ledgers, statements and vouchers stay available to read and print. Switch to {formatSession(CURRENT_SESSION)} to enter or post vouchers.
        </Banner>
      )}
      {children}
    </Page>
  );
}

/* ---------------------------------------------------------------- Navigation */

/** Goes to an accounts page. Campus and session are kept by the router. */
export function useGo() {
  const navigate = useNavigate();
  return (to: string, search: Record<string, string | number | undefined> = {}, params?: Record<string, string>) =>
    void navigate({ to, ...(params ? { params } : {}), search: Object.fromEntries(Object.entries(search).filter(([, v]) => v !== undefined && v !== "")) } as never);
}

/** Opens a voucher. */
export function useOpenVoucher() {
  const go = useGo();
  return (id: string) => go("/accounts/vouchers/$voucherId", {}, { voucherId: id });
}

export function AccLink({ to, search, params, className, children }: { to: string; search?: Record<string, string | number>; params?: Record<string, string>; className?: string; children: ReactNode }) {
  return (
    <Link to={to as never} {...(params ? { params: params as never } : {})} search={(search ?? {}) as never} className={className ?? "font-medium text-brand-ink underline-offset-2 hover:underline"}>
      {children}
    </Link>
  );
}

/* ---------------------------------------------------------------- Errors */

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.isNetwork ? "No response from the server; nothing was changed. Try again." : e.message;
  return "Something went wrong. Try again.";
}

export const errorField = (e: unknown) => (e instanceof ApiError ? e.field : undefined);

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

/* ---------------------------------------------------------------- Money and badges */

/** "Rs 12,450,800 Dr" — a balance with its side, as accountants read it. */
export function Bal({ value, strong, className }: { value: number; strong?: boolean; className?: string }) {
  const side = accountsSideOf(value);
  return (
    <span className={cx("mtb-num whitespace-nowrap", strong && "font-semibold", className)}>
      {formatRs(Math.abs(value))}
      <span className="acc-side">{side}</span>
    </span>
  );
}

/** Plain-language balance: "Rs 12,450 Dr" with a hint for screen readers. */
export const balText = (v: number) => `${formatRs(Math.abs(v))}${v > 0 ? " Dr" : v < 0 ? " Cr" : ""}`;

const SYSTEM_TYPES: AccountsVoucherType[] = ["FEE", "FEE_CANCEL", "OPENING"];
const TYPE_CODE: Record<AccountsVoucherType, string> = { JV: "JV", CP: "CP", CR: "CR", BP: "BP", BR: "BR", FEE: "FB", FEE_CANCEL: "FC", OPENING: "OB" };

export function TypeChip({ type }: { type: AccountsVoucherType }) {
  return (
    <Tooltip content={ACCOUNTS_VOUCHER_TYPE_LABEL[type]}>
      <span className={cx("acc-type", SYSTEM_TYPES.includes(type) && "is-system")} tabIndex={0} aria-label={ACCOUNTS_VOUCHER_TYPE_LABEL[type]}>
        {TYPE_CODE[type]}
      </span>
    </Tooltip>
  );
}

export function VoucherStatus({ status, totalDebit, totalCredit, rejected, type }: { status: AccountsVoucherStatus; totalDebit?: number; totalCredit?: number; rejected?: boolean; type?: AccountsVoucherType }) {
  const diff = (totalDebit ?? 0) - (totalCredit ?? 0);
  if (status === "POSTED")
    return (
      <StatusBadge status="declared" icon="lock">
        Posted
      </StatusBadge>
    );
  if (status === "REVERSED")
    return (
      <StatusBadge status="cancelled" icon="refresh">
        Reversed
      </StatusBadge>
    );
  if (status === "APPROVED") return <StatusBadge status="approved" icon="check" />;
  if (status === "SUBMITTED") return <StatusBadge status="pending">{ACCOUNTS_STATUS_LABEL.SUBMITTED}</StatusBadge>;
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <StatusBadge status="draft" />
      {rejected && <StatusBadge status="rejected">Sent back</StatusBadge>}
      {type === "JV" && diff !== 0 && <StatusBadge status="overdue">Out of balance by {formatRs(Math.abs(diff))}</StatusBadge>}
    </span>
  );
}

/** A labelled figure inside a panel. */
export function Figure({ label, children, hint, large }: { label: ReactNode; children: ReactNode; hint?: ReactNode; large?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={large ? "acc-figure-lg" : undefined}>{children}</dd>
      {hint && <dd className="text-small font-normal text-ink-muted">{hint}</dd>}
    </div>
  );
}

/** A needs-attention row. */
export function Todo({ icon, tone, title, desc, onClick, i }: { icon: IconName; tone?: "warning" | "danger" | "info" | "success"; title: ReactNode; desc?: ReactNode; onClick: () => void; i: number }) {
  return (
    <li className="mtb-slide-in" style={slide(i)}>
      <button type="button" onClick={onClick}>
        <span className={cx("acc-todo-icon", tone && `tone-${tone}`)} aria-hidden="true">
          <Icon name={icon} />
        </span>
        <span className="grid min-w-0">
          <span className="acc-todo-title">{title}</span>
          {desc && <span className="acc-todo-desc">{desc}</span>}
        </span>
        <Icon name="chevronRight" size={16} className="text-ink-muted" />
      </button>
    </li>
  );
}

/* ---------------------------------------------------------------- Chart of accounts helpers */

/** The chart for the current campus and session, plus searchable options for account pickers. */
export function useChart() {
  const ctx = useCtx();
  const q = useQuery(accountsQueries.chart(ctx));
  const accounts = useMemo(() => q.data ?? [], [q.data]);
  const byCode = useMemo(() => new Map(accounts.map((a) => [a.code, a])), [accounts]);
  return { q, accounts, byCode };
}

/** Postable accounts as combobox options, with the group as the hint. */
export function accountOptions(accounts: AccountsAccount[], filter: (a: AccountsAccount) => boolean = () => true): ComboboxOption[] {
  const groups = new Map(accounts.filter((a) => !a.postable).map((a) => [a.code, a.name]));
  return accounts
    .filter((a) => a.postable && a.active && filter(a))
    .map((a) => {
      const group = groups.get(a.parentCode ?? "") ?? "";
      return { value: a.code, label: `${a.code} ${a.name}`, hint: a.campus ? `${group} · ${a.campus} only` : group, keywords: [a.code, a.name, group] };
    });
}

/* ---------------------------------------------------------------- Print header */

/** The top of every printed accounts document. */
export function DocHead({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  const ctx = useCtx();
  return (
    <div className="acc-doc-head">
      <div>
        <h2>MTB Schools and Colleges · {campusLabel(ctx.campus)}</h2>
        <h1>{title}</h1>
        {subtitle && <div>{subtitle}</div>}
      </div>
      <div className="text-right">{right ?? <>Session {formatSession(ctx.session)}</>}</div>
    </div>
  );
}

export function DocFoot() {
  return (
    <div className="acc-doc-foot">
      <span>Printed {formatDate(accToday())} from MTB Accounts</span>
      <span>Amounts in rupees</span>
    </div>
  );
}
