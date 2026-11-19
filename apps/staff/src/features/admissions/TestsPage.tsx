import { admissionsApi, admissionsPapersFor, admissionsQueries, ApiError, newIdempotencyKey, type AdmissionsApplicant, type AdmissionsTest, type AdmissionsTestSubject } from "@mtb/api";
import { formatDate } from "@mtb/domain";
import { Banner, Button, buttonClassName, Checkbox, cx, DatePicker, EmptyState, IconButton, Input, Modal, Panel, Segmented, Select, Skeleton, StatusBadge, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Page, PageHeader, RequireSingleCampus } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { PrintSheet, printNow } from "../students/documents/print";
import { apiMessage, fieldError, LoadError, stagger } from "../students/shared";
import { AdmissionsSubNav, DiamondMindsBadge, relationName, sittingWhen, sittingWhenWhere, today } from "./shared";
import { AttendanceSheet, MarksSheetPrint, TestSlip, TestSlipSheet } from "./slips";
import "../students/students.css";

type Row = { absent: boolean; marks: Record<string, string> };
/** Where one candidate's row stands, for the status badge and the filter above the sheet (design of 19-Nov-2026). */
type RowState = "due" | "absent" | "bad" | "marked" | "todo";
type SheetFilter = "all" | "todo" | "marked" | "absent";

const STATUS: Record<AdmissionsTest["status"], { label: string; tone: "warning" | "info" | "success" }> = {
  MARKING: { label: "Marks to enter", tone: "warning" },
  UPCOMING: { label: "Upcoming", tone: "info" },
  DONE: { label: "Marked", tone: "success" },
};

