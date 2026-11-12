import { portalQueries, type PortalDue, type PortalFees, type PortalReceiptRow } from "@mtb/api";
import { buttonClassName, cx, EmptyState, Icon, Panel, SegmentedBar, Skeleton, StatusBadge } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatRs, formatSession } from "@mtb/domain";
import type { CSSProperties } from "react";
import { DateL, firstName, Money, SessionL } from "../../app/format";
import { Ltr, useLang } from "../../app/i18n";
import { PageHeader, QueryState } from "../../app/shell/page";
import { useChild } from "../../app/session";

function DueRow({ d, i }: { d: PortalDue; i: number }) {
  const { pick, rich, lang } = useLang();
  return (
    <li className="mtb-slide-in flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-border py-3 last:border-b-0" style={{ "--i": i } as CSSProperties}>
      <div className="grid min-w-0 gap-1">
        <span className="font-medium text-ink">{pick(d.head, d.headUr)}</span>
        <span className="flex flex-wrap items-center gap-2 text-small text-ink-muted">
          <DateL value={d.dueDate} />
          <StatusBadge status={d.status} lang={lang} />
          {d.daysOverdue > 0 && <span>{rich("fees.daysOverdue", { n: <Ltr className="tabular-nums">{d.daysOverdue}</Ltr> })}</span>}
        </span>
      </div>
      <div className="grid justify-items-end text-end">
        <Money value={d.total} className="text-title-3 tabular-nums" />
        {d.lateFine > 0 && (
          <span className="text-small text-ink-muted">
            <Ltr className="tabular-nums">
              {formatRs(d.amount)} + {formatRs(d.lateFine)}
            </Ltr>
          </span>
        )}
      </div>
    </li>
  );
}

function ToPay({ f }: { f: PortalFees }) {
  const { t, rich, pick, name, lang } = useLang();
  if (f.dues.length === 0) {
    return (
      <Panel id="fees-due" title={t("fees.toPay")} rise={0} className="lg:col-span-2">
        <EmptyState icon="checkCircle" title={t("fees.cleared")} description={t("fees.clearedDesc", { child: firstName(pick(f.child.name, f.child.nameUr)) })} />
      </Panel>
    );
  }
  const overdue = f.dues.some((d) => d.status === "overdue");
  return (
    <Panel id="fees-due" title={t("fees.toPay")} rise={0} className="lg:col-span-2" actions={<StatusBadge status={overdue ? "overdue" : "unpaid"} lang={lang} />}>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-1">
            <span className="text-small text-ink-muted">{t("fees.totalDue")}</span>
            <Money value={f.totalDue} animate className="portal-figure tabular-nums" />
            {f.payBy && (
              <span className={cx("font-medium", overdue ? "text-status-overdue-ink" : "text-ink")}>
                {overdue ? rich("home.overdueSince", { date: <DateL value={f.payBy} /> }) : rich("home.payBy", { date: <DateL value={f.payBy} /> })}
              </span>
            )}
            {f.lateFineSoFar > 0 && <span className="text-small text-ink-muted">{rich("fees.fineSoFar", { amount: <Money value={f.lateFineSoFar} /> })}</span>}
          </div>
          <div className="grid gap-1">
            <Link to="/fees/voucher" className={buttonClassName({ variant: "primary", size: "touch" })}>
              <Icon name="download" size={18} />
              {t("fees.voucher")}
            </Link>
          </div>
        </div>
        <ul className="m-0 list-none p-0">
          {f.dues.map((d, i) => (
            <DueRow key={d.chargeId} d={d} i={i} />
          ))}
        </ul>
        <p className="m-0 flex items-start gap-2 text-small text-ink-muted">
          <Icon name="info" size={16} className="mt-1 shrink-0" />
          <span>
            {f.finePerDay > 0 && <>{rich("fees.fineRule", { amount: <Money value={f.finePerDay} /> })} </>}
            {f.bankName ? rich("fees.voucherHint", { bank: <span className="text-ink">{name(f.bankName)}</span> }) : t("fees.voucherHintCounter")}
          </span>
        </p>
      </div>
    </Panel>
  );
}

