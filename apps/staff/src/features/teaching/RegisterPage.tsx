import { newIdempotencyKey, photoUrl, teacherApi, teacherCountMarks, teacherCountsLine, teacherQueries, type RegisterCode, type TeacherRegister, type TeacherRegisterStudent } from "@mtb/api";
import { formatLongDate, formatTime, type IsoDate } from "@mtb/domain";
import { Avatar, Banner, Button, buttonClassName, EmptyState, Icon, Input, Modal, Panel, Segmented, Skeleton, StatusBadge, cx, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useCan, useCtx } from "../../app/session";
import { Page, PageHeader } from "../../app/shell/page";
import { ChangeRequestPanel } from "./ChangeRequestPanel";
import { errorText, MARK_LABEL, MarkChip, MarkControl, QueryState } from "./shared";

const BackLink = () => (
  <Link to="/teaching/registers" className={buttonClassName({ variant: "ghost" })}>
    <Icon name="arrowLeft" />
    All registers
  </Link>
);

/** /teaching/registers/7-B?date= — one class register: mark and submit today's, or ask for a change once it is locked. */
export function RegisterPage({ classSection, date }: { classSection: string; date?: IsoDate }) {
  const ctx = useCtx();
  const q = useQuery(teacherQueries.register(ctx, classSection, date));
  if (q.data) return <RegisterView key={`${q.data.classSection}|${q.data.date}`} reg={q.data} requestedDate={date} />;
  return (
    <Page>
      <PageHeader title={`${classSection} register`} actions={<BackLink />} />
      <QueryState query={q} what="The register" skeleton={<RegisterSkeleton />}>
        {() => null}
      </QueryState>
    </Page>
  );
}

