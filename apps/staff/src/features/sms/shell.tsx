import { ApiError, CURRENT_SESSION, SMS_BATCH_STATUS_LABEL, SMS_CHANNEL_LABEL, smsStatusQueries, type SmsBatch, type SmsBatchStatus, type SmsChannel } from "@mtb/api";
import { formatDate, formatSession, formatTime } from "@mtb/domain";
import { Banner, Button, Icon, StatusBadge, type IconName } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import { useCtx, useReadOnly } from "../../app/session";
import { Page, PageHeader } from "../../app/shell/page";
import { SubNav, type SubNavItem } from "../../app/shell/SubNav";
import "./sms.css";

const NAV: SubNavItem[] = [
  { to: "/sms", label: "Overview", icon: "dashboard", exact: true },
  { to: "/sms/compose", label: "Compose", icon: "send" },
  { to: "/sms/outbox", label: "Outbox", icon: "inbox" },
  { to: "/sms/delivery", label: "Delivery", icon: "listChecks" },
  { to: "/sms/notices", label: "Notices", icon: "flag" },
  { to: "/sms/templates", label: "Templates", icon: "message" },
  { to: "/sms/opt-outs", label: "Opt-outs", icon: "ban" },
  { to: "/sms/settings", label: "SMS companies", icon: "settings" },
];

/** Page, header with campus and session, the Messages tabs, the paused badge and the read-only notice. */
export function MessagesShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const status = useQuery(smsStatusQueries.status());
  const readOnly = useReadOnly();
  const { session } = useCtx();
  return (
    <Page>
      <PageHeader title={title} {...(actions ? { actions } : {})} {...(status.data?.paused ? { meta: <StatusBadge status="danger">All SMS paused</StatusBadge> } : {})} />
      <SubNav items={NAV} label="Messages" />
      {readOnly && (
        <Banner tone="neutral" icon="lock" title={`Session ${formatSession(session)} is closed.`}>
          What was sent stays available to read. Switch to {formatSession(CURRENT_SESSION)} to send messages or publish notices.
        </Banner>
      )}
      {children}
    </Page>
  );
}

/** Goes to a Messages page; the router keeps campus and session. */
export function useGo() {
  const navigate = useNavigate();
  return (to: string, search: Record<string, string | number | undefined> = {}) => void navigate({ to, search: Object.fromEntries(Object.entries(search).filter(([, v]) => v !== undefined && v !== "")) } as never);
}

export const slide = (i: number) => ({ "--i": Math.min(i, 12) }) as CSSProperties;

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

const STATUS_TONE: Record<SmsBatchStatus, "warning" | "info" | "brand" | "success" | "neutral" | "danger"> = {
  AWAITING_APPROVAL: "warning",
  SCHEDULED: "info",
  SENDING: "brand",
  SENT: "success",
  CANCELLED: "neutral",
  REJECTED: "danger",
};

export function BatchStatus({ status }: { status: SmsBatchStatus }) {
  return <StatusBadge status={STATUS_TONE[status]}>{SMS_BATCH_STATUS_LABEL[status]}</StatusBadge>;
}

const CHANNEL_ICON: Record<SmsChannel, IconName> = { SMS: "sms", APP: "smartphone", APP_FIRST: "bolt" };

export function ChannelLabel({ channel, short }: { channel: SmsChannel; short?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-small text-ink-muted">
      <Icon name={CHANNEL_ICON[channel]} size={14} />
      {short ? (channel === "SMS" ? "SMS" : channel === "APP" ? "App" : "App + SMS") : SMS_CHANNEL_LABEL[channel]}
    </span>
  );
}

/** "Today 4:30 PM", "Thu 05-Nov 4:30 PM". */
export function whenText(iso: string): string {
  const day = iso.slice(0, 10);
  const today = "2026-11-04";
  const time = formatTime(iso);
  if (day === today) return `Today ${time}`;
  if (day === "2026-11-05") return `Tomorrow ${time}`;
  if (day === "2026-11-03") return `Yesterday ${time}`;
  return `${formatDate(day)} ${time}`;
}

/** Delivered / failed / waiting as a slim bar for an outbox row. */
export function BatchProgress({ b }: { b: SmsBatch }) {
  const c = b.counts;
  const sms = c.delivered + c.failed + c.sent + c.queued;
  const total = sms + c.app;
  if (b.status !== "SENDING" && b.status !== "SENT") return <span className="text-small text-ink-subtle">—</span>;
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <span className="grid gap-1">
      <span className="sms-mini-bar" role="img" aria-label={`${c.delivered + c.app} delivered, ${c.failed} failed, ${c.queued + c.sent} on the way`}>
        <span style={{ width: pct(c.delivered + c.app), background: "var(--status-paid)" }} />
        <span style={{ width: pct(c.sent + c.queued), background: "var(--info)" }} />
        <span style={{ width: pct(c.failed), background: "var(--danger)" }} />
      </span>
      <span className="text-small text-ink-muted">
        <span className="mtb-num">{(c.delivered + c.app).toLocaleString("en-PK")}</span> delivered
        {c.failed ? (
          <>
            {" · "}
            <span className="mtb-num text-danger-ink">{c.failed}</span> failed
          </>
        ) : null}
        {c.queued + c.sent ? (
          <>
            {" · "}
            <span className="mtb-num">{(c.queued + c.sent).toLocaleString("en-PK")}</span> on the way
          </>
        ) : null}
      </span>
    </span>
  );
}

/** Half-hour slots for scheduling, 7:00 AM to 8:30 PM. */
export const TIME_SLOTS: Array<{ value: string; label: string }> = Array.from({ length: 28 }, (_, i) => {
  const m = 7 * 60 + i * 30;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  return { value: `${String(h).padStart(2, "0")}:${mm}`, label: `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? "AM" : "PM"}` };
});

export const isoAt = (date: string, time: string) => `${date}T${time}:00+05:00`;

/** The demo's "now": today's demo date with the real time of day in Pakistan (as the mock server uses). */
export function demoNowIso(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const hh = parts.find((x) => x.type === "hour")?.value ?? "10";
  const mm = parts.find((x) => x.type === "minute")?.value ?? "00";
  return `2026-11-04T${hh === "24" ? "00" : hh}:${mm}:00+05:00`;
}
