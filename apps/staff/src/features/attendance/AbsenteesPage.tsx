import { attendanceApi, attendanceQueries, newIdempotencyKey, smsRender, type AttendanceAbsentee, type CampusCode, type RegisterCode } from "@mtb/api";
import { formatCount, formatLongDate, formatMobile, formatTime } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, DataTable, EmptyState, Input, Modal, Panel, Segmented, Select, StatCard, StatusBadge, Urdu, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties, type ReactNode } from "react";
import { campusLabel } from "../../app/shell/campus";
import { RequireSingleCampus } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { AttendanceShell, CodeBadge, errorText, PastSessionNote, PrintSheet, QueryError, teacherText, useToday } from "./shared";

function SmsCell({ a }: { a: AttendanceAbsentee }) {
  const s = a.sms;
  const when = s.at ? ` · ${formatTime(s.at)}` : "";
  switch (s.status) {
    case "SENT":
      return (
        <span className="grid justify-items-start gap-0.5">
          <StatusBadge status="sent" />
          <span className="mtb-cell-secondary">
            {s.by === "Automatic" ? "Automatic" : s.by}
            {when}
          </span>
        </span>
      );
    case "QUEUED":
      return <StatusBadge status="queued" />;
    case "FAILED":
      return (
        <span className="grid justify-items-start gap-0.5" title={s.error}>
          <StatusBadge status="failed" />
          <span className="mtb-cell-secondary">Phone off · retry</span>
        </span>
      );
    case "HELD":
      return (
        <span className="grid justify-items-start gap-0.5" title={s.error}>
          <StatusBadge status="pending">Held</StatusBadge>
          <span className="mtb-cell-secondary">
            {a.changePending ? "Change pending" : `${s.by === "Automatic" ? "Automatic" : (s.by ?? "Held")}${when}`}
          </span>
        </span>
      );
    default:
      return <span className="text-small text-ink-muted">{a.code !== "A" ? "No SMS for this mark" : a.mobile ? "Not written" : "No mobile on record"}</span>;
  }
}

/** Urdu text with the filled-in values (names, class, campus) kept left-to-right inside it. */
function urduWithValues(template: string, values: Record<string, string>): ReactNode[] {
  return template.split(/(\{[a-z_]+\})/g).map((part, i) => {
    const m = /^\{([a-z_]+)\}$/.exec(part);
    return m && values[m[1]!] !== undefined ? (
      <bdi key={i} dir="ltr">
        {values[m[1]!]}
      </bdi>
    ) : (
      part
    );
  });
}

/** Only Absent marks get the "Absent today" message, once, with a mobile on record and no change waiting. */
const sendable = (a: AttendanceAbsentee) => a.code === "A" && !!a.mobile && !a.changePending && a.sms.status === "NOT_SENT";
const messaged = (a: AttendanceAbsentee) => a.sms.status === "HELD" || a.sms.status === "SENT" || a.sms.status === "QUEUED";

/**
 * Today's absent, on-leave and late students with their parents, and the "Absent today" messages. SMS sending starts
 * with the Messages module: until then every message is written and held, never sent.
 */
