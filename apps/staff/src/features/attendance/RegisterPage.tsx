import {
  ApiError,
  attendanceApi,
  attendanceQueries,
  newIdempotencyKey,
  REGISTER_CODE_LABEL,
  smsStatusQueries,
  type AttendanceRegister,
  type AttendanceRegisterStudent,
  type CampusCode,
  type RegisterCode,
} from "@mtb/api";
import { formatDate, formatDateTime, formatLongDate, formatSession, formatTime, type IsoDate } from "@mtb/domain";
import { Avatar, Banner, Button, buttonClassName, ConfirmDialog, DatePicker, EmptyState, Input, Panel, SegmentedBar, SidePanel, Skeleton, StatusBadge, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type CSSProperties } from "react";
import { z } from "zod";
import { RequireSingleCampus, useContextLine } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { AttendanceShell, CodeBadge, errorText, lastWeekday, MARK_ORDER, PrintSheet, QueryError, SESSION_START, TODAY, useCanMark, useSections, useSessionSpan } from "./shared";

const MARK_HINT: Record<RegisterCode, string> = { P: "Present", A: "Absent", L: "On leave", LT: "Late (counts as attended)" };

function MarkPicker({ value, onChange, name }: { value: RegisterCode; onChange: (c: RegisterCode) => void; name: string }) {
  return (
    <span className="att-marks" role="group" aria-label={`Mark for ${name}`}>
      {MARK_ORDER.map((c) => (
        <button key={c} type="button" className={`is-${c}`} aria-pressed={value === c} title={MARK_HINT[c]} onClick={() => onChange(c)}>
          {c}
        </button>
      ))}
    </span>
  );
}

const countsOf = (codes: Array<RegisterCode | null | undefined>) => ({
  P: codes.filter((c) => c === "P").length,
  A: codes.filter((c) => c === "A").length,
  L: codes.filter((c) => c === "L").length,
  LT: codes.filter((c) => c === "LT").length,
});

function CountsBar({ counts, total }: { counts: Record<RegisterCode, number>; total: number }) {
  return (
    <div className="grid gap-3">
      <SegmentedBar
        label="Register"
        height={12}
        segments={[
          { key: "P", label: "Present", value: counts.P, color: "var(--status-present)" },
          { key: "LT", label: "Late", value: counts.LT, color: "var(--status-late)" },
          { key: "L", label: "Leave", value: counts.L, color: "var(--status-leave)" },
          { key: "A", label: "Absent", value: counts.A, color: "var(--status-absent)" },
        ]}
      />
      <div className="att-counts">
        {MARK_ORDER.map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5 text-small text-ink-muted">
            <CodeBadge code={c} compact />
            {REGISTER_CODE_LABEL[c]} <b className="mtb-num text-ink">{counts[c]}</b>
          </span>
        ))}
        <span className="text-small text-ink-muted">
          of <b className="mtb-num text-ink">{total}</b> students
        </span>
      </div>
    </div>
  );
}

const correctionSchema = z
  .object({
    from: z.enum(["P", "A", "L", "LT"]),
    to: z.enum(["P", "A", "L", "LT"], { error: "Choose the correct mark." }),
    reason: z.string().trim().min(10, { error: "Write the reason in a few words (at least 10 letters), so the principal can decide." }),
  })
  .refine((v) => v.to !== v.from, { path: ["to"], error: "Choose a different mark from the one in the register." });

