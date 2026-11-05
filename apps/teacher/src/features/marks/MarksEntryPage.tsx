import { teacherQueries, type ExamsMark, type TeacherPaperRef, type TeacherPaperSheet } from "@mtb/api";
import { formatDateTime, formatTime } from "@mtb/domain";
import { Banner, BottomSheet, Button, IconButton, Menu, MenuItem, Skeleton, cx, useToast } from "@mtb/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { idbDel, idbGet, idbSet } from "../../app/idb";
import { useCtx, useReadOnly } from "../../app/session";
import { errorText, QueryState } from "../../app/shell/QueryState";
import { Screen } from "../../app/shell/Screen";
import { useOnline } from "../../app/sync/network";
import { enqueue, useSync, type OutboxItem } from "../../app/sync/outbox";
import { checkBuffer, displayOf, Keypad, typeKey, type PadKey } from "./Keypad";
import { CATEGORY_LABEL, PaperBadge, paperHeader } from "./paper-status";

interface MarksDraft {
  edits: Record<string, ExamsMark>;
  at: number;
}

const AUTOSAVE_MS = 2500;

export function MarksEntryPage(ref: TeacherPaperRef) {
  const ctx = useCtx();
  const q = useQuery(teacherQueries.paper(ctx, ref));
  if (q.data) return <Entry key={`${ref.examId}|${ref.classSection}|${ref.subjectId}`} sheet={q.data} paperRef={ref} />;
  return (
    <Screen title="Marks" subtitle={ref.classSection} documentTitle="Marks entry" backTo="/marks">
      <QueryState
        query={q}
        skeleton={
          <div className="grid gap-2" aria-busy="true" aria-label="Loading the marks sheet">
            <Skeleton height={110} className="rounded-lg" />
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} height={56} className="rounded-lg" />
            ))}
          </div>
        }
      >
        {() => null}
      </QueryState>
    </Screen>
  );
}

const fmtMark = (m: ExamsMark) => (m === null ? "" : String(m));
const sameRef = (a: TeacherPaperRef, b: TeacherPaperRef) => a.examId === b.examId && a.classSection === b.classSection && a.subjectId === b.subjectId;

