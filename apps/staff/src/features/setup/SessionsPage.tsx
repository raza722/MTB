import { newIdempotencyKey, setupApi, setupQueries, type CampusCode, type SetupSession, type SetupSessionStatus } from "@mtb/api";
import { daysBetween, formatCount, formatDate, formatDateTime, formatSession, type IsoDate } from "@mtb/domain";
import { Banner, Button, Checkbox, ConfirmDialog, DataTable, DatePicker, Modal, Panel, Skeleton, StatusBadge, useToast, type Status } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { useCan, useCtx } from "../../app/session";
import { apiFieldError, ConflictBanner, conflictOf, EditButton, err, errorText, QueryError, SetupPage, zodErrors, type Conflict, type FieldErrors } from "./shared";

const STATUS: Record<SetupSessionStatus, { badge: Status; label: string }> = {
  PLANNED: { badge: "info", label: "Planned" },
  CURRENT: { badge: "success", label: "Current" },
  ENDED: { badge: "warning", label: "Ended, not closed" },
  CLOSED: { badge: "neutral", label: "Closed and locked" },
};

function Lifecycle() {
  const steps: Array<[SetupSessionStatus, string]> = [
    ["PLANNED", "Created ahead of time. Sections and teachers can be prepared; no daily work yet."],
    ["CURRENT", "Everyone opens it by default. Attendance, fees and exams are recorded here."],
    ["ENDED", "Read-only for daily work. Approved corrections can still be made."],
    ["CLOSED", "Locked for good. Nothing can change; reports stay available."],
  ];
  return (
    <div className="setup-lifecycle" aria-label="How a session moves">
      {steps.map(([s, text], i) => (
        <div key={s}>
          <span className="flex items-center gap-2">
            <span className="text-caption tabular-nums text-ink-subtle">{i + 1}</span>
            <StatusBadge status={STATUS[s].badge}>{STATUS[s].label}</StatusBadge>
          </span>
          <span>{text}</span>
        </div>
      ))}
    </div>
  );
}

const newSessionSchema = z
  .object({ startsOn: z.string({ error: "Enter the first day." }).min(1, { error: "Enter the first day." }), endsOn: z.string({ error: "Enter the last day." }).min(1, { error: "Enter the last day." }) })
  .refine((v) => v.endsOn > v.startsOn, { path: ["endsOn"], error: "The last day must be after the first day." });