function RequestChange({ register, student, onClose }: { register: AttendanceRegister; student: AttendanceRegisterStudent | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [to, setTo] = useState<RegisterCode | null>(null);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"to" | "reason", string>>>({});
  const [key] = useState(newIdempotencyKey);
  const save = useMutation({
    mutationFn: () => attendanceApi.requestCorrection({ campus: register.campus, session: ctx.session, classSection: register.classSection, date: register.date, grNo: student!.grNo, to: to!, reason: reason.trim() }, key),
    onSuccess: (c) => {
      toast({ title: `Change requested for ${c.studentName}`, message: `${REGISTER_CODE_LABEL[c.from]} → ${REGISTER_CODE_LABEL[c.to]}. The principal approves it on the dashboard; the register keeps the old mark until then.` });
      void qc.invalidateQueries({ queryKey: ["attendance"] });
      void qc.invalidateQueries({ queryKey: ["approvals"] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.field === "to" || e.field === "reason")) setErrors({ [e.field]: e.message });
    },
  });
  const submit = () => {
    const parsed = correctionSchema.safeParse({ from: student?.code ?? "P", to: to ?? undefined, reason });
    if (!parsed.success) {
      const next: Partial<Record<"to" | "reason", string>> = {};
      for (const i of parsed.error.issues) next[i.path[0] as "to" | "reason"] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate();
  };
  return (
    <SidePanel
      open={student !== null}
      onClose={onClose}
      title="Request a change"
      description={student ? `${student.name} · ${register.classSection} · ${formatLongDate(register.date)}` : undefined}
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" icon="send" onClick={submit} loading={save.isPending} loadingLabel="Sending…">
            Send to principal
          </Button>
        </>
      }
    >
      {student && (
        <div className="grid gap-5">
          <div className="flex items-center gap-3">
            <span className="text-small text-ink-muted">In the register:</span>
            {student.code && <CodeBadge code={student.code} />}
          </div>
          <div className="grid gap-2">
            <span className="text-small font-medium text-ink">Correct mark</span>
            <span className="att-marks" role="radiogroup" aria-label="Correct mark">
              {MARK_ORDER.map((c) => (
                <button key={c} type="button" role="radio" className={`is-${c}`} aria-checked={to === c} aria-pressed={to === c} disabled={c === student.code} title={MARK_HINT[c]} onClick={() => setTo(c)}>
                  {c}
                </button>
              ))}
            </span>
            {to && <span className="text-small text-ink-muted">{MARK_HINT[to]}</span>}
            {errors.to && (
              <span className="text-small text-danger-ink" role="alert">
                {errors.to}
              </span>
            )}
          </div>
          <Textarea label="Reason" required rows={4} value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} help="For example: “Arrived at 08:20 AM with his father.” The principal sees this." />
          {save.isError && !(save.error instanceof ApiError && save.error.field) && (
            <Banner tone="danger" title="The request was not sent.">
              {errorText(save.error)}
            </Banner>
          )}
          <p className="m-0 text-small text-ink-muted">Submitted registers are locked. The principal approves or rejects the change on the dashboard, and the register shows "Change pending" until then.</p>
        </div>
      )}
    </SidePanel>
  );
}

export interface RegisterPageProps {
  classSection: string;
  date: IsoDate | undefined;
  onDate: (date: IsoDate | undefined) => void;
}

