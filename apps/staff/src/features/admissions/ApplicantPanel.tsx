import {
  ADMISSIONS_WITHDRAW_REASONS,
  admissionsApi,
  admissionsQueries,
  newIdempotencyKey,
  type AdmissionsApplicant,
} from "@mtb/api";
import { formatCnic, formatDate, formatDateTime, formatMobile, formatRs } from "@mtb/domain";
import { Banner, Button, buttonClassName, ConfirmDialog, KeyValue, Modal, Select, SidePanel, Skeleton, StatusBadge, Timeline, Urdu, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { PrintSheet, printNow } from "../students/documents/print";
import { apiMessage } from "../students/shared";
import { DiamondMindsBadge, offerDeadline, StageBadge, TODAY } from "./shared";
import { ApplicationForm, TestSlip } from "./slips";

/** One applicant: details, candidate fee, test booking and marks, offer, history, and the next step. */
export function ApplicantPanel({ id, onClose, onAdmit }: { id: string | null; onClose: () => void; onAdmit: (a: AdmissionsApplicant) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = useCan("admissions.manage");
  const readOnly = useReadOnly();
  const q = useQuery({ ...admissionsQueries.applicant(id ?? ""), enabled: Boolean(id) });
  const a = q.data;
  const setup = useQuery({ ...admissionsQueries.setup({ campus: a?.campus ?? ctx.campus, session: ctx.session }), enabled: Boolean(a) });
  const [testId, setTestId] = useState("");
  const [printing, setPrinting] = useState<null | "form" | "slip">(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState("");
  const [offering, setOffering] = useState(false);
  useEffect(() => {
    setTestId("");
    setWithdrawing(false);
    setReason("");
    setOffering(false);
  }, [id]);

  const done = (next: AdmissionsApplicant, title: string, message?: string) => {
    queryClient.setQueryData(admissionsQueries.applicant(next.id).queryKey, next);
    void queryClient.invalidateQueries({ queryKey: admissionsQueries.all() });
    toast({ title, ...(message ? { message } : {}) });
  };
  const fee = useMutation({ mutationFn: () => admissionsApi.recordFee(a!.id, newIdempotencyKey()), onSuccess: (n) => done(n, "Candidate fee recorded", `${n.fee?.receiptNo} · ${formatRs(n.fee?.amount ?? 0)}`) });
  const book = useMutation({ mutationFn: () => admissionsApi.scheduleTest(a!.id, testId, newIdempotencyKey()), onSuccess: (n) => done(n, "Entrance test booked", `${formatDate(n.testDate!)} · seat ${n.testRollNo}. Print the test slip for the family.`) });
  const withdraw = useMutation({
    mutationFn: () => admissionsApi.withdraw(a!.id, reason, newIdempotencyKey()),
    onSuccess: (n) => {
      setWithdrawing(false);
      done(n, `${n.name} withdrawn`, n.withdrawnReason);
    },
  });
  const offer = useMutation({
    mutationFn: () => admissionsApi.offerDirect(a!.id, newIdempotencyKey()),
    onSuccess: (n) => {
      setOffering(false);
      done(n, `Seat offered to ${n.name}`, `Valid until ${formatDate(n.offerValidUntil!)}. Complete the admission when the family confirms.`);
    },
  });

  const editable = canManage && !readOnly;
  const rule = setup.data?.classes.find((c) => c.classApplied === a?.classApplied);
  const sittings = (setup.data?.tests ?? []).filter((t) => t.classApplied === a?.classApplied && t.date >= TODAY);
  const test = setup.data?.tests.find((t) => t.id === a?.testId);
  const deadline = a?.stage === "OFFERED" ? offerDeadline(a.offerValidUntil) : null;
  const mutError = fee.error ?? book.error;

  return (
    <SidePanel
      open={Boolean(id)}
      onClose={onClose}
      wide
      title={a?.name ?? "Applicant"}
      description={a ? `${a.applicationNo} · ${a.classApplied} · ${a.campusName}` : undefined}
      footer={
        a ? (
          <>
            <Button icon="printer" onClick={() => setPrinting("form")}>
              Application form
            </Button>
            {a.testRollNo && a.fee?.status !== "DUE" && (
              <Button icon="printer" onClick={() => setPrinting("slip")}>
                Test slip
              </Button>
            )}
            {a.stage === "ADMITTED" && a.grNo && (
              <Link to="/students/$grNo" params={{ grNo: a.grNo }} className={buttonClassName({ variant: "primary" })}>
                Open student record
              </Link>
            )}
            {editable && a.stage === "OFFERED" && (
              <Button variant="primary" icon="checkCircle" onClick={() => onAdmit(a)}>
                Complete admission
              </Button>
            )}
            {editable && a.stage === "APPLIED" && a.directAdmission && (
              <Button variant="primary" icon="send" onClick={() => setOffering(true)}>
                Offer a seat
              </Button>
            )}
            {editable && a.stage === "TEST" && a.testId && (
              <Link to="/admissions/tests" search={(prev: Record<string, unknown>) => ({ ...prev, test: a.testId }) as never} className={buttonClassName({ variant: "primary" })}>
                Enter marks
              </Link>
            )}
            {a.stage === "MERIT" && (
              <Link to="/admissions/merit" search={(prev: Record<string, unknown>) => ({ ...prev, cls: a.classApplied }) as never} className={buttonClassName({ variant: "primary" })}>
                Open merit list
              </Link>
            )}
          </>
        ) : undefined
      }
    >
      {q.isError ? (
        <Banner tone="danger" title="This application could not be loaded.">
          {apiMessage(q.error)}
        </Banner>
      ) : !a ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton height={28} width="50%" />
          <Skeleton height={180} />
          <Skeleton height={120} />
        </div>
      ) : (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <StageBadge stage={a.stage} />
            {a.diamondMinds && <DiamondMindsBadge />}
            {a.directAdmission && <StatusBadge status="neutral">No entrance test</StatusBadge>}
            {a.source === "WEB" && <StatusBadge status="info">Website</StatusBadge>}
            {a.enquiryNo && <StatusBadge status="neutral">From enquiry {a.enquiryNo}</StatusBadge>}
            {a.nameUr && <Urdu size="small">{a.nameUr}</Urdu>}
          </div>
          {deadline && <Banner tone={deadline.urgent ? "warning" : "info"} title={deadline.text}>{`Offered on ${formatDate(a.offeredOn!)} by ${a.offeredBy ?? "the principal"}. Complete the admission when the family confirms and the admission fee is arranged.`}</Banner>}
          {a.stage === "WITHDRAWN" && <Banner tone="neutral" title={`Withdrawn on ${formatDate(a.withdrawnOn!)}`}>{a.withdrawnReason}</Banner>}
          {a.siblings && a.siblings.length > 0 && (
            <Banner tone="info" icon="home" title="Siblings already at MTB">
              {a.siblings.map((s, i) => (
                <span key={s.grNo}>
                  {i > 0 && ", "}
                  <Link to="/students/$grNo" params={{ grNo: s.grNo }} className="text-brand-ink underline-offset-2 hover:underline">
                    {s.name}
                  </Link>{" "}
                  ({s.classSection}, {s.campusName})
                </span>
              ))}
              . The child joins the same family record when admitted.
            </Banner>
          )}
          <KeyValue
            items={[
              ["Date of birth", <span className="tabular-nums">{formatDate(a.dob)}</span>],
              ...(a.bForm ? ([["B-form", <span className="mtb-mono">{formatCnic(a.bForm)}</span>]] as Array<[string, ReactNode]>) : []),
              ...(a.stream ? ([["Group", a.stream]] as Array<[string, string]>) : []),
              ...(a.religion || a.disability || a.identificationMark || a.birthCertificateNo
                ? ([["More about the child", [a.religion, a.birthCertificateNo && `birth certificate ${a.birthCertificateNo}`, a.disability && `disability: ${a.disability}`, a.identificationMark && `mark: ${a.identificationMark}`].filter(Boolean).join(" · ")]] as Array<[string, string]>)
                : []),
              ["Father", `${a.father}${a.fatherCnic ? ` · ${formatCnic(a.fatherCnic)}` : " · CNIC not given"}${a.fatherOccupation ? ` · ${a.fatherOccupation}` : ""}${a.fatherQualification ? ` · ${a.fatherQualification}` : ""}`],
              ...(a.mother || a.motherOccupation || a.motherQualification ? ([["Mother", [a.mother, a.motherOccupation, a.motherQualification].filter(Boolean).join(" · ")]] as Array<[string, string]>) : []),
              ["Mobile", <span className="tabular-nums">{formatMobile(a.mobile)}{a.homePhone ? ` · home ${a.homePhone}` : ""}</span>],
              ...(a.email ? ([["Email", a.email]] as Array<[string, string]>) : []),
              ["Address", `${a.address}${a.city ? `, ${a.city}` : ""}`],
              ...(a.tempAddress ? ([["Temporary address", a.tempAddress]] as Array<[string, string]>) : []),
              ...(a.emergencyContact ? ([["Emergency contact", `${a.emergencyContact.name} · ${formatMobile(a.emergencyContact.mobile1)}${a.emergencyContact.mobile2 ? ` / ${formatMobile(a.emergencyContact.mobile2)}` : ""}`]] as Array<[string, string]>) : []),
              ["Previous school", a.previousSchool ?? "—"],
              ...(a.admissionReference ? ([["Admission reference", a.admissionReference]] as Array<[string, string]>) : []),
              ...(a.hostel ? ([["Hostel", "Yes"]] as Array<[string, string]>) : []),
              ["Applied on", formatDate(a.appliedOn)],
            ]}
          />

          {a.fee && (
            <section className="grid gap-2 rounded-lg border border-border p-3" aria-label="Candidate fee">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">Candidate fee · {formatRs(a.fee.amount)}</span>
                {a.fee.status === "PAID" ? <StatusBadge status="paid">Paid · {a.fee.receiptNo}</StatusBadge> : <StatusBadge status="unpaid">Not paid</StatusBadge>}
              </div>
              {a.fee.status === "DUE" && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-small text-ink-muted">
                  <span>The test slip is printed once the fee is paid.</span>
                  {editable && (
                    <Button size="sm" variant="primary" icon="fees" loading={fee.isPending} onClick={() => fee.mutate()}>
                      Record payment
                    </Button>
                  )}
                </div>
              )}
            </section>
          )}

          {!a.directAdmission && (
            <section className="grid gap-3 rounded-lg border border-border p-3" aria-label="Entrance test">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">Entrance test</span>
                {a.testRollNo && <span className="text-small text-ink-muted">Seat <b className="mtb-mono text-ink">{a.testRollNo}</b></span>}
              </div>
              {test && (
                <span className="text-small text-ink-muted">
                  {test.name} · {formatDate(test.date)}, {test.time} · {test.venue}
                </span>
              )}
              {a.marks && Object.keys(a.marks).length > 0 && (
                <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">
                  {Object.entries(a.marks).map(([s, v]) => (
                    <li key={s} className="grid rounded-md bg-surface-sunken px-2 py-1.5 text-small">
                      <span className="text-ink-muted">{s}</span>
                      <b className="tabular-nums text-ink">{v ?? "—"}</b>
                    </li>
                  ))}
                  <li className="grid rounded-md bg-brand-tint px-2 py-1.5 text-small">
                    <span className="text-brand-ink">Total</span>
                    <b className="tabular-nums text-brand-ink">
                      {a.testScore ?? "—"} / {a.testMax}
                    </b>
                  </li>
                </ul>
              )}
              {editable && (a.stage === "APPLIED" || (a.stage === "TEST" && (a.testDate ?? "") > TODAY)) && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-56 flex-1">
                    <Select
                      label={a.testId ? "Move to another sitting" : "Book a sitting"}
                      value={testId}
                      onChange={(e) => setTestId(e.target.value)}
                      options={[{ value: "", label: sittings.length ? "Choose a date…" : "No upcoming sitting for this class" }, ...sittings.filter((t) => t.id !== a.testId).map((t) => ({ value: t.id, label: `${formatDate(t.date)}, ${t.time} · ${t.candidates} booked` }))]}
                    />
                  </div>
                  <Button variant="primary" disabled={!testId || a.fee?.status === "DUE"} loading={book.isPending} onClick={() => book.mutate()}>
                    Book test
                  </Button>
                </div>
              )}
              {editable && a.fee?.status === "DUE" && <p className="m-0 text-small text-ink-muted">Record the candidate fee first, then book the test.</p>}
              {rule && !rule.testRequired && <p className="m-0 text-small text-ink-muted">{a.classApplied} has no entrance test.</p>}
            </section>
          )}
          {mutError && <Banner tone="danger">{apiMessage(mutError)}</Banner>}

          <section className="grid gap-2" aria-label="History">
            <span className="mtb-label">History</span>
            <Timeline label="Application history" items={[...(a.history ?? [])].reverse().map((h, i) => ({ id: `${h.at}-${i}`, date: h.at.slice(0, 10), title: h.text, description: `${formatDateTime(h.at)}${h.by ? ` · ${h.by}` : ""}`, icon: "clock", tone: "neutral" }))} />
          </section>

          {editable && a.stage !== "ADMITTED" && a.stage !== "WITHDRAWN" && (
            <div>
              <Button variant="danger-quiet" icon="ban" onClick={() => setWithdrawing(true)}>
                Withdraw application…
              </Button>
            </div>
          )}
        </div>
      )}

      <Modal
        open={printing !== null}
        onClose={() => setPrinting(null)}
        size="lg"
        title={printing === "slip" ? "Entrance test slip" : "Application form"}
        footer={
          <>
            <Button onClick={() => setPrinting(null)}>Close</Button>
            <Button variant="primary" icon="printer" onClick={printNow}>
              Print
            </Button>
          </>
        }
      >
        {a && (
          <PrintSheet paper="A5" label={printing === "slip" ? "Test slip" : "Application form"} zoom={0.7}>
            {printing === "slip" ? <TestSlip a={a} test={test} /> : <ApplicationForm a={a} />}
          </PrintSheet>
        )}
      </Modal>
      <Modal
        open={withdrawing}
        onClose={() => setWithdrawing(false)}
        title={`Withdraw ${a?.name ?? ""}'s application?`}
        description="The application stays on record as withdrawn. It leaves the pipeline and the merit list."
        footer={
          <>
            <Button onClick={() => setWithdrawing(false)}>Back</Button>
            <Button variant="danger" disabled={!reason} loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
              Withdraw application
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Select label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} options={[{ value: "", label: "Choose…" }, ...ADMISSIONS_WITHDRAW_REASONS]} />
          {withdraw.error && <Banner tone="danger">{apiMessage(withdraw.error)}</Banner>}
        </div>
      </Modal>
      {a && (
        <ConfirmDialog
          open={offering}
          onClose={() => {
            setOffering(false);
            offer.reset();
          }}
          onConfirm={() => offer.mutate()}
          icon="send"
          title={`Offer ${a.name} a seat in ${a.classApplied}?`}
          message={`${a.classApplied} admits on an interview and available seats, without an entrance test. The offer is valid for seven days.`}
          confirmLabel="Offer a seat"
          loading={offer.isPending}
          loadingLabel="Offering…"
          error={offer.error ? apiMessage(offer.error) : undefined}
        />
      )}
    </SidePanel>
  );
}
