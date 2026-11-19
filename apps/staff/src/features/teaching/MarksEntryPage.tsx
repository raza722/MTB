import { newIdempotencyKey, teacherApi, teacherQueries, type Ctx, type ExamsMark, type TeacherPaperRef, type TeacherPaperSheet } from "@mtb/api";
import { formatDateTime, formatTime } from "@mtb/domain";
import { Banner, Button, buttonClassName, Icon, Modal, Skeleton, cx, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useCtx, useReadOnly } from "../../app/session";
import { Page, PageHeader } from "../../app/shell/page";
import { checkBuffer, displayOf, Keypad, typeKey, type PadKey } from "./Keypad";
import { CATEGORY_LABEL, errorText, PaperBadge, paperHeader, QueryState } from "./shared";

const AUTOSAVE_MS = 2500;

const BackLink = ({ examId, cls }: { examId: string; cls: string }) => (
  <Link to="/teaching/marks" search={{ exam: examId, cls }} className={buttonClassName({ variant: "ghost" })}>
    <Icon name="arrowLeft" />
    All papers
  </Link>
);

/** /teaching/marks/<exam>/<class>/<subject> — one paper's marks, typed on the pad, saved as a draft, then submitted. */
export function MarksEntryPage(ref: TeacherPaperRef) {
  const ctx = useCtx();
  const q = useQuery(teacherQueries.paper(ctx, ref));
  if (q.data) return <Entry key={`${ref.examId}|${ref.classSection}|${ref.subjectId}`} sheet={q.data} paperRef={ref} />;
  return (
    <Page>
      <PageHeader title="Marks" context={ref.classSection} actions={<BackLink examId={ref.examId} cls={ref.classSection} />} />
      <QueryState
        query={q}
        what="The marks sheet"
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
    </Page>
  );
}

const fmtMark = (m: ExamsMark) => (m === null ? "" : String(m));

/** After a draft reaches the server, the paper lists and Today show the new progress. */
function refreshLists(queryClient: QueryClient, ctx: Ctx, ref: TeacherPaperRef) {
  const all = teacherQueries.all(ctx);
  void queryClient.invalidateQueries({ queryKey: [...all, "papers"] });
  void queryClient.invalidateQueries({ queryKey: [...all, "today"] });
  // The open sheet keeps what was typed; the next visit loads the saved marks.
  void queryClient.invalidateQueries({ queryKey: teacherQueries.paper(ctx, ref).queryKey, refetchType: "none" });
}