function Entry({ sheet, paperRef }: { sheet: TeacherPaperSheet; paperRef: TeacherPaperRef }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const online = useOnline();
  const sync = useSync();
  const readOnly = useReadOnly();
  const draftKey = `draft:marks:${paperRef.examId}|${paperRef.classSection}|${paperRef.subjectId}`;
  const coalesceKey = `marks:${paperRef.examId}|${paperRef.classSection}|${paperRef.subjectId}`;

  const [edits, setEdits] = useState<Record<string, ExamsMark>>({});
  const [active, setActive] = useState<string | null>(null);
  const [buffer, setBuffer] = useState("");
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());

  const forThis = (i: OutboxItem) => (i.payload.kind === "marks.save" || i.payload.kind === "marks.submit") && sameRef(i.payload.ref, paperRef);
  const queuedSubmit = sync.items.find((i) => forThis(i) && i.payload.kind === "marks.submit");
  const queuedSave = sync.items.find((i) => forThis(i) && i.payload.kind === "marks.save");
  const locked = sheet.locked || Boolean(queuedSubmit) || readOnly;
  const students = sheet.students;
  const queuedMarks = queuedSubmit && queuedSubmit.payload.kind === "marks.submit" ? queuedSubmit.payload.marks : undefined;
  const markOf = (id: string, server: ExamsMark): ExamsMark => (id in edits ? edits[id]! : (queuedMarks?.[id] ?? server));
  const marks: Record<string, ExamsMark> = Object.fromEntries(students.map((s) => [s.id, markOf(s.id, s.mark)]));
  const entered = students.filter((s) => marks[s.id] !== null).length;
  const missing = students.length - entered;
  const progress = `${entered} of ${students.length} entered`;
  const checked = checkBuffer(buffer, sheet.maxMarks);
  const activeStudent = students.find((s) => s.id === active);

  // Marks typed earlier on this phone come back (only the ones that differ from what the server has).
  useEffect(() => {
    if (loaded.current || locked) return;
    loaded.current = true;
    void idbGet<MarksDraft>(draftKey).then((d) => {
      if (!d) return;
      const fresh = Object.fromEntries(Object.entries(d.edits).filter(([id, v]) => students.find((s) => s.id === id)?.mark !== v));
      if (Object.keys(fresh).length) {
        setEdits(fresh);
        setRestoredAt(d.at);
      }
    });
  }, [draftKey, locked, students]);

  const saveToServer = async (explicit: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (locked) return;
    const res = await enqueue({ ctx, payload: { kind: "marks.save", ref: paperRef, marks }, label: `Marks · ${sheet.subjectName} ${sheet.classSection} (draft)`, coalesceKey });
    if (res.status === "sent") {
      setSavedAt(Date.now());
      if (explicit) toast({ title: "Draft saved", message: `${sheet.subjectName} · ${sheet.classSection} · ${progress}.` });
    } else if (res.status === "queued" && explicit) {
      toast({ tone: "warning", title: "Saved on this phone", message: `${progress}. It syncs when you're back online.` });
    } else if (res.status === "rejected") {
      toast({ tone: "danger", title: "Draft not saved", message: errorText(res.error) });
    }
  };

  // Autosave: on the phone straight away, to the server a moment after the last change.
  useEffect(() => {
    if (!loaded.current || locked) return;
    const local = setTimeout(() => {
      if (Object.keys(edits).length) void idbSet(draftKey, { edits, at: Date.now() } satisfies MarksDraft);
      else void idbDel(draftKey);
    }, 250);
    if (Object.keys(edits).length) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveToServer(false), AUTOSAVE_MS);
    }
    return () => clearTimeout(local);
    // saveToServer reads the latest marks when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const setEdit = (id: string, value: ExamsMark) => {
    const server = students.find((s) => s.id === id)?.mark ?? null;
    setEdits((e) => {
      const next = { ...e };
      if (value === server && !queuedMarks) delete next[id];
      else next[id] = value;
      return next;
    });
  };

  const activate = (id: string | null, current: Record<string, ExamsMark> = marks) => {
    setActive(id);
    setBuffer(id ? fmtMark(current[id] ?? null) : "");
    if (id) requestAnimationFrame(() => rows.current.get(id)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

  /** Keeps the typed value (if valid) and moves on to the next student in roll order. */
  const commit = (value: string, advance: boolean): boolean => {
    if (!active) return true;
    const c = checkBuffer(value, sheet.maxMarks);
    if (c.error) {
      setBuffer(value);
      return false;
    }
    setEdit(active, c.value);
    const current = { ...marks, [active]: c.value };
    if (advance) {
      const idx = students.findIndex((s) => s.id === active);
      const next = students[idx + 1] ?? students.find((s) => current[s.id] === null);
      activate(next && next.id !== active ? next.id : null, current);
    }
    return true;
  };

  const onKey = (k: PadKey) => {
    if (k === "A" || k === "L") commit(k, true);
    else if (k === "next") commit(buffer, true);
    else setBuffer((b) => typeKey(b, k));
  };

  // A physical keyboard works too: digits, point, Backspace, Enter (Next), A (Absent), L (Leave), Esc (Done).
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      let k: PadKey | "esc" | null = null;
      if (/^\d$/.test(e.key)) k = e.key as PadKey;
      else if (e.key === "." || e.key === ",") k = ".";
      else if (e.key === "Backspace") k = "back";
      else if (e.key === "Enter") k = "next";
      else if (e.key.toLowerCase() === "a") k = "A";
      else if (e.key.toLowerCase() === "l") k = "L";
      else if (e.key === "Escape") k = "esc";
      if (!k) return;
      e.preventDefault();
      if (k === "esc") {
        if (commit(buffer, false)) activate(null);
      } else onKey(k);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const submit = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setSending(true);
    setSubmitError(null);
    const res = await enqueue({ ctx, payload: { kind: "marks.submit", ref: paperRef, marks }, label: `Marks · ${sheet.subjectName} ${sheet.classSection} (submit)` });
    setSending(false);
    if (res.status === "rejected") {
      setSubmitError(errorText(res.error));
      return;
    }
    setConfirm(false);
    activate(null);
    void idbDel(draftKey);
    if (res.status === "sent") {
      setEdits({});
      queryClient.setQueryData(teacherQueries.paper(ctx, paperRef).queryKey, res.data as TeacherPaperSheet);
      void queryClient.invalidateQueries({ queryKey: teacherQueries.all(ctx) });
      toast({ title: "Marks submitted", message: `${sheet.subjectName} · ${sheet.classSection} went to the exam office. They're locked for you now.` });
    } else {
      toast({ tone: "warning", title: "Saved on this phone", message: "The marks are submitted to the exam office when the connection is back." });
    }
  };

  const demoFill = () => {
    const next: Record<string, ExamsMark> = { ...edits };
    let n = 0;
    for (const s of students) {
      if (marks[s.id] !== null) continue;
      next[s.id] = n === 2 ? "A" : Math.max(0, Math.min(sheet.maxMarks, Math.round(sheet.maxMarks * (0.48 + ((n * 37) % 47) / 100))));
      n++;
    }
    setEdits(next);
  };

  const saveLabel = queuedSubmit
    ? "Submitted on this phone · waiting to send"
    : queuedSave
      ? online
        ? "Saving…"
        : "Saved on this phone · will sync"
      : Object.keys(edits).length && !savedAt
        ? "Saved on this phone"
        : savedAt
          ? `Saved ${formatTime(new Date(savedAt))}`
          : sheet.updatedAt
            ? `Last saved ${formatDateTime(sheet.updatedAt)}`
            : "Nothing entered yet";

  const numeric = students.map((s) => marks[s.id]).filter((m): m is number => typeof m === "number");
  const absent = students.filter((s) => marks[s.id] === "A").length;
  const onLeave = students.filter((s) => marks[s.id] === "L").length;

  const bottom = locked ? undefined : activeStudent ? (
    <Keypad
      who={`${activeStudent.rollNo} · ${activeStudent.name}`}
      buffer={buffer}
      error={checked.error}
      max={sheet.maxMarks}
      progress={progress}
      onKey={onKey}
      onDone={() => {
        if (commit(buffer, false)) activate(null);
      }}
    />
  ) : (
    <div className="grid gap-2">
      {missing > 0 && (
        <p className="m-0 text-center text-small text-ink-muted">
          {missing} {missing === 1 ? "mark is" : "marks are"} missing. Submit opens when every student has a mark, Absent or Leave.
        </p>
      )}
      <div className="flex gap-2 [&>*]:flex-1">
        <Button size="touch" icon="download" onClick={() => void saveToServer(true)}>
          Save draft
        </Button>
        <Button
          size="touch"
          variant="primary"
          icon="send"
          disabled={missing > 0}
          onClick={() => {
            setSubmitError(null);
            setConfirm(true);
          }}
        >
          Submit
        </Button>
      </div>
    </div>
  );

  return (
    <Screen
      title={`${sheet.subjectName} · ${sheet.classSection}`}
      subtitle={sheet.examName}
      documentTitle={`Marks ${sheet.subjectName} ${sheet.classSection}`}
      backTo="/marks"
      bottom={bottom}
      actions={
        !locked && import.meta.env.VITE_USE_MOCKS !== "false" ? (
          <Menu trigger={<IconButton icon="more" label="More actions" size="touch" />} align="end" label="Marks actions">
            <MenuItem icon="bolt" onSelect={demoFill} disabled={missing === 0}>
              Fill the missing marks (demo)
            </MenuItem>
          </Menu>
        ) : undefined
      }
    >
      <div className="grid gap-3">
        <section className="mtb-card mtb-rise grid gap-2 p-4" aria-labelledby="paper-title">
          <div className="flex items-center justify-between gap-2">
            <span className="text-small text-ink-muted">{CATEGORY_LABEL[sheet.category]}</span>
            <PaperBadge p={sheet} />
          </div>
          <h2 id="paper-title" className="m-0 text-title-2 text-ink">
            {paperHeader(sheet)}
          </h2>
          <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={students.length} aria-valuenow={entered} aria-label="Marks entered">
            <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${students.length ? (entered / students.length) * 100 : 0}%` }} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-small">
            <span className="font-medium text-ink tabular-nums">{progress}</span>
            <span className="text-ink-muted" aria-live="polite">
              {saveLabel}
            </span>
          </div>
        </section>

        {sheet.note && !locked && (
          <Banner tone="warning" title="Returned by the exam office.">
            {sheet.note}
          </Banner>
        )}
        {locked && (
          <Banner tone={queuedSubmit ? "warning" : "neutral"} icon={queuedSubmit ? "cloudOff" : "lock"}>
            {queuedSubmit ? "Submitted on this phone. The marks are sent to the exam office when the connection is back; they're locked meanwhile." : sheet.lockedReason}
          </Banner>
        )}
        {!locked && restoredAt && (
          <Banner
            tone="info"
            title="Marks restored."
            actions={
              <Button
                size="sm"
                onClick={() => {
                  setEdits({});
                  setRestoredAt(null);
                  void idbDel(draftKey);
                }}
              >
                Discard
              </Button>
            }
          >
            You typed these at <bdi dir="ltr">{formatTime(new Date(restoredAt))}</bdi>; they were saved on this phone.
          </Banner>
        )}
        {!locked && !active && entered === 0 && <p className="m-0 px-1 text-small text-ink-muted">Tap a student to start. Type the mark on the pad and press Next; Absent is different from 0.</p>}

        <ol className="m-0 grid list-none gap-1.5 p-0" aria-label="Students">
          {students.map((s, i) => {
            const isActive = s.id === active;
            const m = marks[s.id] ?? null;
            const shown = isActive ? displayOf(buffer) : m === "A" ? "Absent" : m === "L" ? "Leave" : fmtMark(m);
            return (
              <li
                key={s.id}
                ref={(el) => {
                  if (el) rows.current.set(s.id, el);
                  else rows.current.delete(s.id);
                }}
                className={i < 14 ? "mtb-slide-in" : undefined}
                style={i < 14 ? ({ "--i": i } as CSSProperties) : undefined}
              >
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    if (isActive) return;
                    if (active && !commit(buffer, false)) return;
                    activate(s.id);
                  }}
                  aria-current={isActive ? "true" : undefined}
                  aria-label={`${s.rollNo}. ${s.name}: ${m === null ? "no mark yet" : m === "A" ? "absent" : m === "L" ? "on leave" : `${m} out of ${sheet.maxMarks}`}`}
                  className={cx(
                    "flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 py-2 text-start disabled:cursor-default",
                    isActive ? (checked.error ? "border-danger bg-danger-tint" : "border-brand bg-brand-tint") : "border-border bg-surface-raised enabled:hover:border-border-strong",
                  )}
                >
                  <span className="w-6 shrink-0 text-end text-small text-ink-muted tabular-nums">{s.rollNo}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{s.name}</span>
                  <span
                    className={cx(
                      "grid h-11 min-w-[4.5rem] place-items-center rounded-md border px-2 tabular-nums",
                      m === "A" && !isActive ? "border-transparent bg-status-absent-tint text-small font-semibold text-status-absent-ink" : "",
                      m === "L" && !isActive ? "border-transparent bg-status-leave-tint text-small font-semibold text-status-leave-ink" : "",
                      typeof m === "number" || isActive ? "border-border bg-surface text-title-2 text-ink" : "",
                      m === null && !isActive ? "border-dashed border-border-strong text-ink-subtle" : "",
                      isActive && checked.error && "border-danger text-danger-ink",
                    )}
                  >
                    {shown || "—"}
                    {isActive && <span className="ms-0.5 inline-block h-6 w-0.5 animate-pulse bg-brand align-middle" aria-hidden="true" />}
                  </span>
                </button>
                {isActive && checked.error && (
                  <p className="m-0 px-3 pt-1 text-small font-medium text-danger-ink" role="alert">
                    {checked.error}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        {activeStudent && <div aria-hidden="true" className="h-56" />}
      </div>

      <BottomSheet
        open={confirm}
        onClose={sending ? undefined : () => setConfirm(false)}
        title="Submit marks to the exam office?"
        description={paperHeader(sheet)}
        footer={
          <>
            <Button size="touch" onClick={() => setConfirm(false)} disabled={sending}>
              Back
            </Button>
            <Button size="touch" variant="primary" icon="send" loading={sending} loadingLabel="Submitting…" onClick={() => void submit()}>
              Submit marks
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {submitError && (
            <Banner tone="danger" title="Not submitted.">
              {submitError}
            </Banner>
          )}
          <dl className="m-0 grid grid-cols-2 gap-2">
            {[
              ["Entered", `${entered} of ${students.length}`],
              ["Absent · Leave", `${absent} · ${onLeave}`],
              ["Highest", numeric.length ? `${Math.max(...numeric)} / ${sheet.maxMarks}` : "—"],
              ["Average", numeric.length ? `${(numeric.reduce((a, b) => a + b, 0) / numeric.length).toFixed(1)} / ${sheet.maxMarks}` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="grid gap-0.5 rounded-md bg-surface-sunken px-3 py-2">
                <dt className="text-caption text-ink-muted">{k}</dt>
                <dd className="m-0 text-title-3 tabular-nums text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {!online && (
            <Banner tone="warning" icon="cloudOff">
              You're offline. The marks are kept on this phone and submitted when the connection is back.
            </Banner>
          )}
          <p className="m-0 text-small text-ink-muted">After you submit, the marks lock for you. If one needs correcting, the exam office can return the paper to you.</p>
        </div>
      </BottomSheet>
    </Screen>
  );
}
