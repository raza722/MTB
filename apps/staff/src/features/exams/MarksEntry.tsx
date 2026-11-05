import { examsApi, examsQueries, examsSits, type ExamDetail, type ExamsMark } from "@mtb/api";
import { formatPercent, formatTime } from "@mtb/domain";
import { Banner, Button, Checkbox, cx, Panel, Segmented, Select, ShortcutHints, Spinner, StatusBadge, useToast } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useCan, useReadOnly } from "../../app/session";
import { cellText, MarksGrid, parseCell, type GridCol, type GridRow, type GridValues } from "./MarksGrid";
import { errorText, PaperBadge, useExam } from "./shared";
import { useAutosave, type AutosaveState } from "./useAutosave";

export interface MarksSearch {
  section?: string;
  subject?: string;
}

/**
 * Marks entry for the exam office: one section at a time (a programme test: several test centres at once), every
 * subject or one, saved as you type. In classes with groups, a paper outside a student's group is a dash.
 */
export function MarksEntry({ search, onSearch }: { search: MarksSearch; onSearch: (next: MarksSearch) => void }) {
  const exam = useExam();
  const canManage = useCan("exams.manage");
  const readOnly = useReadOnly();
  const programme = Boolean(exam.programmeId);
  const section = search.section && exam.classes.includes(search.section) ? search.section : exam.classes[0]!;
  // Programme tests (Diamond Minds): tick several test centres, or Check all.
  const [centres, setCentres] = useState<string[]>(() => (search.section && exam.classes.includes(search.section) ? [search.section] : exam.classes));
  const shown = programme ? exam.classes.filter((c) => centres.includes(c)) : [section];
  const subject = search.subject && exam.subjects.some((s) => s.id === search.subject) ? search.subject : "ALL";
  const declared = exam.status === "DECLARED";
  const locked = declared || readOnly || !canManage;
  const why = declared ? "Results are declared, so marks are locked. Ask for the results to be reopened to correct a mark." : readOnly ? "Past sessions are read-only." : !canManage ? "Your role can view marks but not change them." : null;
  const where = programme ? (shown.length === exam.classes.length ? "every centre" : shown.length === 1 ? shown[0]! : `${shown.length} centres`) : section;

  return (
    <>
      {why && <Banner tone="neutral" title="Read only">{why}</Banner>}
      <Panel
        id="marks-entry"
        title={`Marks · ${where}`}
        description={`Type a mark, A for absent or L for leave. Marks save on their own a moment after you stop typing.${exam.groups?.length ? " A dash means the student's group doesn't take that paper." : ""}`}
        rise={0}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {!programme && exam.classes.length > 1 && <Segmented aria-label="Section" value={section} onChange={(v) => onSearch({ section: v, ...(subject !== "ALL" ? { subject } : {}) })} options={exam.classes} />}
            <div className="w-48">
              <Select
                aria-label="Subjects shown"
                value={subject}
                onChange={(e) => onSearch({ section, ...(e.target.value !== "ALL" ? { subject: e.target.value } : {}) })}
                options={[{ value: "ALL", label: "Every subject" }, ...exam.subjects.map((s) => ({ value: s.id, label: s.groups?.length ? `${s.name} (${s.groups.join(", ")})` : s.name }))]}
              />
            </div>
          </div>
        }
      >
        {programme && (
          <fieldset className="m-0 mb-4 grid gap-2 border-0 p-0">
            <legend className="mb-1 text-small font-medium">Test centres</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Checkbox label="Check all" checked={centres.length === exam.classes.length} onChange={(e) => setCentres(e.target.checked ? exam.classes : [])} />
              {exam.classes.map((c) => (
                <Checkbox
                  key={c}
                  label={`${c} · ${exam.rows.filter((r) => r.classSection === c).length}`}
                  checked={centres.includes(c)}
                  onChange={(e) => setCentres((list) => (e.target.checked ? [...list, c] : list.filter((x) => x !== c)))}
                />
              ))}
            </div>
          </fieldset>
        )}
        {shown.length === 0 ? (
          <p className="m-0 text-small text-ink-muted">Tick at least one test centre to load its participants.</p>
        ) : (
          <SectionGrid key={`${exam.id}:${shown.join(",")}`} exam={exam} sections={shown} subject={subject} locked={locked} />
        )}
      </Panel>
    </>
  );
}

