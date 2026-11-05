import { portalQueries, type PortalHome } from "@mtb/api";
import { daysBetween, type AttendanceCode } from "@mtb/domain";
import { buttonClassName, cx, EmptyState, Icon, Panel, SegmentedBar, Skeleton, StatusBadge, type AttendanceStatus } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, type CSSProperties } from "react";
import { DateL, firstName, LongDate, Money, Percent } from "../../app/format";
import { Ltr, useLang } from "../../app/i18n";
import { QueryState } from "../../app/shell/page";
import { useAccount, useChild } from "../../app/session";

export const ATT_STATUS: Record<AttendanceCode, AttendanceStatus> = { P: "present", A: "absent", L: "leave", LT: "late", H: "holiday" };

function Hero({ h }: { h: PortalHome | undefined }) {
  const account = useAccount();
  const child = useChild()!;
  const { rich, pick } = useLang();
  const childName = <strong className="font-semibold text-ink">{firstName(pick(child.name, child.nameUr))}</strong>;
  return (
    <section className="portal-hero mtb-rise grid gap-2 p-5 lg:p-8" aria-labelledby="home-greeting">
      <p className="m-0 text-small font-medium text-ink-muted">{h ? <LongDate value={h.today} /> : <Skeleton width={160} />}</p>
      <h1 id="home-greeting" className="m-0 text-title-1 text-ink lg:text-display">
        {rich("home.greeting", { name: firstName(pick(account.name, account.nameUr)) })}
      </h1>
      <p className="m-0 max-w-[60ch] text-ink-muted">
        {!h ? (
          <Skeleton width="70%" />
        ) : h.fees.due === 0 ? (
          rich("home.summaryClear", { child: childName })
        ) : h.fees.status === "overdue" ? (
          rich("home.summaryOverdue", { child: childName, amount: <Money value={h.fees.overdue} className="font-semibold text-ink tabular-nums" /> })
        ) : (
          rich("home.summaryDue", { child: childName, amount: <Money value={h.fees.due} className="font-semibold text-ink tabular-nums" />, date: <DateL value={h.fees.payBy ?? h.today} className="font-semibold text-ink" /> })
        )}
      </p>
    </section>
  );
}

