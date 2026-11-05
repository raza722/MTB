import {
  CURRENT_SESSION,
  ENROLMENT_STATUS_LABEL,
  metaQueries,
  newIdempotencyKey,
  STUDENT_MOVEMENT_LABEL,
  STUDENT_MOVEMENT_REASONS,
  studentDocsQueries,
  studentFamiliesQueries,
  studentMovementsAllowed,
  studentMovementsApi,
  studentMovementsQueries,
  studentPromotionQueries,
  sectionAllotmentQueries,
  studentsQueries,
  type CampusCode,
  type StudentMovement,
  type StudentMovementChange,
} from "@mtb/api";
import { formatDate, formatMobile, formatRs } from "@mtb/domain";
import { Banner, Button, buttonClassName, Combobox, ConfirmDialog, DatePicker, Input, Segmented, Select, SidePanel, Skeleton, Switch, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useCan, useCtx } from "../../../app/session";
import { AddChargePanel } from "../../fees/ledger/ChargePanels";
import { PrintSheet, printNow } from "../documents/print";
import { ReadmissionStatement, StatusNotice } from "../documents/templates";
import { apiMessage, EnrolmentBadge, fieldError, TODAY } from "../shared";

type Kind = StudentMovementChange["kind"];

const KIND_HELP: Record<Kind, string> = {
  LEFT: "The student stops attending. Dues stay on the ledger; issue the leaving certificate from ID cards & certificates.",
  STRUCK_OFF: "Temporary: the seat is held and the student can be restored (continuous absence or unpaid dues).",
  EXPELLED: "A disciplinary decision approved by the principal. Printed notices and result cards show it.",
  RESTORED: "Back in the same class and section, with the history kept.",
  TRANSFER: "Moves to the same class at another campus. G.R. number, history, fees and family stay with the student.",
};

const schema = z
  .object({
    kind: z.enum(["LEFT", "STRUCK_OFF", "EXPELLED", "RESTORED", "TRANSFER"]),
    date: z.string({ error: "Choose the date." }).min(1, { error: "Choose the date." }),
    reason: z.string().trim().min(1, { error: "Choose a reason." }),
    remarks: z.string().optional(),
    approvedBy: z.string().optional(),
    toCampus: z.string().optional(),
    toClassSection: z.string().optional(),
  })
  .superRefine((v, c) => {
    if (v.date > TODAY) c.addIssue({ code: "custom", path: ["date"], message: "The date can't be in the future." });
    if (v.kind === "EXPELLED" && !v.approvedBy?.trim()) c.addIssue({ code: "custom", path: ["approvedBy"], message: "Enter who approved the expulsion (the principal)." });
    if (v.kind === "TRANSFER" && !v.toCampus) c.addIssue({ code: "custom", path: ["toCampus"], message: "Choose the campus the student is moving to." });
    if (v.kind === "TRANSFER" && !v.toClassSection) c.addIssue({ code: "custom", path: ["toClassSection"], message: "Choose the section at the new campus." });
  });