function SessionCard({ f }: { f: PortalFees }) {
  const { t, rich } = useLang();
  const toPay = Math.max(0, f.session.charged - f.session.paid);
  return (
    <Panel id="fees-session" title={t("fees.sessionTitle")} description={rich("fees.sessionDesc", { paid: <Money value={f.session.paid} />, total: <Money value={f.session.charged} />, session: <SessionL value={f.child.session} /> })} rise={1}>
      <div className="grid gap-3">
        <div dir="ltr">
          <SegmentedBar
            label={t("fees.sessionBar")}
            format={formatRs}
            segments={[
              { key: "paid", label: t("fees.sessionPaid"), value: f.session.paid, color: "var(--status-paid)" },
              { key: "due", label: t("fees.sessionToPay"), value: toPay, color: "var(--status-unpaid)" },
            ]}
          />
        </div>
        <ul className="m-0 grid list-none gap-1 p-0 text-small" aria-hidden="true">
          <li className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-ink-muted">
              <span className="size-2.5 rounded-sm bg-status-paid" />
              {t("fees.sessionPaid")}
            </span>
            <Money value={f.session.paid} className="font-medium text-ink tabular-nums" />
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-ink-muted">
              <span className="size-2.5 rounded-sm bg-status-unpaid" />
              {t("fees.sessionToPay")}
            </span>
            <Money value={toPay} className="font-medium text-ink tabular-nums" />
          </li>
        </ul>
      </div>
    </Panel>
  );
}

function ReceiptRow({ r, i, today }: { r: PortalReceiptRow; i: number; today: string }) {
  const { t, pick } = useLang();
  return (
    <li className="mtb-slide-in grid gap-2 border-b border-border py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4" style={{ "--i": i } as CSSProperties}>
      <div className="grid min-w-0 gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <Ltr mono className="font-medium text-ink">
            {r.receiptNo}
          </Ltr>
          {r.postedAt.slice(0, 10) === today && <StatusBadge status="success">{t("fees.receiptToday")}</StatusBadge>}
          {r.status === "CANCEL_PENDING" && <StatusBadge status="pending">{t("fees.receiptReview")}</StatusBadge>}
          {r.status === "CANCELLED" && <StatusBadge status="cancelled">{t("fees.receiptCancelled")}</StatusBadge>}
        </span>
        <span className="text-small text-ink-muted">
          <DateL value={r.postedAt} /> · {t(`fees.method.${r.method}`)}
        </span>
        <span className="truncate text-small text-ink">{r.heads.map((h) => pick(h.head, h.headUr)).join(" · ")}</span>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <Money value={r.total} className={cx("text-title-3 tabular-nums", r.status === "CANCELLED" && "text-ink-muted line-through")} />
        <Link to="/fees/receipts/$receiptNo" params={{ receiptNo: r.receiptNo }} className={buttonClassName({ variant: "secondary", size: "touch" })} aria-label={`${t("fees.download")} ${r.receiptNo}`}>
          <Icon name="download" size={18} />
          {t("fees.download")}
        </Link>
      </div>
    </li>
  );
}

function Receipts({ f }: { f: PortalFees }) {
  const { t, rich } = useLang();
  const sessions = [...new Set(f.receipts.map((r) => r.session))].sort((a, b) => b - a);
  return (
    <Panel id="fees-receipts" title={t("fees.receiptsTitle")} description={t("fees.receiptsDesc")} rise={2} className="lg:col-span-3">
      {f.receipts.length === 0 ? (
        <EmptyState icon="receipt" title={t("fees.receiptsNone")} description={t("fees.receiptsNoneDesc")} />
      ) : (
        <div className="grid gap-4">
          {sessions.map((s) => (
            <section key={s} aria-label={formatSession(s)}>
              {s !== f.child.session && <h3 className="m-0 mb-1 text-caption text-ink-subtle">{rich("fees.pastSession", { session: <SessionL value={s} /> })}</h3>}
              <ul className="m-0 list-none p-0">
                {f.receipts
                  .filter((r) => r.session === s)
                  .map((r, i) => (
                    <ReceiptRow key={r.receiptNo} r={r} i={i} today={f.today} />
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}

function FeesSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3" aria-busy="true">
      <div className="mtb-card grid gap-3 p-5 lg:col-span-2">
        <Skeleton width={120} />
        <Skeleton width="45%" height={44} />
        <Skeleton width="90%" />
        <Skeleton width="90%" />
      </div>
      <div className="mtb-card grid gap-3 p-5">
        <Skeleton width={120} />
        <Skeleton width="100%" height={14} />
      </div>
      <div className="mtb-card grid gap-3 p-5 lg:col-span-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width="100%" height={40} />
        ))}
      </div>
    </div>
  );
}

/** Fees: what is due now with the voucher to download, the session at a glance, and every receipt as a PDF. */
export function FeesPage() {
  const child = useChild()!;
  const { t } = useLang();
  const fees = useQuery(portalQueries.fees(child.grNo));
  return (
    <div key={child.grNo}>
      <PageHeader title={t("fees.title")} description={t("fees.desc")} />
      <QueryState query={fees} skeleton={<FeesSkeleton />}>
        {(f) => (
          <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
            <ToPay f={f} />
            <SessionCard f={f} />
            <Receipts f={f} />
          </div>
        )}
      </QueryState>
    </div>
  );
}