function NewSittingModal({ open, onClose, tests, onCreated }: { open: boolean; onClose: () => void; tests: AdmissionsTest[]; onCreated: (id: string) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const setup = useQuery(admissionsQueries.setup(ctx));
  const testClasses = (setup.data?.classes ?? []).filter((c) => c.testRequired).map((c) => c.classApplied);
  const [cls, setCls] = useState("");
  const streams = setup.data?.classes.find((c) => c.classApplied === cls)?.streams ?? [];
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState("9:00 am");
  const [venue, setVenue] = useState("");
  const [subjects, setSubjects] = useState<Array<{ subject: string; max: string; stream: string; mins: string }>>([]);
  const [tried, setTried] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => {
    if (open) {
      setCls("");
      setDate(null);
      setTime("9:00 am");
      setVenue("");
      setSubjects([]);
      setTried(false);
      setKey(newIdempotencyKey());
    }
  }, [open]);
  // Start from the class's last sitting (papers, marks and venue); a class's first sitting starts with one empty paper.
  useEffect(() => {
    const last = tests.filter((t) => t.classApplied === cls).sort((a, b) => b.date.localeCompare(a.date))[0];
    setSubjects(last?.subjects.length ? last.subjects.map((s: AdmissionsTestSubject) => ({ subject: s.subject, max: String(s.max), stream: s.stream ?? "", mins: s.durationMins ? String(s.durationMins) : "" })) : [{ subject: "", max: "", stream: "", mins: "" }]);
    setVenue(last?.venue ?? "");
  }, [cls, tests]);
  const parsed: AdmissionsTestSubject[] = subjects.map((s) => ({ subject: s.subject.trim(), max: Number(s.max), ...(s.stream && streams.includes(s.stream) ? { stream: s.stream } : {}), ...(s.mins ? { durationMins: Number(s.mins) } : {}) }));
  const badPaper = parsed.some((s) => !s.subject || !Number.isInteger(s.max) || s.max <= 0 || s.max > 200);
  const badTime = parsed.some((s) => s.durationMins !== undefined && (s.durationMins < 5 || s.durationMins > 240));
  const noCommon = parsed.length > 0 && parsed.every((s) => s.stream);
  const bad = badPaper || badTime || noCommon;
  const common = parsed.filter((s) => !s.stream).reduce((a, s) => a + (Number.isFinite(s.max) ? s.max : 0), 0);
  const perGroup = streams.map((g) => ({ g, total: common + parsed.filter((s) => s.stream === g).reduce((a, s) => a + (Number.isFinite(s.max) ? s.max : 0), 0) }));
  const create = useMutation({
    mutationFn: () => admissionsApi.createTest(ctx, { classApplied: cls, date: date!, time, venue, subjects: parsed }, key),
    onSuccess: (t) => {
      void queryClient.invalidateQueries({ queryKey: admissionsQueries.all() });
      onCreated(t.id);
      onClose();
      toast({ title: `${t.name} added`, message: `${sittingWhen(t)} · ${t.max} marks. Applicants can now be booked into it.` });
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New test sitting"
      description="The papers and their marks are set per class; families book a sitting when they apply."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={create.isPending}
            onClick={() => {
              setTried(true);
              if (cls && date && !bad) create.mutate();
            }}
          >
            Add sitting
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Class" required value={cls} error={tried && !cls ? "Choose the class." : fieldError(create.error, "classApplied")} onChange={(e) => setCls(e.target.value)} options={[{ value: "", label: "Choose…" }, ...testClasses]} />
          <DatePicker label="Date" required value={date} minDate={today()} onValueChange={setDate} error={tried && !date ? "Choose the date." : fieldError(create.error, "date")} />
          <Input label="Time" value={time} placeholder="9:00 am" onChange={(e) => setTime(e.target.value)} {...(fieldError(create.error, "time") ? { error: fieldError(create.error, "time") } : {})} />
          <Input label="Venue" value={venue} placeholder="Examination hall" onChange={(e) => setVenue(e.target.value)} {...(fieldError(create.error, "venue") ? { error: fieldError(create.error, "venue") } : { help: "Left empty: the campus examination hall." })} />
        </div>
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mtb-label mb-1">Papers and total marks</legend>
          <div className="flex items-end gap-2 text-small text-ink-muted" aria-hidden="true">
            <span className="flex-1">Paper</span>
            {streams.length > 0 && <span className="w-48">Group</span>}
            <span className="w-24">Marks</span>
            <span className="w-24">Minutes</span>
            <span className="w-9" />
          </div>
          {subjects.map((s, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <Input aria-label={`Paper ${i + 1}`} placeholder="Subject, e.g. Mathematics" value={s.subject} onChange={(e) => setSubjects((x) => x.map((y, j) => (j === i ? { ...y, subject: e.target.value } : y)))} />
              </div>
              {streams.length > 0 && (
                <div className="w-full sm:w-48">
                  <Select aria-label={`Group for paper ${i + 1}`} value={s.stream} onChange={(e) => setSubjects((x) => x.map((y, j) => (j === i ? { ...y, stream: e.target.value } : y)))} options={[{ value: "", label: "All candidates" }, ...streams.map((g) => ({ value: g, label: g }))]} />
                </div>
              )}
              <div className="w-24">
                <Input aria-label={`Marks for paper ${i + 1}`} inputMode="numeric" value={s.max} onChange={(e) => setSubjects((x) => x.map((y, j) => (j === i ? { ...y, max: e.target.value.replace(/\D/g, "") } : y)))} />
              </div>
              <div className="w-24">
                <Input aria-label={`Minutes for paper ${i + 1}`} inputMode="numeric" placeholder="—" value={s.mins} onChange={(e) => setSubjects((x) => x.map((y, j) => (j === i ? { ...y, mins: e.target.value.replace(/\D/g, "").slice(0, 3) } : y)))} />
              </div>
              <IconButton icon="trash" label={`Remove ${s.subject || "paper"}`} disabled={subjects.length <= 1} onClick={() => setSubjects((x) => x.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" icon="plus" onClick={() => setSubjects((x) => [...x, { subject: "", max: "20", stream: "", mins: "" }])}>
              Add paper
            </Button>
            <span className="text-small text-ink-muted">{perGroup.some((p) => p.total !== common) ? perGroup.map((p) => `${p.g}: ${p.total} marks`).join(" · ") : `Total ${common} marks`}</span>
          </div>
          {tried && badPaper && <span className="text-small text-danger-ink">Each paper needs a name and total marks between 1 and 200.</span>}
          {fieldError(create.error, "subjects") && <span className="text-small text-danger-ink">{fieldError(create.error, "subjects")}</span>}
          <span className="text-small text-ink-muted">Each paper is a subject from Setup › Subjects (its name or code).</span>
          {tried && badTime && <span className="text-small text-danger-ink">A paper lasts 5 to 240 minutes.</span>}
          {tried && noCommon && <span className="text-small text-danger-ink">Add at least one paper for all candidates.</span>}
          {streams.length > 0 && <span className="text-small text-ink-muted">A group paper is sat only by that group's candidates; their totals follow their own papers.</span>}
        </fieldset>
        {create.error && !(create.error instanceof ApiError && create.error.field) && <Banner tone="danger">{apiMessage(create.error)}</Banner>}
      </div>
    </Modal>
  );
}

/** A mark as the server stores it: a whole number or up to two decimals ("18", "18.5"); never negative. */
const isMark = (v: string) => /^\d{1,3}(\.\d{1,2})?$/.test(v);

function MarksSheet({ testId }: { testId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = useCan("admissions.manage");
  const readOnly = useReadOnly();
  const sheet = useQuery(admissionsQueries.testSheet(testId));
  const [rows, setRows] = useState<Map<string, Row>>(new Map());
  const [printing, setPrinting] = useState<null | "slips" | "sheet" | "marks">(null);
  const [remarks, setRemarks] = useState("");
  const [filter, setFilter] = useState<SheetFilter>("all");
  useEffect(() => setFilter("all"), [testId]);
  const t = sheet.data?.test;
  const list = sheet.data?.rows ?? [];
  /** The papers one candidate sits: common ones plus their group's. */
  const papers = (a: AdmissionsApplicant) => admissionsPapersFor(t?.subjects ?? [], a.stream);
  useEffect(() => {
    setRows(new Map(list.map((a) => [a.id, { absent: Boolean(a.absentFromTest), marks: Object.fromEntries(admissionsPapersFor(t?.subjects ?? [], a.stream).map((s) => [s.subject, a.marks?.[s.subject] != null ? String(a.marks[s.subject]) : ""])) }])));
    setRemarks(t?.remarks ?? "");
  }, [testId, sheet.data?.test.marked, list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!t) return e;
    for (const [id, r] of rows) {
      if (r.absent) continue;
      const a = list.find((x) => x.id === id);
      for (const s of admissionsPapersFor(t.subjects, a?.stream)) {
        const v = r.marks[s.subject] ?? "";
        if (v === "") continue;
        if (!isMark(v)) e[`${id}:${s.subject}`] = `A number, 0 to ${s.max}`;
        else if (Number(v) > s.max) e[`${id}:${s.subject}`] = `0 to ${s.max}`;
      }
    }
    return e;
  }, [rows, t, list]);

  const save = useMutation({
    mutationFn: () =>
      admissionsApi.saveMarks(
        testId,
        [...rows.entries()].filter(([id]) => list.find((a) => a.id === id)?.fee?.status !== "DUE").map(([id, r]) => ({ id, absent: r.absent, marks: Object.fromEntries(Object.entries(r.marks).map(([k, v]) => [k, v === "" ? null : Number(v)])) })),
        newIdempotencyKey(),
        remarks.trim(),
      ),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: admissionsQueries.all() });
      const moved = res.completed ?? 0;
      toast({ title: "Marks saved", message: moved ? `${moved} ${moved === 1 ? "candidate" : "candidates"} moved to the ${res.test.classApplied} merit list.` : "Partly marked candidates stay here until every paper has a mark." });
    },
  });

  if (sheet.isError) return <LoadError what="test sheet" error={sheet.error} onRetry={() => void sheet.refetch()} />;
  if (!t) return <Skeleton height={320} />;
  const upcoming = t.status === "UPCOMING";
  const editable = canManage && !readOnly && !upcoming;
  const total = (a: AdmissionsApplicant, r: Row | undefined) =>
    r && !r.absent && papers(a).every((s) => isMark(r.marks[s.subject] ?? "")) ? Math.round(papers(a).reduce((x, s) => x + Number(r.marks[s.subject]), 0) * 100) / 100 : null;
  const maxFor = (a: AdmissionsApplicant) => papers(a).reduce((x, s) => x + s.max, 0);
  const absentCount = [...rows.values()].filter((r) => r.absent).length;
  const appearedCount = list.filter((a) => !rows.get(a.id)?.absent && total(a, rows.get(a.id)) !== null).length;
  const grouped = t.subjects.some((s) => s.stream);
  const set = (id: string, patch: Partial<Row> | ((r: Row) => Row)) =>
    setRows((m) => {
      const n = new Map(m);
      const cur = n.get(id) ?? { absent: false, marks: {} };
      n.set(id, typeof patch === "function" ? patch(cur) : { ...cur, ...patch });
      return n;
    });
  const paid = list.filter((a) => a.fee?.status !== "DUE");
  const stateOf = (a: AdmissionsApplicant): RowState => {
    const r = rows.get(a.id);
    if (a.fee?.status === "DUE") return "due";
    if (r?.absent) return "absent";
    if (Object.keys(errors).some((k) => k.startsWith(`${a.id}:`))) return "bad";
    return total(a, r) !== null ? "marked" : "todo";
  };
  const states = new Map(list.map((a) => [a.id, stateOf(a)]));
  const countOf = (...which: RowState[]) => list.filter((a) => which.includes(states.get(a.id)!)).length;
  const shown = filter === "all" ? list : list.filter((a) => (filter === "todo" ? ["todo", "bad"] : [filter]).includes(states.get(a.id)!));
  const percents = list.map((a) => ({ tot: total(a, rows.get(a.id)), max: maxFor(a) })).filter((x): x is { tot: number; max: number } => x.tot !== null && x.max > 0);
  const average = percents.length ? percents.reduce((x, y) => x + (y.tot / y.max) * 100, 0) / percents.length : null;
  const best = percents.length ? percents.reduce((x, y) => (y.tot / y.max > x.tot / x.max ? y : x)) : null;
  const settled = countOf("marked", "absent");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="stu-chip">{sittingWhenWhere(t)}</span>
          {t.subjects.map((s) => (
            <span key={s.subject} className="stu-chip">
              {s.subject} <b>{s.max}</b>
              {s.durationMins ? ` · ${s.durationMins} min` : ""}
              {s.stream ? ` · ${s.stream} only` : ""}
            </span>
          ))}
          <span className="stu-tile-pill">Total {t.max}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon="printer" disabled={!list.length || upcoming} onClick={() => setPrinting("marks")}>
            Print marks sheet
          </Button>
          <Button size="sm" icon="printer" disabled={!paid.length} onClick={() => setPrinting("slips")}>
            Test slips · {paid.length}
          </Button>
          <Button size="sm" icon="printer" disabled={!list.length} onClick={() => setPrinting("sheet")}>
            Attendance sheet
          </Button>
        </div>
      </div>
      {upcoming && <Banner tone="info">{`Marks open after the test on ${formatDate(t.date)}. Print the slips and the attendance sheet before the day.`}</Banner>}
      {list.some((a) => a.fee?.status === "DUE") && <Banner tone="warning">Candidates whose fee is not paid can't sit the test or get marks. Record the fee from the applicant's page.</Banner>}
      {list.length === 0 ? (
        <EmptyState icon="admissions" title="Nobody booked yet" description="Book applicants into this sitting from their application." />
      ) : (
        <div className="mtb-table-wrap">
          <div className="mtb-table-toolbar">
            <Segmented
              aria-label="Show"
              value={filter}
              onChange={(v) => setFilter(v as SheetFilter)}
              options={[
                { value: "all", label: `Everyone · ${list.length}` },
                { value: "todo", label: `To mark · ${countOf("todo", "bad")}` },
                { value: "marked", label: `Marked · ${countOf("marked")}` },
                { value: "absent", label: `Absent · ${countOf("absent")}` },
              ]}
            />
            {editable && <span className="text-small text-ink-muted">Type a mark and press Tab for the next paper. Totals add up as you type.</span>}
          </div>
          <div className="mtb-table-scroll" style={{ maxHeight: 520, overflowY: "auto" }}>
            <table className="mtb-table">
              <caption className="mtb-sr-only">Marks for {t.name}</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 90 }}>Seat</th>
                  <th scope="col" >Candidate</th>
                  <th scope="col" style={{ width: 80 }}>Absent</th>
                  {t.subjects.map((s) => (
                    <th key={s.subject} scope="col" className="mtb-th-num" style={{ width: 110 }}>
                      {s.subject} <span className="text-ink-muted">/{s.max}</span>
                      {s.stream && <span className="block text-caption font-normal text-ink-muted">{s.stream} only</span>}
                    </th>
                  ))}
                  <th scope="col" style={{ width: 180 }}>Total</th>
                  <th scope="col" className="mtb-th-num" style={{ width: 110 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={5 + t.subjects.length} style={{ padding: 0 }}>
                      <EmptyState icon="checkCircle" title={filter === "todo" ? "Nobody left to mark" : filter === "absent" ? "Nobody is marked absent" : "Nobody is marked yet"} description="Choose Everyone to see the whole sitting." />
                    </td>
                  </tr>
                )}
                {shown.map((a: AdmissionsApplicant, i) => {
                  const r = rows.get(a.id);
                  const due = a.fee?.status === "DUE";
                  const tot = total(a, r);
                  const mine = papers(a);
                  const state = states.get(a.id)!;
                  const pct = !r?.absent && tot !== null && maxFor(a) ? (tot / maxFor(a)) * 100 : null;
                  return (
                    <tr key={a.id} className={cx("mtb-slide-in", (r?.absent || due) && "is-muted")} style={stagger(i)}>
                      <td className="mtb-mono">{a.testRollNo ?? "—"}</td>
                      <td>
                        <span className="grid">
                          <span className="mtb-cell-primary flex flex-wrap items-center gap-2">
                            {a.name} {a.diamondMinds && <DiamondMindsBadge />} {due && <StatusBadge status="unpaid">Fee due</StatusBadge>}
                          </span>
                          <span className="mtb-cell-secondary">
                            {a.father ? `${relationName(a)} · ` : ""}
                            {a.applicationNo}
                            {grouped ? ` · ${a.stream ?? "no group: common papers only"}` : ""}
                          </span>
                        </span>
                      </td>
                      <td>
                        <Checkbox aria-label={`${a.name} was absent`} checked={Boolean(r?.absent)} disabled={!editable || due} onChange={(e) => set(a.id, { absent: e.target.checked })} />
                      </td>
                      {t.subjects.map((s) => {
                        const k = `${a.id}:${s.subject}`;
                        if (!mine.includes(s))
                          return (
                            <td key={s.subject} className="mtb-td-num text-ink-subtle" title={`${s.subject} is for ${s.stream}`}>
                              ·
                            </td>
                          );
                        return (
                          <td key={s.subject} className="mtb-td-num">
                            <Input
                              aria-label={`${a.name} ${s.subject} out of ${s.max}`}
                              inputMode="decimal"
                              inputClassName="text-right tabular-nums"
                              disabled={!editable || due || r?.absent}
                              value={r?.marks[s.subject] ?? ""}
                              error={errors[k]}
                              // kept as typed: stripping the point turned "2.5" into 25 (test run F-031); a bad mark is flagged instead
                              onChange={(e) => set(a.id, (x) => ({ ...x, marks: { ...x.marks, [s.subject]: e.target.value.replace(/\s/g, "").slice(0, 6) } }))}
                            />
                          </td>
                        );
                      })}
                      <td>
                        <span className="promo-att">
                          <span className="flex justify-between gap-2 tabular-nums">
                            <b className="font-semibold">{r?.absent ? "Absent" : tot !== null ? `${tot} / ${maxFor(a)}` : <span className="text-ink-subtle">—</span>}</b>
                            {pct !== null && <span className="text-ink-muted">{pct.toFixed(1)}%</span>}
                          </span>
                          <span className="promo-att-bar" aria-hidden="true">
                            <span style={{ width: `${pct === null ? 0 : Math.min(100, pct)}%` }} />
                          </span>
                        </span>
                      </td>
                      <td className="mtb-td-num">
                        {state === "due" ? (
                          <StatusBadge status="unpaid">Fee due</StatusBadge>
                        ) : state === "absent" ? (
                          <StatusBadge status="neutral">Absent</StatusBadge>
                        ) : state === "bad" ? (
                          <StatusBadge status="danger">Check marks</StatusBadge>
                        ) : state === "marked" ? (
                          <StatusBadge status="success">Marked</StatusBadge>
                        ) : (
                          <StatusBadge status="pending">To mark</StatusBadge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mtb-table-footer flex flex-wrap items-center justify-between gap-3">
            <span className="grid min-w-64 flex-1 gap-1.5">
              <span className="promo-att-bar" aria-hidden="true" style={{ height: 6 }}>
                <span style={{ width: `${list.length ? (settled / list.length) * 100 : 0}%` }} />
              </span>
              <span className="tabular-nums">
                <b className="text-ink">{countOf("marked")}</b> of {list.length} marked · <b className="text-ink">{countOf("todo", "bad")}</b> left · appeared {appearedCount} · absent {absentCount}
                {average !== null && best && (
                  <>
                    {" "}· average <b className="text-ink">{average.toFixed(1)}%</b> · highest <b className="text-ink">{best.tot} / {best.max}</b>
                  </>
                )}
              </span>
              <span>A candidate moves to the merit list when every paper has a mark.</span>
            </span>
            {editable && (
              <span className="flex gap-2">
                <Link to="/admissions/merit" search={(prev: Record<string, unknown>) => ({ ...prev, cls: t.classApplied }) as never} className={buttonClassName({ size: "sm" })}>
                  Merit list
                </Link>
                <Button size="sm" variant="primary" icon="check" disabled={Object.keys(errors).length > 0} loading={save.isPending} onClick={() => save.mutate()}>
                  Save marks
                </Button>
              </span>
            )}
          </div>
        </div>
      )}
      {list.length > 0 && !upcoming && (
        <Input
          label="Remarks for this sitting"
          value={remarks}
          disabled={!editable}
          maxLength={300}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="e.g. Hall changed to the library; two candidates arrived late"
          {...(fieldError(save.error, "remarks") ? { error: fieldError(save.error, "remarks") } : { help: "Saved with the marks and printed on the marks sheet." })}
        />
      )}
      {Object.keys(errors).length > 0 && (
        <Banner tone="danger">
          {Object.values(errors).some((m) => m.startsWith("A number"))
            ? "Some marks are not numbers (a mark is like 18 or 18.5) or are above the paper's total. Fix the highlighted boxes, then save."
            : "Some marks are above the paper's total. Fix the highlighted boxes, then save."}
        </Banner>
      )}
      {save.error && <Banner tone="danger">{apiMessage(save.error)}</Banner>}
      <Modal
        open={printing !== null}
        onClose={() => setPrinting(null)}
        size="lg"
        title={printing === "slips" ? `Test slips · ${t.name}` : printing === "marks" ? `Marks sheet · ${t.name}` : `Attendance sheet · ${t.name}`}
        footer={
          <>
            <Button onClick={() => setPrinting(null)}>Close</Button>
            <Button variant="primary" icon="printer" onClick={printNow}>
              Print
            </Button>
          </>
        }
      >
        {printing === "slips" ? (
          <PrintSheet paper="A4" label="Test slips" zoom={0.55}>
            <TestSlipSheet>
              {paid.map((a) => (
                <TestSlip key={a.id} a={a} test={t} />
              ))}
            </TestSlipSheet>
          </PrintSheet>
        ) : printing === "sheet" ? (
          <PrintSheet paper="A4" label="Attendance sheet" zoom={0.55}>
            <AttendanceSheet test={t} rows={list} campusName={list[0]?.campusName ?? t.campus} />
          </PrintSheet>
        ) : printing === "marks" ? (
          <PrintSheet paper="A4" label="Marks sheet" zoom={0.55}>
            <MarksSheetPrint test={t} rows={list} campusName={list[0]?.campusName ?? t.campus} />
          </PrintSheet>
        ) : null}
      </Modal>
    </div>
  );
}

export function TestsPage({ testId, setTestId }: { testId: string; setTestId: (id: string) => void }) {
  const ctx = useCtx();
  const canManage = useCan("admissions.manage");
  const readOnly = useReadOnly();
  const setup = useQuery({ ...admissionsQueries.setup(ctx), enabled: ctx.campus !== "ALL" });
  const [adding, setAdding] = useState(false);
  const tests = setup.data?.tests ?? [];
  const order: AdmissionsTest["status"][] = ["MARKING", "UPCOMING", "DONE"];
  const sorted = [...tests].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (a.status === "DONE" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  const selected = testId && tests.some((t) => t.id === testId) ? testId : (sorted[0]?.id ?? "");
  const current = tests.find((t) => t.id === selected);

  return (
    <Page>
      <PageHeader
        title="Entrance tests"
        actions={
          canManage && !readOnly && ctx.campus !== "ALL" ? (
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
              New test sitting
            </Button>
          ) : undefined
        }
      />
      <AdmissionsSubNav />
      <RequireSingleCampus action="entrance tests">
        {setup.isError && <LoadError what="test sittings" error={setup.error} onRetry={() => void setup.refetch()} />}
        <div className="grid gap-6">
          <Panel id="sittings" rise={1} title="Sittings" description="Marks to enter first, then upcoming, then marked">
            {!setup.data ? (
              <div className="stu-tiles">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} height={112} />
                ))}
              </div>
            ) : sorted.length === 0 ? (
              <EmptyState icon="calendar" title="No test sittings" description="Add a sitting for each class that admits through an entrance test." />
            ) : (
              <ul className="stu-tiles max-h-[272px] overflow-y-auto p-1">
                {sorted.map((t, i) => (
                  <li key={t.id} className="mtb-slide-in" style={stagger(i)}>
                    <button type="button" onClick={() => setTestId(t.id)} aria-pressed={t.id === selected} className="stu-tile" style={{ gap: "var(--space-2)" }}>
                      <span className="flex items-center justify-between gap-2">
                        <b className="truncate text-title-3 font-semibold text-ink">{t.classApplied}</b>
                        <StatusBadge status={STATUS[t.status].tone}>{STATUS[t.status].label}</StatusBadge>
                      </span>
                      <span className="truncate text-small text-ink-muted">
                        {t.name.split("·")[1]?.trim() ?? t.name} · {sittingWhen(t)}
                      </span>
                      <span className="mtb-meter" role="meter" aria-valuenow={t.marked} aria-valuemin={0} aria-valuemax={Math.max(1, t.candidates)} aria-label={`${t.marked} of ${t.candidates} marked`}>
                        <span style={{ width: `${t.candidates ? (t.marked / t.candidates) * 100 : 0}%` }} />
                      </span>
                      <span className="flex justify-between gap-2 text-small tabular-nums text-ink-muted">
                        <span>
                          <b className="text-ink">{t.marked}</b> of {t.candidates} marked
                        </span>
                        <span>{t.feePaid} paid</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel id="marks" rise={2} title={current?.name ?? "Choose a sitting"} description={current ? `${current.candidates} ${current.candidates === 1 ? "candidate" : "candidates"} · marks per paper, totals add up as you type` : undefined}>
            {selected ? <MarksSheet testId={selected} /> : <EmptyState icon="edit" title="No sitting chosen" description="Choose a sitting above." />}
          </Panel>
        </div>
        <NewSittingModal open={adding} onClose={() => setAdding(false)} tests={tests} onCreated={setTestId} />
      </RequireSingleCampus>
    </Page>
  );
}
