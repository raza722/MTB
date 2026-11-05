import { ApiError, newIdempotencyKey, smsParts, smsStatusQueries, timetableApi, timetableQueries, type CampusCode, type TeacherDayText } from "@mtb/api";
import { formatCount, formatDateTime, formatLongDate, formatMobile, formatTime, type IsoDate } from "@mtb/domain";
import { Banner, Button, DataTable, DatePicker, EmptyState, Modal, Skeleton, StatusBadge, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useCtx } from "../../app/session";
import { errorText, QueryError, TODAY } from "./shared";

/** The current session's last day: teachers can be texted for any school day up to it. */
const SESSION_LAST_DAY: IsoDate = "2027-03-31";

const sendable = (r: TeacherDayText) => !r.away && r.lessons.length > 0 && (r.sms.status === "NOT_SENT" || r.sms.status === "CHANGED");

function StatusCell({ r }: { r: TeacherDayText }) {
  if (r.away) return <StatusBadge status="neutral">Away · {r.away}</StatusBadge>;
  if (r.lessons.length === 0) return <span className="text-small text-ink-muted">Free all day</span>;
  switch (r.sms.status) {
    case "QUEUED":
      return <StatusBadge status="queued" />;
    case "SENT":
      return (
        <span className="grid justify-items-start gap-0.5">
          <StatusBadge status="sent" />
          <span className="mtb-cell-secondary">
            {r.sms.by}
            {r.sms.at ? ` · ${formatTime(r.sms.at)}` : ""}
          </span>
        </span>
      );
    case "CHANGED":
      return (
        <span className="grid justify-items-start gap-0.5" title={r.sms.at ? `Last sent ${formatDateTime(r.sms.at)}` : undefined}>
          <StatusBadge status="warning">Day changed</StatusBadge>
          <span className="mtb-cell-secondary">Send the new periods</span>
        </span>
      );
    default:
      return <span className="text-small text-ink-muted">Not sent</span>;
  }
}

export interface TeacherTextsDialogProps {
  /** The day to start on (it can be changed in the dialog). */
  date: IsoDate;
  /** Teachers to tick first, e.g. the substitutes on the cover page. Omitted: every teacher not yet texted. */
  preselect?: string[];
  onClose: () => void;
}

/**
 * "Text teachers their day" (the old SMS Staff Lectures screen, which never worked): each teacher gets their own
 * periods for a day, with any cover. Respects the SMS pause, previews the exact message, and shows who was texted.
 */
