import { activitiesApi, activitiesQueries, type ActivitiesAward, type ActivitiesCertificate } from "@mtb/api";
import { formatDate, formatDateTime, formatRs, formatSession } from "@mtb/domain";
import { Banner, Button, ConfirmDialog, DatePicker, EmptyState, Icon, KeyValue, Modal, SidePanel, Skeleton, Textarea, Timeline, useToast } from "@mtb/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { campusLabel } from "../../app/shell/campus";
import { useCan, useCtx, useReadOnly, useSessionUser } from "../../app/session";
import { AwardLetter } from "./print";
import { AwardBadge, dateLimits, errorText, monthStart, PrintLayer, RenewalBadge, useRefresh, useToday } from "./shared";

/** One award: who, what it does to fees, why, and the approval. Approve, reject, end or print the award letter. */
export function AwardPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const ctx = useCtx();
  const q = useQuery(activitiesQueries.award(ctx, id));
  const a = q.data;
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={a ? a.studentName : "Scholarship"}
      description={a ? `${a.awardNo} · ${a.schemeName} · session ${formatSession(a.session)}` : undefined}
      footer={a ? <AwardActions award={a} onClose={onClose} /> : undefined}
    >
      {q.isLoading ? (
        <div className="grid gap-3">
          <Skeleton height={60} />
          <Skeleton height={160} />
          <Skeleton height={120} />
        </div>
      ) : q.isError || !a ? (
        <EmptyState icon="alertCircle" title="This award couldn't be loaded" description={errorText(q.error)} action={<Button onClick={() => void q.refetch()}>Try again</Button>} />
      ) : (
        <AwardBody award={a} />
      )}
    </SidePanel>
  );
}

