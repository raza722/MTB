import {
  isHandoverDoc,
  newIdempotencyKey,
  STUDENT_DOC_LABEL,
  STUDENT_DOC_PAPER,
  STUDENT_DOC_TYPES,
  STUDENT_MOVEMENT_REASONS,
  studentDocsApi,
  studentDocsQueries,
  studentMovementsQueries,
  studentsQueries,
  type StudentDocDetails,
  type StudentDocIssued,
  type StudentDocType,
} from "@mtb/api";
import { formatDate, formatRs } from "@mtb/domain";
import { Banner, Button, Checkbox, DatePicker, Input, KeyValue, Segmented, Select, SidePanel, Skeleton, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useCan, useCtx, useSessionUser } from "../../../app/session";
import { apiMessage, fieldError, LoadError, today } from "../shared";
import { CardBackSwitch, PrintSheet, printNow } from "./print";
import { DocumentView, docPaper, type DocInput } from "./templates";

const CHARACTER = ["Excellent", "Very good", "Good", "Satisfactory"];
/** "Completed Class 10" (the student's own class, from Setup) first, then the usual leaving reasons. */
const leavingReasons = (className?: string) => [...new Set([...(className ? [`Completed ${className}`] : []), ...STUDENT_MOVEMENT_REASONS.LEFT])];

/** Short names for the document switch. */
export const DOC_SHORT: Record<StudentDocType, string> = {
  ID_CARD: "ID card",
  ADMISSION_SLIP: "Admission slip",
  LEAVING_CERT: "Leaving cert.",
  CHARACTER_CERT: "Character cert.",
  DOB_CERT: "Birth cert.",
  APPRECIATION_LETTER: "Appreciation letter",
  ROLL_NO_SLIP: "Roll no. slip",
  RESULT_CARD: "Result card",
  BOARD_CERTIFICATE: "Board cert.",
};

/** Letters and certificates can carry an earlier date (the day it was signed); slips and cards always print today. */
const DATED: StudentDocType[] = ["LEAVING_CERT", "CHARACTER_CERT", "DOB_CERT", "APPRECIATION_LETTER"];

const appreciationSchema = z
  .object({ attendanceDays: z.number({ error: "Enter the days present." }).int().min(1, { error: "Enter the days present." }), totalDays: z.number({ error: "Enter the school days." }).int().min(1, { error: "Enter the school days." }) })
  .refine((v) => v.attendanceDays <= v.totalDays, { error: "Days present can't be more than the school days.", path: ["attendanceDays"] });
const leavingSchema = z.object({ leavingReason: z.string().trim().min(1, { error: "Choose the reason for leaving." }) });
const datedSchema = (sessionStart: string) =>
  z.object({
    dated: z
      .string()
      .optional()
      .refine((v) => !v || v <= today(), { error: "The date can't be in the future." })
      .refine((v) => !v || v >= sessionStart, { error: `Choose a date in this session (from ${formatDate(sessionStart)}).` }),
  });
const handoverSchema = (sessionStart: string, slip: boolean) =>
  z.object({
    receivedBy: z.string({ error: "Enter who received the document." }).trim().min(1, { error: "Enter who received the document." }),
    handedOverOn: z
      .string({ error: "Choose the date it was handed over." })
      .refine((v) => v <= today(), { error: "The hand-over date can't be in the future." })
      .refine((v) => v >= sessionStart, { error: `Choose a date in this session (from ${formatDate(sessionStart)}).` }),
    part: slip ? z.enum(["I", "II"], { error: "Choose Part-I or Part-II." }) : z.enum(["I", "II"]).optional(),
  });

/**
 * Issue one document to one student: fill the few details, check the live preview, issue (serial number assigned)
 * and print. Board documents (roll no. slip, result card, certificate) are only handed over: the register logs who
 * received them and when, and nothing prints.
 */