export function AbsenteesPage() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canSms = useCan("sms.send");
  const toast = useToast();
  const qc = useQueryClient();
  const [cls, setCls] = useState("");
  const [code, setCode] = useState<"A" | "L" | "LT" | "ALL">("A");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<unknown>>(new Set());
  const [compose, setCompose] = useState(false);
  const [language, setLanguage] = useState<"en" | "ur">("en");
  const [key, setKey] = useState(newIdempotencyKey);
  const today = useToday();
  const q = useQuery({ ...attendanceQueries.absentees(ctx), enabled: !readOnly && ctx.campus !== "ALL" });

  const send = useMutation({
    mutationFn: (grNos: string[]) => attendanceApi.smsAbsentees({ campus: ctx.campus as CampusCode, session: ctx.session, date: q.data?.date ?? today, grNos, language }, key),
    onSuccess: (r) => {
      setCompose(false);
      setSelected(new Set());
      setKey(newIdempotencyKey());
      void qc.invalidateQueries({ queryKey: ["attendance"] });
      toast({
        title: `${r.queued} ${r.queued === 1 ? "message" : "messages"} held`,
        message: `${r.skipped ? `${r.skipped} skipped: not absent, already held today, a change pending, or no mobile. ` : ""}SMS sending starts with the Messages module.`,
      });
    },
  });

  if (readOnly) {
    return (
      <AttendanceShell title="Absent today">
        <PastSessionNote what="Today's absentees and the parent SMS" />
      </AttendanceShell>
    );
  }

  const data = q.data;
  const rows = (data?.rows ?? []).filter(
    (r) =>
      (code === "ALL" || r.code === code) &&
      (!cls || r.classSection === cls) &&
      (!search.trim() || `${r.name} ${r.grNo} ${r.guardian} ${r.mobile}`.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const day = data?.date ?? today;
  const absent = (data?.rows ?? []).filter((r) => r.code === "A");
  const sent = absent.filter(messaged).length;
  const streak = absent.filter((r) => r.daysInRow >= 3);
  const picked = rows.filter((r) => selected.has(r.grNo) && sendable(r));
  const first = picked[0];
  const template = data?.template[language] ?? "";
  const values = first ? { student_name: first.name, class: first.classSection, campus: campusLabel(ctx.campus).replace(" Campus", "") } : null;
  const preview = values ? smsRender(template, values) : "";
  const classes = [...new Set((data?.rows ?? []).map((r) => r.classSection))];

  const columns: Array<Column<AttendanceAbsentee>> = [
    {
      key: "name",
      header: "Student",
      render: (r) => (
        <span className="grid">
          <Link to="/students/$grNo" params={{ grNo: r.grNo }} className="mtb-cell-primary text-ink no-underline hover:underline">
            {r.name}
          </Link>
          <span className="mtb-cell-secondary mtb-num">{r.grNo}</span>
        </span>
      ),
    },
    {
      key: "classSection",
      header: "Class",
      width: 150,
      render: (r) => (
        <span className="grid">
          <Link to="/attendance/register/$classSection" params={{ classSection: r.classSection }} className="mtb-cell-primary text-brand-ink no-underline hover:underline">
            {r.classSection}
          </Link>
          <span className="mtb-cell-secondary">{teacherText(r.classTeacher)}</span>
        </span>
      ),
    },
    {
      key: "code",
      header: "Mark",
      width: 170,
      render: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          <CodeBadge code={r.code as RegisterCode} />
          {r.changePending && <StatusBadge status="pending">Change pending</StatusBadge>}
        </span>
      ),
    },
    {
      key: "daysInRow",
      header: "In a row",
      width: 110,
      render: (r) =>
        r.code !== "A" ? (
          <span className="text-ink-muted">—</span>
        ) : r.daysInRow >= 3 ? (
          <StatusBadge status="warning">{r.daysInRow} days</StatusBadge>
        ) : (
          <span className="mtb-num">{r.daysInRow === 1 ? "Today only" : `${r.daysInRow} days`}</span>
        ),
    },
    {
      key: "guardian",
      header: "Parent",
      render: (r) => (
        <span className="grid">
          <span>{r.guardian || "—"}</span>
          {r.mobile ? (
            <a href={`tel:${r.mobile}`} className="mtb-cell-secondary mtb-num text-ink-muted">
              {formatMobile(r.mobile)}
            </a>
          ) : (
            <span className="mtb-cell-secondary text-ink-muted">No mobile</span>
          )}
        </span>
      ),
    },
    { key: "sms", header: "Parent SMS", width: 170, render: (r) => <SmsCell a={r} /> },
  ];

  return (
    <AttendanceShell
      title="Absent today"
      meta={<span className="text-small text-ink-muted">{formatLongDate(day)} · from today's submitted registers</span>}
      actions={
        <Button icon="printer" disabled={!data || rows.length === 0} onClick={() => window.print()}>
          Print list
        </Button>
      }
    >
      <RequireSingleCampus action="the absentee list">
        {q.isError && <QueryError what="Today's absentees" error={q.error} onRetry={() => void q.refetch()} />}
        <Banner tone="info" icon="message" title="SMS sending starts with the Messages module.">
          “Absent today” messages are written for absent students' parents and held until then; none is sent yet.
        </Banner>
        {data?.closed && data.rows.length > 0 && (
          <Banner tone="info" icon="calendar" title={`${data.closed.name}: registers are closed on this day`}>
            These absences come from registers taken that day.
          </Banner>
        )}
        {data?.closed && data.rows.length === 0 ? (
          <div className="mtb-card">
            <EmptyState icon="calendar" title={`No school today — ${data.closed.name}`} description="Registers are closed, so nobody is marked absent." />
          </div>
        ) : (
          <>
            <div className="att-kpis">
              {!data ? (
                [0, 1, 2, 3].map((i) => <StatCard key={i} label="" loading />)
              ) : (
                <>
                  <div style={{ "--i": 0 } as CSSProperties}>
                    <StatCard label="Absent today" icon="alertCircle" tone="danger" value={<AnimatedNumber value={absent.length} format={formatCount} />} foot={`${(data.rows.length - absent.length).toString()} more on leave or late`} />
                  </div>
                  <div style={{ "--i": 1 } as CSSProperties}>
                    <StatCard
                      label="Messages held"
                      icon="message"
                      value={<AnimatedNumber value={sent} format={formatCount} />}
                      {...(absent.length ? { meter: (sent / absent.length) * 100, meterLabel: "Absent students with a message held" } : {})}
                      foot={absent.length ? `${absent.length - sent} absent without a message` : "Nobody absent"}
                    />
                  </div>
                  <div style={{ "--i": 2 } as CSSProperties}>
                    <StatCard label="Absent 3+ days running" icon="alert" tone="warning" value={<AnimatedNumber value={streak.length} format={formatCount} />} foot={streak.length ? streak.map((s) => s.name).join(", ") : "None today"} />
                  </div>
                  <div style={{ "--i": 3 } as CSSProperties}>
                    <StatCard label="Changes pending" icon="clock" tone="info" value={formatCount(data.rows.filter((r) => r.changePending).length)} foot="Their message waits for the principal" />
                  </div>
                </>
              )}
            </div>

            <Panel
              id="att-absentees"
              rise={1}
              flush
              title={`${rows.length} ${rows.length === 1 ? "student" : "students"}`}
              description="Tick absent students whose parents have no message yet, then write it; it is held until SMS sending starts. Late and leave marks get no message."
              actions={
                canSms ? (
                  <Button variant="primary" icon="send" disabled={picked.length === 0} onClick={() => setCompose(true)}>
                    Write parent SMS{picked.length ? ` (${picked.length})` : ""}
                  </Button>
                ) : undefined
              }
            >
              <div className="att-filters px-4 pb-3">
                <Segmented
                  aria-label="Mark"
                  value={code}
                  onChange={(v) => {
                    setCode(v as typeof code);
                    setSelected(new Set());
                  }}
                  options={[
                    { value: "A", label: `Absent (${absent.length})` },
                    { value: "L", label: "Leave" },
                    { value: "LT", label: "Late" },
                    { value: "ALL", label: "All" },
                  ]}
                />
                <div className="att-f">
                  <Select aria-label="Class" value={cls} onChange={(e) => setCls(e.target.value)} options={[{ value: "", label: "All classes" }, ...classes.map((c) => ({ value: c, label: c }))]} />
                </div>
                <div className="w-64">
                  <Input aria-label="Search" icon="search" placeholder="Student, parent or mobile" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
              <DataTable
                caption="Students not present today"
                columns={columns}
                rows={rows}
                rowKey="grNo"
                loading={q.isLoading}
                maxHeight={560}
                selectable={canSms}
                selected={selected}
                onSelectedChange={setSelected}
                isRowSelectable={sendable}
                rowClassName={(r) => (r.daysInRow >= 3 ? "att-warn" : undefined)}
                empty={<EmptyState icon="checkCircle" title="Nobody here" description={code === "A" ? "No student is marked absent in the registers submitted so far." : "No student matches these filters."} />}
              />
            </Panel>
          </>
        )}

        <Modal
          open={compose}
          onClose={() => !send.isPending && setCompose(false)}
          title={`Message ${picked.length} ${picked.length === 1 ? "parent" : "parents"}`}
          description="The school's “Absent today” message, filled in for each student. It is held until SMS sending starts with the Messages module."
          footer={
            <>
              <Button variant="quiet" onClick={() => setCompose(false)} disabled={send.isPending}>
                Cancel
              </Button>
              <Button variant="primary" icon="send" loading={send.isPending} loadingLabel="Saving…" onClick={() => send.mutate(picked.map((p) => p.grNo))}>
                Hold {picked.length} {picked.length === 1 ? "message" : "messages"}
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <Segmented aria-label="Language" value={language} onChange={(v) => setLanguage(v as "en" | "ur")} options={[{ value: "en", label: "English" }, { value: "ur", label: "اردو" }]} />
            {first && (
              <div className="grid gap-1">
                <span className="text-small text-ink-muted">
                  Preview for {first.guardian || "the parent"} ({formatMobile(first.mobile)}):
                </span>
                {language === "ur" ? (
                  <Urdu as="p" className="att-sms m-0">
                    {values ? urduWithValues(template, values) : null}
                  </Urdu>
                ) : (
                  <p className="att-sms m-0">{preview}</p>
                )}
              </div>
            )}
            <p className="m-0 text-small text-ink-muted">Attendance messages are sent even to parents who opted out of notices, because they are about their own child.</p>
            {send.isError && (
              <Banner tone="danger" title="No message was written.">
                {errorText(send.error)}
              </Banner>
            )}
          </div>
        </Modal>

        {data && (
          <PrintSheet title="Students absent today" scope={`${formatLongDate(day)} · ${rows.length} students`} signatures={["Prepared by", "Principal"]}>
            <table>
              <thead>
                <tr>
                  <th className="l">Class</th>
                  <th className="l">G.R. no.</th>
                  <th className="l">Student</th>
                  <th>Mark</th>
                  <th>In a row</th>
                  <th className="l">Parent</th>
                  <th className="l">Mobile</th>
                  <th className="l">SMS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.grNo}>
                    <td className="l">{r.classSection}</td>
                    <td className="l">{r.grNo}</td>
                    <td className="l">{r.name}</td>
                    <td>{r.code}</td>
                    <td>{r.code === "A" ? r.daysInRow : ""}</td>
                    <td className="l">{r.guardian}</td>
                    <td className="l">{r.mobile ? formatMobile(r.mobile) : ""}</td>
                    <td className="l">{r.sms.status === "SENT" ? "Sent" : r.sms.status === "NOT_SENT" ? "" : r.sms.status.toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PrintSheet>
        )}
      </RequireSingleCampus>
    </AttendanceShell>
  );
}