function NewSessionModal({ current, onClose }: { current: SetupSession; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const year = current.startYear + 1;
  const [startsOn, setStartsOn] = useState<IsoDate | null>(`${year}-04-01`);
  const [endsOn, setEndsOn] = useState<IsoDate | null>(`${year + 1}-03-31`);
  const [copySections, setCopySections] = useState(true);
  const [copyClassTeachers, setCopyClassTeachers] = useState(true);
  const [copySubjectTeachers, setCopySubjectTeachers] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [key] = useState(newIdempotencyKey);
  const sections = current.campuses.reduce((a, c) => a + c.sections, 0);
  const create = useMutation({
    mutationFn: () => setupApi.createSession({ startYear: year, startsOn: startsOn!, endsOn: endsOn!, copySections, copyClassTeachers: copySections && copyClassTeachers, copySubjectTeachers: copySections && copySubjectTeachers }, key),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      // The header's session switcher lists Setup's sessions: the new planned year appears there now.
      void qc.invalidateQueries({ queryKey: ["meta", "sessions"] });
      toast({ title: `${s.label} created`, message: copySections ? `${formatCount(s.campuses.reduce((a, c) => a + c.sections, 0))} sections ready. Choose it in the session switcher to prepare them.` : "Choose it in the session switcher to add sections before promotion." });
      onClose();
    },
    onError: (e) => {
      const f = apiFieldError(e);
      if (f) setErrors(f);
      else setFailure(errorText(e));
    },
  });
  const submit = () => {
    setFailure(null);
    const r = newSessionSchema.safeParse({ startsOn: startsOn ?? "", endsOn: endsOn ?? "" });
    if (!r.success) return setErrors(zodErrors(r.error));
    create.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Create session ${formatSession(year)}`}
      description="Prepare next year now. It stays planned until you make it current, usually on the first day of the new session."
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" icon="plus" onClick={submit} loading={create.isPending} loadingLabel="Creating…">
            Create {formatSession(year)}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        {failure && <Banner tone="danger" title="Not created.">{failure}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">
          <DatePicker label="First day" required value={startsOn} onValueChange={(v) => { setStartsOn(v); setErrors((e) => ({ ...e, startsOn: undefined })); }} today="2026-11-04" {...err(errors, "startsOn")} />
          <DatePicker label="Last day" required value={endsOn} onValueChange={(v) => { setEndsOn(v); setErrors((e) => ({ ...e, endsOn: undefined })); }} today="2026-11-04" {...err(errors, "endsOn")} />
        </div>
        <fieldset className="m-0 grid gap-3 rounded-md border border-border p-4">
          <legend className="px-1 text-small font-medium text-ink">Copy from {current.label}</legend>
          <Checkbox checked={copySections} onChange={(e) => setCopySections(e.target.checked)} label={`Sections, seats and rooms (${formatCount(sections)} sections at ${current.campuses.filter((c) => c.sections).length} campuses)`} />
          <Checkbox checked={copySections && copyClassTeachers} disabled={!copySections} onChange={(e) => setCopyClassTeachers(e.target.checked)} label="Class teachers" />
          <Checkbox checked={copySections && copySubjectTeachers} disabled={!copySections} onChange={(e) => setCopySubjectTeachers(e.target.checked)} label="Subject teachers" />
          <span className="text-small text-ink-muted">Subjects and marks for each class carry over by themselves. In the old software every section and teacher had to be entered again each year.</span>
        </fieldset>
      </div>
    </Modal>
  );
}

function CampusDatesModal({ session, campus, onClose }: { session: SetupSession; campus: CampusCode; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const row = session.campuses.find((c) => c.campus === campus)!;
  const [startsOn, setStartsOn] = useState<IsoDate | null>(row.startsOn);
  const [endsOn, setEndsOn] = useState<IsoDate | null>(row.endsOn);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => setupApi.updateCampusSession(session.startYear, campus, { startsOn: startsOn!, endsOn: endsOn!, rowVer: session.rowVer }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: `${row.campusName} dates saved`, message: `${session.label}: ${formatDate(startsOn!)} to ${formatDate(endsOn!)}.` });
      onClose();
    },
    onError: (e) => {
      const c = conflictOf(e);
      if (c) return setConflict(c);
      const f = apiFieldError(e);
      if (f) return setErrors(f);
      setFailure(errorText(e));
    },
  });
  const submit = () => {
    const r = newSessionSchema.safeParse({ startsOn: startsOn ?? "", endsOn: endsOn ?? "" });
    if (!r.success) return setErrors(zodErrors(r.error));
    save.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${row.campusName} · ${session.label}`}
      description={`The session runs ${formatDate(session.startsOn)} to ${formatDate(session.endsOn)}. A campus can start or end a little differently.`}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setStartsOn(session.startsOn);
              setEndsOn(session.endsOn);
            }}
          >
            Use the session's dates
          </Button>
          <Button variant="primary" onClick={submit} loading={save.isPending} disabled={Boolean(conflict)}>
            Save dates
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {conflict && <ConflictBanner conflict={conflict} onReload={() => void qc.invalidateQueries({ queryKey: ["setup"] }).then(onClose)} />}
        {failure && <Banner tone="danger" title="Not saved.">{failure}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">
          <DatePicker label="First day" required value={startsOn} onValueChange={setStartsOn} today="2026-11-04" {...err(errors, "startsOn")} />
          <DatePicker label="Last day" required value={endsOn} onValueChange={setEndsOn} today="2026-11-04" {...err(errors, "endsOn")} />
        </div>
      </div>
    </Modal>
  );
}

type Pending = { kind: "current" | "close"; session: SetupSession } | null;