export function IssueDocumentPanel({ open, onClose, grNo, initialType }: { open: boolean; onClose: () => void; grNo: string; initialType?: StudentDocType }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const user = useSessionUser();
  const canApprove = useCan("approvals.decide");
  const data = useQuery({ ...studentDocsQueries.forStudent(grNo), enabled: open && Boolean(grNo) });
  const [type, setType] = useState<StudentDocType>(initialType ?? "ID_CARD");
  const [details, setDetails] = useState<StudentDocDetails>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState(newIdempotencyKey);
  const [issued, setIssued] = useState<StudentDocIssued | null>(null);
  const [backs, setBacks] = useState(false);
  const sessionStart = `${ctx.session}-04-01`;
  const handover = isHandoverDoc(type);

  useEffect(() => {
    if (!open) return;
    setType(initialType ?? "ID_CARD");
    setIssued(null);
    setErrors({});
    setKey(newIdempotencyKey());
  }, [open, initialType, grNo]);

  // Sensible defaults per document, suggested from the record (not reset by a background refetch).
  const loadedFor = data.data?.snapshot.grNo ?? "";
  useEffect(() => {
    const d = data.data;
    if (!d) return;
    const by = user?.name ?? "";
    // ID card: valid until the session's end at the campus unless a date is chosen (the server sets it).
    if (type === "ID_CARD") setDetails({});
    else if (type === "APPRECIATION_LETTER") setDetails({ attendanceDays: d.attendance.present, totalDays: d.attendance.total, dated: today() });
    else if (type === "LEAVING_CERT") setDetails({ character: "Good", leavingReason: d.snapshot.leftOn ? `Completed ${d.snapshot.className}` : "", dated: today() });
    else if (type === "CHARACTER_CERT") {
      // Board exam lines start from the student's board exam record or the board result in Exams; all stay editable.
      const b = d.boardPrefill;
      setDetails({ character: "Good", dated: today(), ...(b?.boardExam ? { boardExam: b.boardExam } : {}), ...(b?.boardRollNo ? { boardRollNo: b.boardRollNo } : {}), ...(b?.boardMarks ? { boardMarks: b.boardMarks } : {}) });
    }
    else if (type === "DOB_CERT") setDetails({ dated: today() });
    else if (type === "ROLL_NO_SLIP") {
      // The part not yet handed over.
      const done = new Set(d.issued.filter((x) => x.type === "ROLL_NO_SLIP" && x.status === "ISSUED").map((x) => x.details.part ?? "I"));
      setDetails({ part: done.has("I") ? "II" : "I", handedOverOn: today(), handedOverBy: by });
    } else if (type === "RESULT_CARD" || type === "BOARD_CERTIFICATE") setDetails({ handedOverOn: today(), handedOverBy: by });
    else setDetails({});
    setErrors({});
  }, [type, loadedFor]); // eslint-disable-line react-hooks/exhaustive-deps

  const issue = useMutation({
    mutationFn: () => studentDocsApi.issue(ctx, { type, grNos: [grNo], details }, key),
    onSuccess: (res) => {
      const doc = res.issued[0]!;
      setIssued(doc);
      void queryClient.invalidateQueries({ queryKey: studentDocsQueries.all() });
      void queryClient.invalidateQueries({ queryKey: studentsQueries.all() });
      if (type === "LEAVING_CERT") void queryClient.invalidateQueries({ queryKey: studentMovementsQueries.all() });
      if (isHandoverDoc(type)) {
        toast({ title: `${STUDENT_DOC_LABEL[type]} handed over`, message: `${doc.serialNo} · ${doc.studentName} · received by ${doc.details.receivedBy ?? ""}.` });
        return;
      }
      toast({ title: `${STUDENT_DOC_LABEL[type]} issued`, message: `${doc.serialNo} · ${doc.studentName}. Printing now.` });
      printNow();
    },
  });

  const d = data.data;
  const block = d?.blocks[type];
  const warning = d?.warnings[type];
  const set = (patch: Partial<StudentDocDetails>) => setDetails((x) => ({ ...x, ...patch }));
  const err = (f: string) => errors[f] ?? fieldError(issue.error, f);
  const slipDone = new Set((d?.issued ?? []).filter((x) => x.type === "ROLL_NO_SLIP" && x.status === "ISSUED").map((x) => x.details.part ?? "I"));

  const submit = () => {
    const result =
      type === "APPRECIATION_LETTER"
        ? appreciationSchema.and(datedSchema(sessionStart)).safeParse(details)
        : type === "LEAVING_CERT"
          ? leavingSchema.and(datedSchema(sessionStart)).safeParse(details)
          : DATED.includes(type)
            ? datedSchema(sessionStart).safeParse(details)
            : handover
              ? handoverSchema(sessionStart, type === "ROLL_NO_SLIP").safeParse(details)
              : { success: true as const };
    if (!result.success) {
      setErrors(Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    if (type === "ROLL_NO_SLIP" && details.part && slipDone.has(details.part)) {
      setErrors({ part: `The Part-${details.part} slip is already handed over.` });
      return;
    }
    setErrors({});
    issue.mutate();
  };

  const preview: DocInput | null = issued
    ? { ...issued, copy: 1 }
    : d
      ? { type, serialNo: "Assigned on issue", issuedOn: details.dated ?? today(), details, snapshot: d.snapshot, issuedBy: "You" }
      : null;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      wide
      title={issued ? `${STUDENT_DOC_LABEL[issued.type]} ${isHandoverDoc(issued.type) ? "handed over" : "issued"}` : handover ? "Record a hand-over" : "Issue a document"}
      description={d ? `${d.snapshot.name} · ${d.snapshot.grNo} · ${d.snapshot.classSection}` : grNo}
      footer={
        issued ? (
          <>
            <Button onClick={onClose}>Done</Button>
            {!isHandoverDoc(issued.type) && (
              <Button variant="primary" icon="printer" onClick={() => window.print()}>
                Print
              </Button>
            )}
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon={handover ? "checkCircle" : "printer"} disabled={!d || Boolean(block) || data.isLoading} loading={issue.isPending} onClick={submit}>
              {handover ? "Record hand-over" : "Issue and print"}
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-5">
        {data.isError && <LoadError what="student's details" error={data.error} onRetry={() => void data.refetch()} />}
        {!d ? (
          <div className="grid gap-3" aria-busy="true">
            <Skeleton height={36} />
            <Skeleton height={120} />
            <Skeleton height={320} />
          </div>
        ) : issued ? (
          isHandoverDoc(issued.type) ? (
            <>
              <Banner tone="success" title={`Recorded as ${issued.serialNo}`}>
                The register shows who received it and when. It also fills the date on the collection sheet.
              </Banner>
              <KeyValue
                items={[
                  ["Document", `${STUDENT_DOC_LABEL[issued.type]}${issued.details.part ? ` Part-${issued.details.part}` : ""}`],
                  ["Handed over", formatDate(issued.issuedOn)],
                  ["Received by", issued.details.receivedBy ?? "—"],
                  ["Issued by", issued.issuedBy],
                ]}
              />
            </>
          ) : (
            <Banner tone="success" title={`Serial number ${issued.serialNo}`}>
              Recorded in the issue register on {formatDate(issued.issuedOn)}. Any further copy is a reprint and is logged with a reason.
            </Banner>
          )
        ) : (
          <>
            <div className="grid gap-1.5">
              <span className="mtb-label">Document</span>
              <Segmented aria-label="Document" className="flex-wrap" value={type} onChange={(v) => setType(v as StudentDocType)} options={STUDENT_DOC_TYPES.map((t) => ({ value: t, label: DOC_SHORT[t] }))} />
              <span className="text-small text-ink-muted">{handover ? "From the board: the school records the hand-over and prints nothing." : `Prints on ${STUDENT_DOC_PAPER[type]}.`}</span>
            </div>
            {block && <Banner tone="warning" title={handover ? "Can't record this hand-over" : "Can't issue this document"}>{block}</Banner>}
            {!block && warning && <Banner tone="info">{warning}</Banner>}
            {!block && (
              <div className="grid gap-4 sm:grid-cols-2">
                {type === "ID_CARD" && (
                  <DatePicker label="Valid until" value={details.validUntil ?? null} onValueChange={(v) => set({ validUntil: v ?? undefined })} minDate={today()} help="Leave empty for the last day of the session." />
                )}
                {type === "LEAVING_CERT" && (
                  <>
                    <Select label="Reason for leaving" required value={details.leavingReason ?? ""} error={err("leavingReason")} onChange={(e) => set({ leavingReason: e.target.value })} options={[{ value: "", label: "Choose…" }, ...leavingReasons(data.data?.snapshot.className)]} />
                    <Select label="Character and conduct" value={details.character ?? "Good"} onChange={(e) => set({ character: e.target.value })} options={CHARACTER} />
                    {d.snapshot.balance > 0 && (
                      <div className="sm:col-span-2">
                        <Checkbox
                          label={`Principal allows the certificate with ${formatRs(d.snapshot.balance)} outstanding`}
                          checked={Boolean(details.duesOverride)}
                          disabled={!canApprove}
                          onChange={(e) => set({ duesOverride: e.target.checked })}
                        />
                        {!canApprove && <p className="m-0 mt-1 text-small text-ink-muted">Only the principal can tick this. Without it the certificate says the dues are not cleared.</p>}
                      </div>
                    )}
                  </>
                )}
                {type === "CHARACTER_CERT" && (
                  <>
                    <Select label="Character and conduct" value={details.character ?? "Good"} onChange={(e) => set({ character: e.target.value })} options={CHARACTER} />
                    <Input
                      label="Board exam (if any)"
                      placeholder="Secondary School Certificate (Annual) 2026"
                      value={details.boardExam ?? ""}
                      onChange={(e) => set({ boardExam: e.target.value || undefined })}
                      help={d.boardPrefill?.from === "record" ? "From the board exams on the student's record." : d.boardPrefill?.from === "exams" ? "From the board result in Exams." : undefined}
                    />
                    <Input label="Board roll no." mono value={details.boardRollNo ?? ""} onChange={(e) => set({ boardRollNo: e.target.value || undefined })} help={d.boardPrefill?.boardRollNo ? "Filled from the record. Change it if needed." : undefined} />
                    <Input label="Marks obtained" placeholder="1,012 / 1,200" value={details.boardMarks ?? ""} onChange={(e) => set({ boardMarks: e.target.value || undefined })} />
                  </>
                )}
                {type === "APPRECIATION_LETTER" && (
                  <>
                    <Input
                      label="Days present"
                      inputMode="numeric"
                      required
                      value={details.attendanceDays ?? ""}
                      error={err("attendanceDays")}
                      onChange={(e) => set({ attendanceDays: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : undefined })}
                      help={`Suggested from attendance: ${d.attendance.present} of ${d.attendance.total} days`}
                    />
                    <Input label="School days in the session" inputMode="numeric" required value={details.totalDays ?? ""} error={err("totalDays")} onChange={(e) => set({ totalDays: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : undefined })} />
                  </>
                )}
                {DATED.includes(type) && (
                  <DatePicker label="Date on the document" value={details.dated ?? null} onValueChange={(v) => set({ dated: v ?? undefined })} today={today()} minDate={sessionStart} maxDate={today()} error={err("dated")} help="Today, or the day it was signed." />
                )}
                {(type === "LEAVING_CERT" || type === "CHARACTER_CERT" || type === "DOB_CERT" || type === "APPRECIATION_LETTER") && (
                  <div className="sm:col-span-2">
                    <Textarea label={type === "DOB_CERT" ? "Purpose (printed)" : "Remarks (printed)"} placeholder={type === "DOB_CERT" ? "a passport application" : undefined} rows={2} value={details.remarks ?? ""} onChange={(e) => set({ remarks: e.target.value || undefined })} />
                  </div>
                )}
                {handover && (
                  <>
                    {type === "ROLL_NO_SLIP" && (
                      <div className="grid gap-1.5 sm:col-span-2">
                        <span className="mtb-label">Part</span>
                        <Segmented
                          aria-label="Part"
                          value={details.part ?? ""}
                          onChange={(v) => set({ part: v as "I" | "II" })}
                          options={(["I", "II"] as const).map((p) => ({ value: p, label: `Part-${p}${slipDone.has(p) ? " (handed over)" : ""}` }))}
                        />
                        {err("part") && <span className="text-small text-danger-ink">{err("part")}</span>}
                      </div>
                    )}
                    <DatePicker label="Date handed over" required value={details.handedOverOn ?? null} onValueChange={(v) => set({ handedOverOn: v ?? undefined })} today={today()} minDate={sessionStart} maxDate={today()} error={err("handedOverOn")} />
                    <Input label="Received by" required placeholder={`${d.snapshot.father} (father)`} value={details.receivedBy ?? ""} error={err("receivedBy")} onChange={(e) => set({ receivedBy: e.target.value || undefined })} help="The person who signed for it." />
                    <Input label="Issued by" value={details.handedOverBy ?? ""} onChange={(e) => set({ handedOverBy: e.target.value || undefined })} help="Who handed it over. You, unless someone else did." />
                  </>
                )}
                {!handover && type !== "ID_CARD" && type !== "APPRECIATION_LETTER" && (
                  <Input label="Collected by" placeholder={`${d.snapshot.father} (father)`} value={details.receivedBy ?? ""} onChange={(e) => set({ receivedBy: e.target.value || undefined })} help="Kept in the issue register." />
                )}
              </div>
            )}
            {issue.error && !(Object.keys(errors).length || ["receivedBy", "handedOverOn", "part", "dated", "leavingReason", "attendanceDays"].some((f) => fieldError(issue.error, f))) && <Banner tone="danger">{apiMessage(issue.error)}</Banner>}
          </>
        )}
        {preview && !isHandoverDoc(preview.type) && (issued || !block) && (
          <div className="grid gap-2">
            <span className="mtb-label">{issued ? "Printed document" : "Preview"}</span>
            {preview.type === "ID_CARD" && <CardBackSwitch checked={backs} onChange={setBacks} />}
            <PrintSheet paper={docPaper(preview.type)} label={`${STUDENT_DOC_LABEL[preview.type]} preview`} zoom={preview.type === "ID_CARD" ? 0.62 : 0.55}>
              <DocumentView d={preview} backs={backs} />
            </PrintSheet>
          </div>
        )}
      </div>
    </SidePanel>
  );
}
