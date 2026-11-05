import { teacherCountMarks, teacherCountsLine, teacherQueries, type RegisterCode, type TeacherRegister, type TeacherRegisterStudent } from "@mtb/api";
import { formatDate, formatLongDate, formatTime, type IsoDate } from "@mtb/domain";
import { Avatar, Banner, BottomSheet, Button, EmptyState, Icon, Input, Segmented, Skeleton, StatusBadge, cx, useToast } from "@mtb/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { idbDel, idbGet, idbSet } from "../../app/idb";
import { useCtx } from "../../app/session";
import { errorText, QueryState } from "../../app/shell/QueryState";
import { Screen } from "../../app/shell/Screen";
import { useOnline } from "../../app/sync/network";
import { enqueue, retrySync, useSync } from "../../app/sync/outbox";
import { nowIso } from "../../app/time";
import { ChangeSheet } from "./ChangeSheet";
import { MARK_LABEL, MarkChip, MarkControl, useQueuedFor } from "./marks";

interface Draft {
  edits: Record<string, RegisterCode>;
  at: number;
}

export function RegisterPage({ classSection, date }: { classSection: string; date?: IsoDate }) {
  const ctx = useCtx();
  const q = useQuery(teacherQueries.register(ctx, classSection, date));
  if (q.data) return <RegisterView key={`${q.data.classSection}|${q.data.date}`} reg={q.data} requestedDate={date} />;
  return (
    <Screen title={`${classSection} register`} documentTitle={`${classSection} register`} backTo="/registers">
      <QueryState query={q} skeleton={<RegisterSkeleton />}>
        {() => null}
      </QueryState>
    </Screen>
  );
}

