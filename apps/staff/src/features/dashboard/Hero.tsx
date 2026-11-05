import type { DashboardSummary } from "@mtb/api";
import { formatCount, formatLongDate, formatPercent, formatRs, formatSession } from "@mtb/domain";
import { buttonClassName, Icon, Kbd, Skeleton, type IconName } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import { campusLabel } from "../../app/shell/campus";
import { openGlobalSearch } from "../../app/shell/GlobalSearch";
import { useCan, useCtx, useSessionUser } from "../../app/session";
import { firstName, greeting, stagger, TODAY } from "./format";

function Glance({ icon, value, label, i, to }: { icon: IconName; value: string; label: string; i: number; to?: string }) {
  const body = (
    <>
      <span className="mtb-dash-glance-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="grid min-w-0">
        <span className="mtb-dash-glance-value">{value}</span>
        <span className="truncate text-small text-ink-muted">{label}</span>
      </span>
    </>
  );
  return (
    <li className="mtb-rise" style={stagger(i + 2)}>
      {to ? (
        <Link to={to} className="mtb-dash-glance">
          {body}
        </Link>
      ) : (
        <div className="mtb-dash-glance">{body}</div>
      )}
    </li>
  );
}

/** Greeting, today's headline in one sentence, the main actions, and three small figures. */
export function Hero({ s, approvals }: { s: DashboardSummary | undefined; approvals: number | undefined }) {
  const user = useSessionUser();
  const ctx = useCtx();
  const canCollect = useCan("fees.collect");
  const canAdmissions = useCan("admissions.view");
  const canSms = useCan("sms.view");
  const canApprove = useCan("approvals.decide");
  const canStaff = useCan("hr.view");
  const staff = s?.staff;
  // Before anyone is marked today (the fingerprint file comes in later), show the roll rather than "0 present".
  const staffMarked = staff ? staff.total - staff.notMarked - staff.onLeave > 0 : false;
  const delta = s?.attendance.deltaPts ?? 0;

  return (
    <section className="mtb-dash-hero mtb-rise" aria-labelledby="dash-greeting">
      <div className="mtb-dash-hero-art" aria-hidden="true">
        <span className="mtb-dash-orb mtb-dash-orb-a" />
        <span className="mtb-dash-orb mtb-dash-orb-b" />
      </div>
      <div className="relative grid min-w-0 content-start gap-3">
        <p className="m-0 flex flex-wrap items-center gap-x-2 text-small font-medium text-ink-muted">
          <span className="mtb-dash-live" aria-hidden="true" />
          <span>Dashboard</span>
          <span aria-hidden="true">·</span>
          <span>{formatLongDate(TODAY)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {campusLabel(ctx.campus)} · Session {formatSession(ctx.session)}
          </span>
        </p>
        <h1 id="dash-greeting" className="m-0 text-display mtb-dash-hello">
          {greeting()}, {user ? firstName(user.name) : ""}
        </h1>
        <p className="m-0 max-w-[62ch] text-body text-ink-muted">
          {s ? (
            <>
              <strong className="font-semibold text-ink">{formatRs(s.feesToday.amount)}</strong> collected so far today from {formatCount(s.feesToday.receipts)} receipts. Attendance is{" "}
              <strong className="font-semibold text-ink">{formatPercent(s.attendance.percent)}</strong>
              {delta === 0 ? ", the same as yesterday." : `, ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} points on yesterday.`}
            </>
          ) : (
            <Skeleton width="80%" />
          )}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {canCollect && ctx.campus !== "ALL" && (
            <Link to="/fees/counter" className={buttonClassName({ variant: "primary" })}>
              <Icon name="fees" size={18} />
              Collect fee
            </Link>
          )}
          <button type="button" className={buttonClassName({ variant: "secondary" })} onClick={openGlobalSearch} aria-keyshortcuts="Control+K">
            <Icon name="search" size={18} />
            Find a student
            <span className="ml-1 hidden items-center gap-1 sm:inline-flex" aria-hidden="true">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
        </div>
      </div>
      <ul className="mtb-dash-glances" aria-label="At a glance">
        {s ? (
          <>
            <Glance i={0} icon="admissions" value={`${formatCount(s.admissions.session)} admissions`} label={`+${formatCount(s.admissions.week)} this week`} {...(canAdmissions ? { to: "/admissions" } : {})} />
            {staff && staff.total > 0 && (
              <Glance
                i={1}
                icon="hr"
                value={staffMarked ? `Staff present: ${formatCount(staff.present)} of ${formatCount(staff.total)}` : `${formatCount(staff.total)} staff on roll today`}
                label={staffMarked ? `${formatCount(staff.late)} late · ${formatCount(staff.onLeave)} on leave` : `Not marked yet · ${formatCount(staff.onLeave)} on leave`}
                {...(canStaff ? { to: "/hr/attendance" } : {})}
              />
            )}
            <Glance i={2} icon="sms" value={`${formatCount(s.sms.delivered)} SMS delivered`} label={`${formatCount(s.sms.failed)} failed · ${formatCount(s.sms.queued)} queued`} {...(canSms ? { to: "/sms" } : {})} />
            {canApprove && approvals !== undefined && <Glance i={3} icon="inbox" value={`${formatCount(approvals)} approvals waiting`} label="Attendance and receipts" />}
          </>
        ) : (
          [0, 1, 2, 3].map((i) => (
            <li key={i} className="mtb-dash-glance">
              <Skeleton width={36} height={36} />
              <Skeleton width={140} />
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
