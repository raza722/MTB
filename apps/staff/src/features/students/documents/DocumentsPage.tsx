import {
  isHandoverDoc,
  metaQueries,
  newIdempotencyKey,
  STUDENT_DOC_LABEL,
  STUDENT_DOC_PAPER,
  STUDENT_DOC_TYPES,
  STUDENT_HANDOVER_DOC_TYPES,
  STUDENT_PRINTED_DOC_TYPES,
  studentDocsApi,
  studentDocsQueries,
  studentsQueries,
  type StudentDocIssued,
  type StudentDocType,
} from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatSession } from "@mtb/domain";
import {
  AnimatedNumber,
  Banner,
  Button,
  buttonClassName,
  Combobox,
  ConfirmDialog,
  DataTable,
  DatePicker,
  EmptyState,
  Icon,
  Input,
  KeyValue,
  Modal,
  Panel,
  Segmented,
  Select,
  SidePanel,
  Skeleton,
  StatCard,
  StatusBadge,
  Timeline,
  useToast,
  type Column,
  type IconName,
} from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Page, PageHeader, RequirePermission, RequireSingleCampus } from "../../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../../app/session";
import { apiMessage, classShortOf, fieldError, isBoardClass, LoadError, stagger, StudentsSubNav, today } from "../shared";
import { AdmissionFormsPanel, AdmissionSlipsPanel, LettersPanel } from "./BatchPanels";
import { CollectionSheetPanel } from "./CollectionSheetPanel";
import { DOC_SHORT, IssueDocumentPanel } from "./IssueDocumentPanel";
import { CardBackSwitch, PrintSheet, printNow } from "./print";
import { DocumentView, docPaper, IdCardSheets, type DocInput } from "./templates";

const ICON: Record<StudentDocType, IconName> = {
  ID_CARD: "idCard",
  ADMISSION_SLIP: "receipt",
  LEAVING_CERT: "logout",
  CHARACTER_CERT: "award",
  DOB_CERT: "calendar",
  APPRECIATION_LETTER: "star",
  ROLL_NO_SLIP: "file",
  RESULT_CARD: "listChecks",
  BOARD_CERTIFICATE: "award",
};
const REPRINT_REASONS = ["Original lost by the family", "Extra copy requested", "Printer fault on the first copy", "Other"];

const returnSchema = (issuedOn: string) =>
  z.object({
    returnedOn: z
      .string({ error: "Choose the date the card was handed back." })
      .min(1, { error: "Choose the date the card was handed back." })
      .refine((v) => v <= today(), { error: "The date can't be in the future." })
      .refine((v) => v >= issuedOn, { error: `The card was issued on ${formatDate(issuedOn)}. Choose that day or later.` }),
  });

const asInput = (d: StudentDocIssued, copy?: number): DocInput => ({ type: d.type, serialNo: d.serialNo, issuedOn: d.issuedOn, issuedBy: d.issuedBy, details: d.details, snapshot: d.snapshot, copy: copy ?? d.prints.length, cancelled: d.status === "CANCELLED" });