export function SessionsPage() {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const canManage = useCan("setup.manage");
  const q = useQuery(setupQueries.sessions(ctx));
  const sessions = q.data ?? [];
  const current = sessions.find((s) => s.status === "CURRENT");
  const planned = sessions.find((s) => s.status === "PLANNED");
  const [creating, setCreating] = useState(false);
  const [dates, setDates] = useState<{ year: number; campus: CampusCode } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const datesSession = sessions.find((s) => s.startYear === dates?.year);

  const act = useMutation({
    mutationFn: (p: NonNullable<Pending>) => (p.kind === "current" ? setupApi.setCurrentSession(p.session.startYear, p.session.rowVer) : setupApi.closeSession(p.session.startYear, p.session.rowVer)),
    onSuccess: (s, p) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      void qc.invalidateQueries({ queryKey: ["meta", "sessions"] });
      toast(p.kind === "current" ? { title: `${s.label} is now the current session`, message: "Everyone opens it by default from their next page." } : { title: `${s.label} closed and locked`, message: "Its records can be read and printed, but no longer changed." });
      setPending(null);
    },
    onError: (e) => setActionError(conflictOf(e) ? "This session was changed by someone else. Close this and try again." : errorText(e)),
  });

  const day = current ? Math.max(1, daysBetween(current.startsOn, "2026-11-04") + 1) : 0;
  const days = current ? daysBetween(current.startsOn, current.endsOn) + 1 : 1;

  return (
    <SetupPage
      title="Academic sessions"
      actions={
        canManage &&
        current &&
        !planned && (
          <EditButton variant="primary" icon="plus" onClick={() => setCreating(true)}>
            Create {formatSession(current.startYear + 1)}
          </EditButton>
        )
      }
    >
      {q.isError && <QueryError what="The sessions" error={q.error} onRetry={() => void q.refetch()} />}
      <Panel id="session-life" title="How a session moves" description="Sessions are shared by every campus; each campus can have its own start and end dates." rise={0}>
        <Lifecycle />
      </Panel>

      {q.isLoading ? (
        <div className="mtb-card grid gap-3 p-5">
          <Skeleton width="30%" height={20} />
          <Skeleton height={140} />
        </div>
      ) : (
        current && (
          <Panel
            id="session-current"
            rise={1}
            title={
              <span className="flex items-center gap-2">
                {current.label}
                <StatusBadge status="success">Current</StatusBadge>
              </span>
            }
            description={`${formatDate(current.startsOn)} to ${formatDate(current.endsOn)} · created by ${current.createdBy}, ${formatDate(current.createdAt)}`}
            flush
          >
            <div className="grid gap-2 px-5 pb-4">
              <div className="flex items-baseline justify-between text-small">
                <span className="text-ink-muted">How far into the session</span>
                <span className="tabular-nums text-ink-muted">
                  Day {day} of {days}
                </span>
              </div>
              <div className="mtb-meter mtb-meter-lg setup-meter-grow" role="progressbar" aria-valuenow={Math.round((day / days) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Day ${day} of ${days}`}>
                <span style={{ width: `${(day / days) * 100}%` }} />
              </div>
            </div>
            <DataTable
              rows={current.campuses}
              rowKey="campus"
              density="dense"
              stickyHeader={false}
              caption={`Campus dates for ${current.label}`}
              columns={[
                { key: "campusName", header: "Campus" },
                {
                  key: "dates",
                  header: "Dates",
                  render: (c) => (
                    <span className="flex flex-wrap items-center gap-2">
                      {formatDate(c.startsOn)} to {formatDate(c.endsOn)}
                      {(c.startsOn !== current.startsOn || c.endsOn !== current.endsOn) && (
                        <StatusBadge status="info" dot={false}>
                          Own dates
                        </StatusBadge>
                      )}
                    </span>
                  ),
                },
                { key: "sections", header: "Sections", align: "right", render: (c) => formatCount(c.sections) },
                { key: "students", header: "Students", align: "right", render: (c) => formatCount(c.students) },
                {
                  key: "act",
                  header: <span className="mtb-sr-only">Actions</span>,
                  align: "right",
                  render: (c) =>
                    canManage && (
                      <EditButton size="sm" variant="quiet" icon="calendar" onClick={() => setDates({ year: current.startYear, campus: c.campus })} aria-label={`Change ${c.campusName} dates`}>
                        Change dates
                      </EditButton>
                    ),
                },
              ]}
              footer={{ campusName: <span className="font-medium">All campuses</span>, sections: formatCount(current.campuses.reduce((a, c) => a + c.sections, 0)), students: formatCount(current.campuses.reduce((a, c) => a + c.students, 0)) }}
            />
          </Panel>
        )
      )}

      <Panel id="session-all" title="All sessions" description="Older sessions from the old software are kept read-only for reference." flush rise={2}>
        <DataTable
          rows={sessions}
          rowKey="startYear"
          loading={q.isLoading}
          caption="Academic sessions"
          columns={[
            { key: "label", header: "Session", render: (s) => <span className="font-medium tabular-nums">{s.label}</span> },
            { key: "status", header: "Status", render: (s) => <StatusBadge status={STATUS[s.status].badge}>{STATUS[s.status].label}</StatusBadge> },
            { key: "dates", header: "Dates", render: (s) => <span className="tabular-nums">{formatDate(s.startsOn)} to {formatDate(s.endsOn)}</span> },
            { key: "sections", header: "Sections", align: "right", render: (s) => formatCount(s.campuses.reduce((a, c) => a + c.sections, 0)) },
            { key: "students", header: "Students", align: "right", render: (s) => formatCount(s.campuses.reduce((a, c) => a + c.students, 0)) },
            {
              key: "who",
              header: "Created / closed",
              render: (s) => (
                <span className="grid text-small">
                  <span>{s.createdBy}</span>
                  {s.closedAt && <span className="text-ink-muted">Closed {formatDateTime(s.closedAt)} by {s.closedBy}</span>}
                </span>
              ),
            },
            {
              key: "act",
              header: <span className="mtb-sr-only">Actions</span>,
              align: "right",
              render: (s) =>
                canManage && (
                  <span className="inline-flex gap-2">
                    {s.status === "PLANNED" && (
                      <EditButton size="sm" onClick={() => { setActionError(null); setPending({ kind: "current", session: s }); }}>
                        Make current
                      </EditButton>
                    )}
                    {s.status === "ENDED" && (
                      <EditButton size="sm" variant="danger-quiet" icon="lock" onClick={() => { setActionError(null); setPending({ kind: "close", session: s }); }}>
                        Close and lock
                      </EditButton>
                    )}
                  </span>
                ),
            },
          ]}
        />
      </Panel>

      {creating && current && <NewSessionModal current={current} onClose={() => setCreating(false)} />}
      {datesSession && dates && <CampusDatesModal key={`${dates.year}:${dates.campus}:${datesSession.rowVer}`} session={datesSession} campus={dates.campus} onClose={() => setDates(null)} />}
      <ConfirmDialog
        open={pending?.kind === "current"}
        onClose={() => setPending(null)}
        onConfirm={() => pending && act.mutate(pending)}
        tone="warning"
        icon="calendar"
        title={pending ? `Make ${pending.session.label} the current session?` : ""}
        message="Every campus will open it by default. The session before it becomes read-only for daily work."
        details={pending && current ? [["Current now", current.label], ["Will be current", pending.session.label], ["Starts", formatDate(pending.session.startsOn)]] : []}
        {...(pending && pending.session.startsOn > "2026-11-04" ? { warning: `${pending.session.label} doesn't start until ${formatDate(pending.session.startsOn)}. Usually this is done on that day.` } : {})}
        {...(actionError ? { error: actionError } : {})}
        requireText="CURRENT"
        confirmLabel={pending ? `Make ${pending.session.label} current` : "Make current"}
        loading={act.isPending}
        loadingLabel="Changing…"
      />
      <ConfirmDialog
        open={pending?.kind === "close"}
        onClose={() => setPending(null)}
        onConfirm={() => pending && act.mutate(pending)}
        tone="danger"
        icon="lock"
        title={pending ? `Close and lock ${pending.session.label}?` : ""}
        message="Nobody will be able to change its attendance, marks, results, fees or classes again, at any campus. Reports and printouts stay available."
        details={pending ? [["Sections", formatCount(pending.session.campuses.reduce((a, c) => a + c.sections, 0))], ["Students", formatCount(pending.session.campuses.reduce((a, c) => a + c.students, 0))]] : []}
        warning="This can't be undone. Finish any late corrections first."
        {...(actionError ? { error: actionError } : {})}
        requireText="CLOSE"
        confirmLabel="Close and lock"
        loading={act.isPending}
        loadingLabel="Closing…"
      />
    </SetupPage>
  );
}