function Entry({ sheet, paperRef }: { sheet: TeacherPaperSheet; paperRef: TeacherPaperRef }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();

  const [edits, setEdits] = useState<Record<string, ExamsMark>>({});
  const [active, setActive] = useState<string | null>(null);
  const [buffer, setBuffer] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const rows = useRef(new Map<string, HTMLElement>());
  // One key for every attempt at this submit, so a retry after a lost reply can't submit twice.
  const submitKey = useRef(newIdempotencyKey());

  const locked = sheet.locked || readOnly;
  const students = sheet.students;
  const markOf = (id: string, server: ExamsMark): ExamsMark => (id in edits ? edits[id]! : server);
  const marks: Record<string, ExamsMark> = Object.fromEntries(students.map((s) => [s.id, markOf(s.id, s.mark)]));
  // The marks as last shown, for the autosave timer and for a save sent while leaving the page.
  const latest = useRef(marks);
  useEffect(() => {
    latest.current = marks;
  });
  const entered = students.filter((s) => marks[s.id] !== null).length;
  const missing = students.length - entered;
  const progress = `${entered} of ${students.length} entered`;
  const checked = checkBuffer(buffer, sheet.maxMarks);
  const activeStudent = students.find((s) => s.id === active);

  /** Saves the draft (the marks as they are now). Saves run one after another, never two at once. */
  const saveToServer = (explicit: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (locked) return;
    const snapshot = latest.current;
    chain.current = chain.current.then(async () => {
      setSaving(true);
      try {
        await teacherApi.saveMarks(ctx, paperRef, snapshot, newIdempotencyKey());
        setSavedAt(Date.now());
        refreshLists(queryClient, ctx, paperRef);
        if (explicit) toast({ title: "Draft saved", message: `${sheet.subjectName} · ${sheet.classSection} · ${progress}.` });
      } catch (e) {
        toast({ tone: "danger", title: "Draft not saved", message: errorText(e) });
      } finally {
        setSaving(false);
      }
    });
  };

  // Autosave: to the server a moment after the last change.
  useEffect(() => {
    if (locked || !Object.keys(edits).length) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => saveToServer(false), AUTOSAVE_MS);
    // saveToServer reads the latest marks when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits]);

  // Leaving the page with a save still waiting sends it straight away.
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      void teacherApi
        .saveMarks(ctx, paperRef, latest.current, newIdempotencyKey())
        .then(() => refreshLists(queryClient, ctx, paperRef))
        .catch((e: unknown) => toast({ tone: "danger", title: "Draft not saved", message: errorText(e) }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const setEdit = (id: string, value: ExamsMark) => {
    const server = students.find((s) => s.id === id)?.mark ?? null;
    setEdits((e) => {
      const next = { ...e };
      if (value === server) delete next[id];
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

  // The keyboard works too: digits, point, Backspace, Enter (Next), A (Absent), L (Leave), Esc (Done).
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

  const submit = useMutation({
    mutationFn: async () => {
      // A draft save still waiting is overtaken by the submit (it carries the same marks).
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      await chain.current;
      return teacherApi.submitMarks(ctx, paperRef, latest.current, submitKey.current);
    },
    onSuccess: (data) => {
      submitKey.current = newIdempotencyKey();
      setConfirm(false);
      activate(null);
      setEdits({});
      queryClient.setQueryData(teacherQueries.paper(ctx, paperRef).queryKey, data);
      void queryClient.invalidateQueries({ queryKey: teacherQueries.all(ctx) });
      toast({ title: "Marks submitted", message: `${sheet.subjectName} · ${sheet.classSection} went to the exam office. They're locked for you now.` });
    },
  });

  const saveLabel = saving
    ? "Saving…"
    : savedAt
      ? `Saved ${formatTime(new Date(savedAt))}`
      : Object.keys(edits).length
        ? "Not saved yet"
        : sheet.updatedAt
          ? `Last saved ${formatDateTime(sheet.updatedAt)}`
          : "Nothing entered yet";

  const numeric = students.map((s) => marks[s.id]).filter((m): m is number => typeof m === "number");
  const absent = students.filter((s) => marks[s.id] === "A").length;
  const onLeave = students.filter((s) => marks[s.id] === "L").length;

  const tools: ReactNode = locked ? null : activeStudent ? (
    <Keypad
      who={`${activeStudent.rollNo ? `${activeStudent.rollNo} · ` : ""}${activeStudent.name}`}
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
        <p className="m-0 text-small text-ink-muted">
          {missing} {missing === 1 ? "mark is" : "marks are"} missing. Submit opens when every student has a mark, Absent or Leave.
        </p>
      )}
      <div className="flex gap-2 [&>*]:flex-1">
        <Button icon="download" onClick={() => saveToServer(true)} loading={saving}>
          Save draft
        </Button>
        <Button
          variant="primary"
          icon="send"
          disabled={missing > 0}
          onClick={() => {
            submit.reset();
            setConfirm(true);
          }}
        >
          Submit
        </Button>
      </div>
    </div>
  );

  return (
    <Page>
      <PageHeader title={`${sheet.subjectName} · ${sheet.classSection}`} context={sheet.examName} actions={<BackLink examId={paperRef.examId} cls={paperRef.classSection} />} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-4 lg:sticky lg:top-16 lg:col-start-2 lg:row-start-1">
          <section className="mtb-card mtb-rise grid gap-2 p-5" aria-labelledby="paper-title">
            <div className="flex items-center justify-between gap-2">
              <span className="text-small text-ink-muted">{CATEGORY_LABEL[sheet.category]}</span>
              <PaperBadge p={sheet} />
            </div>
            <h2 id="paper-title" className="m-0 text-title-3 text-ink">
              {paperHeader(sheet)}
            </h2>
            <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={students.length} aria-valuenow={entered} aria-label="Marks entered">
              <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${students.length ? (entered / students.length) * 100 : 0}%` }} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-small">
              <span className="font-medium text-ink tabular-nums">{progress}</span>
              {!locked && (
                <span className="text-ink-muted" aria-live="polite">
                  {saveLabel}
                </span>
              )}
            </div>
          </section>
          {tools && <div className="mtb-card hidden p-4 lg:block">{tools}</div>}
        </div>

        <div className="grid gap-3 lg:col-start-1 lg:row-start-1">
          {sheet.note && !locked && (
            <Banner tone="warning" title="Returned by the exam office.">
              {sheet.note}
            </Banner>
          )}
          {locked && (
            <Banner tone="neutral" icon="lock">
              {sheet.lockedReason ?? "These marks can't be changed in this session."}
            </Banner>
          )}
          {!locked && !active && entered === 0 && <p className="m-0 px-1 text-small text-ink-muted">Choose a student to start. Type the mark and press Next; Absent is different from 0.</p>}

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
                      "flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-1.5 text-start disabled:cursor-default",
                      isActive ? (checked.error ? "border-danger bg-danger-tint" : "border-brand bg-brand-tint") : "border-border bg-surface-raised enabled:hover:border-border-strong",
                    )}
                  >
                    <span className="w-6 shrink-0 text-end text-small text-ink-muted tabular-nums">{s.rollNo || "—"}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{s.name}</span>
                    <span
                      className={cx(
                        "grid h-10 min-w-[4.5rem] place-items-center rounded-md border px-2 tabular-nums",
                        m === "A" && !isActive ? "border-transparent bg-status-absent-tint text-small font-semibold text-status-absent-ink" : "",
                        m === "L" && !isActive ? "border-transparent bg-status-leave-tint text-small font-semibold text-status-leave-ink" : "",
                        typeof m === "number" || isActive ? "border-border bg-surface text-title-3 text-ink" : "",
                        m === null && !isActive ? "border-dashed border-border-strong text-ink-subtle" : "",
                        isActive && checked.error && "border-danger text-danger-ink",
                      )}
                    >
                      {shown || "—"}
                      {isActive && <span className="ms-0.5 inline-block h-5 w-0.5 animate-pulse bg-brand align-middle" aria-hidden="true" />}
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
        </div>
      </div>

      {/* Phones and tablets: the pad (or Save draft · Submit) stays at the foot of the screen. */}
      {tools && <div className="sticky bottom-0 z-20 -mx-3 border-t border-border bg-surface-raised px-4 py-3 shadow-md sm:-mx-4 lg:hidden">{tools}</div>}

      <Modal
        open={confirm}
        {...(submit.isPending ? {} : { onClose: () => setConfirm(false) })}
        title="Submit marks to the exam office?"
        description={paperHeader(sheet)}
        footer={
          <>
            <Button onClick={() => setConfirm(false)} disabled={submit.isPending}>
              Back
            </Button>
            <Button variant="primary" icon="send" loading={submit.isPending} loadingLabel="Submitting…" onClick={() => submit.mutate()}>
              Submit marks
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {submit.isError && (
            <Banner tone="danger" title="Not submitted.">
              {errorText(submit.error)}
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
          <p className="m-0 text-small text-ink-muted">After you submit, the marks lock for you. If one needs correcting, the exam office can return the paper to you.</p>
        </div>
      </Modal>
    </Page>
  );
}