/** One issued document: preview, print log, reprint with a reason, cancel. */
function DocumentPanel({ doc, open, onClose }: { doc: StudentDocIssued | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = useCan("students.edit");
  const readOnly = useReadOnly();
  const [reprinting, setReprinting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const [current, setCurrent] = useState<StudentDocIssued | null>(doc);
  const [backs, setBacks] = useState(false);
  const [returning, setReturning] = useState(false);
  const [returnedOn, setReturnedOn] = useState<string>(today());
  const [returnError, setReturnError] = useState("");
  useEffect(() => {
    setCurrent(doc);
    setReprinting(false);
    setCancelling(false);
    setReturning(false);
    setReturnedOn(today());
    setReturnError("");
    setReason("");
    setOther("");
  }, [doc]);
  const why = reason === "Other" ? other.trim() : reason;
  // Optional chaining, not `current!`: the compiler reads these ids while rendering (to memoise the callbacks), when no document is open yet.
  const reprint = useMutation({
    mutationFn: () => studentDocsApi.reprint(current?.id ?? "", why, newIdempotencyKey()),
    onSuccess: (d) => {
      setCurrent(d);
      setReprinting(false);
      void queryClient.invalidateQueries({ queryKey: studentDocsQueries.all() });
      toast({ title: `Reprint ${d.prints.length} of ${d.serialNo}`, message: "Logged with the reason. The copy says it is a reprint." });
      printNow();
    },
  });
  const cancel = useMutation({
    mutationFn: () => studentDocsApi.cancel(current?.id ?? "", why, newIdempotencyKey()),
    onSuccess: (d) => {
      setCurrent(d);
      setCancelling(false);
      void queryClient.invalidateQueries({ queryKey: studentDocsQueries.all() });
      void queryClient.invalidateQueries({ queryKey: studentsQueries.all() });
      toast({ title: `${d.serialNo} cancelled`, message: d.cancelledReason ?? "" });
    },
  });
  const markReturned = useMutation({
    mutationFn: () => studentDocsApi.markReturned(current?.id ?? "", returnedOn, newIdempotencyKey()),
    onSuccess: (d) => {
      setCurrent(d);
      setReturning(false);
      void queryClient.invalidateQueries({ queryKey: studentDocsQueries.all() });
      void queryClient.invalidateQueries({ queryKey: studentsQueries.all() });
      toast({ title: `${d.serialNo} marked returned`, message: `Handed back on ${formatDate(d.returnedOn ?? returnedOn)}. It shows in the register and the student's history.` });
    },
  });
  const confirmReturn = () => {
    const r = returnSchema(current?.issuedOn ?? today()).safeParse({ returnedOn });
    if (!r.success) {
      setReturnError(r.error.issues[0]?.message ?? "");
      return;
    }
    setReturnError("");
    markReturned.mutate();
  };
  if (!current) return null;
  const d = current;
  const editable = canEdit && !readOnly && d.status === "ISSUED";
  const returnable = editable && d.type === "ID_CARD" && !d.returnedOn;
  const handover = isHandoverDoc(d.type);
  if (handover)
    return (
      <SidePanel
        open={open}
        onClose={onClose}
        title={`${STUDENT_DOC_LABEL[d.type]}${d.details.part ? ` Part-${d.details.part}` : ""} · ${d.serialNo}`}
        description={`${d.studentName} · ${d.grNo} · ${d.classSection}`}
        footer={
          <>
            <Link to="/students/$grNo" params={{ grNo: d.grNo }} search={(prev: Record<string, unknown>) => ({ ...prev, tab: "documents" }) as never} className={buttonClassName({ variant: "secondary" })}>
              Student record
            </Link>
            {editable && (
              <Button variant="danger-quiet" icon="ban" onClick={() => setCancelling(true)}>
                Cancel entry
              </Button>
            )}
          </>
        }
      >
        <div className="grid gap-5">
          {d.status === "CANCELLED" && <Banner tone="warning" title="Cancelled">{d.cancelledReason}</Banner>}
          <KeyValue
            items={[
              ["Serial no.", <span className="mtb-mono">{d.serialNo}</span>],
              ["Document", `${STUDENT_DOC_LABEL[d.type]}${d.details.part ? ` Part-${d.details.part}` : ""}`],
              ["Handed over", formatDate(d.issuedOn)],
              ["Received by", d.details.receivedBy ?? "—"],
              ["Issued by", d.issuedBy],
            ]}
          />
          <p className="m-0 text-small text-ink-muted">Board documents are not printed by the school. This entry also fills the date on the collection sheet.</p>
        </div>
        <Modal
          open={cancelling}
          onClose={() => setCancelling(false)}
          title={`Cancel ${d.serialNo}?`}
          description="The entry stays in the register, marked cancelled. Record the hand-over again if it was entered wrongly."
          footer={
            <>
              <Button onClick={() => setCancelling(false)}>Back</Button>
              <Button variant="danger" icon="ban" disabled={!why} loading={cancel.isPending} onClick={() => cancel.mutate()}>
                Cancel entry
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <Select label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} options={[{ value: "", label: "Choose…" }, "Recorded for the wrong student", "Date or name was wrong", "Not handed over after all", "Other"]} />
            {reason === "Other" && <Input label="Say why" required value={other} onChange={(e) => setOther(e.target.value)} />}
            {cancel.error && <Banner tone="danger">{apiMessage(cancel.error)}</Banner>}
          </div>
        </Modal>
      </SidePanel>
    );
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      wide
      title={`${STUDENT_DOC_LABEL[d.type]} · ${d.serialNo}`}
      description={`${d.studentName} · ${d.grNo} · ${d.classSection}`}
      footer={
        <>
          <Link to="/students/$grNo" params={{ grNo: d.grNo }} search={(prev: Record<string, unknown>) => ({ ...prev, tab: "documents" }) as never} className={buttonClassName({ variant: "secondary" })}>
            Student record
          </Link>
          {editable && (
            <Button variant="danger-quiet" icon="ban" onClick={() => setCancelling(true)}>
              Cancel document
            </Button>
          )}
          {returnable && (
            <Button icon="inbox" onClick={() => setReturning(true)}>
              Mark card returned
            </Button>
          )}
          {editable && !d.returnedOn && (
            <Button variant="primary" icon="printer" onClick={() => setReprinting(true)}>
              Reprint…
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-5">
        {d.status === "CANCELLED" && <Banner tone="warning" title="Cancelled">{d.cancelledReason}</Banner>}
        {d.returnedOn && (
          <Banner tone="neutral" title={`Card returned on ${formatDate(d.returnedOn)}`}>
            The card is back with the office{d.returnedBy ? ` (taken by ${d.returnedBy})` : ""}. Issue a new card if the student needs one again.
          </Banner>
        )}
        <KeyValue
          items={[
            ["Serial no.", <span className="mtb-mono">{d.serialNo}</span>],
            ["Issued", `${formatDate(d.issuedOn)} by ${d.issuedBy}`],
            ...(d.details.receivedBy ? ([["Collected by", d.details.receivedBy]] as Array<[string, string]>) : []),
            ...(d.type === "ID_CARD" ? ([["Returned", d.returnedOn ? `${formatDate(d.returnedOn)}${d.returnedBy ? ` · ${d.returnedBy}` : ""}` : "Not returned"]] as Array<[string, string]>) : []),
            ["Paper", STUDENT_DOC_PAPER[d.type]],
            ["Prints", `${d.prints.length} (${d.prints.length - 1} ${d.prints.length - 1 === 1 ? "reprint" : "reprints"})`],
          ]}
        />
        {d.type === "ID_CARD" && <CardBackSwitch checked={backs} onChange={setBacks} />}
        <PrintSheet paper={docPaper(d.type)} label={`${STUDENT_DOC_LABEL[d.type]} ${d.serialNo}`} zoom={d.type === "ID_CARD" ? 0.62 : 0.55}>
          <DocumentView d={asInput(d)} backs={backs} />
        </PrintSheet>
        <div className="grid gap-2">
          <span className="mtb-label">Print log</span>
          <Timeline label="Print log" items={[...d.prints].reverse().map((pr, i) => ({ id: `${pr.at}-${i}`, date: pr.at.slice(0, 10), title: i === d.prints.length - 1 ? "Original printed" : `Reprint ${d.prints.length - i - 1}`, description: `${formatDateTime(pr.at)} · ${pr.by}${pr.reason ? ` · ${pr.reason}` : ""}`, icon: "printer", tone: i === d.prints.length - 1 ? "brand" : "neutral" }))} />
        </div>
      </div>
      <Modal
        open={reprinting || cancelling}
        onClose={() => {
          setReprinting(false);
          setCancelling(false);
        }}
        title={cancelling ? `Cancel ${d.serialNo}?` : `Reprint ${d.serialNo}`}
        description={cancelling ? "The serial number stays in the register, marked cancelled. Issue a new document if one is still needed." : "Every reprint is logged with a reason and the copy is marked as a reprint."}
        footer={
          <>
            <Button
              onClick={() => {
                setReprinting(false);
                setCancelling(false);
              }}
            >
              Back
            </Button>
            <Button variant={cancelling ? "danger" : "primary"} icon={cancelling ? "ban" : "printer"} disabled={!why} loading={reprint.isPending || cancel.isPending} onClick={() => (cancelling ? cancel.mutate() : reprint.mutate())}>
              {cancelling ? "Cancel document" : "Reprint and print"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Select label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} options={[{ value: "", label: "Choose…" }, ...(cancelling ? ["Card lost, a new one will be issued", "Issued by mistake", "Details were wrong", "Other"] : REPRINT_REASONS)]} />
          {reason === "Other" && <Input label="Say why" required value={other} onChange={(e) => setOther(e.target.value)} />}
          {(reprint.error || cancel.error) && <Banner tone="danger">{apiMessage(reprint.error ?? cancel.error)}</Banner>}
        </div>
      </Modal>
      <Modal
        open={returning}
        onClose={() => setReturning(false)}
        title={`Mark ${d.serialNo} returned`}
        description="Record the day the card was handed back to the office, for example when the student leaves."
        footer={
          <>
            <Button onClick={() => setReturning(false)}>Back</Button>
            <Button variant="primary" icon="check" loading={markReturned.isPending} onClick={confirmReturn}>
              Mark returned
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <DatePicker label="Returned on" required value={returnedOn || null} onValueChange={(v) => setReturnedOn(v ?? "")} today={today()} minDate={d.issuedOn} maxDate={today()} error={returnError || fieldError(markReturned.error, "returnedOn")} />
          {markReturned.error && !fieldError(markReturned.error, "returnedOn") && <Banner tone="danger">{apiMessage(markReturned.error)}</Banner>}
        </div>
      </Modal>
    </SidePanel>
  );
}

/** ID cards for a whole class: preview the sheet, issue a serial for each card, print ten to an A4 sheet. */
function ClassCardsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const classes = useQuery(metaQueries.classes(ctx.campus));
  const [cs, setCs] = useState("");
  const roster = useQuery({ ...studentDocsQueries.classRoster(ctx, cs), enabled: open && Boolean(cs) });
  const [confirming, setConfirming] = useState(false);
  const [issued, setIssued] = useState<StudentDocIssued[] | null>(null);
  const [skipped, setSkipped] = useState<Array<{ name: string; reason: string }>>([]);
  const [key, setKey] = useState(newIdempotencyKey);
  const [backs, setBacks] = useState(false);
  useEffect(() => {
    if (open) {
      setIssued(null);
      setSkipped([]);
      setConfirming(false);
      setKey(newIdempotencyKey());
    }
  }, [open]);
  const issue = useMutation({
    mutationFn: () => studentDocsApi.issue(ctx, { type: "ID_CARD", grNos: (roster.data ?? []).map((s) => s.grNo), details: {} }, key), // valid until the session's end at this campus (server default)
    onSuccess: (r) => {
      setConfirming(false);
      setIssued(r.issued);
      setSkipped(r.skipped);
      void queryClient.invalidateQueries({ queryKey: studentDocsQueries.all() });
      toast({ title: `${r.issued.length} ID cards issued for ${cs}`, message: r.skipped.length ? `${r.skipped.length} skipped. Printing now.` : "Printing now: ten cards to an A4 sheet." });
      printNow();
    },
  });
  const options = (classes.data ?? []).flatMap((c) => c.sections.map((s) => `${c.short}-${s}`));
  const preview: DocInput[] = issued
    ? issued.map((d) => asInput(d, 1))
    : (roster.data ?? []).map((s) => ({ type: "ID_CARD" as const, serialNo: "Assigned on issue", issuedOn: today(), details: {}, snapshot: s }));
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      wide
      title={issued ? `${issued.length} ID cards issued` : "ID cards for a class"}
      description="CR80 cards, ten to an A4 sheet. Each card gets its own serial number in the register."
      footer={
        issued ? (
          <>
            <Button onClick={onClose}>Done</Button>
            <Button variant="primary" icon="printer" onClick={() => window.print()}>
              Print
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon="idCard" disabled={!roster.data?.length} onClick={() => setConfirming(true)}>
              Issue {roster.data?.length ?? 0} cards and print
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-4">
        {!issued && <Select label="Class and section" value={cs} onChange={(e) => setCs(e.target.value)} options={[{ value: "", label: "Choose…" }, ...options]} />}
        {skipped.length > 0 && (
          <Banner tone="warning" title={`${skipped.length} not issued`}>
            {skipped.map((s) => `${s.name}: ${s.reason}`).join(" ")}
          </Banner>
        )}
        {roster.isError && <LoadError what="class list" error={roster.error} onRetry={() => void roster.refetch()} />}
        {cs && roster.isLoading && <Skeleton height={320} />}
        {cs && roster.data?.length === 0 && <EmptyState icon="students" title="No students" description={`Nobody is enrolled in ${cs}.`} />}
        {preview.length > 0 && <CardBackSwitch checked={backs} onChange={setBacks} />}
        {preview.length > 0 && (
          <PrintSheet paper="ID_SHEET" label={`ID cards ${cs}`} zoom={0.5}>
            <IdCardSheets cards={preview} backs={backs} />
          </PrintSheet>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          issue.reset();
        }}
        onConfirm={() => issue.mutate()}
        icon="idCard"
        title={`Issue ${roster.data?.length ?? 0} ID cards for ${cs}?`}
        message="Each student gets a new serial number. Any card already issued this session is cancelled and replaced, and the register records it."
        details={[
          ["Class", cs],
          ["Cards", String(roster.data?.length ?? 0)],
          ["Valid until", "The last day of the session at this campus"],
          ["A4 sheets", String(Math.ceil((roster.data?.length ?? 0) / 10) * (backs ? 2 : 1)) + (backs ? " (fronts and backs)" : "")],
        ]}
        confirmLabel="Issue and print"
        loading={issue.isPending}
        loadingLabel="Issuing…"
        error={issue.error ? apiMessage(issue.error) : undefined}
      />
    </SidePanel>
  );
}

export function DocumentsPage({ type, setType }: { type: StudentDocType | ""; setType: (t: StudentDocType | "") => void }) {
  const ctx = useCtx();
  const canEdit = useCan("students.edit");
  const readOnly = useReadOnly();
  const register = useQuery(studentDocsQueries.register(ctx, type));
  const roster = useQuery({ ...studentsQueries.list(ctx, { status: "" }), enabled: ctx.campus !== "ALL" });
  const classes = useQuery(metaQueries.classes(ctx.campus));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<StudentDocIssued | null>(null);
  const [picking, setPicking] = useState<StudentDocType | null>(null);
  const [grNo, setGrNo] = useState("");
  const [issuing, setIssuing] = useState<{ grNo: string; type: StudentDocType } | null>(null);
  const [classCards, setClassCards] = useState(false);
  const [collection, setCollection] = useState(false);
  const [slips, setSlips] = useState(false);
  const [forms, setForms] = useState(false);
  const [letters, setLetters] = useState(false);
  const r = register.data;
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (r?.items ?? []).filter((d) => !n || d.studentName.toLowerCase().includes(n) || d.grNo.toLowerCase().includes(n) || d.serialNo.toLowerCase().includes(n));
  }, [r, q]);
  const editable = canEdit && !readOnly;
  const studentOptions = (roster.data?.items ?? []).map((s) => ({ value: s.grNo, label: s.name, hint: `${s.grNo} · ${s.classSection}`, keywords: [s.grNo, s.father], classSection: s.classSection }));

  const columns: Array<Column<StudentDocIssued>> = [
    { key: "serialNo", header: "Serial no.", width: 170, render: (d) => <span className="mtb-mono">{d.serialNo}</span> },
    { key: "type", header: "Document", width: 220, render: (d) => <span className="flex items-center gap-2"><Icon name={ICON[d.type]} size={16} className="text-ink-muted" />{STUDENT_DOC_LABEL[d.type]}</span> },
    {
      key: "studentName",
      header: "Student",
      render: (d) => (
        <span className="grid">
          <span className="mtb-cell-primary">{d.studentName}</span>
          <span className="mtb-cell-secondary">
            <span className="mtb-mono">{d.grNo}</span> · {d.classSection}
          </span>
        </span>
      ),
    },
    { key: "issuedOn", header: "Issued", width: 120, render: (d) => <span className="tabular-nums">{formatDate(d.issuedOn)}</span> },
    {
      key: "issuedBy",
      header: "By",
      width: 150,
      render: (d) =>
        isHandoverDoc(d.type) ? (
          <span className="grid">
            <span>{d.issuedBy}</span>
            {d.details.receivedBy && <span className="mtb-cell-secondary">to {d.details.receivedBy}</span>}
          </span>
        ) : (
          d.issuedBy
        ),
    },
    { key: "prints", header: "Prints", align: "right", width: 80, render: (d) => (isHandoverDoc(d.type) ? <span className="text-ink-subtle">—</span> : <span className="tabular-nums">{d.prints.length}</span>) },
    {
      key: "status",
      header: "Status",
      width: 150,
      render: (d) =>
        d.status === "CANCELLED" ? (
          <StatusBadge status="cancelled" />
        ) : isHandoverDoc(d.type) ? (
          <StatusBadge status="success">{d.details.part ? `Handed over · ${d.details.part}` : "Handed over"}</StatusBadge>
        ) : d.returnedOn ? (
          <StatusBadge status="neutral">{`Returned ${formatDate(d.returnedOn)}`}</StatusBadge>
        ) : d.prints.length > 1 ? (
          <StatusBadge status="info">Reprinted</StatusBadge>
        ) : (
          <StatusBadge status="success">Issued</StatusBadge>
        ),
    },
  ];
  // Board documents: only students of board-exam classes (Setup's boardExamPart; everyone while the server doesn't send it).
  const pickOptions = picking && isHandoverDoc(picking) ? studentOptions.filter((o) => isBoardClass(classes.data, classShortOf(o.classSection)) !== false) : studentOptions;
  const handedOver = r ? STUDENT_HANDOVER_DOC_TYPES.reduce((a, t) => a + r.counts[t], 0) : 0;
  const tile = (t: StudentDocType, i: number) => (
    <li key={t} className="mtb-slide-in" style={stagger(i)}>
      <button
        type="button"
        onClick={() => {
          setPicking(t);
          setGrNo("");
        }}
        className="grid h-full w-full gap-2 rounded-lg border border-border p-4 text-left hover:border-brand hover:bg-surface-hover"
      >
        <span className="grid h-9 w-9 place-content-center rounded-md bg-brand-tint text-brand-ink" aria-hidden="true">
          <Icon name={ICON[t]} size={18} />
        </span>
        <b className="font-medium text-ink">{STUDENT_DOC_LABEL[t]}</b>
        <span className="text-small text-ink-muted">{STUDENT_DOC_PAPER[t]}</span>
      </button>
    </li>
  );

  return (
    <RequirePermission permission="students.view" page="ID cards and certificates">
      <Page>
        <PageHeader
          title="ID cards & certificates"
          actions={
            ctx.campus !== "ALL" ? (
              <>
                <Button icon="listChecks" onClick={() => setCollection(true)}>
                  Collection sheet
                </Button>
                <Button icon="file" onClick={() => setForms(true)}>
                  Admission forms for a class
                </Button>
                {editable && (
                  <Button icon="receipt" onClick={() => setSlips(true)}>
                    Admission slips for new admissions
                  </Button>
                )}
                {editable && (
                  <Button icon="star" onClick={() => setLetters(true)}>
                    Letters for a class
                  </Button>
                )}
                {editable && (
                  <Button variant="primary" icon="idCard" onClick={() => setClassCards(true)}>
                    ID cards for a class
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
        <StudentsSubNav />
        {register.isError && <LoadError what="issue register" error={register.error} onRetry={() => void register.refetch()} />}
        {readOnly && <Banner tone="info">{`Session ${formatSession(ctx.session)} is closed. Its register can be viewed; new documents are issued in the current session.`}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="mtb-rise" style={stagger(1)}>
            <StatCard
              label="Issued this session"
              icon="file"
              loading={!r}
              value={r ? <AnimatedNumber value={Object.values(r.counts).reduce((a, n) => a + n, 0)} format={formatCount} /> : undefined}
              foot={handedOver ? `each with a serial number · ${handedOver} board ${handedOver === 1 ? "document" : "documents"} handed over` : "each with a serial number"}
            />
          </div>
          <div className="mtb-rise" style={stagger(2)}>
            <StatCard label="ID cards" icon="idCard" tone="info" loading={!r} value={r ? <AnimatedNumber value={r.counts.ID_CARD} format={formatCount} /> : undefined} foot="replacements cancel the old card" onClick={() => setType("ID_CARD")} />
          </div>
          <div className="mtb-rise" style={stagger(3)}>
            <StatCard label="Certificates" icon="award" loading={!r} value={r ? <AnimatedNumber value={r.counts.LEAVING_CERT + r.counts.CHARACTER_CERT} format={formatCount} /> : undefined} foot={r ? `${r.counts.LEAVING_CERT} leaving · ${r.counts.CHARACTER_CERT} character` : undefined} />
          </div>
          <div className="mtb-rise" style={stagger(4)}>
            <StatCard label="Reprints" icon="printer" tone={r && r.reprints > 0 ? "warning" : "neutral"} loading={!r} value={r ? <AnimatedNumber value={r.reprints} format={formatCount} /> : undefined} foot="every copy logged with a reason" />
          </div>
        </div>

        {editable && (
          <Panel id="issue" rise={5} title="Issue a document" description="Choose the document, then the student. The live preview is exactly what prints.">
            <RequireSingleCampus action="document issue">
              <div className="grid gap-4">
                <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3 xl:grid-cols-6">{STUDENT_PRINTED_DOC_TYPES.map(tile)}</ul>
                <div className="grid gap-2">
                  <span className="mtb-label">Board documents · hand over and log who received them</span>
                  <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3 xl:grid-cols-6">{STUDENT_HANDOVER_DOC_TYPES.map((t, i) => tile(t, i + STUDENT_PRINTED_DOC_TYPES.length))}</ul>
                </div>
              </div>
            </RequireSingleCampus>
          </Panel>
        )}

        <DataTable
          caption="Issue register"
          columns={columns}
          rows={rows}
          loading={register.isLoading}
          onRowClick={setOpen}
          rowClassName={(d) => (d.status === "CANCELLED" ? "is-muted" : undefined)}
          empty={<EmptyState icon="file" title="Nothing issued yet" description="ID cards, admission slips, certificates and letters appear here with their serial numbers once issued." />}
          toolbar={
            <div className="flex w-full flex-wrap items-end gap-3">
              <Segmented aria-label="Document" className="flex-wrap" value={type} onChange={(v) => setType(v as StudentDocType | "")} options={[{ value: "", label: "All" }, ...STUDENT_DOC_TYPES.map((t) => ({ value: t, label: `${DOC_SHORT[t]}${r ? ` · ${r.counts[t]}` : ""}` }))]} />
              <div className="min-w-56 flex-1">
                <Input label="Search" icon="search" placeholder="Student, G.R. or serial number" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
          }
        />

        <Modal
          open={picking !== null}
          onClose={() => setPicking(null)}
          title={picking ? STUDENT_DOC_LABEL[picking] : ""}
          description="Choose the student"
          footer={
            <>
              <Button onClick={() => setPicking(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!grNo}
                onClick={() => {
                  setIssuing({ grNo, type: picking! });
                  setPicking(null);
                }}
              >
                Continue
              </Button>
            </>
          }
        >
          <Combobox label="Student" required options={pickOptions} value={grNo || null} onValueChange={setGrNo} placeholder="Search by name or G.R. number" emptyText={picking && isHandoverDoc(picking) ? "No Class 9 or 10 student matches." : "No student matches."} />
        </Modal>

        <DocumentPanel doc={open} open={open !== null} onClose={() => setOpen(null)} />
        <IssueDocumentPanel open={issuing !== null} onClose={() => setIssuing(null)} grNo={issuing?.grNo ?? ""} {...(issuing ? { initialType: issuing.type } : {})} />
        <ClassCardsPanel open={classCards} onClose={() => setClassCards(false)} />
        <CollectionSheetPanel open={collection} onClose={() => setCollection(false)} />
        <AdmissionSlipsPanel open={slips} onClose={() => setSlips(false)} />
        <AdmissionFormsPanel open={forms} onClose={() => setForms(false)} />
        <LettersPanel open={letters} onClose={() => setLetters(false)} />
      </Page>
    </RequirePermission>
  );
}