/** One class's register for a day: who was present, office marking for a teacher who is away, and change requests. */
export function RegisterPage({ classSection, date, onDate }: RegisterPageProps) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canMark = useCanMark();
  const canApprove = useCan("approvals.decide");
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const contextLine = useContextLine();
  const span = useSessionSpan();
  // An ended session opens on its last school week's register; the current one on today.
  const defaultDay = readOnly ? lastWeekday(span.last) : TODAY;
  const day = date ?? defaultDay;
  const single = ctx.campus !== "ALL";
  const q = useQuery({ ...attendanceQueries.register(ctx, classSection, day), enabled: single });
  const sections = useSections();
  const sms = useQuery(smsStatusQueries.status());
  const [draft, setDraft] = useState<Record<string, RegisterCode> | null>(null);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [changeFor, setChangeFor] = useState<AttendanceRegisterStudent | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);

  const reg = q.data;
  const marking = !!reg && !reg.closed && reg.status === "NOT_MARKED" && day === TODAY && canMark && !readOnly;
  const canRequest = canMark && !readOnly;
  const marks: Record<string, RegisterCode> = useMemo(() => draft ?? Object.fromEntries((reg?.students ?? []).map((s) => [s.grNo, "P" as RegisterCode])), [draft, reg]);
  const codes = reg ? reg.students.map((s) => (marking ? marks[s.grNo] : s.code)) : [];
  const counts = countsOf(codes);
  const absentees = reg ? reg.students.filter((s) => marks[s.grNo] === "A") : [];
  const paused = sms.data?.paused ?? false;

  const submit = useMutation({
    mutationFn: () => attendanceApi.saveRegister(classSection, { campus: ctx.campus as CampusCode, session: ctx.session, date: day, marks: reg!.students.map((s) => ({ grNo: s.grNo, code: marks[s.grNo] ?? "P" })) }, key),
    onSuccess: (r) => {
      setConfirm(false);
      setDraft(null);
      setKey(newIdempotencyKey());
      qc.setQueryData(attendanceQueries.register(ctx, classSection, day).queryKey, r.register);
      void qc.invalidateQueries({ queryKey: ["attendance"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: `${classSection} register submitted`,
        message: r.smsHeld ? "SMS are paused, so parents of absent students were not messaged. Send from Absentees once SMS resume." : r.smsQueued ? `${r.smsQueued} ${r.smsQueued === 1 ? "parent gets" : "parents get"} an SMS about today's absence.` : "Nobody is absent today.",
      });
    },
  });

  const list = sections.data ?? [];
  const at = list.findIndex((s) => s.classSection === classSection);
  const goto = (cs: string) => void navigate({ to: "/attendance/register/$classSection", params: { classSection: cs }, search: (p: Record<string, unknown>) => p } as never);
  const shown = (reg?.students ?? []).filter((s) => !search.trim() || `${s.name} ${s.grNo} ${s.rollNo}`.toLowerCase().includes(search.trim().toLowerCase()));

  const title = `${classSection} register`;
  // Moving between classes, days and printing are reading, so they stay available in an ended session.
  const actions = (
    <div className="flex flex-wrap items-end gap-2">
      <Button size="sm" variant="quiet" icon="chevronLeft" disabled={at <= 0} onClick={() => goto(list[at - 1]!.classSection)} aria-label="Previous class" />
      <Button size="sm" variant="quiet" icon="chevronRight" disabled={at < 0 || at >= list.length - 1} onClick={() => goto(list[at + 1]!.classSection)} aria-label="Next class" />
      <div className="w-44">
        <DatePicker aria-label="Day" value={day} today={TODAY} minDate={readOnly ? span.starts : SESSION_START} maxDate={span.last} onValueChange={(d) => onDate(d && d !== defaultDay ? d : undefined)} />
      </div>
      <Button size="sm" icon="printer" disabled={!reg || !!reg.closed || (reg.status === "NOT_MARKED" && !marking)} onClick={() => window.print()}>
        Print
      </Button>
    </div>
  );

  return (
    <AttendanceShell
      title={title}
      context={`${contextLine} · ${formatLongDate(day)}${reg ? ` · Class teacher ${reg.classTeacher}` : ""}`}
      actions={actions}
      meta={
        readOnly ? (
          <Link to="/attendance/monthly" search={{ cls: classSection, month: day.slice(0, 7) }} className="text-small font-medium text-brand-ink underline-offset-2 hover:underline">
            ← Monthly sheet for {classSection}
          </Link>
        ) : (
          <Link to="/attendance" search={(p: Record<string, unknown>) => ({ ...p, date: day === TODAY ? undefined : day })} className="text-small font-medium text-brand-ink underline-offset-2 hover:underline">
            ← All registers for {formatDate(day)}
          </Link>
        )
      }
    >
      <RequireSingleCampus action="a class register">
        {q.isError && <QueryError what={`The ${classSection} register`} error={q.error} onRetry={() => void q.refetch()} />}
        {q.isLoading && (
          <div className="grid gap-4">
            <Skeleton height={72} />
            <Skeleton height={420} />
          </div>
        )}
        {reg?.closed && (
          <div className="mtb-card">
            <EmptyState icon="calendar" title={`No attendance — ${reg.closed.name}`} description={`Registers are closed on ${formatLongDate(day)}. Choose another day.`} />
          </div>
        )}
        {reg && !reg.closed && (
          <>
            {readOnly ? (
              <Banner tone="neutral" icon="lock" title={`Session ${formatSession(ctx.session)} has ended: this register is read-only.`}>
                {reg.status === "NOT_MARKED" ? "This register was never submitted." : `Carried over from the old software (${reg.students.length} students). It can be read and printed; marks can no longer be changed.`}
              </Banner>
            ) : marking ? (
              <Banner tone="info" title={`${reg.classTeacher} hasn't marked this register yet.`}>
                You can mark it for them. Everyone starts as present: change only the students who are absent, on leave or late, then submit. The register locks once it is submitted.
              </Banner>
            ) : reg.status === "NOT_MARKED" ? (
              <Banner tone="warning" title="Not marked yet.">
                {day === TODAY ? `${reg.classTeacher} marks it in the teacher app. ${canMark ? "" : "Office staff can mark it for a teacher who is away."}` : "This register was never submitted."}
              </Banner>
            ) : (
              <Banner
                tone={reg.status === "CHANGE_PENDING" ? "warning" : "success"}
                icon={reg.status === "CHANGE_PENDING" ? "clock" : "lock"}
                title={reg.status === "CHANGE_PENDING" ? "Submitted, with a change waiting for the principal." : "Submitted and locked."}
                actions={
                  reg.status === "CHANGE_PENDING" && canApprove ? (
                    <Link to="/dashboard" hash="approvals" className={buttonClassName({ size: "sm" })}>
                      Review on dashboard
                    </Link>
                  ) : undefined
                }
              >
                {reg.submittedAt ? `${reg.source === "Office" ? "Marked by the office" : "Submitted in the teacher app"} by ${reg.submittedBy} at ${formatTime(reg.submittedAt)}. ` : ""}
                {canMark ? "To correct a mark, use “Request change” on the student." : "Changes are requested by the teacher or the office."}
              </Banner>
            )}

            <Panel id="att-register" rise={0} flush title={`${reg.students.length} students`} description={marking ? "Tap P, A, L or LT for each student. Late counts as attended." : undefined} actions={
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-56">
                  <Input aria-label="Search this register" icon="search" placeholder="Name, roll or G.R. no." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                {marking && (
                  <Button size="sm" variant="quiet" icon="checkSquare" onClick={() => setDraft(Object.fromEntries(reg.students.map((s) => [s.grNo, "P" as RegisterCode])))}>
                    All present
                  </Button>
                )}
              </div>
            }>
              <div className="px-4 pb-4 pt-1">
                <CountsBar counts={counts} total={reg.students.length} />
              </div>
              {shown.length === 0 ? (
                <EmptyState icon="search" title="No student matches" description="Check the spelling, or search by roll number." />
              ) : (
                <ol className="att-register" aria-label={`${classSection} students`}>
                  {shown.map((s, i) => {
                    const code = marking ? (marks[s.grNo] ?? "P") : s.code;
                    return (
                      <li key={s.grNo} className={`mtb-slide-in ${code === "A" ? "is-absent" : ""} ${s.pending ? "is-pending" : ""}`} style={{ "--i": Math.min(i, 18) } as CSSProperties}>
                        <span className="att-roll">{s.rollNo}</span>
                        <Avatar name={s.name} size="sm" />
                        <span className="att-name">
                          {s.hasProfile ? (
                            <Link to="/students/$grNo" params={{ grNo: s.grNo }}>
                              {s.name}
                            </Link>
                          ) : (
                            <b>{s.name}</b>
                          )}
                          <small className="mtb-num">G.R. {s.grNo}</small>
                        </span>
                        <span className="att-row-actions">
                          {marking ? (
                            <MarkPicker name={s.name} value={marks[s.grNo] ?? "P"} onChange={(c) => setDraft({ ...marks, [s.grNo]: c })} />
                          ) : (
                            <>
                              {s.pending && (
                                <StatusBadge status="pending" title={`${s.pending.requestedBy}: ${s.pending.reason}`}>
                                  Change pending → {REGISTER_CODE_LABEL[s.pending.to]}
                                </StatusBadge>
                              )}
                              {s.code ? <CodeBadge code={s.code} /> : <span className="text-small text-ink-muted">Not marked</span>}
                              {canRequest && s.code && !s.pending && (
                                <Button size="sm" variant="quiet" icon="edit" onClick={() => setChangeFor(s)} aria-label={`Request a change for ${s.name}`}>
                                  Request change
                                </Button>
                              )}
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Panel>

            {marking && (
              <div className="att-submitbar" role="region" aria-label="Submit the register">
                <span className="text-body-strong">
                  <span className="mtb-num">
                    {counts.P} P · {counts.A} A · {counts.L} L · {counts.LT} LT
                  </span>
                </span>
                <Button variant="primary" icon="check" onClick={() => setConfirm(true)}>
                  Submit register
                </Button>
              </div>
            )}

            {reg.history.length > 0 && (
              <Panel id="att-history" rise={1} title="History" description="Who submitted the register and every change requested since.">
                <ul className="att-list">
                  {reg.history.map((h) => (
                    <li key={h.id}>
                      <span className="att-when">
                        <b>{formatTime(h.at).slice(0, 5)}</b>
                        <span>{formatTime(h.at).slice(-2)}</span>
                      </span>
                      <span className="grid min-w-0">
                        <span className="font-medium text-ink">{h.action}</span>
                        <span className="text-small text-ink-muted">
                          {h.by} · {formatDateTime(h.at)}
                          {h.detail ? ` · ${h.detail}` : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <PrintSheet title={`Attendance register · ${classSection}`} scope={`${formatLongDate(day)} · Class teacher ${reg.classTeacher} · ${counts.P} present, ${counts.A} absent, ${counts.L} leave, ${counts.LT} late`}>
              <table>
                <thead>
                  <tr>
                    <th>Roll</th>
                    <th className="l">G.R. no.</th>
                    <th className="l">Student</th>
                    <th>Mark</th>
                  </tr>
                </thead>
                <tbody>
                  {reg.students.map((s) => (
                    <tr key={s.grNo}>
                      <td>{s.rollNo}</td>
                      <td className="l">{s.grNo}</td>
                      <td className="l">{s.name}</td>
                      <td>{(marking ? marks[s.grNo] : s.code) ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PrintSheet>

            <ConfirmDialog
              open={confirm}
              onClose={() => setConfirm(false)}
              onConfirm={() => submit.mutate()}
              title={`Submit the ${classSection} register?`}
              icon="listChecks"
              confirmLabel="Submit register"
              loading={submit.isPending}
              loadingLabel="Submitting…"
              message={`After submitting, the register is locked. Corrections go to the principal for approval.`}
              details={[
                ["Present", `${counts.P}`],
                ["Absent", `${counts.A}`],
                ["Leave", `${counts.L}`],
                ["Late", `${counts.LT}`],
              ]}
              warning={
                absentees.length === 0
                  ? undefined
                  : paused
                    ? `All SMS are paused. Parents of ${absentees.map((s) => s.name).join(", ")} won't get a message until an admin resumes SMS.`
                    : `${absentees.map((s) => s.name).join(", ")} ${absentees.length === 1 ? "is" : "are"} absent. Their parents get an SMS.`
              }
              error={submit.isError ? errorText(submit.error) : undefined}
            />
            <RequestChange register={reg} student={changeFor} onClose={() => setChangeFor(null)} />
          </>
        )}
      </RequireSingleCampus>
    </AttendanceShell>
  );
}