/** Record leaving, struck off, expulsion, restore or a campus transfer for one student, with a reason and a date. */
export function StatusChangePanel({ open, onClose, grNo: fixedGrNo, initialKind }: { open: boolean; onClose: () => void; grNo?: string; initialKind?: Kind }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [grNo, setGrNo] = useState(fixedGrNo ?? "");
  const roster = useQuery({ ...studentsQueries.list(ctx, {}), enabled: open && !fixedGrNo });
  const profile = useQuery({ ...studentsQueries.profile(grNo), enabled: open && Boolean(grNo) });
  const campuses = useQuery(metaQueries.campuses());
  const classes = useQuery(metaQueries.classes("ALL"));
  const p = profile.data;
  const allowed = useMemo(() => (p ? studentMovementsAllowed(p.status) : []), [p]);
  const [form, setForm] = useState<StudentMovementChange>({ kind: initialKind ?? "LEFT", date: TODAY, reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const [done, setDone] = useState<StudentMovement | null>(null);
  // Restored: the struck-off note it replaced, for the re-admission statement; and the re-admission fee panel.
  const [previous, setPrevious] = useState<{ on: string; reason: string } | null>(null);
  const [charging, setCharging] = useState(false);
  const canCollect = useCan("fees.collect");
  const canSetFees = useCan("fees.setup");
  const canCharge = canCollect || canSetFees;
  const canSms = useCan("sms.send");

  useEffect(() => {
    if (!open) return;
    setGrNo(fixedGrNo ?? "");
    setDone(null);
    setPrevious(null);
    setCharging(false);
    setErrors({});
    setConfirming(false);
    setKey(newIdempotencyKey());
  }, [open, fixedGrNo]);

  useEffect(() => {
    if (!p) return;
    const kind = initialKind && allowed.includes(initialKind) ? initialKind : (allowed[0] ?? "LEFT");
    setForm({ kind, date: TODAY, reason: "", ...(kind === "EXPELLED" || kind === "STRUCK_OFF" ? { approvedBy: p.campus === "KC" ? "Mrs Sadia Rehman" : "" } : {}) });
  }, [p?.grNo, p?.status, initialKind]); // eslint-disable-line react-hooks/exhaustive-deps

  const record = useMutation({
    mutationFn: () => studentMovementsApi.record(grNo, form.kind === "EXPELLED" ? form : { ...form, sendNoticeSms: undefined }, key),
    onSuccess: (m) => {
      setConfirming(false);
      setPrevious(m.kind === "RESTORED" && p?.statusNote ? { on: p.statusNote.on, reason: p.statusNote.reason } : null);
      setDone(m);
      for (const k of [studentsQueries.all(), studentMovementsQueries.all(), studentFamiliesQueries.all(), studentPromotionQueries.all(), sectionAllotmentQueries.all(), studentDocsQueries.all(), ["sms"]]) void queryClient.invalidateQueries({ queryKey: k });
      toast({
        title: m.kind === "TRANSFER" ? `${m.name} moved to ${m.toCampusName}` : `${m.name}: ${STUDENT_MOVEMENT_LABEL[m.kind].toLowerCase()}`,
        message: m.kind === "LEFT" ? "Recorded. Issue the school leaving certificate when the family asks for it." : `Recorded on ${formatDate(m.date)} · ${m.reason}${m.noticeSms ? (m.noticeSms.held ? " · notice SMS waiting (SMS paused)" : " · notice SMS sent") : ""}`,
      });
    },
  });

  const set = (patch: Partial<StudentMovementChange>) => setForm((f) => ({ ...f, ...patch }));
  const review = () => {
    const r = schema.safeParse(form);
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setConfirming(true);
  };

  const classShort = p?.classSection.split("-")[0] ?? "";
  const sections = classes.data?.find((c) => c.short === classShort)?.sections ?? [];
  const options = (roster.data?.items ?? []).filter((s) => s.status !== "PASSED_OUT").map((s) => ({ value: s.grNo, label: s.name, hint: `${s.grNo} · ${s.classSection} · ${ENROLMENT_STATUS_LABEL[s.status]}`, keywords: [s.grNo, s.father, s.classSection] }));
  const danger = form.kind === "EXPELLED" || form.kind === "STRUCK_OFF";
  const err = (f: string) => errors[f] ?? fieldError(record.error, f);

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={done ? "Change recorded" : "Record a change"}
      description={p ? `${p.name} · ${p.grNo} · ${p.classSection} · ${p.campusName}` : "Leaving, struck off, expelled, restored or campus transfer"}
      wide={Boolean(done && (done.kind === "STRUCK_OFF" || done.kind === "EXPELLED" || done.kind === "RESTORED"))}
      footer={
        done ? (
          <>
            <Link to="/students/$grNo" params={{ grNo: done.grNo }} className={buttonClassName({ variant: "secondary" })} onClick={onClose}>
              Open student record
            </Link>
            {done.kind === "STRUCK_OFF" || done.kind === "EXPELLED" ? (
              <Button variant="primary" icon="printer" onClick={printNow}>
                Print notice to parents
              </Button>
            ) : done.kind === "RESTORED" ? (
              <>
                {canCharge && (
                  <Button icon="plus" onClick={() => setCharging(true)}>
                    Charge re-admission fee
                  </Button>
                )}
                <Button variant="primary" icon="printer" onClick={printNow}>
                  Print re-admission statement
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            )}
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant={danger ? "danger" : "primary"} disabled={!p || allowed.length === 0} onClick={review}>
              Review change
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="grid gap-4">
          <Banner tone="success" title={`${STUDENT_MOVEMENT_LABEL[done.kind]} · ${formatDate(done.date)}`}>
            {done.kind === "TRANSFER" ? `${done.name} is now in ${done.toClassSection} at ${done.toCampusName}. The G.R. number, fee ledger and family stay the same.` : `${done.reason}. It is in ${done.name}'s class history and on the Leaving & transfers list.`}
          </Banner>
          {done.noticeSms && (
            <Banner tone={done.noticeSms.held ? "warning" : "info"} title={done.noticeSms.held ? "Notice SMS waiting" : "Notice SMS sent"}>
              {done.noticeSms.held ? "All SMS are paused. The expulsion notice is in Messages → Outbox and goes out when SMS is resumed." : "The expulsion notice is in Messages → Outbox, with its delivery report."}{" "}
              <Link to="/sms/outbox" onClick={onClose}>
                Open Outbox
              </Link>
            </Banner>
          )}
          {(done.kind === "STRUCK_OFF" || done.kind === "EXPELLED") && (
            <PrintSheet paper="A5" label="Notice to parents" zoom={0.62}>
              <StatusNotice m={done} {...(p ? { mobile: p.guardian.mobile } : {})} />
            </PrintSheet>
          )}
          {done.kind === "RESTORED" && (
            <PrintSheet paper="A4" label="Re-admission statement" zoom={0.5}>
              <ReadmissionStatement m={done} {...(previous ? { previous } : {})} />
            </PrintSheet>
          )}
          {charging && (
            <AddChargePanel student={{ grNo: done.grNo, name: done.name, classSection: done.classSection, campus: done.campus }} initialHead="READMISSION" onClose={() => setCharging(false)} />
          )}
        </div>
      ) : (
        <div className="grid gap-5">
          {!fixedGrNo && <Combobox label="Student" required options={options} value={grNo || null} onValueChange={setGrNo} placeholder="Search by name or G.R. number" emptyText="No student matches." />}
          {grNo && !p && profile.isLoading && <Skeleton height={120} />}
          {profile.isError && <Banner tone="danger">{apiMessage(profile.error)}</Banner>}
          {p && (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface-sunken px-3 py-2 text-small">
                <EnrolmentBadge status={p.status} />
                <span className="text-ink-muted">
                  Dues <b className="tabular-nums text-ink">{formatRs(p.balance)}</b>
                </span>
                {p.statusNote && (
                  <span className="text-ink-muted">
                    since {formatDate(p.statusNote.on)} · {p.statusNote.reason}
                  </span>
                )}
              </div>
              {ctx.session !== CURRENT_SESSION ? (
                <Banner tone="info">Past sessions are read-only. Switch to the current session to record a change.</Banner>
              ) : allowed.length === 0 ? (
                <Banner tone="neutral">{`${p.name} is ${ENROLMENT_STATUS_LABEL[p.status].toLowerCase()}. No further change can be recorded.`}</Banner>
              ) : (
                <>
                  <div className="grid gap-1.5">
                    <span className="mtb-label">Change</span>
                    <Segmented aria-label="Change" value={form.kind} onChange={(v) => set({ kind: v as Kind, reason: "" })} options={allowed.map((k) => ({ value: k, label: STUDENT_MOVEMENT_LABEL[k] }))} />
                    <span className="text-small text-ink-muted">{KIND_HELP[form.kind]}</span>
                  </div>
                  {p.balance > 0 && form.kind !== "RESTORED" && (
                    <Banner tone="warning" title={`${formatRs(p.balance)} is outstanding`}>
                      {form.kind === "TRANSFER" ? "The dues move with the student and can be paid at the new campus." : "The dues stay on the student's ledger and can still be collected at the fee counter."}
                    </Banner>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <DatePicker label="Effective date" required value={form.date} onValueChange={(v) => set({ date: v ?? "" })} maxDate={TODAY} minDate={p.admissionDate} error={err("date")} />
                    <Select label="Reason" required value={form.reason} error={err("reason")} onChange={(e) => set({ reason: e.target.value })} options={[{ value: "", label: "Choose…" }, ...STUDENT_MOVEMENT_REASONS[form.kind]]} />
                    {form.kind === "TRANSFER" && (
                      <>
                        <Select
                          label="Moving to"
                          required
                          value={form.toCampus ?? ""}
                          error={err("toCampus")}
                          onChange={(e) => set({ toCampus: (e.target.value || undefined) as CampusCode | undefined, toClassSection: e.target.value ? p.classSection : undefined })}
                          options={[{ value: "", label: "Choose a campus…" }, ...(campuses.data ?? []).filter((c) => c.code !== p.campus).map((c) => ({ value: c.code, label: c.name }))]}
                        />
                        <Select label="Class and section there" required value={form.toClassSection ?? ""} error={err("toClassSection")} disabled={!form.toCampus} onChange={(e) => set({ toClassSection: e.target.value })} options={[{ value: "", label: "Choose…" }, ...sections.map((s) => `${classShort}-${s}`)]} />
                      </>
                    )}
                    {(form.kind === "EXPELLED" || form.kind === "STRUCK_OFF" || form.kind === "TRANSFER") && (
                      <Input label="Approved by" required={form.kind === "EXPELLED"} value={form.approvedBy ?? ""} error={err("approvedBy")} onChange={(e) => set({ approvedBy: e.target.value })} placeholder="Principal's name" />
                    )}
                    <div className="sm:col-span-2">
                      <Textarea label="Remarks" rows={3} value={form.remarks ?? ""} onChange={(e) => set({ remarks: e.target.value || undefined })} help="Kept in the student's history. Printed on the notice to parents." />
                    </div>
                    {form.kind === "EXPELLED" && canSms && (
                      <div className="grid gap-1 sm:col-span-2">
                        <Switch label={`Send the expulsion notice SMS to ${p.guardian.name} (${formatMobile(p.guardian.mobile)})`} checked={Boolean(form.sendNoticeSms)} onChange={(e) => set({ sendNoticeSms: e.target.checked || undefined })} />
                        <span className="text-small text-ink-muted">Uses the "Expulsion notice" template in Messages. It shows in the Outbox and the delivery report.</span>
                        {err("sendNoticeSms") && (
                          <div className="mtb-error" role="alert">
                            {err("sendNoticeSms")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
          {record.error && !confirming && <Banner tone="danger">{apiMessage(record.error)}</Banner>}
        </div>
      )}
      {p && (
        <ConfirmDialog
          open={confirming}
          onClose={() => {
            setConfirming(false);
            record.reset();
          }}
          onConfirm={() => record.mutate()}
          tone={danger ? "danger" : "brand"}
          icon={form.kind === "TRANSFER" ? "building" : form.kind === "RESTORED" ? "refresh" : "logout"}
          title={form.kind === "TRANSFER" ? `Move ${p.name} to ${campuses.data?.find((c) => c.code === form.toCampus)?.name ?? "the other campus"}?` : form.kind === "RESTORED" ? `Restore ${p.name} to ${p.classSection}?` : `${STUDENT_MOVEMENT_LABEL[form.kind]}: ${p.name}?`}
          message={KIND_HELP[form.kind]}
          details={[
            ["Student", `${p.name} (${p.grNo})`],
            ["Class", form.kind === "TRANSFER" ? `${p.classSection} → ${form.toClassSection ?? ""}` : p.classSection],
            ["Date", formatDate(form.date)],
            ["Reason", form.reason],
            ...(form.approvedBy ? ([["Approved by", form.approvedBy]] as Array<[string, string]>) : []),
            ...(form.kind === "EXPELLED" && form.sendNoticeSms ? ([["Notice SMS", `To ${p.guardian.name}, ${formatMobile(p.guardian.mobile)}`]] as Array<[string, string]>) : []),
            ...(p.balance > 0 ? ([["Dues outstanding", formatRs(p.balance)]] as Array<[string, string]>) : []),
          ]}
          confirmLabel={form.kind === "TRANSFER" ? "Transfer student" : form.kind === "RESTORED" ? "Restore" : `Record: ${STUDENT_MOVEMENT_LABEL[form.kind].toLowerCase()}`}
          loading={record.isPending}
          loadingLabel="Saving…"
          error={record.error ? apiMessage(record.error) : undefined}
        />
      )}
    </SidePanel>
  );
}