function RegisterView({ reg, requestedDate }: { reg: TeacherRegister; requestedDate: IsoDate | undefined }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const online = useOnline();
  const sync = useSync();
  const queued = useQueuedFor(reg.classSection, reg.date);
  const draftKey = `draft:register:${reg.campus}|${reg.classSection}|${reg.date}`;

  const [edits, setEdits] = useState<Record<string, RegisterCode>>({});
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "away">("all");
  const [sheet, setSheet] = useState<"submit" | "change" | null>(null);
  const [changeFor, setChangeFor] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const loaded = useRef(false);

  const queuedMarks = queued.submit?.payload.body.marks;
  const editable = reg.canMark && !queued.submit;
  const closed = reg.closed;
  const submitted = !closed && (reg.status !== "NOT_MARKED" || Boolean(queued.submit));

  // Marks started earlier on this phone come back after a reload or a closed tab.
  useEffect(() => {
    if (!editable || loaded.current) return;
    loaded.current = true;
    void idbGet<Draft>(draftKey).then((d) => {
      if (d && Object.keys(d.edits).length) {
        setEdits(d.edits);
        setRestoredAt(d.at);
      }
    });
  }, [editable, draftKey]);

  useEffect(() => {
    if (!editable || !loaded.current) return;
    const t = setTimeout(() => {
      if (Object.keys(edits).length) void idbSet(draftKey, { edits, at: Date.now() } satisfies Draft);
      else void idbDel(draftKey);
    }, 250);
    return () => clearTimeout(t);
  }, [edits, editable, draftKey]);

  const students = reg.students;
  const markOf = (s: TeacherRegisterStudent): RegisterCode => queuedMarks?.[s.grNo] ?? edits[s.grNo] ?? s.mark;
  const marks = useMemo(() => Object.fromEntries(students.map((s) => [s.grNo, queuedMarks?.[s.grNo] ?? edits[s.grNo] ?? s.mark])) as Record<string, RegisterCode>, [students, queuedMarks, edits]);
  const counts = teacherCountMarks(Object.values(marks));
  const away = students.filter((s) => markOf(s) !== "P");
  const needle = search.trim().toLowerCase();
  const visible = students.filter((s) => (filter === "all" || markOf(s) !== "P") && (!needle || s.name.toLowerCase().includes(needle) || String(s.rollNo) === needle || s.grNo.toLowerCase().includes(needle)));
  const queuedChanges = new Map(queued.changes.map((c) => [c.payload.kind === "register.change" ? c.payload.body.grNo : "", c]));

  const setMark = (grNo: string, code: RegisterCode) => {
    const original = students.find((s) => s.grNo === grNo)?.mark ?? "P";
    setEdits((e) => {
      const next = { ...e };
      if (code === original) delete next[grNo];
      else next[grNo] = code;
      return next;
    });
  };

  const submit = async () => {
    setSending(true);
    setSubmitError(null);
    const res = await enqueue({
      ctx,
      payload: { kind: "register.submit", classSection: reg.classSection, body: { date: reg.date, marks, takenAt: nowIso(), savedOffline: !online } },
      label: `${reg.classSection} register · ${formatDate(reg.date)}`,
    });
    setSending(false);
    if (res.status === "rejected") {
      setSubmitError(errorText(res.error));
      return;
    }
    void idbDel(draftKey);
    setEdits({});
    setSheet(null);
    setExpanded(null);
    if (res.status === "sent") {
      queryClient.setQueryData(teacherQueries.register(ctx, reg.classSection, requestedDate).queryKey, res.data as TeacherRegister);
      void queryClient.invalidateQueries({ queryKey: teacherQueries.all(ctx) });
      toast({
        title: "Attendance submitted",
        message: `${reg.classSection} · ${teacherCountsLine(counts)}.${counts.absent ? ` Parents of ${counts.absent} absent ${counts.absent === 1 ? "student" : "students"} get an SMS.` : ""}`,
      });
    } else {
      toast({
        tone: "warning",
        title: "Saved on this phone",
        message: res.status === "queued" && res.reason === "failed" ? `The school server didn't answer. It will try again. ${res.message ?? ""}` : "You're offline. The register is sent as soon as the connection is back.",
      });
    }
  };

  const title = `${reg.classSection} register`;
  const subtitle = (
    <>
      <bdi dir="ltr">{formatLongDate(reg.date)}</bdi> · {reg.enrolled} students
    </>
  );

  if (closed) {
    return (
      <Screen title={title} subtitle={subtitle} documentTitle={title} backTo="/registers">
        <div className="mtb-card mtb-rise p-2">
          <EmptyState icon="calendar" title={`No attendance today — ${closed.name}`} description="Registers are closed for the day. Nothing needs marking." />
        </div>
      </Screen>
    );
  }

  const bottom = editable ? (
    <Button
      variant="primary"
      size="touch"
      block
      icon="send"
      onClick={() => {
        setSubmitError(null);
        setSheet("submit");
      }}
      aria-label={`Submit the register: ${counts.present} present, ${counts.absent} absent, ${counts.leave} on leave, ${counts.late} late`}
    >
      <span className="tabular-nums">Submit · {teacherCountsLine(counts)}</span>
    </Button>
  ) : queued.submit ? (
    <Button size="touch" block icon={online ? "refresh" : "cloudOff"} disabled={!online || sync.phase === "syncing"} onClick={() => void retrySync()}>
      {online ? (sync.phase === "syncing" ? "Sending…" : "Send now") : "Waiting for a connection"}
    </Button>
  ) : reg.lockedReason && reg.status !== "NOT_MARKED" ? (
    <Button
      size="touch"
      block
      icon="edit"
      onClick={() => {
        setChangeFor(null);
        setSheet("change");
      }}
    >
      Request change
    </Button>
  ) : undefined;

  return (
    <Screen title={title} subtitle={subtitle} documentTitle={title} backTo="/registers" bottom={bottom}>
      <div className="grid gap-3">
        {queued.submit && (
          <Banner tone="warning" icon="cloudOff" title="Saved on this phone.">
            Submitted at <bdi dir="ltr">{formatTime(new Date(queued.submit.createdAt))}</bdi>.{" "}
            {online ? (sync.phase === "failed" ? "The school server didn't take it yet; it will try again." : "Sending now…") : "It is sent automatically when you're back online. The register is locked meanwhile."}
          </Banner>
        )}
        {!queued.submit && submitted && (reg.status === "CHANGE_PENDING" || queued.changes.length > 0) && (
          <Banner tone="warning" icon="clock" title="Change pending approval.">
            {[
              ...reg.students.filter((s) => s.pending).map((s) => `${s.name}: ${MARK_LABEL[s.mark]} → ${MARK_LABEL[s.pending!.to]}`),
              ...queued.changes.flatMap((c) => (c.payload.kind === "register.change" ? [`${c.payload.studentName}: → ${MARK_LABEL[c.payload.body.to]} (saved on this phone)`] : [])),
            ].join("; ")}
            . The principal decides; until then the register keeps the original mark.
          </Banner>
        )}
        {!queued.submit && submitted && (
          <Banner tone="success" icon="lock" title={`Submitted${reg.submittedAt ? ` at ${formatTime(reg.submittedAt)}` : ""} · locked.`}>
            {reg.takenOffline ? "Taken offline and synced. " : ""}
            {reg.smsSent ? `Parents of ${reg.smsSent} absent ${reg.smsSent === 1 ? "student were" : "students were"} sent an SMS. ` : ""}
            To correct a mark, tap the student or use Request change.
          </Banner>
        )}
        {editable && restoredAt && (
          <Banner
            tone="info"
            title="Marks restored."
            actions={
              <Button
                size="sm"
                onClick={() => {
                  setEdits({});
                  setRestoredAt(null);
                }}
              >
                Start again
              </Button>
            }
          >
            You started this register at <bdi dir="ltr">{formatTime(new Date(restoredAt))}</bdi>; it was saved on this phone.
          </Banner>
        )}
        {!editable && !queued.submit && reg.lockedReason && reg.status === "NOT_MARKED" && <Banner tone="neutral">{reg.lockedReason}</Banner>}

        {submitted && (
          <p className="m-0 mtb-card px-4 py-3 text-title-3 tabular-nums text-ink" aria-label={`${counts.present} present, ${counts.absent} absent, ${counts.leave} on leave, ${counts.late} late`}>
            {teacherCountsLine(counts)}
          </p>
        )}

        <div className="grid gap-2">
          <Input icon="search" size="lg" type="search" placeholder="Search by name or roll number" aria-label="Search students" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Segmented
            touch
            className="w-full [&>button]:flex-1"
            aria-label="Show"
            value={filter}
            onChange={(v) => setFilter(v as "all" | "away")}
            options={[
              { value: "all", label: `Everyone · ${students.length}` },
              { value: "away", label: `Not present · ${away.length}` },
            ]}
          />
        </div>

        {editable && !search && filter === "all" && <p className="m-0 px-1 text-small text-ink-muted">Everyone starts as Present. Tap a student to mark them absent, on leave or late.</p>}

        {visible.length === 0 ? (
          <div className="mtb-card p-2">
            <EmptyState icon={filter === "away" ? "checkCircle" : "search"} title={filter === "away" && !needle ? "Everyone is present" : "No student matches"} description={filter === "away" && !needle ? "Nobody is marked absent, on leave or late." : "Check the spelling, or search by roll number."} />
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-1.5 p-0" aria-label={`${reg.classSection} students`}>
            {visible.map((s, i) => {
              const mark = markOf(s);
              const open = expanded === s.grNo;
              const qc = queuedChanges.get(s.grNo);
              const pendingTo = s.pending?.to ?? (qc && qc.payload.kind === "register.change" ? qc.payload.body.to : undefined);
              const changed = edits[s.grNo] !== undefined;
              return (
                <li key={s.grNo} className={cx("mtb-card overflow-hidden", i < 14 && "mtb-slide-in", open && "border-brand")} style={i < 14 ? ({ "--i": i } as CSSProperties) : undefined}>
                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start"
                    aria-expanded={editable ? open : undefined}
                    onClick={() => {
                      if (editable) setExpanded(open ? null : s.grNo);
                      else if (submitted && !queued.submit && !pendingTo) {
                        setChangeFor(s.grNo);
                        setSheet("change");
                      }
                    }}
                    aria-label={`${s.rollNo}. ${s.name}, ${MARK_LABEL[mark]}${pendingTo ? `, change to ${MARK_LABEL[pendingTo]} waiting for approval` : ""}. ${editable ? "Tap to change the mark." : submitted && !queued.submit && !pendingTo ? "Tap to request a change." : ""}`}
                  >
                    <span className="w-6 shrink-0 text-end text-small text-ink-muted tabular-nums">{s.rollNo}</span>
                    <Avatar name={s.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{s.name}</span>
                      <span className={cx("block truncate text-small", pendingTo ? "text-status-unpaid-ink" : "text-ink-muted")}>
                        {pendingTo ? `Change pending: ${MARK_LABEL[mark]} → ${MARK_LABEL[pendingTo]}${qc ? " (on this phone)" : ""}` : changed ? `Marked ${MARK_LABEL[mark].toLowerCase()}` : `Father: ${s.father}`}
                      </span>
                    </span>
                    <MarkChip code={mark} />
                    {editable && <Icon name="chevronDown" size={18} className={cx("shrink-0 text-ink-muted transition-transform", open && "rotate-180")} />}
                  </button>
                  {open && editable && (
                    <div className="px-3 pb-3">
                      <MarkControl
                        name={s.name}
                        value={mark}
                        autoFocus
                        onChange={(c) => {
                          setMark(s.grNo, c);
                          setExpanded(null);
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {reg.changes.length > 0 && (
          <section className="mt-2 grid gap-2" aria-labelledby="changes-title">
            <h2 id="changes-title" className="m-0 px-1 text-caption tracking-wide text-ink-muted uppercase">
              Changes for this day
            </h2>
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {reg.changes.map((c) => (
                <li key={c.id} className="mtb-card grid gap-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{c.studentName}</span>
                    <StatusBadge status={c.status === "PENDING" ? "pending" : c.status === "APPROVED" ? "approved" : "rejected"}>
                      {c.status === "PENDING" ? "Waiting for approval" : c.status === "APPROVED" ? "Approved" : "Rejected"}
                    </StatusBadge>
                  </div>
                  <p className="m-0 text-small text-ink">
                    {MARK_LABEL[c.from]} → {MARK_LABEL[c.to]} · {c.reason}
                  </p>
                  <p className="m-0 text-caption text-ink-muted">
                    Asked at <bdi dir="ltr">{formatTime(c.requestedAt)}</bdi>
                    {c.decidedBy && c.decidedAt && (
                      <>
                        {" "}
                        · {c.status === "APPROVED" ? "approved" : "rejected"} by {c.decidedBy} at <bdi dir="ltr">{formatTime(c.decidedAt)}</bdi>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <SubmitSheet open={sheet === "submit"} onClose={() => !sending && setSheet(null)} reg={reg} marks={marks} sending={sending} error={submitError} online={online} onSubmit={() => void submit()} />
      <ChangeSheet
        open={sheet === "change"}
        onClose={() => setSheet(null)}
        reg={reg}
        initialGrNo={changeFor}
        queuedGrNos={[...queuedChanges.keys()]}
      />
    </Screen>
  );
}

function SubmitSheet({
  open,
  onClose,
  reg,
  marks,
  sending,
  error,
  online,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  reg: TeacherRegister;
  marks: Record<string, RegisterCode>;
  sending: boolean;
  error: string | null;
  online: boolean;
  onSubmit: () => void;
}) {
  const counts = teacherCountMarks(Object.values(marks));
  const of = (code: RegisterCode) => reg.students.filter((s) => marks[s.grNo] === code);
  const groups: Array<{ code: RegisterCode; title: string }> = [
    { code: "A", title: "Absent" },
    { code: "L", title: "On leave" },
    { code: "LT", title: "Late" },
  ];
  return (
    <BottomSheet
      open={open}
      onClose={sending ? undefined : onClose}
      title={`Submit ${reg.classSection} register?`}
      description={
        <>
          <bdi dir="ltr">{formatLongDate(reg.date)}</bdi> · {reg.enrolled} students
        </>
      }
      footer={
        <>
          <Button size="touch" onClick={onClose} disabled={sending}>
            Back
          </Button>
          <Button size="touch" variant="primary" icon="send" loading={sending} loadingLabel="Submitting…" onClick={onSubmit}>
            Submit register
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {error && (
          <Banner tone="danger" title="Not submitted.">
            {error}
          </Banner>
        )}
        <dl className="m-0 grid grid-cols-4 gap-2">
          {(["P", "A", "L", "LT"] as const).map((c) => (
            <div key={c} className="grid justify-items-center gap-1 rounded-md bg-surface-sunken px-1 py-2">
              <dt className="order-2 text-caption text-ink-muted">{MARK_LABEL[c]}</dt>
              <dd className="order-1 m-0 text-title-1 tabular-nums text-ink">{c === "P" ? counts.present : c === "A" ? counts.absent : c === "L" ? counts.leave : counts.late}</dd>
            </div>
          ))}
        </dl>
        {groups.map((g) => {
          const list = of(g.code);
          if (!list.length) return null;
          return (
            <section key={g.code} className="grid gap-1.5" aria-label={`${g.title}: ${list.length}`}>
              <h3 className="m-0 flex items-center gap-2 text-title-3 text-ink">
                <MarkChip code={g.code} /> {g.title} · {list.length}
              </h3>
              <ul className="m-0 grid list-none gap-1 p-0">
                {list.map((s) => (
                  <li key={s.grNo} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-ink">
                    <span className="w-6 text-end text-small text-ink-muted tabular-nums">{s.rollNo}</span>
                    {s.name}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <Banner tone={counts.absent ? "info" : "neutral"} icon="message">
          {counts.absent
            ? `Parents of the ${counts.absent} absent ${counts.absent === 1 ? "student" : "students"} will get an SMS after you submit.`
            : "Nobody is absent, so no absence SMS will be sent."}
        </Banner>
        {!online && (
          <Banner tone="warning" icon="cloudOff">
            You're offline. The register will be saved on this phone and sent automatically when the connection is back.
          </Banner>
        )}
        <p className="m-0 text-small text-ink-muted">After you submit, the register locks. To correct a mark later, request a change; the principal approves it.</p>
      </div>
    </BottomSheet>
  );
}

function RegisterSkeleton() {
  return (
    <div className="grid gap-2" aria-busy="true" aria-label="Loading the register">
      <Skeleton height={44} className="rounded-md" />
      <Skeleton height={44} className="rounded-md" />
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} height={56} className="rounded-lg" />
      ))}
    </div>
  );
}
