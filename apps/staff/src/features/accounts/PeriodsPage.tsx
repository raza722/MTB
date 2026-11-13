import { accountsApi, accountsQueries, can, type AccountsPeriod, type CampusCode } from "@mtb/api";
import { formatDate, formatDateTime } from "@mtb/domain";
import { Banner, Button, ConfirmDialog, cx, EmptyState, Icon, Modal, Panel, SidePanel, Skeleton, StatusBadge, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useCtx, useReadOnly, useSessionUser } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { AccLink, AccountsShell, errorText, LoadError, monthName, monthShort, sessionMonths, slide } from "./shared";

const CAMPUS_ORDER: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];

function PeriodBadge({ p }: { p: AccountsPeriod }) {
  if (p.status === "CLOSED")
    return (
      <StatusBadge status="declared" icon="lock">
        Closed
      </StatusBadge>
    );
  if (p.status === "FUTURE") return <StatusBadge status="neutral">Not started</StatusBadge>;
  return <StatusBadge status={p.canClose ? "approved" : "pending"}>{p.canClose ? "Ready to close" : "Open"}</StatusBadge>;
}

/** /accounts/periods — month close: once a month is closed, nothing can be dated in it. */
export function PeriodsPage() {
  const ctx = useCtx();
  const q = useQuery(accountsQueries.periods(ctx));
  const [open, setOpen] = useState<{ campus: CampusCode; month: string } | null>(null);
  const list = q.data ?? [];
  const months = sessionMonths(ctx.session);
  const selected = open ? list.find((p) => p.campus === open.campus && p.month === open.month) : undefined;
  const ready = list.filter((p) => p.status === "OPEN" && p.canClose);
  const blocked = list.filter((p) => p.status === "OPEN" && !p.canClose && p.checks.find((c) => c.key === "ENDED")?.ok);

  return (
    <AccountsShell title="Month close">
      <Banner tone="neutral" icon="lock" title="Closing a month locks it.">
        After a month is closed, no voucher, fee batch or reversal can be dated in it, so reports for that month never change. The old system had no month close; back-dated entries changed figures that had already been reported. Only an admin can reopen a month, with a reason.
      </Banner>
      {q.error && !q.data ? (
        <LoadError what="Months" error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} height={120} />
          ))}
        </div>
      ) : ctx.campus === "ALL" ? (
        <>
          {(ready.length > 0 || blocked.length > 0) && (
            <div className="grid gap-2">
              {ready.map((p) => (
                <Banner key={`${p.campus}${p.month}`} tone="success" icon="checkCircle" title={`${p.campusName}: ${monthName(p.month)} is ready to close.`} actions={<Button size="sm" onClick={() => setOpen({ campus: p.campus, month: p.month })}>Review and close</Button>}>
                  Every check passes.
                </Banner>
              ))}
              {blocked.map((p) => (
                <Banner key={`${p.campus}${p.month}`} tone="warning" title={`${p.campusName}: ${monthName(p.month)} can't be closed yet.`} actions={<Button size="sm" variant="secondary" onClick={() => setOpen({ campus: p.campus, month: p.month })}>See what's left</Button>}>
                  {p.checks.filter((c) => !c.ok).map((c) => c.label).join("; ")}.
                </Banner>
              ))}
            </div>
          )}
          <Panel id="periods-matrix" rise={1} title="Every campus, every month" description="Click a month to see its checks." flush>
            <div className="mtb-table-scroll">
              <table className="mtb-table acc-matrix acc-stagger">
                <caption className="mtb-sr-only">Month status by campus</caption>
                <thead>
                  <tr>
                    <th scope="col">Campus</th>
                    {months.map((m) => (
                      <th key={m} scope="col">
                        {monthShort(m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CAMPUS_ORDER.map((c) => (
                    <tr key={c}>
                      <td>{campusLabel(c)}</td>
                      {months.map((m) => {
                        const p = list.find((x) => x.campus === c && x.month === m);
                        if (!p) return <td key={m} />;
                        const label = `${campusLabel(c)}, ${monthName(m)}: ${p.status === "CLOSED" ? "closed" : p.status === "FUTURE" ? "not started" : p.canClose ? "ready to close" : "open"}`;
                        return (
                          <td key={m}>
                            <button type="button" className={cx("acc-cell", p.status === "CLOSED" ? "is-closed" : p.status === "OPEN" ? "is-open" : "is-future")} aria-label={label} title={label} onClick={() => setOpen({ campus: c, month: m })}>
                              <Icon name={p.status === "CLOSED" ? "lock" : p.status === "OPEN" ? (p.canClose ? "checkCircle" : "unlock") : "minus"} />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mtb-table-footer">
              <span className="inline-flex flex-wrap gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="lock" size={14} /> Closed
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="unlock" size={14} /> Open
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="checkCircle" size={14} /> Ready to close
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="minus" size={14} /> Not started
                </span>
              </span>
            </div>
          </Panel>
        </>
      ) : list.length === 0 ? (
        <div className="mtb-card">
          <EmptyState icon="calendar" title="No months to show" />
        </div>
      ) : (
        <div className="acc-months">
          {list.map((p, i) => (
            <button
              key={p.month}
              type="button"
              className={cx("acc-month mtb-rise", p.status === "OPEN" && "is-open", p.status === "FUTURE" && "is-future")}
              style={slide(i)}
              onClick={() => setOpen({ campus: p.campus, month: p.month })}
              disabled={p.status === "FUTURE"}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{monthName(p.month)}</span>
                <PeriodBadge p={p} />
              </span>
              <span className="text-small text-ink-muted">
                {p.status === "CLOSED"
                  ? `Closed by ${p.closedBy ?? "—"}${p.closedAt ? ` on ${formatDate(p.closedAt)}` : ""}`
                  : p.status === "OPEN"
                    ? `${p.checks.filter((c) => c.ok).length} of ${p.checks.length} checks pass`
                    : "Opens when the month starts"}
              </span>
              {p.reopened && <span className="text-small text-warning-ink">Reopened by {p.reopened.by}: {p.reopened.reason}</span>}
            </button>
          ))}
        </div>
      )}
      {selected && <PeriodPanel p={selected} onClose={() => setOpen(null)} />}
    </AccountsShell>
  );
}

function PeriodPanel({ p, onClose }: { p: AccountsPeriod; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  // Rights at the month's own campus (the server checks them there too).
  const user = useSessionUser();
  const canPost = can(user, "accounts.post", p.campus);
  const canReopen = can(user, "settings.manage", p.campus);
  const [confirm, setConfirm] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);

  const close = useMutation({
    mutationFn: () => accountsApi.closePeriod({ campus: p.campus, month: p.month }),
    onSuccess: () => {
      setConfirm(false);
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: `${monthName(p.month)} closed for ${p.campusName}`, message: "Nothing can be dated in it from now on." });
      onClose();
    },
  });
  const reopenM = useMutation({
    mutationFn: () => accountsApi.reopenPeriod({ campus: p.campus, month: p.month, reason }),
    onSuccess: () => {
      setReopen(false);
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast({ tone: "warning", title: `${monthName(p.month)} reopened for ${p.campusName}`, message: "Vouchers can be dated in it again. Close it again once the correction is posted." });
      onClose();
    },
  });

  return (
    <SidePanel
      open
      onClose={onClose}
      title={`${monthName(p.month)} · ${p.campusName}`}
      description={p.status === "CLOSED" ? "This month is locked." : p.status === "FUTURE" ? "This month hasn't started." : "Every check must pass before the month is closed."}
      footer={
        <>
          <Button onClick={onClose}>Close panel</Button>
          {p.status === "OPEN" && canPost && !readOnly && (
            <Button variant="primary" icon="lock" disabled={!p.canClose} onClick={() => setConfirm(true)}>
              Close {monthName(p.month)}
            </Button>
          )}
          {p.status === "CLOSED" && p.canReopen && canReopen && !readOnly && (
            <Button variant="danger-quiet" icon="unlock" onClick={() => setReopen(true)}>
              Reopen month
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-5">
        <div className="flex items-center gap-2">
          <PeriodBadge p={p} />
          {p.closedAt && (
            <span className="text-small text-ink-muted">
              by {p.closedBy}, {formatDateTime(p.closedAt)}
            </span>
          )}
        </div>
        {p.reopened && (
          <Banner tone="warning" title={`Reopened by ${p.reopened.by} on ${formatDateTime(p.reopened.at)}.`}>
            {p.reopened.reason}
          </Banner>
        )}
        {p.status === "OPEN" && (
          <ul className="acc-checks">
            {p.checks.map((c, i) => (
              <li key={c.key} className="mtb-slide-in" style={slide(i)}>
                <Icon name={c.ok ? "checkCircle" : "alertCircle"} size={20} className={c.ok ? "acc-check-ok" : "acc-check-no"} />
                <span className="grid gap-0.5">
                  <span className="font-medium">{c.label}</span>
                  <span className="text-small text-ink-muted">{c.detail}</span>
                  {!c.ok && c.link && (
                    <span>
                      <AccLink to={c.link.to} search={c.link.search ?? {}}>
                        Put it right
                      </AccLink>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {p.status === "CLOSED" && !p.canReopen && <p className="m-0 text-small text-ink-muted">Months reopen from the latest closed month backwards.</p>}
        {p.status === "CLOSED" && p.canReopen && !canReopen && <p className="m-0 text-small text-ink-muted">Only an admin can reopen a month.</p>}
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => close.mutate()}
        title={`Close ${monthName(p.month)} for ${p.campusName}?`}
        message="No voucher, fee batch or reversal can be dated in this month after it closes. An admin can reopen it with a reason."
        details={p.checks.map((c) => [c.label, c.ok ? "Passed" : "Not passed"] as [string, string])}
        confirmLabel={`Close ${monthName(p.month)}`}
        icon="lock"
        loading={close.isPending}
        loadingLabel="Closing…"
        {...(close.error ? { error: errorText(close.error) } : {})}
      />
      <Modal
        open={reopen}
        onClose={() => setReopen(false)}
        title={`Reopen ${monthName(p.month)} for ${p.campusName}?`}
        description="Reports for this month may change once vouchers are dated in it again. The reason is kept with the month."
        footer={
          <>
            <Button onClick={() => setReopen(false)}>Cancel</Button>
            <Button
              variant="danger"
              icon="unlock"
              loading={reopenM.isPending}
              loadingLabel="Reopening…"
              onClick={() => {
                setTried(true);
                if (reason.trim().length >= 10) reopenM.mutate();
              }}
            >
              Reopen month
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Textarea
            label="Why does it need reopening?"
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. The auditor found a September bill posted to the wrong account."
            {...(tried && reason.trim().length < 10 ? { error: "Write a short sentence, so the reason stays with the month." } : {})}
          />
          {reopenM.error && <Banner tone="danger">{errorText(reopenM.error)}</Banner>}
        </div>
      </Modal>
    </SidePanel>
  );
}
