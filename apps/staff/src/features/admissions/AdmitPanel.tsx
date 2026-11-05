import {
  admissionsApi,
  admissionsQueries,
  ApiError,
  newIdempotencyKey,
  studentDocsApi,
  studentDocsQueries,
  studentFamiliesQueries,
  studentsQueries,
  type AdmissionsAdmitResult,
  type AdmissionsApplicant,
  type StudentDocIssued,
} from "@mtb/api";
import { formatDate, formatRs } from "@mtb/domain";
import { Banner, Button, buttonClassName, ConfirmDialog, cx, DatePicker, Icon, Select, SidePanel, Skeleton, Switch, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useCan, useCtx } from "../../app/session";
import { PrintSheet, printNow } from "../students/documents/print";
import { AdmissionSlip } from "../students/documents/templates";
import { apiMessage, SeatMeter } from "../students/shared";
import { TODAY } from "./shared";

const HOUSES = ["Iqbal House", "Jinnah House", "Liaquat House", "Sir Syed House"];

/** Completes an offered admission: section and roll number, the G.R. number, the first charges and the admission slip. */
export function AdmitPanel({ applicant: a, open, onClose }: { applicant: AdmissionsApplicant | null; open: boolean; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canCollect = useCan("fees.collect");
  const actx = { campus: a?.campus ?? ctx.campus, session: ctx.session };
  const placement = useQuery({ ...admissionsQueries.placement(actx, a?.classApplied ?? ""), enabled: open && Boolean(a) });
  const setup = useQuery({ ...admissionsQueries.setup(actx), enabled: open && Boolean(a) });
  const streams = setup.data?.classes.find((c) => c.classApplied === a?.classApplied)?.streams ?? [];
  const [stream, setStream] = useState("");
  const [hostel, setHostel] = useState(false);
  const [cs, setCs] = useState("");
  const [date, setDate] = useState<string | null>(TODAY);
  const [house, setHouse] = useState("");
  const [sms, setSms] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const [done, setDone] = useState<AdmissionsAdmitResult | null>(null);
  const [slip, setSlip] = useState<StudentDocIssued | null>(null);

  useEffect(() => {
    if (!open) return;
    setCs("");
    setDate(TODAY);
    setHouse("");
    setSms(true);
    setStream(a?.stream ?? "");
    setHostel(a?.hostel ?? false);
    setDone(null);
    setSlip(null);
    setConfirming(false);
    setKey(newIdempotencyKey());
  }, [open, a?.id]);

  // Suggest the section with the most free seats.
  useEffect(() => {
    const p = placement.data;
    if (!p || cs) return;
    const best = [...p.sections].sort((x, y) => y.seats - y.enrolled - (x.seats - x.enrolled))[0];
    if (best) setCs(best.classSection);
  }, [placement.data, cs]);

  const admit = useMutation({
    mutationFn: () => admissionsApi.admit(a!.id, { classSection: cs, admissionDate: date ?? TODAY, ...(house ? { house } : {}), welcomeSms: sms, ...(stream ? { stream } : {}), hostel }, key),
    onSuccess: (r) => {
      setConfirming(false);
      setDone(r);
      for (const k of [admissionsQueries.all(), studentsQueries.all(), studentFamiliesQueries.all(), ["sms"]]) void queryClient.invalidateQueries({ queryKey: k });
      const smsText = !sms ? "" : !r.welcomeSms ? " · welcome SMS not sent" : r.welcomeSms.held ? " · welcome SMS waiting in Messages (SMS paused)" : " · welcome SMS sent";
      toast({ title: `${r.student.name} admitted · ${r.student.grNo}`, message: `${r.student.classSection}, roll no. ${r.rollNo}${smsText}` });
    },
  });
  const issueSlip = useMutation({
    mutationFn: () => studentDocsApi.issue({ campus: a!.campus, session: ctx.session }, { type: "ADMISSION_SLIP", grNos: [done!.student.grNo], details: { receivedBy: `${a!.father} (father)` } }, newIdempotencyKey()),
    onSuccess: (r) => {
      setSlip(r.issued[0] ?? null);
      void queryClient.invalidateQueries({ queryKey: studentDocsQueries.all() });
      printNow();
    },
  });

  if (!a) return null;
  const p = placement.data;
  const chosen = p?.sections.find((s) => s.classSection === cs);
  const full = chosen ? chosen.enrolled >= chosen.seats : false;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      wide
      title={done ? "Admission complete" : `Admit ${a.name}`}
      description={`${a.applicationNo} · ${a.classApplied} · ${a.campusName}`}
      footer={
        done ? (
          <>
            <Link to="/students/$grNo" params={{ grNo: done.student.grNo }} className={buttonClassName({ variant: "secondary" })}>
              Open student record
            </Link>
            {canCollect && a.campus === ctx.campus && (
              <Button icon="fees" onClick={() => navigate({ to: "/fees/counter", search: (prev: Record<string, unknown>) => ({ ...prev, gr: done.student.grNo }) } as never)}>
                Collect admission fee
              </Button>
            )}
            <Button variant="primary" icon="printer" loading={issueSlip.isPending} onClick={() => (slip ? window.print() : issueSlip.mutate())}>
              {slip ? "Print again" : "Print admission slip"}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon="checkCircle" disabled={!cs || !date || full || !p || (streams.length > 0 && !stream)} onClick={() => setConfirming(true)}>
              Review admission
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="grid gap-5">
          <div className="grid justify-items-center gap-2 rounded-lg bg-success-tint px-4 py-6 text-center">
            <span className="grid h-12 w-12 place-content-center rounded-full bg-success text-on-brand" aria-hidden="true">
              <Icon name="check" size={24} />
            </span>
            <span className="text-title-2 text-success-ink">G.R. number {done.student.grNo}</span>
            <span className="text-small text-success-ink">
              {done.student.name} is now a student of {done.student.classSection} (roll no. {done.rollNo}) at {done.student.campusName}. The application and the student share one record, so nothing is typed twice.
            </span>
          </div>
          {done.charges.length > 0 && (
            <div className="grid gap-1">
              <span className="mtb-label">Charges raised on the fee ledger</span>
              <ul className="m-0 grid list-none gap-1 rounded-md bg-surface-sunken p-3 text-small">
                {done.charges.map((c) => (
                  <li key={c.head} className="flex justify-between gap-3">
                    <span>
                      {c.head} <span className="text-ink-muted">· due {formatDate(c.dueDate)}</span>
                    </span>
                    <b className="tabular-nums">{formatRs(c.amount)}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {issueSlip.error && <Banner tone="danger">{apiMessage(issueSlip.error)}</Banner>}
          {slip && (
            <PrintSheet paper="A5" label="Admission slip" zoom={0.62}>
              <AdmissionSlip d={{ type: "ADMISSION_SLIP", serialNo: slip.serialNo, issuedOn: slip.issuedOn, issuedBy: slip.issuedBy, details: slip.details, snapshot: slip.snapshot }} />
            </PrintSheet>
          )}
        </div>
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-1 rounded-md bg-surface-sunken px-3 py-2 text-small">
            <span>
              <b className="text-ink">{a.name}</b> {a.relation} {a.father} · born {formatDate(a.dob)}
            </span>
            <span className="text-ink-muted">
              {a.testScore !== null ? `Entrance test ${a.testScore}/${a.testMax}` : "Admitted without a test"} · offered {a.offeredOn ? formatDate(a.offeredOn) : ""}
              {a.offeredBy ? ` by ${a.offeredBy}` : ""}
            </span>
            {a.siblings && a.siblings.length > 0 && <span className="text-ink-muted">Siblings at MTB: {a.siblings.map((s) => `${s.name} (${s.classSection})`).join(", ")} · linked to the same family</span>}
          </div>
          {placement.isError && <Banner tone="danger">{apiMessage(placement.error)}</Banner>}
          {!p ? (
            <Skeleton height={160} />
          ) : (
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mtb-label mb-1">Section</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {p.sections.map((s) => {
                  const isFull = s.enrolled >= s.seats;
                  const active = s.classSection === cs;
                  return (
                    <label key={s.classSection} className={cx("grid cursor-pointer gap-2 rounded-lg border p-3", active ? "border-brand bg-brand-tint" : "border-border hover:bg-surface-hover", isFull && "cursor-not-allowed opacity-60")}>
                      <span className="flex items-center gap-2">
                        <input type="radio" name="admit-section" checked={active} disabled={isFull} onChange={() => setCs(s.classSection)} />
                        <b className="text-ink">{s.classSection}</b>
                        <span className="text-small text-ink-muted">{s.classTeacher}</span>
                      </span>
                      <SeatMeter enrolled={s.enrolled} seats={s.seats} label={s.classSection} />
                      <span className="text-small text-ink-muted">
                        {s.girls} girls · {s.boys} boys · next roll no. {s.nextRollNo}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <DatePicker label="Admission date" required value={date} onValueChange={setDate} maxDate={TODAY} {...(a.offeredOn ? { minDate: a.offeredOn } : {})} />
            {a.campus === "KC" && <Select label="House" value={house} onChange={(e) => setHouse(e.target.value)} options={[{ value: "", label: "Assign later" }, ...HOUSES]} />}
            {streams.length > 0 && (
              <Select
                label="Group"
                required
                value={stream}
                onChange={(e) => setStream(e.target.value)}
                options={[{ value: "", label: "Choose the group" }, ...streams.map((s) => ({ value: s, label: s }))]}
                help={a.stream ? `Chosen on the application: ${a.stream}. Confirm or change it.` : "Required for this class: it decides the subjects and the timetable group."}
                {...(admit.error instanceof ApiError && admit.error.field === "stream" ? { error: admit.error.message } : {})}
              />
            )}
          </div>
          <Switch label="Lives in the school hostel" checked={hostel} onChange={(e) => setHostel(e.target.checked)} />
          <Switch label={`Send the welcome SMS to ${a.father} (${a.mobile.slice(0, 4)}-${a.mobile.slice(4)})`} checked={sms} onChange={(e) => setSms(e.target.checked)} />
          {p && (
            <div className="grid gap-1 rounded-lg border border-border p-3 text-small">
              <span className="flex justify-between gap-2">
                <span className="text-ink-muted">G.R. number to be issued</span>
                <b className="mtb-mono text-ink">{p.nextGrNo}</b>
              </span>
              <span className="flex justify-between gap-2">
                <span className="text-ink-muted">Roll number in {cs || "the section"}</span>
                <b className="tabular-nums text-ink">{chosen?.nextRollNo ?? "—"}</b>
              </span>
              <span className="flex justify-between gap-2">
                <span className="text-ink-muted">Admission fee on the ledger</span>
                <b className="tabular-nums text-ink">{formatRs(p.admissionFee)}</b>
              </span>
            </div>
          )}
          {admit.error && !confirming && <Banner tone="danger">{apiMessage(admit.error)}</Banner>}
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          admit.reset();
        }}
        onConfirm={() => admit.mutate()}
        icon="checkCircle"
        title={`Admit ${a.name} to ${cs}?`}
        message="A G.R. number is issued and cannot be reused. The student record is created from the application, linked to the family, and the admission fee goes on the ledger."
        details={[
          ["Class and section", cs],
          ...(stream ? ([["Group", stream]] as Array<[string, string]>) : []),
          ...(hostel ? ([["Hostel", "Yes"]] as Array<[string, string]>) : []),
          ["Admission date", date ? formatDate(date) : "—"],
          ["G.R. number", p?.nextGrNo ?? "—"],
          ["Roll number", String(chosen?.nextRollNo ?? "—")],
          ["Admission fee", p ? formatRs(p.admissionFee) : "—"],
        ]}
        confirmLabel="Admit and issue G.R. number"
        loading={admit.isPending}
        loadingLabel="Admitting…"
        error={admit.error ? apiMessage(admit.error) : undefined}
      />
    </SidePanel>
  );
}