function AwardBody({ award: a }: { award: ActivitiesAward }) {
  const user = useSessionUser();
  const canDecide = useCan("approvals.decide");
  const fx = a.feeEffect;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <AwardBadge status={a.status} />
        <span className="text-small text-ink-muted">{a.valueText}</span>
      </div>

      {a.status === "PENDING" && (
        <Banner tone={canDecide && a.proposedBy !== user?.name ? "warning" : "info"} title="Waiting for approval">
          Proposed by {a.proposedBy} on {formatDateTime(a.proposedAt)}.{" "}
          {a.proposedBy === user?.name ? "You proposed it, so another approver (the principal or the admin) must decide it." : canDecide ? "Check the reason and documents, then approve or reject." : "The principal or the admin decides."}
        </Banner>
      )}
      {a.status === "REJECTED" && (
        <Banner tone="danger" title={`Rejected by ${a.decidedBy ?? "—"}`}>
          {a.decisionNote ?? "No reason given."}
        </Banner>
      )}
      {a.status === "ENDED" && (
        <Banner tone="neutral" title={`Ended on ${a.endedOn ? formatDate(a.endedOn) : "—"}`}>
          {a.endReason}
        </Banner>
      )}

      <section className="grid gap-2">
        <h3 className="m-0 text-body-strong">Fee effect</h3>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="mtb-table mtb-table-dense">
            <thead>
              <tr>
                <th>Fee</th>
                <th className="mtb-th-num">Usual</th>
                <th className="mtb-th-num">With the award</th>
                <th>Charged</th>
              </tr>
            </thead>
            <tbody>
              {fx.lines.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-ink-muted">
                    —
                  </td>
                </tr>
              )}
              {fx.lines.map((l) => (
                <tr key={l.head}>
                  <td>{l.label}</td>
                  <td className="mtb-td-num">
                    <span className="mtb-money">{formatRs(l.before)}</span>
                  </td>
                  <td className="mtb-td-num">
                    <span className="mtb-money font-semibold">{formatRs(l.after)}</span>
                  </td>
                  <td className="text-ink-muted">{l.per === "month" ? "Every month" : l.per === "year" ? "Once a year" : "On admission"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-surface-sunken p-3">
            <div className="text-small text-ink-muted">Off each monthly voucher</div>
            <div className="text-title-2 font-semibold tabular-nums">{fx.lines.length ? formatRs(fx.monthly) : "—"}</div>
          </div>
          <div className="rounded-md bg-surface-sunken p-3">
            <div className="text-small text-ink-muted">This session ({fx.months} {fx.months === 1 ? "month" : "months"})</div>
            <div className="text-title-2 font-semibold tabular-nums">{fx.lines.length ? formatRs(fx.session) : "—"}</div>
          </div>
        </div>
        <p className="m-0 flex gap-2 text-small text-ink-muted">
          <Icon name="info" size={16} className="mt-0.5 shrink-0" />
          {fx.note} The relief reaches vouchers as the award's concession in Fees.
        </p>
      </section>

      <KeyValue
        items={[
          ["Student", `${a.studentName} ${a.relation} ${a.father}`],
          [a.isApplicant ? "Application no." : "G.R. number", <span key="gr" className="mtb-num">{a.studentId}</span>],
          ["Class", `${a.classSection}${a.isApplicant ? " (applies once admitted)" : ""}`],
          ...(a.previousSchool ? ([["Previous school", a.previousSchool]] as Array<[string, ReactNode]>) : []),
          ["Campus", campusLabel(a.campus)],
          ["Scheme", a.schemeName],
          ["Relief", a.valueText],
          ["From", `${formatDate(a.effectiveFrom)} to ${formatDate(a.effectiveTo)}`],
          ["Why", a.reason],
          ["Documents seen", a.evidence || "—"],
          ...(a.listRound ? ([["Merit list round", `${["", "1st", "2nd", "3rd"][a.listRound] ?? `${a.listRound}th`} list`]] as Array<[string, ReactNode]>) : []),
          ...(a.testTitle
            ? ([
                [
                  "Merit list",
                  <Link key="t" to="/activities/tests/$testId" params={{ testId: a.testId! }} className="text-brand-ink underline">
                    {a.testTitle}
                    {a.rank ? ` · rank ${a.rank}` : ""}
                    {a.percent !== undefined ? ` · ${a.percent.toFixed(1)}%` : ""}
                  </Link>,
                ],
              ] as Array<[string, ReactNode]>)
            : []),
          ...(a.hasProfile
            ? ([
                [
                  "Profile",
                  <Link key="p" to="/students/$grNo" params={{ grNo: a.studentId }} className="text-brand-ink underline">
                    Open student profile
                  </Link>,
                ],
              ] as Array<[string, ReactNode]>)
            : []),
        ]}
      />

      {a.application && (
        <section className="grid gap-2">
          <h3 className="m-0 text-body-strong">Application form</h3>
          <KeyValue
            items={[
              ["Handed in on", formatDate(a.application.submittedOn)],
              ...(a.application.receiptNo ? ([["Receipt no.", <span key="r" className="mtb-num">{a.application.receiptNo}</span>]] as Array<[string, ReactNode]>) : []),
              ...(a.application.lastExam
                ? ([["Last examination", `${a.application.lastExam.name}${a.application.lastExam.rollNo ? ` · roll no. ${a.application.lastExam.rollNo}` : ""} · ${a.application.lastExam.obtained}/${a.application.lastExam.total} (${Math.round((a.application.lastExam.obtained / a.application.lastExam.total) * 1000) / 10}%)`]] as Array<[string, ReactNode]>)
                : []),
              ...(a.application.previousSchool ? ([["Previous school", a.application.previousSchool]] as Array<[string, ReactNode]>) : []),
              ...(a.application.staffParentName ? ([["Parent on the staff", a.application.staffParentName]] as Array<[string, ReactNode]>) : []),
              ...(a.application.subjectGroup ? ([["Subject group", a.application.subjectGroup]] as Array<[string, ReactNode]>) : []),
            ]}
          />
        </section>
      )}

      {a.renewal && (
        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="m-0 text-body-strong">Renewal check</h3>
            <RenewalBadge outcome={a.renewal.outcome} />
          </div>
          {a.renewal.checks.length === 0 ? (
            <p className="m-0 text-small text-ink-muted">No conditions to check.</p>
          ) : (
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {a.renewal.checks.map((c) => (
                <li key={c.label} className="flex items-start gap-2 text-small">
                  <Icon name={c.ok ? "checkCircle" : "alertCircle"} size={16} className={c.ok ? "mt-0.5 text-success-ink" : "mt-0.5 text-danger-ink"} />
                  <span>
                    <b>{c.label}</b> · {c.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {a.renewal.decision && (
            <p className="m-0 text-small">
              Decision: <b>{a.renewal.decision === "RENEW" ? "renew for next session" : a.renewal.decision === "REDUCE" ? `renew at ${a.basis === "FIXED" ? formatRs(a.renewal.newValue ?? 0) : `${a.renewal.newValue}%`}` : "end at session end"}</b> · {a.renewal.decidedBy}
            </p>
          )}
        </section>
      )}

      <section className="grid gap-2">
        <h3 className="m-0 text-body-strong">History</h3>
        <Timeline items={[...a.history].reverse().map((h) => ({ id: h.id, date: h.at.slice(0, 10), title: `${h.action} · ${h.by}`, description: h.detail, tone: h.action === "Approved" ? ("success" as const) : h.action === "Rejected" ? ("danger" as const) : ("neutral" as const) }))} />
      </section>
    </div>
  );
}

function AwardActions({ award: a, onClose }: { award: ActivitiesAward; onClose: () => void }) {
  const ctx = useCtx();
  const user = useSessionUser();
  const toast = useToast();
  const readOnly = useReadOnly();
  const canDecide = useCan("approvals.decide");
  const canManage = useCan("activities.manage");
  const qc = useRefresh();
  const [confirm, setConfirm] = useState<"approve" | "reject" | "end" | null>(null);
  const [note, setNote] = useState("");
  const [endOn, setEndOn] = useState<string | null>(null);
  const today = useToday();
  const [tried, setTried] = useState(false);
  const [letter, setLetter] = useState<ActivitiesCertificate | null>(null);

  const decide = useMutation({
    mutationFn: (decision: "APPROVE" | "REJECT") => activitiesApi.decideAward(a.id, { decision, note: note.trim() }),
    onSuccess: (x) => {
      qc();
      setConfirm(null);
      setNote("");
      toast({ tone: x.status === "APPROVED" ? "success" : "info", title: x.status === "APPROVED" ? "Scholarship approved" : "Scholarship rejected", message: x.status !== "APPROVED" ? `${x.studentName} · ${x.awardNo}` : x.isApplicant ? `${x.studentName} · ${x.awardNo}: ${x.feeEffect.note}` : `${x.studentName}: ${formatRs(x.feeEffect.monthly)} a month off tuition from the ${x.feeEffect.firstVoucher} voucher. Fees › Concessions shows it under ${x.awardNo}.` });
    },
  });
  const end = useMutation({
    mutationFn: () => activitiesApi.endAward(a.id, { endOn: endOn ?? "", reason: note.trim() }),
    onSuccess: (x) => {
      qc();
      setConfirm(null);
      setNote("");
      toast({ tone: "info", title: "Award ended", message: `${x.studentName}: no relief after ${formatDate(x.endedOn ?? x.effectiveTo)}.` });
    },
  });
  const print = useMutation({
    mutationFn: async () => {
      const [cert] = await activitiesApi.issueCertificates({ campus: a.campus, session: a.session }, { type: "SCHOLARSHIP", title: a.id });
      if (cert) await activitiesApi.recordPrint([cert.id]);
      return cert ?? null;
    },
    onSuccess: (c) => {
      qc();
      setLetter(c);
    },
  });

  const self = a.proposedBy === user?.name;
  const live = !readOnly && a.session === ctx.session;
  return (
    <>
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <Button onClick={onClose}>Close</Button>
        <div className="flex flex-wrap gap-2">
          {a.status === "APPROVED" && canManage && (
            <Button icon="printer" loading={print.isPending} onClick={() => print.mutate()} disabled={readOnly}>
              Print award letter
            </Button>
          )}
          {a.status === "APPROVED" && canManage && live && (
            <Button
              variant="danger-quiet"
              onClick={() => {
                setTried(false);
                setNote("");
                setEndOn(null);
                setConfirm("end");
              }}
            >
              End award
            </Button>
          )}
          {a.status === "PENDING" && canDecide && live && (
            <>
              <Button
                variant="danger-quiet"
                disabled={self}
                title={self ? "You proposed this award" : undefined}
                onClick={() => {
                  setTried(false);
                  setNote("");
                  setConfirm("reject");
                }}
              >
                Reject
              </Button>
              <Button variant="primary" icon="check" disabled={self} title={self ? "You proposed this award" : undefined} onClick={() => setConfirm("approve")}>
                Approve
              </Button>
            </>
          )}
        </div>
      </div>
      {print.isError && <Banner tone="danger">{errorText(print.error)}</Banner>}

      <ConfirmDialog
        open={confirm === "approve"}
        onClose={() => setConfirm(null)}
        onConfirm={() => decide.mutate("APPROVE")}
        title="Approve this scholarship?"
        message={a.isApplicant ? "It reaches the fees once the applicant is admitted. You can end it later if circumstances change." : "It becomes the student's concession in Fees from the first voucher shown. You can end it later if circumstances change."}
        details={[
          ["Student", `${a.studentName} · ${a.classSection}`],
          ["Scholarship", `${a.schemeName}: ${a.valueText}`],
          ["Off tuition a month", a.feeEffect.lines.length ? formatRs(a.feeEffect.monthly) : "—"],
          ["This session", a.feeEffect.lines.length ? `${formatRs(a.feeEffect.session)} from ${a.feeEffect.firstVoucher}` : "—"],
        ]}
        confirmLabel="Approve scholarship"
        loading={decide.isPending}
        loadingLabel="Approving…"
        error={decide.isError ? errorText(decide.error) : undefined}
      />

      <Modal
        open={confirm === "reject"}
        onClose={() => setConfirm(null)}
        title={`Reject ${a.studentName}'s ${a.schemeName.toLowerCase()}?`}
        description="The office tells the family why. The award stays in the history."
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={decide.isPending}
              onClick={() => {
                setTried(true);
                if (note.trim().length >= 5) decide.mutate("REJECT");
              }}
            >
              Reject award
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Textarea label="Reason" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={tried && note.trim().length < 5 ? "Say why it is rejected, in a sentence." : undefined} placeholder="For example: income documents don't match the home visit." />
          {decide.isError && <Banner tone="danger">{errorText(decide.error)}</Banner>}
        </div>
      </Modal>

      <Modal
        open={confirm === "end"}
        onClose={() => setConfirm(null)}
        title={`End ${a.studentName}'s ${a.schemeName.toLowerCase()}?`}
        description="Relief stops after the month you choose. Vouchers already posted keep it."
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Keep the award</Button>
            <Button
              variant="danger"
              loading={end.isPending}
              onClick={() => {
                setTried(true);
                if (endOn && note.trim().length >= 5) end.mutate();
              }}
            >
              End award
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <DatePicker label="Last day of relief" required value={endOn} onValueChange={setEndOn} {...dateLimits(monthStart(today), a.effectiveTo)} today={today} error={tried && !endOn ? "Choose the last day the award applies." : undefined} />
          <Textarea label="Reason" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={tried && note.trim().length < 5 ? "Say why the award ends." : undefined} />
          {end.isError && <Banner tone="danger">{errorText(end.error)}</Banner>}
        </div>
      </Modal>

      {letter && (
        <PrintLayer paper="A4" onDone={() => setLetter(null)}>
          <AwardLetter award={a} letterNo={letter.certNo} />
        </PrintLayer>
      )}
    </>
  );
}