function FeesCard({ h }: { h: PortalHome }) {
  const { t, tp, rich, lang } = useLang();
  const f = h.fees;
  if (f.due === 0) {
    return (
      <Panel id="home-fees" title={t("home.feesTitle")} rise={1} className="lg:col-span-2">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-status-paid-tint text-status-paid-ink">
            <Icon name="checkCircle" size={28} />
          </span>
          <div className="grid min-w-0 flex-1 gap-1">
            <h3 className="m-0 text-title-2 text-ink">{t("home.cleared")}</h3>
            <p className="m-0 text-ink-muted">{t("home.clearedDesc")}</p>
            {f.lastReceipt && <p className="m-0 text-small text-ink-muted">{rich("home.lastPaid", { amount: <Money value={f.lastReceipt.total} />, date: <DateL value={f.lastReceipt.postedAt} /> })}</p>}
          </div>
          <Link to="/fees" className={buttonClassName({ variant: "secondary", size: "touch" })}>
            {t("home.feeDetails")}
          </Link>
        </div>
      </Panel>
    );
  }
  const overdue = f.status === "overdue";
  const left = f.payBy ? daysBetween(h.today, f.payBy) : 0;
  return (
    <Panel id="home-fees" title={t("home.feesTitle")} rise={1} className="lg:col-span-2" actions={<StatusBadge status={overdue ? "overdue" : "unpaid"} lang={lang} />}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="grid gap-1">
          <Money value={f.due} animate className="portal-figure tabular-nums" />
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-muted">
            {f.payBy &&
              (overdue ? (
                <span className="font-medium text-status-overdue-ink">{rich("home.overdueSince", { date: <DateL value={f.payBy} /> })}</span>
              ) : (
                <span className="font-medium text-ink">{rich("home.payBy", { date: <DateL value={f.payBy} /> })}</span>
              ))}
            {!overdue && f.payBy && (
              <span className="inline-flex items-center gap-1 text-small">
                <Icon name="clock" size={16} />
                {left === 0 ? t("home.dueToday") : tp("home.daysLeft", left)}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/fees/voucher" className={buttonClassName({ variant: "primary", size: "touch" })}>
            <Icon name="download" size={18} />
            {t("home.voucher")}
          </Link>
          <Link to="/fees" className={buttonClassName({ variant: "secondary", size: "touch" })}>
            {t("home.feeDetails")}
          </Link>
        </div>
      </div>
    </Panel>
  );
}

function AttendanceCard({ h }: { h: PortalHome }) {
  const { t, rich, lang, pick } = useLang();
  const a = h.attendance;
  const m = a.month;
  return (
    <Panel id="home-att" title={t("home.attTitle")} rise={2}>
      <div className="grid gap-3">
        {a.code === null ? (
          <div className="grid gap-1">
            <span>
              <StatusBadge status="neutral" icon="clock" size="lg">
                {t("home.attNotMarked")}
              </StatusBadge>
            </span>
            <p className="m-0 text-small text-ink-muted">{t("home.attNotMarkedDesc")}</p>
          </div>
        ) : (
          <div className="grid gap-1">
            <span>
              <StatusBadge status={ATT_STATUS[a.code]} size="lg" lang={lang} />
            </span>
            {a.holiday && <p className="m-0 text-small text-ink-muted">{rich("home.attHoliday", { name: pick(a.holiday.name, a.holiday.nameUr) })}</p>}
            {(a.code === "A" || a.code === "LT") && <p className="m-0 text-small text-ink-muted">{t("home.attAbsentNote")}</p>}
          </div>
        )}
        {m.percent !== null && (
          <div className="grid gap-2">
            <p className="m-0 text-small text-ink-muted">
              {rich("home.attMonth", {
                percent: <Percent value={m.percent} />,
                present: <Ltr className="tabular-nums">{m.present + m.late}</Ltr>,
                days: <Ltr className="tabular-nums">{m.schoolDays}</Ltr>,
              })}
            </p>
            <div dir="ltr">
              <SegmentedBar
                label={t("att.attended")}
                height={10}
                segments={[
                  { key: "P", label: t("att.present"), value: m.present, color: "var(--status-present)" },
                  { key: "LT", label: t("att.late"), value: m.late, color: "var(--status-late)" },
                  { key: "L", label: t("att.leave"), value: m.leave, color: "var(--status-leave)" },
                  { key: "A", label: t("att.absent"), value: m.absent, color: "var(--status-absent)" },
                ]}
              />
            </div>
          </div>
        )}
        <Link to="/attendance" className="inline-flex min-h-11 items-center gap-1 font-medium text-brand-ink no-underline hover:underline">
          {t("home.attCalendar")}
          <Icon name="chevronRight" size={16} className="portal-flip" />
        </Link>
      </div>
    </Panel>
  );
}

function ResultCard({ h }: { h: PortalHome }) {
  const { t, rich, pick, lang } = useLang();
  const r = h.result;
  return (
    <Panel id="home-result" title={t("home.resultTitle")} rise={3}>
      {!r ? (
        <EmptyState icon="exams" title={t("home.resultNone")} description={t("home.resultNoneDesc")} className="py-4" />
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-ink">{pick(r.exam, r.examUr)}</span>
            <StatusBadge status="declared" icon="lock" lang={lang} />
          </div>
          <dl className="m-0 grid grid-cols-3 gap-2">
            <div className="rounded-md bg-surface-sunken p-3">
              <dt className="text-caption text-ink-muted">{t("res.percent")}</dt>
              <dd className="m-0 text-title-2 text-ink">
                <Percent value={r.percent} animate />
              </dd>
            </div>
            <div className="rounded-md bg-surface-sunken p-3">
              <dt className="text-caption text-ink-muted">{t("res.grade")}</dt>
              <dd className="m-0 text-title-2 text-ink">
                <Ltr>{r.grade}</Ltr>
              </dd>
            </div>
            <div className="rounded-md bg-surface-sunken p-3">
              <dt className="text-caption text-ink-muted">{rich("res.position", { cls: <Ltr>{r.classSection}</Ltr> })}</dt>
              <dd className="m-0 text-title-2 text-ink">
                <Ltr className="tabular-nums">{r.position ?? "—"}</Ltr>
              </dd>
            </div>
          </dl>
          <p className="m-0 text-small text-ink-muted">{rich("home.resultMarks", { obtained: <Ltr className="tabular-nums">{r.obtained}</Ltr>, total: <Ltr className="tabular-nums">{r.total}</Ltr> })}</p>
          <Link to="/results" className="inline-flex min-h-11 items-center gap-1 font-medium text-brand-ink no-underline hover:underline">
            {t("home.resultOpen")}
            <Icon name="chevronRight" size={16} className="portal-flip" />
          </Link>
        </div>
      )}
    </Panel>
  );
}

function NoticesCard({ h }: { h: PortalHome }) {
  const { t, pick } = useLang();
  return (
    <Panel
      id="home-notices"
      title={t("home.noticesTitle")}
      rise={4}
      className="lg:col-span-2"
      actions={h.unreadNotices > 0 ? <StatusBadge status="brand">{t("home.noticesUnread", { n: h.unreadNotices })}</StatusBadge> : undefined}
    >
      {h.notices.length === 0 ? (
        <p className="m-0 text-ink-muted">{t("home.noticesNone")}</p>
      ) : (
        <ul className="m-0 grid list-none gap-1 p-0">
          {h.notices.map((n, i) => (
            <li key={n.id} className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
              <Link to="/notices" hash={n.id} className="flex items-start gap-3 rounded-md px-2 py-2.5 no-underline hover:bg-surface-hover">
                <span className={cx("mt-2", n.read ? "size-2" : "portal-unread-dot")} aria-hidden="true" />
                <span className="grid min-w-0 flex-1">
                  <span className={cx("text-ink", !n.read && "font-semibold")}>
                    {pick(n.title, n.titleUr)}
                    {!n.read && <span className="mtb-sr-only"> ({t("not.new")})</span>}
                  </span>
                  <span className="text-small text-ink-muted">
                    <DateL value={n.publishedAt} />
                  </span>
                </span>
                {n.pinned && <Icon name="star" size={16} className="mt-1 shrink-0 text-ink-subtle" label={t("not.pinned")} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/notices" className="mt-2 inline-flex min-h-11 items-center gap-1 font-medium text-brand-ink no-underline hover:underline">
        {t("home.noticesAll")}
        <Icon name="chevronRight" size={16} className="portal-flip" />
      </Link>
    </Panel>
  );
}

function HomeSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={cx("mtb-card grid gap-3 p-5", (i === 0 || i === 3) && "lg:col-span-2")}>
          <Skeleton width={140} />
          <Skeleton width="50%" height={36} />
          <Skeleton width="80%" />
        </div>
      ))}
    </div>
  );
}

/** Home: what is due, today's attendance, the latest declared result and notices, for the child on screen. */
export function HomePage() {
  const child = useChild()!;
  const { t, pick } = useLang();
  const home = useQuery(portalQueries.home(child.grNo));
  useEffect(() => {
    document.title = `${t("home.title")} · ${pick(child.name, child.nameUr)} · ${t("app.name")}`;
  }, [t, pick, child.name, child.nameUr]);

  return (
    <div key={child.grNo} className="grid gap-4 lg:gap-6">
      <Hero h={home.data} />
      <QueryState query={home} skeleton={<HomeSkeleton />}>
        {(h) => (
          <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
            <FeesCard h={h} />
            <AttendanceCard h={h} />
            <ResultCard h={h} />
            <NoticesCard h={h} />
          </div>
        )}
      </QueryState>
    </div>
  );
}