export function TeacherTextsDialog({ date: initialDate, preselect, onClose }: TeacherTextsDialogProps) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [date, setDate] = useState<IsoDate>(initialDate < TODAY ? TODAY : initialDate);
  const [selected, setSelected] = useState<Set<unknown>>(new Set());
  const [initFor, setInitFor] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const q = useQuery({
    ...timetableQueries.teacherTexts(ctx, date),
    enabled: ctx.campus !== "ALL",
    refetchInterval: (query) => (query.state.data?.rows.some((r) => r.sms.status === "QUEUED") ? 2000 : false),
  });
  const sms = useQuery(smsStatusQueries.status());
  const paused = sms.data?.paused ?? false;
  const data = q.data;

  // Tick the first time a day loads: the given teachers when they can be texted, else everyone not texted yet.
  if (data && data.date === date && initFor !== date) {
    const open = data.rows.filter(sendable);
    const wanted = preselect?.length ? open.filter((r) => preselect.includes(r.teacherId)) : [];
    setInitFor(date);
    setSelected(new Set((wanted.length ? wanted : open).map((r) => r.teacherId)));
  }

  const send = useMutation({
    mutationFn: (teacherIds: string[]) => timetableApi.smsTeachers({ campus: ctx.campus as CampusCode, session: ctx.session, date, teacherIds }, key),
    onSuccess: (r) => {
      setKey(newIdempotencyKey());
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: timetableQueries.teacherTexts(ctx, date).queryKey });
      toast({
        title: `${r.queued} ${r.queued === 1 ? "teacher" : "teachers"} texted`,
        message: `Each gets their periods for ${formatLongDate(date)}.${r.skipped ? ` ${r.skipped} skipped: away, free all day, or already texted.` : " Delivery shows in the list within a few seconds."}`,
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "SMS_PAUSED") void qc.invalidateQueries({ queryKey: ["sms", "status"] });
    },
  });

  const rows = data?.rows ?? [];
  const picked = rows.filter((r) => selected.has(r.teacherId) && sendable(r));
  const preview = picked[0] ?? rows.find(sendable) ?? rows.find((r) => r.lessons.length > 0);
  const texted = rows.filter((r) => r.sms.status === "SENT" || r.sms.status === "QUEUED").length;
  const teaching = rows.filter((r) => !r.away && r.lessons.length > 0).length;
  const parts = picked.reduce((a, r) => a + smsParts(r.message), 0);

  const columns: Array<Column<TeacherDayText>> = [
    {
      key: "name",
      header: "Teacher",
      render: (r) => (
        <span className="grid">
          <span className="mtb-cell-primary">{r.name}</span>
          <span className="mtb-cell-secondary mtb-num">{formatMobile(r.mobile)}</span>
        </span>
      ),
    },
    {
      key: "lessons",
      header: "Periods",
      width: 150,
      render: (r) => {
        const cover = r.lessons.filter((l) => l.cover).length;
        return r.lessons.length === 0 ? (
          <span className="text-ink-muted">—</span>
        ) : (
          <span className="grid">
            <span className="mtb-num">{r.lessons.length}</span>
            {cover > 0 && <span className="mtb-cell-secondary">incl. {cover} cover</span>}
          </span>
        );
      },
    },
    { key: "sms", header: "SMS", width: 170, render: (r) => <StatusCell r={r} /> },
  ];

  return (
    <Modal
      open
      size="lg"
      onClose={() => !send.isPending && onClose()}
      title="Text teachers their day"
      description="Each teacher gets an SMS with their own periods for the day, including any class they cover. The same day shows in their teacher app."
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={send.isPending}>
            Close
          </Button>
          <Button variant="primary" icon="send" disabled={paused || picked.length === 0 || !!data?.closed} loading={send.isPending} loadingLabel="Sending…" onClick={() => send.mutate(picked.map((r) => r.teacherId))}>
            {picked.length ? `Send ${picked.length} SMS` : "Send SMS"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-48">
            <DatePicker label="Day" value={date} today={TODAY} minDate={TODAY} maxDate={SESSION_LAST_DAY} onValueChange={(d) => d && d !== date && setDate(d)} />
          </div>
          {data && !data.closed && (
            <span className="text-small text-ink-muted">
              <b className="mtb-num text-ink">{formatCount(texted)}</b> of <b className="mtb-num text-ink">{formatCount(teaching)}</b> teaching teachers texted for this day
            </span>
          )}
        </div>

        {paused && (
          <Banner tone="warning" icon="pause" title="All SMS are paused.">
            {sms.data?.pausedBy ? `${sms.data.pausedBy} paused SMS${sms.data.pausedAt ? ` at ${formatDateTime(sms.data.pausedAt)}` : ""}. ` : ""}
            Teachers can't be texted until an admin resumes SMS. Their periods still show in the teacher app.
          </Banner>
        )}
        {q.isError && <QueryError what="Teachers' periods" error={q.error} onRetry={() => void q.refetch()} />}

        {!data && !q.isError ? (
          <Skeleton height={320} />
        ) : data?.closed ? (
          <EmptyState icon="calendar" title={`No school on ${formatLongDate(data.date)} — ${data.closed.name}`} description="There are no periods to send. Choose another day." />
        ) : data ? (
          <>
            <DataTable
              caption={`Teachers' periods on ${formatLongDate(data.date)}`}
              density="dense"
              columns={columns}
              rows={rows}
              rowKey="teacherId"
              maxHeight={300}
              selectable={!paused}
              selected={selected}
              onSelectedChange={setSelected}
              isRowSelectable={sendable}
              empty={<EmptyState icon="user" title="No teachers on this campus's timetable" />}
            />
            {preview && preview.message && (
              <div className="grid gap-1">
                <span className="text-small text-ink-muted">
                  Preview for {preview.name} ({formatMobile(preview.mobile)}) · {preview.message.length} letters, {smsParts(preview.message)} SMS {smsParts(preview.message) === 1 ? "part" : "parts"}:
                </span>
                <p className="tt-sms">{preview.message}</p>
              </div>
            )}
            {picked.length > 0 && (
              <p className="m-0 text-small text-ink-muted">
                {picked.length} {picked.length === 1 ? "teacher" : "teachers"} ticked · {parts} SMS {parts === 1 ? "part" : "parts"} in all. Teachers who are away or free all day are not texted.
              </p>
            )}
          </>
        ) : null}

        {send.isError && (
          <Banner tone="danger" title="Nothing was sent.">
            {errorText(send.error)}
          </Banner>
        )}
      </div>
    </Modal>
  );
}