/** Board exams: a roll no. is 4 to 9 digits, once per exam. */
function rollError(rolls: Record<string, string>, id: string): string | undefined {
  const v = rolls[id] ?? "";
  if (!v) return undefined;
  if (!/^\d{4,9}$/.test(v)) return "A board roll no. is 4 to 9 digits.";
  if (Object.entries(rolls).some(([o, n]) => o !== id && n === v)) return "Another candidate has this roll no.";
  return undefined;
}

function initialValues(exam: ExamDetail, sections: string[]): GridValues {
  return Object.fromEntries(exam.rows.filter((r) => sections.includes(r.classSection)).map((r) => [r.id, Object.fromEntries(exam.subjects.map((s) => [s.id, cellText(r.marks[s.id] ?? null)]))]));
}

function SectionGrid({ exam, sections, subject, locked }: { exam: ExamDetail; sections: string[]; subject: string; locked: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const section = sections[0]!;
  const single = sections.length === 1;
  const where = single ? section : `${sections.length} centres`;
  const [values, setValues] = useState<GridValues>(() => initialValues(exam, sections));
  const people = useMemo(
    () => exam.rows.filter((r) => sections.includes(r.classSection)).sort((a, b) => sections.indexOf(a.classSection) - sections.indexOf(b.classSection) || a.rollNo - b.rollNo),
    [exam.rows, sections],
  );
  const sectionOf = useMemo(() => new Map(people.map((r) => [r.id, r.classSection])), [people]);
  // Board exams: each candidate's board roll no., saved with the marks and kept on the student's record.
  const board = exam.category === "BOARD";
  const [rolls, setRolls] = useState<Record<string, string>>(() => Object.fromEntries(exam.rows.filter((r) => sections.includes(r.classSection)).map((r) => [r.id, r.boardRollNo ?? ""])));
  const groupOf = useMemo(() => new Map(people.map((r) => [r.id, r.group])), [people]);
  const subjects = subject === "ALL" ? exam.subjects : exam.subjects.filter((s) => s.id === subject);
  const papers = exam.papers ?? [];
  const hasGroups = Boolean(exam.groups?.length);
  const cols: GridCol[] = subjects.map((s) => {
    const p = single ? papers.find((x) => x.classSection === section && x.subjectId === s.id) : undefined;
    return {
      key: s.id,
      label: s.name,
      max: s.maxMarks,
      allowAbsent: true,
      allowLeave: true,
      head:
        p || s.groups?.length ? (
          <span className="grid justify-items-end gap-1 font-normal">
            {s.groups?.length ? <span className="max-w-[120px] truncate text-[11px] normal-case">{s.groups.join(", ")} only</span> : null}
            {p && <PaperBadge status={p.status} />}
            {p && <span className="max-w-[120px] truncate text-[11px] normal-case">{p.teacher ?? ""}</span>}
          </span>
        ) : undefined,
    };
  });
  const rows: GridRow[] = people.map((r) => ({
    id: r.id,
    name: r.name,
    roll: r.rollNo,
    sub: (
      <span>
        <span className="mtb-mono">{r.id}</span>
        {single ? "" : ` · ${r.classSection}`}
      </span>
    ),
    ...(r.group ? { group: r.group } : {}),
    na: subjects.filter((s) => !examsSits(s, r.group)).map((s) => s.id),
  }));
  const sits = (rowId: string, subjectId: string) => {
    const s = exam.subjects.find((x) => x.id === subjectId);
    return s ? examsSits(s, groupOf.get(rowId)) : false;
  };

  const flush = useCallback(
    async (keys: string[]) => {
      // One save per section and paper (a programme test can show several centres at once).
      const byPaper = new Map<string, { classSection: string; subjectId: string; marks: Record<string, ExamsMark> }>();
      const rollsBySection = new Map<string, Record<string, string>>();
      for (const k of keys) {
        if (k.startsWith("roll|")) {
          const rowId = k.slice(5);
          const cs = sectionOf.get(rowId);
          if (!cs || rollError(rolls, rowId)) continue;
          rollsBySection.set(cs, { ...(rollsBySection.get(cs) ?? {}), [rowId]: rolls[rowId] ?? "" });
          continue;
        }
        const [rowId, subjectId] = k.split("|") as [string, string];
        const s = exam.subjects.find((x) => x.id === subjectId);
        const cs = sectionOf.get(rowId);
        if (!s || !cs) continue;
        const parsed = parseCell(values[rowId]?.[subjectId] ?? "", { key: s.id, label: s.name, max: s.maxMarks, allowAbsent: true, allowLeave: true });
        if (parsed.error) continue;
        const key = `${cs}|${subjectId}`;
        const entry = byPaper.get(key) ?? { classSection: cs, subjectId, marks: {} };
        entry.marks[rowId] = parsed.value;
        byPaper.set(key, entry);
      }
      for (const body of byPaper.values()) await examsApi.saveMarks(exam.id, body);
      for (const [cs, boardRollNos] of rollsBySection) await examsApi.saveMarks(exam.id, { classSection: cs, subjectId: exam.subjects[0]!.id, marks: {}, boardRollNos });
      void queryClient.invalidateQueries({ queryKey: ["exams"], refetchType: "active" });
      if (rollsBySection.size) void queryClient.invalidateQueries({ queryKey: ["students"] });
    },
    [exam.id, exam.subjects, queryClient, sectionOf, values, rolls],
  );
  const autosave = useAutosave(flush);

  const check = useMutation({
    mutationFn: (subjectId: string) => examsApi.paperAction(exam.id, { classSection: section, subjectId, action: "CHECK" }),
    onSuccess: (data, subjectId) => {
      queryClient.setQueryData(examsQueries.detail(exam.id).queryKey, data);
      void queryClient.invalidateQueries({ queryKey: ["exams"], refetchType: "active" });
      toast({ title: "Marked as checked", message: `${exam.subjects.find((s) => s.id === subjectId)?.name ?? ""} · ${section}` });
    },
  });

  const onRoll = (rowId: string, raw: string) => {
    if (locked) return;
    const v = raw.replace(/\D/g, "").slice(0, 9);
    const next = { ...rolls, [rowId]: v };
    setRolls(next);
    // A clash clears when either number changes, so every row whose check changed is saved or held back.
    for (const id of Object.keys(next)) {
      const was = rollError(rolls, id);
      const now = rollError(next, id);
      if (id === rowId) {
        if (now) autosave.forget(`roll|${id}`);
        else autosave.mark(`roll|${id}`);
      } else if (was && !now) autosave.mark(`roll|${id}`);
      else if (!was && now) autosave.forget(`roll|${id}`);
    }
  };

  const onChange = (rowId: string, colKey: string, raw: string) => {
    if (locked || !sits(rowId, colKey)) return;
    setValues((v) => ({ ...v, [rowId]: { ...(v[rowId] ?? {}), [colKey]: raw } }));
    const col = cols.find((c) => c.key === colKey)!;
    const key = `${rowId}|${colKey}`;
    if (parseCell(raw, col).error) autosave.forget(key);
    else autosave.mark(key);
  };

  // Live counts and problems for the subjects on screen; papers a student doesn't take are left out.
  let entered = 0;
  let total = 0;
  const problems: Array<{ name: string; subject: string; message: string }> = [];
  for (const r of people)
    for (const c of cols) {
      if (!sits(r.id, c.key)) continue;
      total++;
      const raw = values[r.id]?.[c.key] ?? "";
      const p = parseCell(raw, c);
      if (p.error) problems.push({ name: r.name, subject: c.label, message: p.error });
      else if (p.value !== null) entered++;
    }
  if (board) for (const r of people) {
    const e = rollError(rolls, r.id);
    if (e) problems.push({ name: r.name, subject: "Board roll no.", message: e });
  }
  const rollsMissing = board ? people.filter((r) => !rolls[r.id]).length : 0;
  const totalMax = exam.subjects.reduce((a, s) => a + s.maxMarks, 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-small text-ink-muted" aria-live="polite">
          <b className="text-ink">
            {entered} of {total}
          </b>{" "}
          marks entered in {where}
          {subject === "ALL" ? "" : ` · ${cols[0]?.label ?? ""}`}
          {board && ` · ${rollsMissing ? `${rollsMissing} without a board roll no.` : "every board roll no. entered"}`}
        </span>
        {!locked && <SaveStatus state={autosave.state} problems={problems.length} onRetry={() => void autosave.saveNow()} />}
      </div>

      <MarksGrid
        caption={`${exam.name} marks, ${where}`}
        rows={rows}
        cols={cols}
        values={values}
        onChange={onChange}
        readOnly={locked}
        groupColumn={hasGroups}
        {...(board
          ? {
              leadHead: (
                <span className="exams-grid-head">
                  <b>Board roll no.</b>
                  <span>4 to 9 digits</span>
                </span>
              ),
              lead: (row: GridRow) => {
                const e = rollError(rolls, row.id);
                return (
                  <input
                    className={cx("exams-cell mtb-mono", e && "is-invalid")}
                    style={{ width: 104, textAlign: "left" }}
                    value={rolls[row.id] ?? ""}
                    readOnly={locked}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={9}
                    aria-label={`${row.name}, board roll no.${e ? `: ${e}` : ""}`}
                    aria-invalid={e ? true : undefined}
                    title={e}
                    onChange={(ev) => onRoll(row.id, ev.target.value)}
                  />
                );
              },
            }
          : {})}
        trailingHead={
          <span className="exams-grid-head">
            <b>Total</b>
            <span>{hasGroups ? "own papers" : `out of ${totalMax}`}</span>
          </span>
        }
        trailing={(row) => {
          let sum = 0;
          let max = 0;
          let missing = false;
          // Only the papers the student sits count, so each group has its own maximum.
          for (const s of exam.subjects) {
            if (!examsSits(s, row.group)) continue;
            max += s.maxMarks;
            const p = parseCell(values[row.id]?.[s.id] ?? "", { key: s.id, label: s.name, max: s.maxMarks, allowAbsent: true, allowLeave: true });
            if (p.value === null) missing = true;
            else if (typeof p.value === "number") sum += p.value;
          }
          return (
            <span className="grid justify-items-end">
              <span className="mtb-num font-semibold">
                {sum}
                {hasGroups ? <span className="font-normal text-ink-muted">/{max}</span> : null}
              </span>
              <span className="text-[12px] text-ink-muted">{missing ? "incomplete" : max ? formatPercent((sum / max) * 100) : "—"}</span>
            </span>
          );
        }}
      />

      {problems.length > 0 && (
        <Banner tone="danger" title={`${problems.length} ${problems.length === 1 ? "mark needs" : "marks need"} fixing — ${problems.length === 1 ? "it isn't" : "they aren't"} saved.`}>
          <ul className="m-0 mt-1 grid gap-0.5 ps-5">
            {problems.slice(0, 6).map((p, i) => (
              <li key={i}>
                {p.name} · {p.subject}: {p.message}
              </li>
            ))}
          </ul>
        </Banner>
      )}

      {!locked && single && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-small text-ink-muted">Papers in {section}:</span>
          {subjects.map((s) => {
            const p = papers.find((x) => x.classSection === section && x.subjectId === s.id);
            if (!p) return null;
            const complete = people
              .filter((r) => examsSits(s, r.group))
              .every((r) => {
                const v = parseCell(values[r.id]?.[s.id] ?? "", { key: s.id, label: s.name, max: s.maxMarks, allowAbsent: true, allowLeave: true });
                return !v.error && v.value !== null;
              });
            return (
              <span key={s.id} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-small">
                {s.name}
                {p.status === "CHECKED" ? (
                  <StatusBadge status="success" icon="check">
                    Checked
                  </StatusBadge>
                ) : (
                  <Button size="sm" variant="ghost" disabled={!complete || autosave.state.status === "saving" || autosave.state.status === "pending"} loading={check.isPending && check.variables === s.id} onClick={() => check.mutate(s.id)}>
                    Mark checked
                  </Button>
                )}
              </span>
            );
          })}
        </div>
      )}
      {check.isError && <Banner tone="danger">{errorText(check.error)}</Banner>}

      <ShortcutHints
        items={[
          { keys: ["↑", "↓"], label: "Move up or down a subject" },
          { keys: ["Enter"], label: "Next student" },
          { keys: ["Tab"], label: "Next subject (board results: one student across)" },
          { keys: ["A"], label: "Absent" },
          { keys: ["L"], label: "Leave" },
        ]}
      />
    </div>
  );
}

function SaveStatus({ state, problems, onRetry }: { state: AutosaveState; problems: number; onRetry: () => void }) {
  if (state.status === "saving" || state.status === "pending")
    return (
      <span className="inline-flex items-center gap-2 text-small text-ink-muted" role="status">
        <Spinner label="Saving" /> Saving…
      </span>
    );
  if (state.status === "error")
    return (
      <span className="inline-flex items-center gap-2 text-small text-danger-ink" role="alert">
        Not saved: {errorText(state.error)}
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </span>
    );
  if (state.status === "saved")
    return (
      <span className="text-small text-ink-muted" role="status">
        {problems ? "Other changes saved" : "All changes saved"} at {formatTime(state.savedAt!.toISOString())}
      </span>
    );
  return <span className="text-small text-ink-muted">Changes save on their own</span>;
}