function RegisterView({ reg, requestedDate }: { reg: TeacherRegister; requestedDate: IsoDate | undefined }) {
  // Student photos are served to those who can open student records; everyone else sees initials (no refused requests).
  const showPhotos = useCan("students.view");
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [edits, setEdits] = useState<Record<string, RegisterCode>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "away">("all");
  const [sheet, setSheet] = useState<"submit" | "change" | null>(null);
  const [changeFor, setChangeFor] = useState<string | null>(null);
  // One key for every attempt at this submit, so a retry after a lost reply can't record the register twice.
  const submitKey = useRef(newIdempotencyKey());

  const editable = reg.canMark;
  const closed = reg.closed;
  const submitted = !closed && reg.status !== "NOT_MARKED";

  const students = reg.students;
  const markOf = (s: TeacherRegisterStudent): RegisterCode => edits[s.grNo] ?? s.mark;
  const marks = useMemo(() => Object.fromEntries(students.map((s) => [s.grNo, edits[s.grNo] ?? s.mark])) as Record<string, RegisterCode>, [students, edits]);
  const counts = teacherCountMarks(Object.values(marks));
  const away = students.filter((s) => markOf(s) !== "P");
  const needle = search.trim().toLowerCase();
  const visible = students.filter((s) => (filter === "all" || markOf(s) !== "P") && (!needle || s.name.toLowerCase().includes(needle) || String(s.rollNo) === needle || s.grNo.toLowerCase().includes(needle)));

  const setMark = (grNo: string, code: RegisterCode) => {
    const original = students.find((s) => s.grNo === grNo)?.mark ?? "P";
    setEdits((e) => {
      const next = { ...e };
      if (code === original) delete next[grNo];
      else next[grNo] = code;
      return next;
    });
  };

  const submit = useMutation({
    mutationFn: () => teacherApi.submitRegister(ctx, reg.classSection, { date: reg.date, marks, takenAt: new Date().toISOString(), savedOffline: false }, submitKey.current),
    onSuccess: (data) => {
      submitKey.current = newIdempotencyKey();
      setEdits({});
      setSheet(null);
      setExpanded(null);
      queryClient.setQueryData(teacherQueries.register(ctx, reg.classSection, requestedDate).queryKey, data);
      void queryClient.invalidateQueries({ queryKey: teacherQueries.all(ctx) });
      toast({
        title: "Attendance submitted",
        message: `${reg.classSection} · ${teacherCountsLine(counts)}.${counts.absent ? ` Absence messages for ${counts.absent} ${counts.absent === 1 ? "student are" : "students are"} held until SMS starts.` : ""}`,
      });
    },
  });

  const title = `${reg.classSection} register`;
  const context = `${formatLongDate(reg.date)} · ${reg.enrolled} students · ${reg.campusName}`;

  if (closed) {
    return (
      <Page>
        <PageHeader title={title} context={context} actions={<BackLink />} />
        <div className="mtb-card mtb-rise">
          <EmptyState icon="calendar" title={`No attendance — ${closed.name}`} description="Registers are closed for the day. Nothing needs marking." />
        </div>
      </Page>
    );
  }

  const canRequestChange = Boolean(reg.lockedReason) && reg.status !== "NOT_MARKED";

  return (
    <Page>
      <PageHeader
        title={title}
        context={context}
        actions={
          <>
            <BackLink />
            {canRequestChange && (
              <Button
                icon="edit"
                onClick={() => {
                  setChangeFor(null);
                  setSheet("change");
                }}
              >
                Request change
              </Button>
            )}
          </>
        }
      />

      {submitted && reg.status === "CHANGE_PENDING" && (
        <Banner tone="warning" icon="clock" title="Change pending approval.">
          {reg.students
            .filter((s) => s.pending)
            .map((s) => `${s.name}: ${MARK_LABEL[s.mark]} → ${MARK_LABEL[s.pending!.to]}`)
            .join("; ")}
          . The principal decides; until then the register keeps the original mark.
        </Banner>
      )}
      {submitted && (
        <Banner tone="success" icon="lock" title={`Submitted${reg.submittedAt ? ` at ${formatTime(reg.submittedAt)}` : ""} · locked.`}>
          {reg.takenOffline ? "Taken offline and synced. " : ""}
          {reg.smsSent ? `Absence messages for ${reg.smsSent} ${reg.smsSent === 1 ? "student are" : "students are"} held until SMS starts. ` : ""}
          To correct a mark, choose the student or use Request change.
        </Banner>
      )}
      {!editable && reg.lockedReason && reg.status === "NOT_MARKED" && <Banner tone="neutral">{reg.lockedReason}</Banner>}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel
          id="register-students"
          title="Students"
          description={submitted ? teacherCountsLine(counts) : editable ? "Everyone starts as Present. Mark the students who are absent, on leave or late." : `${reg.enrolled} students`}
          flush
        >
          <div className="grid gap-2 border-b border-border px-5 pb-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input icon="search" type="search" placeholder="Search by name or roll number" aria-label="Search students" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Segmented
              aria-label="Show"
              value={filter}
              onChange={(v) => setFilter(v as "all" | "away")}
              options={[
                { value: "all", label: `Everyone · ${students.length}` },
                { value: "away", label: `Not present · ${away.length}` },
              ]}
            />
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={filter === "away" ? "checkCircle" : "search"}
              title={filter === "away" && !needle ? "Everyone is present" : "No student matches"}
              description={filter === "away" && !needle ? "Nobody is marked absent, on leave or late." : "Check the spelling, or search by roll number."}
            />
          ) : (
            <ul className="m-0 grid list-none p-0" aria-label={`${reg.classSection} students`}>
              {visible.map((s, i) => {
                const mark = markOf(s);
                const open = expanded === s.grNo;
                const pendingTo = s.pending?.to;
                const changed = edits[s.grNo] !== undefined;
                const canAsk = submitted && canRequestChange && !pendingTo;
                const line = pendingTo ? `Change pending: ${MARK_LABEL[mark]} → ${MARK_LABEL[pendingTo]}` : changed ? `Marked ${MARK_LABEL[mark].toLowerCase()}` : `Father: ${s.father || "—"}`;
                const who = (
                  <>
                    <span className="w-6 shrink-0 text-end text-small text-ink-muted tabular-nums">{s.rollNo || "—"}</span>
                    <Avatar {...(showPhotos ? { src: photoUrl.student(s.grNo) } : {})} name={s.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{s.name}</span>
                      <span className={cx("block truncate text-small", pendingTo ? "text-status-unpaid-ink" : "text-ink-muted")}>{line}</span>
                    </span>
                  </>
                );
                return (
                  <li key={s.grNo} className={cx("border-t border-border first:border-t-0", i < 14 && "mtb-slide-in", open && "bg-surface-hover")} style={i < 14 ? ({ "--i": i } as CSSProperties) : undefined}>
                    {editable ? (
                      <>
                        {/* Tablets and desktops: the four marks sit on the row. */}
                        <div className="hidden min-h-14 items-center gap-3 px-5 py-2 sm:flex">
                          {who}
                          <MarkControl compact name={s.name} value={mark} onChange={(c) => setMark(s.grNo, c)} />
                        </div>
                        {/* Phones: tap the student to open the marks. */}
                        <button
                          type="button"
                          className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start sm:hidden"
                          aria-expanded={open}
                          onClick={() => setExpanded(open ? null : s.grNo)}
                          aria-label={`${s.rollNo}. ${s.name}, ${MARK_LABEL[mark]}. Tap to change the mark.`}
                        >
                          {who}
                          <MarkChip code={mark} />
                          <Icon name="chevronDown" size={18} className={cx("shrink-0 text-ink-muted transition-transform", open && "rotate-180")} />
                        </button>
                        {open && (
                          <div className="px-4 pb-3 sm:hidden">
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
                      </>
                    ) : canAsk ? (
                      <button
                        type="button"
                        className="flex min-h-14 w-full items-center gap-3 px-5 py-2 text-start hover:bg-surface-hover"
                        onClick={() => {
                          setChangeFor(s.grNo);
                          setSheet("change");
                        }}
                        aria-label={`${s.rollNo}. ${s.name}, ${MARK_LABEL[mark]}. Request a change.`}
                      >
                        {who}
                        <MarkChip code={mark} />
                        <Icon name="edit" size={16} className="shrink-0 text-ink-muted" />
                      </button>
                    ) : (
                      <div className="flex min-h-14 items-center gap-3 px-5 py-2" aria-label={`${s.rollNo}. ${s.name}, ${MARK_LABEL[mark]}${pendingTo ? `, change to ${MARK_LABEL[pendingTo]} waiting for approval` : ""}`}>
                        {who}
                        <MarkChip code={mark} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="grid gap-4 xl:sticky xl:top-16">
          <Panel id="register-counts" title={editable ? "To submit" : "Counts"}>
            <dl className="m-0 grid grid-cols-4 gap-2">
              {(["P", "A", "L", "LT"] as const).map((c) => (
                <div key={c} className="grid justify-items-center gap-1 rounded-md bg-surface-sunken px-1 py-2">
                  <dt className="order-2 text-caption text-ink-muted">{MARK_LABEL[c]}</dt>
                  <dd className="order-1 m-0 text-title-2 tabular-nums text-ink">{c === "P" ? counts.present : c === "A" ? counts.absent : c === "L" ? counts.leave : counts.late}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          {reg.changes.length > 0 && (
            <Panel id="register-changes" title="Changes for this day" flush>
              <ul className="m-0 grid list-none p-0">
                {reg.changes.map((c) => (
                  <li key={c.id} className="grid gap-1 border-t border-border px-5 py-3 first:border-t-0">
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
            </Panel>
          )}
        </div>
      </div>

      {editable && (
        <div className="sticky bottom-0 z-20 -mx-3 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-raised px-4 py-3 shadow-md sm:-mx-4 lg:-mx-6 lg:px-6">
          <span className="text-body-strong tabular-nums text-ink">{teacherCountsLine(counts)}</span>
          <Button
            variant="primary"
            icon="send"
            onClick={() => {
              submit.reset();
              setSheet("submit");
            }}
            aria-label={`Submit the register: ${counts.present} present, ${counts.absent} absent, ${counts.leave} on leave, ${counts.late} late`}
          >
            Submit register
          </Button>
        </div>
      )}

      <SubmitDialog
        open={sheet === "submit"}
        onClose={() => !submit.isPending && setSheet(null)}
        reg={reg}
        marks={marks}
        sending={submit.isPending}
        error={submit.isError ? errorText(submit.error) : null}
        onSubmit={() => submit.mutate()}
      />
      <ChangeRequestPanel open={sheet === "change"} onClose={() => setSheet(null)} reg={reg} initialGrNo={changeFor} />
    </Page>
  );
}

function SubmitDialog({
  open,
  onClose,
  reg,
  marks,
  sending,
  error,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  reg: TeacherRegister;
  marks: Record<string, RegisterCode>;
  sending: boolean;
  error: string | null;
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
    <Modal
      open={open}
      {...(sending ? {} : { onClose })}
      title={`Submit ${reg.classSection} register?`}
      description={`${formatLongDate(reg.date)} · ${reg.enrolled} students`}
      footer={
        <>
          <Button onClick={onClose} disabled={sending}>
            Back
          </Button>
          <Button variant="primary" icon="send" loading={sending} loadingLabel="Submitting…" onClick={onSubmit}>
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
                  <li key={s.grNo} className="flex items-center gap-2 rounded-md px-2 py-1 text-ink">
                    <span className="w-6 text-end text-small text-ink-muted tabular-nums">{s.rollNo || "—"}</span>
                    {s.name}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <Banner tone={counts.absent ? "info" : "neutral"} icon="message">
          {counts.absent
            ? `An absence message for the parents of the ${counts.absent} absent ${counts.absent === 1 ? "student" : "students"} is written when you submit. It is held until SMS starts.`
            : "Nobody is absent, so no absence message is written."}
        </Banner>
        <p className="m-0 text-small text-ink-muted">After you submit, the register locks. To correct a mark later, request a change; the principal approves it.</p>
      </div>
    </Modal>
  );
}

function RegisterSkeleton() {
  return (
    <div className="grid gap-2" aria-busy="true" aria-label="Loading the register">
      <Skeleton height={44} className="rounded-md" />
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} height={56} className="rounded-lg" />
      ))}
    </div>
  );
}
