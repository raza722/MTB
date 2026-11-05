import { admissionsApi, admissionsPapersFor, admissionsQueries, ApiError, newIdempotencyKey, type AdmissionsApplicant, type AdmissionsTest, type AdmissionsTestSubject } from "@mtb/api";
import { formatDate } from "@mtb/domain";
import { Banner, Button, buttonClassName, Checkbox, cx, DatePicker, EmptyState, IconButton, Input, Modal, Panel, Select, Skeleton, StatusBadge, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Page, PageHeader, RequireSingleCampus } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { PrintSheet, printNow } from "../students/documents/print";
import { apiMessage, fieldError, LoadError, stagger, TODAY } from "../students/shared";
import { AdmissionsSubNav, DiamondMindsBadge } from "./shared";
import { AttendanceSheet, MarksSheetPrint, TestSlip } from "./slips";

type Row = { absent: boolean; marks: Record<string, string> };

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
  useEffect(() => {
    const last = tests.filter((t) => t.classApplied === cls).sort((a, b) => b.date.localeCompare(a.date))[0];
    setSubjects((last?.subjects ?? [{ subject: "English", max: 30 }, { subject: "Mathematics", max: 40 }, { subject: "Urdu", max: 30 }]).map((s: AdmissionsTestSubject) => ({ subject: s.subject, max: String(s.max), stream: s.stream ?? "", mins: s.durationMins ? String(s.durationMins) : "" })));
    if (last) setVenue(last.venue);
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
      toast({ title: `${t.name} added`, message: `${formatDate(t.date)}, ${t.time} · ${t.max} marks. Applicants can now be booked into it.` });
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
          <DatePicker label="Date" required value={date} minDate={TODAY} onValueChange={setDate} error={tried && !date ? "Choose the date." : fieldError(create.error, "date")} />
          <Input label="Time" value={time} onChange={(e) => setTime(e.target.value)} />
          <Input label="Venue" value={venue} onChange={(e) => setVenue(e.target.value)} />
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
                <Input aria-label={`Paper ${i + 1}`} value={s.subject} onChange={(e) => setSubjects((x) => x.map((y, j) => (j === i ? { ...y, subject: e.target.value } : y)))} />
              </div>
              {streams.length > 0 && (
                <div className="w-48">
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
          {tried && badTime && <span className="text-small text-danger-ink">A paper lasts 5 to 240 minutes.</span>}
          {tried && noCommon && <span className="text-small text-danger-ink">Add at least one paper for all candidates.</span>}
          {streams.length > 0 && <span className="text-small text-ink-muted">A group paper is sat only by that group's candidates; their totals follow their own papers.</span>}
        </fieldset>
        {create.error && !(create.error instanceof ApiError && create.error.field) && <Banner tone="danger">{apiMessage(create.error)}</Banner>}
      </div>
    </Modal>
  );
}

function MarksSheet({ testId }: { testId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = useCan("admissions.manage");
  const readOnly = useReadOnly();
  const sheet = useQuery(admissionsQueries.testSheet(testId));
  const [rows, setRows] = useState<Map<string, Row>>(new Map());
  const [printing, setPrinting] = useState<null | "slips" | "sheet" | "marks">(null);
  const [remarks, setRemarks] = useState("");
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
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > s.max) e[`${id}:${s.subject}`] = `0 to ${s.max}`;
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
  const total = (a: AdmissionsApplicant, r: Row | undefined) => (r && !r.absent && papers(a).every((s) => (r.marks[s.subject] ?? "") !== "") ? papers(a).reduce((x, s) => x + Number(r.marks[s.subject] || 0), 0) : null);
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

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-small text-ink-muted">
          {formatDate(t.date)}, {t.time} · {t.venue} · {t.subjects.map((s) => `${s.subject} ${s.max}${s.durationMins ? ` (${s.durationMins} min)` : ""}${s.stream ? `, ${s.stream} only` : ""}`).join(" · ")} · total {t.max}
        </p>
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
          <div className="mtb-table-scroll">
            <table className="mtb-table">
              <caption className="mtb-sr-only">Marks for {t.name}</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ position: "static", width: 90 }}>Seat</th>
                  <th scope="col" style={{ position: "static" }}>Candidate</th>
                  <th scope="col" style={{ position: "static", width: 80 }}>Absent</th>
                  {t.subjects.map((s) => (
                    <th key={s.subject} scope="col" className="mtb-th-num" style={{ position: "static", width: 110 }}>
                      {s.subject} <span className="text-ink-muted">/{s.max}</span>
                      {s.stream && <span className="block text-caption font-normal text-ink-muted">{s.stream} only</span>}
                    </th>
                  ))}
                  <th scope="col" className="mtb-th-num" style={{ position: "static", width: 100 }}>Total</th>
                  <th scope="col" className="mtb-th-num" style={{ position: "static", width: 80 }}>%</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a: AdmissionsApplicant, i) => {
                  const r = rows.get(a.id);
                  const due = a.fee?.status === "DUE";
                  const tot = total(a, r);
                  const mine = papers(a);
                  return (
                    <tr key={a.id} className={cx("mtb-slide-in", (r?.absent || due) && "is-muted")} style={stagger(i)}>
                      <td className="mtb-mono">{a.testRollNo ?? "—"}</td>
                      <td>
                        <span className="grid">
                          <span className="mtb-cell-primary flex flex-wrap items-center gap-2">
                            {a.name} {a.diamondMinds && <DiamondMindsBadge />} {due && <StatusBadge status="unpaid">Fee due</StatusBadge>}
                          </span>
                          <span className="mtb-cell-secondary">
                            {a.relation} {a.father} · {a.applicationNo}
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
                              inputMode="numeric"
                              inputClassName="text-right tabular-nums"
                              disabled={!editable || due || r?.absent}
                              value={r?.marks[s.subject] ?? ""}
                              error={errors[k]}
                              onChange={(e) => set(a.id, (x) => ({ ...x, marks: { ...x.marks, [s.subject]: e.target.value.replace(/[^\d]/g, "").slice(0, 3) } }))}
                            />
                          </td>
                        );
                      })}
                      <td className="mtb-td-num font-semibold">{r?.absent ? "Absent" : tot !== null ? `${tot} / ${maxFor(a)}` : <span className="text-ink-subtle">—</span>}</td>
                      <td className="mtb-td-num">{!r?.absent && tot !== null && maxFor(a) ? `${((tot / maxFor(a)) * 100).toFixed(1)}` : <span className="text-ink-subtle">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mtb-table-footer flex flex-wrap items-center justify-between gap-3">
            <span>
              {t.marked} of {t.candidates} marked · appeared {appearedCount} · absent {absentCount} · a candidate moves to the merit list when every paper has a mark
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
      {Object.keys(errors).length > 0 && <Banner tone="danger">Some marks are above the paper's total. Fix the highlighted boxes, then save.</Banner>}
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
          <PrintSheet paper="A5" label="Test slips" zoom={0.6}>
            {paid.map((a) => (
              <Fragment key={a.id}>
                <TestSlip a={a} test={t} />
              </Fragment>
            ))}
          </PrintSheet>
        ) : printing === "sheet" ? (
          <PrintSheet paper="A4" label="Attendance sheet" zoom={0.55}>
            <AttendanceSheet test={t} rows={list} campusName={list[0]?.campusName ?? ""} />
          </PrintSheet>
        ) : printing === "marks" ? (
          <PrintSheet paper="A4" label="Marks sheet" zoom={0.55}>
            <MarksSheetPrint test={t} rows={list} campusName={list[0]?.campusName ?? ""} />
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
        <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Panel id="sittings" rise={1} title="Sittings" description="Marks to enter first, then upcoming, then marked" flush>
            {!setup.data ? (
              <div className="grid gap-2 p-4">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} height={64} />
                ))}
              </div>
            ) : sorted.length === 0 ? (
              <EmptyState icon="calendar" title="No test sittings" description="Add a sitting for each class that admits through an entrance test." />
            ) : (
              <ul className="m-0 grid max-h-[680px] list-none gap-1 overflow-y-auto p-2">
                {sorted.map((t, i) => (
                  <li key={t.id} className="mtb-slide-in" style={stagger(i)}>
                    <button type="button" onClick={() => setTestId(t.id)} aria-current={t.id === selected ? "true" : undefined} className={cx("grid w-full gap-1.5 rounded-md px-3 py-2.5 text-left", t.id === selected ? "bg-surface-selected" : "hover:bg-surface-hover")}>
                      <span className="flex items-center justify-between gap-2">
                        <b className="font-medium text-ink">{t.classApplied}</b>
                        <StatusBadge status={STATUS[t.status].tone}>{STATUS[t.status].label}</StatusBadge>
                      </span>
                      <span className="text-small text-ink-muted">
                        {t.name.split("·")[1]?.trim() ?? t.name} · {formatDate(t.date)}, {t.time}
                      </span>
                      <span className="text-small text-ink-muted">
                        {t.candidates} booked · {t.feePaid} paid · {t.marked} marked
                      </span>
                      {t.candidates > 0 && (
                        <span className="mtb-meter" role="meter" aria-valuenow={t.marked} aria-valuemin={0} aria-valuemax={t.candidates} aria-label={`${t.marked} of ${t.candidates} marked`}>
                          <span style={{ width: `${(t.marked / t.candidates) * 100}%` }} />
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel id="marks" rise={2} title={current?.name ?? "Choose a sitting"} description={current ? `${current.candidates} candidates · marks per paper, totals add up as you type` : undefined}>
            {selected ? <MarksSheet testId={selected} /> : <EmptyState icon="edit" title="No sitting chosen" description="Choose a sitting on the left." />}
          </Panel>
        </div>
        <NewSittingModal open={adding} onClose={() => setAdding(false)} tests={tests} onCreated={setTestId} />
      </RequireSingleCampus>
    </Page>
  );
}
