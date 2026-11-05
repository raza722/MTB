import { HR_DAY_LABEL, hrApi, hrMonthLabel, hrQueries, hrSessionMonths, newIdempotencyKey, type CampusCode, type HrAttendanceMonth, type HrAttendanceRange, type HrDayRow, type HrDayStatus, type HrImportPreview, type HrImportResult, type HrMonthCode, type HrRangeCell } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatWeekday } from "@mtb/domain";
import {
  AnimatedNumber,
  Banner,
  Button,
  Checkbox,
  ColumnChart,
  Combobox,
  DataTable,
  DatePicker,
  EmptyState,
  Input,
  Modal,
  Panel,
  Segmented,
  Select,
  Skeleton,
  StatCard,
  StatusBadge,
  Stepper,
  useToast,
  type Column,
} from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { RequirePermission, RequireSingleCampus } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { ReportDoc } from "./print";
import { issues } from "./StaffPanels";
import { campusHeading, DesignationSelect, downloadCsv, errorField, errorText, filterNote, HrShell, LoadError, slide, staffOptions, THIS_MONTH, TODAY, useDesignationTitle, usePrint } from "./shared";

export type AttendanceView = "day" | "month" | "range" | "late" | "imports";
export interface AttendanceSearch {
  view?: AttendanceView;
  date?: string;
  month?: string;
  /** Date-range report: first and last day, and one staff member (the legacy time in/out report). */
  from?: string;
  to?: string;
  staff?: string;
}

const STATUS_BADGE: Record<HrDayStatus, "present" | "late" | "absent" | "leave" | "holiday" | "neutral"> = { PRESENT: "present", LATE: "late", ABSENT: "absent", LEAVE: "leave", HALF_DAY: "leave", HOLIDAY: "holiday", OFF: "neutral" };
const CODE_LABEL: Record<HrMonthCode, string> = { P: "Present", LT: "Late", A: "Absent", LV: "Leave", HD: "Half day", H: "Holiday", OFF: "Off" };
const CODE: Record<HrDayStatus, HrMonthCode> = { PRESENT: "P", LATE: "LT", ABSENT: "A", LEAVE: "LV", HALF_DAY: "HD", HOLIDAY: "H", OFF: "OFF" };
/** Longest range the date-range report covers (the server refuses more). */
const RANGE_MAX_DAYS = 93;

/** "Late 12 min", "Casual leave", "Day off": one person's day in words. */
function dayStatusText(r: Pick<HrDayRow, "status" | "lateMinutes" | "leaveType" | "source"> & { note?: string | null }): string {
  if (!r.status) return "Not marked";
  if (r.status === "LATE") return `Late ${r.lateMinutes} min`;
  if (r.status === "LEAVE") return r.leaveType ?? "On leave";
  if (r.status === "OFF") return r.source === "MANUAL" ? "Day off" : (r.note ?? "Not a working day");
  if (r.status === "HOLIDAY") return r.note ?? "Holiday";
  return HR_DAY_LABEL[r.status];
}

/** 395 minutes → "6:35". */
const hoursText = (min: number) => (min ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}` : "");

const isTime = (v: string) => v === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const draftSchema = z
  .object({
    status: z.string(),
    timeIn: z.string().refine(isTime, "Use hh:mm, like 07:40."),
    timeOut: z.string().refine(isTime, "Use hh:mm, like 14:10."),
    note: z.string(),
  })
  .refine((v) => v.status !== "OFF" || v.note.trim().length >= 3, { path: ["note"], message: "Say why it is a day off." })
  .refine((v) => !v.timeIn || !v.timeOut || v.timeOut > v.timeIn, { path: ["timeOut"], message: "Time out must be after time in." });

/** Staff attendance: the day's register (machine or by hand), the monthly sheet, late arrivals and machine imports. */
export function StaffAttendancePage({ search, setSearch }: { search: AttendanceSearch; setSearch: (s: AttendanceSearch) => void }) {
  const ctx = useCtx();
  const view = search.view ?? "day";
  const date = search.date ?? TODAY;
  const month = search.month ?? THIS_MONTH;
  const [importing, setImporting] = useState(false);
  const canManage = useCan("hr.manage");
  const readOnly = useReadOnly();
  const day = useQuery(hrQueries.attendanceDay(ctx, date));
  const device = day.data?.deviceName;
  return (
    <RequirePermission permission="hr.view" page="Staff attendance">
      <HrShell
        title="Staff attendance"
        actions={
          ctx.campus !== "ALL" &&
          canManage &&
          !readOnly &&
          device && (
            <Button variant="primary" icon="upload" onClick={() => setImporting(true)}>
              Import from fingerprint machine
            </Button>
          )
        }
      >
        <RequireSingleCampus action="staff attendance">
          <Segmented
            aria-label="Show"
            value={view}
            onChange={(v) => setSearch({ ...search, view: v as AttendanceView })}
            options={[
              { value: "day", label: "Daily register" },
              { value: "month", label: "Monthly sheet" },
              { value: "range", label: "Date range" },
              { value: "late", label: "Late arrivals" },
              { value: "imports", label: "Machine imports" },
            ]}
            className="justify-self-start"
          />
          {view === "day" && <DayView date={date} setDate={(d) => setSearch({ ...search, date: d })} onImport={() => setImporting(true)} />}
          {view === "month" && <MonthView month={month} setMonth={(m) => setSearch({ ...search, month: m })} />}
          {view === "range" && <RangeView from={search.from ?? `${THIS_MONTH}-01`} to={search.to ?? TODAY} staffId={search.staff ?? ""} set={(p) => setSearch({ ...search, ...p })} />}
          {view === "late" && <LateView month={month} setMonth={(m) => setSearch({ ...search, month: m })} />}
          {view === "imports" && <ImportsView />}
          {importing && ctx.campus !== "ALL" && <ImportModal campus={ctx.campus} deviceName={device ?? "Fingerprint machine"} onClose={() => setImporting(false)} onDone={(d) => setSearch({ view: "day", date: d })} />}
        </RequireSingleCampus>
      </HrShell>
    </RequirePermission>
  );
}

/* ---------------------------------------------------------------- Daily register */

interface Draft {
  status: HrDayStatus;
  timeIn: string;
  timeOut: string;
  note: string;
}

function DayView({ date, setDate, onImport }: { date: string; setDate: (d: string) => void; onImport: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = useCan("hr.manage");
  const readOnly = useReadOnly();
  const q = useQuery(hrQueries.attendanceDay(ctx, date));
  const { print, area } = usePrint();
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [filter, setFilter] = useState<"" | "NOT" | "LATE" | "ABSENT" | "LEAVE" | "OFF">("");
  const [des, setDes] = useState("");
  const desTitle = useDesignationTitle(des);
  const [query, setQuery] = useState("");
  useEffect(() => {
    setEditing(false);
    setDrafts({});
    setReason("");
    setTried(false);
  }, [date, ctx.campus]);
  const d = q.data;
  const save = useMutation({
    mutationFn: () => hrApi.saveAttendance({ campus: ctx.campus as CampusCode, date, reason, entries: Object.entries(drafts).map(([staffId, x]) => ({ staffId, status: x.status, timeIn: x.timeIn || null, timeOut: x.timeOut || null, note: x.note || null })) }),
    onSuccess: (r) => {
      toast({ title: "Attendance saved", message: `${Object.keys(drafts).length} change${Object.keys(drafts).length === 1 ? "" : "s"} for ${formatDate(date)} · ${r.summary.present + r.summary.late} present` });
      setEditing(false);
      setDrafts({});
      setReason("");
      setTried(false);
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
    },
  });
  const draftOf = (r: HrDayRow): Draft => drafts[r.staffId] ?? { status: r.status ?? "PRESENT", timeIn: r.timeIn ?? "", timeOut: r.timeOut ?? "", note: r.note ?? "" };
  const setDraft = (r: HrDayRow, p: Partial<Draft>) => setDrafts((x) => ({ ...x, [r.staffId]: { ...draftOf(r), ...p } }));
  const draftErrors = useMemo(() => Object.fromEntries(Object.entries(drafts).map(([id, x]) => [id, issues(draftSchema.safeParse(x))])), [drafts]);
  const draftsOk = Object.values(draftErrors).every((e) => Object.keys(e).length === 0);
  /** A field error next to one person's input, once Save has been pressed (the server's own errors show below the table). */
  const cellError = (r: HrDayRow, k: "timeIn" | "timeOut" | "note") => (tried ? draftErrors[r.staffId]?.[k] : undefined);
  // Sundays, holidays and a shared person's days at the other campus come from the calendar; a day off given to one
  // person (OFF by hand) stays on the register.
  const working = (d?.rows ?? []).filter((r) => r.source !== "CALENDAR");
  const rows = working.filter((r) => {
    if (query && !`${r.name} ${r.employeeNo}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (des && r.designationId !== des) return false;
    if (filter === "NOT") return r.status === null;
    if (filter) return r.status === filter;
    return true;
  });
  const shown = {
    present: rows.filter((r) => r.status === "PRESENT" || r.status === "HALF_DAY").length,
    late: rows.filter((r) => r.status === "LATE").length,
    absent: rows.filter((r) => r.status === "ABSENT").length,
    leave: rows.filter((r) => r.status === "LEAVE").length,
    off: rows.filter((r) => r.status === "OFF").length,
    notMarked: rows.filter((r) => r.status === null).length,
  };
  const filterText = filterNote([desTitle, filter && { NOT: "Not marked yet", LATE: "Late", ABSENT: "Absent", LEAVE: "On leave", OFF: "Day off" }[filter], query && `matching “${query}”`]);
  const printRegister = () =>
    print(
      <ReportDoc
        campus={campusHeading(ctx.campus as CampusCode)}
        title={`Staff attendance · ${formatDate(date)}`}
        sub={filterNote([formatWeekday(date), `${shown.present} present`, `${shown.late} late`, `${shown.absent} absent`, `${shown.leave} on leave`, shown.off ? `${shown.off} day off` : "", `${shown.notMarked} not marked`, filterText])}
        head={["#", "Emp. no", "Name", "Designation", "Status", "Time in", "Time out", "Note"]}
        rows={rows.map((r, i) => [i + 1, r.employeeNo, r.name, r.designation, dayStatusText(r), r.timeIn ?? "", r.timeOut ?? "", r.note ?? ""])}
        signatures={["Office", "Principal"]}
      />,
      "A4",
    );
  const exportRegister = () =>
    downloadCsv(
      `staff-attendance-${ctx.campus.toLowerCase()}-${date}.csv`,
      ["#", "Employee no", "Name", "Designation", "Status", "Time in", "Time out", "Note"],
      rows.map((r, i) => [i + 1, r.employeeNo, r.name, r.designation, dayStatusText(r), r.timeIn ?? "", r.timeOut ?? "", r.note ?? ""]),
    );
  const deviceEdits = Object.keys(drafts).filter((id) => working.find((r) => r.staffId === id)?.source === "DEVICE").length;
  const markRestPresent = () => {
    const next = { ...drafts };
    for (const r of working.filter((x) => x.status === null)) next[r.staffId] = { status: "PRESENT", timeIn: "", timeOut: "", note: "" };
    setDrafts(next);
    setEditing(true);
  };
  const columns: Array<Column<HrDayRow>> = [
    {
      key: "name",
      header: "Staff",
      render: (r) => (
        <span className="grid">
          <span className="font-medium">{r.name}</span>
          <span className="text-small text-ink-muted">
            {r.employeeNo} · {r.designation}
          </span>
        </span>
      ),
    },
    {
      key: "in",
      header: "Time in",
      render: (r) => (editing ? <Input aria-label={`${r.name} time in`} mono value={draftOf(r).timeIn} onChange={(e) => setDraft(r, { timeIn: e.target.value.replace(/[^\d:]/g, "").slice(0, 5) })} placeholder="07:40" className="w-24" error={cellError(r, "timeIn")} /> : <span className="mtb-num">{r.timeIn ?? "—"}</span>),
    },
    {
      key: "out",
      header: "Time out",
      render: (r) => (editing ? <Input aria-label={`${r.name} time out`} mono value={draftOf(r).timeOut} onChange={(e) => setDraft(r, { timeOut: e.target.value.replace(/[^\d:]/g, "").slice(0, 5) })} placeholder="14:10" className="w-24" error={cellError(r, "timeOut")} /> : <span className="mtb-num">{r.timeOut ?? "—"}</span>),
    },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        editing && r.source !== "LEAVE" ? (
          <Select
            aria-label={`${r.name} status`}
            value={draftOf(r).status}
            onChange={(e) => setDraft(r, { status: e.target.value as HrDayStatus })}
            options={(["PRESENT", "LATE", "ABSENT", "HALF_DAY", "LEAVE", "OFF"] as HrDayStatus[]).map((s) => ({ value: s, label: s === "OFF" ? "Day off / rest day" : HR_DAY_LABEL[s] }))}
            className="w-40"
          />
        ) : r.status ? (
          <span className="grid">
            <StatusBadge status={STATUS_BADGE[r.status]}>{dayStatusText(r)}</StatusBadge>
          </span>
        ) : (
          <span className="text-small text-ink-muted">Not marked yet</span>
        ),
    },
    {
      key: "source",
      header: "From",
      render: (r) => (
        <span className="text-small text-ink-muted">
          {r.source === "DEVICE" ? "Fingerprint machine" : r.source === "LEAVE" ? "Approved leave" : r.source === "MANUAL" ? `Changed by ${r.editedBy ?? "office"}` : "—"}
          {r.note ? ` · ${r.note}` : ""}
        </span>
      ),
    },
  ];
  if (editing)
    columns.push({
      key: "note",
      header: "Note",
      render: (r) => <Input aria-label={`${r.name} note`} value={draftOf(r).note} onChange={(e) => setDraft(r, { note: e.target.value })} placeholder={draftOf(r).status === "OFF" ? "Rest day for Saturday duty" : "Forgot to punch"} className="w-44" error={cellError(r, "note")} />,
    });

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <DatePicker label="Day" value={date} onValueChange={(v) => v && setDate(v)} today={TODAY} maxDate={TODAY} />
        </div>
        <span className="pb-2 text-small text-ink-muted">
          {formatWeekday(date)}
          {d ? ` · day starts ${d.dayStarts}, late after ${d.lateAfter}` : ""}
          {d?.lastImport ? ` · last machine import ${formatDateTime(d.lastImport.importedAt)} by ${d.lastImport.importedBy}` : ""}
        </span>
      </div>
      {q.isError && <LoadError what="The register" error={q.error} onRetry={() => void q.refetch()} />}
      {d?.closed ? (
        <div className="mtb-card">
          <EmptyState icon="calendar" title={`No attendance: ${d.closed.name}`} description="Choose another day." />
        </div>
      ) : (
        <>
          <div className="hr-kpis">
            <StatCard label="Present" icon="checkCircle" loading={q.isLoading} value={<AnimatedNumber value={(d?.summary.present ?? 0) + (d?.summary.halfDay ?? 0)} format={formatCount} />} foot={d ? `of ${d.summary.total} expected` : undefined} meter={d && d.summary.total ? ((d.summary.present + d.summary.late + d.summary.halfDay) / d.summary.total) * 100 : 0} meterLabel="Share of staff in today" />
            <StatCard label="Late" icon="clock" tone={(d?.summary.late ?? 0) > 0 ? "warning" : "neutral"} loading={q.isLoading} value={<AnimatedNumber value={d?.summary.late ?? 0} format={formatCount} />} foot={d ? `After ${d.lateAfter}` : undefined} onClick={() => setFilter("LATE")} />
            <StatCard label="Absent or on leave" icon="calendar" loading={q.isLoading} value={<AnimatedNumber value={(d?.summary.absent ?? 0) + (d?.summary.leave ?? 0)} format={formatCount} />} foot={d ? `${d.summary.leave} on approved leave` : undefined} onClick={() => setFilter("LEAVE")} />
            <StatCard label="Not marked yet" icon="alertCircle" tone={(d?.summary.notMarked ?? 0) > 0 ? "info" : "neutral"} loading={q.isLoading} value={<AnimatedNumber value={d?.summary.notMarked ?? 0} format={formatCount} />} foot={d?.deviceName ? "Import from the machine" : "Mark them by hand"} onClick={() => setFilter("NOT")} />
          </div>
          {d && d.summary.notMarked > 0 && date === TODAY && canManage && !readOnly && !editing && (
            <Banner
              tone="info"
              title={d.deviceName ? `${d.summary.notMarked} staff not marked yet today` : `${d.summary.notMarked} staff not marked yet`}
              actions={
                <>
                  {d.deviceName && (
                    <Button size="sm" variant="primary" icon="upload" onClick={onImport}>
                      Import from {d.deviceName.split(" · ")[0]}
                    </Button>
                  )}
                  <Button size="sm" onClick={markRestPresent}>
                    Mark the rest present
                  </Button>
                </>
              }
            >
              {d.deviceName ? "Read today's punches from the fingerprint machine's file; nothing is cleared on the machine." : "Mark attendance by hand, then save."}
            </Banner>
          )}
          <DataTable
            caption={`Staff attendance, ${campusLabel(ctx.campus)}, ${formatDate(date)}`}
            columns={columns}
            rows={rows}
            rowKey="staffId"
            loading={q.isLoading}
            toolbar={
              <div className="flex w-full flex-wrap items-end gap-3">
                <div className="w-56">
                  <Input aria-label="Search" placeholder="Name or employee no." icon="search" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <div className="w-44">
                  <Select
                    aria-label="Show"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as typeof filter)}
                    options={[
                      { value: "", label: "Everyone" },
                      { value: "NOT", label: "Not marked yet" },
                      { value: "LATE", label: "Late" },
                      { value: "ABSENT", label: "Absent" },
                      { value: "LEAVE", label: "On leave" },
                      { value: "OFF", label: "Day off" },
                    ]}
                  />
                </div>
                <DesignationSelect value={des} onChange={setDes} />
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  {!editing && (
                    <>
                      <Button icon="download" onClick={exportRegister} disabled={!rows.length}>
                        Export
                      </Button>
                      <Button icon="printer" onClick={printRegister} disabled={!rows.length}>
                        Print
                      </Button>
                    </>
                  )}
                  {canManage && !readOnly && !editing && (
                    <Button icon="edit" onClick={() => setEditing(true)} disabled={!d}>
                      Correct attendance
                    </Button>
                  )}
                  {editing && (
                    <>
                      <Button
                        onClick={() => {
                          setEditing(false);
                          setDrafts({});
                          setTried(false);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        icon="check"
                        loading={save.isPending}
                        disabled={!Object.keys(drafts).length}
                        onClick={() => {
                          setTried(true);
                          if (draftsOk && (deviceEdits === 0 || reason.trim().length >= 5)) save.mutate();
                        }}
                      >
                        Save {Object.keys(drafts).length || ""} change{Object.keys(drafts).length === 1 ? "" : "s"}
                      </Button>
                    </>
                  )}
                </span>
              </div>
            }
            empty={<EmptyState icon="clock" title="Nobody matches" description="Clear the search or filter." />}
          />
          {editing && tried && !draftsOk && <Banner tone="warning">Check the highlighted times and notes, then save again.</Banner>}
          {editing && deviceEdits > 0 && (
            <Input label={`Why are you changing what the machine recorded? (${deviceEdits} ${deviceEdits === 1 ? "person" : "people"})`} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Machine was down from 7:30 to 8:15" error={errorField(save.error) === "reason" ? errorText(save.error) : tried && reason.trim().length < 5 ? "Say why, in a few words." : undefined} />
          )}
          {save.error && errorField(save.error) !== "reason" && <Banner tone="danger">{errorText(save.error)}</Banner>}
        </>
      )}
      {area}
    </>
  );
}

/* ---------------------------------------------------------------- Monthly sheet */

function MonthPicker({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const ctx = useCtx();
  const months = hrSessionMonths(ctx.session).filter((m) => m <= THIS_MONTH);
  return (
    <div className="w-48">
      <Select label="Month" value={months.includes(month) ? month : (months.at(-1) ?? month)} onChange={(e) => setMonth(e.target.value)} options={months.map((m) => ({ value: m, label: hrMonthLabel(m) })).reverse()} />
    </div>
  );
}

function useMonth(month: string) {
  const ctx = useCtx();
  const months = hrSessionMonths(ctx.session).filter((m) => m <= THIS_MONTH);
  const m = months.includes(month) ? month : (months.at(-1) ?? month);
  return { m, q: useQuery(hrQueries.attendanceMonth(ctx, m)) };
}

function MonthView({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const ctx = useCtx();
  const { m, q } = useMonth(month);
  const { print, area } = usePrint();
  const [des, setDes] = useState("");
  const desTitle = useDesignationTitle(des);
  const d = q.data;
  const sheetRows = (d?.rows ?? []).filter((r) => !des || r.designationId === des);
  const exportCsv = (x: HrAttendanceMonth) =>
    downloadCsv(
      `staff-attendance-${ctx.campus.toLowerCase()}-${m}.csv`,
      ["Employee no", "Name", "Designation", ...x.days.map((day) => day.date.slice(8)), "Present", "Late", "Absent", "Leave", "Half day", "Attendance %"],
      sheetRows.map((r) => [r.employeeNo, r.name, r.designation, ...x.days.map((day) => r.codes[day.date] ?? ""), r.present, r.late, r.absent, r.leave, r.halfDay, r.percent ?? ""]),
    );
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <MonthPicker month={m} setMonth={setMonth} />
        <DesignationSelect label="Designation" value={des} onChange={setDes} />
        {d && (
          <span className="ml-auto flex gap-2">
            <Button icon="download" onClick={() => exportCsv(d)}>
              Export
            </Button>
            <Button
              icon="printer"
              onClick={() =>
                print(
                  <ReportDoc
                    campus={campusHeading(ctx.campus as CampusCode)}
                    title={`Staff attendance · ${hrMonthLabel(m)}`}
                    sub={filterNote([desTitle, `${sheetRows.length} staff`, `${d.workingDays} working days`, "P present, LT late, A absent, LV leave, HD half day, H holiday"])}
                    small
                    head={["Name", ...d.days.map((x) => x.date.slice(8)), "P", "LT", "A", "LV", "%"]}
                    numeric={[]}
                    rows={sheetRows.map((r) => [r.name, ...d.days.map((x) => (r.codes[x.date] === "OFF" ? "" : (r.codes[x.date] ?? ""))), r.present, r.late, r.absent, r.leave, r.percent ?? ""])}
                    signatures={["Office", "Principal"]}
                  />,
                  "A4L",
                )
              }
            >
              Print sheet
            </Button>
          </span>
        )}
      </div>
      {q.isError && <LoadError what="The monthly sheet" error={q.error} onRetry={() => void q.refetch()} />}
      <Panel id="sheet" title={`${hrMonthLabel(m)} · ${campusLabel(ctx.campus)}`} description={d ? `${d.workingDays} working days so far. Click a column header letter to read the legend below.` : undefined} rise={0}>
        {!d ? (
          <Skeleton height={320} />
        ) : (
          <>
            <div className="hr-sheet-scroll">
              <table className="hr-sheet">
                <thead>
                  <tr>
                    <th className="hr-name">Staff</th>
                    {d.days.map((x) => (
                      <th key={x.date} className={x.weekday === 0 || x.holiday ? "is-off" : undefined} title={x.holiday ?? formatWeekday(x.date)}>
                        {x.date.slice(8)}
                      </th>
                    ))}
                    <th>P</th>
                    <th>LT</th>
                    <th>A</th>
                    <th>LV</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {sheetRows.length === 0 && (
                    <tr>
                      <td colSpan={d.days.length + 6} className="py-4 text-small text-ink-muted">
                        Nobody with this designation worked here this month.
                      </td>
                    </tr>
                  )}
                  {sheetRows.map((r, i) => (
                    <tr key={r.staffId} style={slide(i)}>
                      <td className="hr-name">
                        <span className="font-medium">{r.name}</span>
                      </td>
                      {d.days.map((x) => {
                        const c = r.codes[x.date];
                        return <td key={x.date}>{c && c !== "OFF" ? <span className={`hr-code hr-code-${c}`} title={`${formatDate(x.date)}: ${CODE_LABEL[c]}`}>{c === "LV" ? "L" : c}</span> : <span className="hr-code hr-code-OFF">·</span>}</td>;
                      })}
                      <td className="hr-tot">{r.present}</td>
                      <td className="hr-tot">{r.late}</td>
                      <td className="hr-tot">{r.absent}</td>
                      <td className="hr-tot">{r.leave}</td>
                      <td className="hr-tot">{r.percent ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-0 mt-3 flex flex-wrap gap-3 text-small text-ink-muted">
              {(["P", "LT", "A", "LV", "HD", "H"] as HrMonthCode[]).map((c) => (
                <span key={c} className="flex items-center gap-1">
                  <span className={`hr-code hr-code-${c}`}>{c === "LV" ? "L" : c}</span> {CODE_LABEL[c]}
                </span>
              ))}
            </p>
          </>
        )}
      </Panel>
      {area}
    </>
  );
}

/* ---------------------------------------------------------------- Date range */

const spanDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

const rangeSchema = z
  .object({
    from: z.string().min(1, "Choose the first day."),
    to: z.string().min(1, "Choose the last day."),
  })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "The last day can't be before the first day." })
  .refine((v) => v.to <= TODAY, { path: ["to"], message: "The last day can be today at the latest." })
  .refine((v) => v.to < v.from || spanDays(v.from, v.to) <= RANGE_MAX_DAYS, { path: ["from"], message: `Choose ${RANGE_MAX_DAYS} days or fewer (about three months).` });

/** One cell of the range grid: the code, or time in over time out. */
function RangeCell({ c, date, times }: { c: HrRangeCell | undefined; date: string; times: boolean }) {
  if (!c?.status) return <span className="hr-code hr-code-OFF">{c ? "?" : ""}</span>;
  const code = CODE[c.status];
  const title = `${formatDate(date)}: ${dayStatusText(c)}${c.timeIn ? ` · in ${c.timeIn}` : ""}${c.timeOut ? ` · out ${c.timeOut}` : ""}`;
  if (code === "OFF") return <span className="hr-code hr-code-OFF" title={title}>·</span>;
  if (times && c.timeIn)
    return (
      <span className={`hr-times hr-code-${code}`} title={title}>
        <span>{c.timeIn}</span>
        <span>{c.timeOut ?? "—"}</span>
      </span>
    );
  return (
    <span className={`hr-code hr-code-${code}`} title={title}>
      {code === "LV" ? "L" : code}
    </span>
  );
}

const rangeCellText = (c: HrRangeCell | undefined, times: boolean) => {
  if (!c?.status) return "";
  const code = CODE[c.status];
  if (code === "OFF") return "";
  if (times && c.timeIn) return `${c.timeIn}–${c.timeOut ?? ""}`;
  return code;
};

/** Attendance for any date range: everyone (codes or times per day) or one person day by day (legacy time in/out). */
function RangeView({ from, to, staffId, set }: { from: string; to: string; staffId: string; set: (p: Partial<AttendanceSearch>) => void }) {
  const ctx = useCtx();
  const { print, area } = usePrint();
  const staff = useQuery(hrQueries.staff(ctx));
  const [des, setDes] = useState("");
  const desTitle = useDesignationTitle(des);
  const [show, setShow] = useState<"codes" | "times">("codes");
  const parsed = rangeSchema.safeParse({ from, to });
  const errors = issues(parsed);
  const q = useQuery(hrQueries.attendanceRange(ctx, parsed.success ? { from, to, ...(des ? { designationId: des } : {}), ...(staffId ? { staffId } : {}) } : { from: "", to: "" }));
  const d = q.data;
  const times = show === "times";
  const person = staff.data?.find((s) => s.id === staffId);
  const single = staffId && d?.rows.length === 1 ? d.rows[0]! : null;
  const sf = errorField(q.error);
  const err = (k: "from" | "to") => errors[k] ?? (sf === k ? errorText(q.error) : undefined);
  const heading = `${formatDate(from)} to ${formatDate(to)}`;
  const sub = (x: HrAttendanceRange) => filterNote([desTitle, single ? `${single.employeeNo} · ${single.designation}` : `${x.rows.length} staff`, `${x.workingDays} working days`, !single && !times && "P present, LT late, A absent, L leave, HD half day, H holiday"]);
  const dayRows = single && d ? d.days.filter((x) => single.cells[x.date]).map((x) => ({ ...x, cell: single.cells[x.date]! })) : [];

  const printRange = (x: HrAttendanceRange) => {
    if (single)
      return print(
        <ReportDoc
          campus={campusHeading(ctx.campus as CampusCode)}
          title={`Time in and out · ${single.name}`}
          sub={`${heading} · ${sub(x)}`}
          head={["#", "Date", "Day", "Status", "Time in", "Time out", "Late (min)", "Hours worked"]}
          numeric={[6, 7]}
          rows={dayRows.map((r, i) => [i + 1, formatDate(r.date), formatWeekday(r.date), dayStatusText(r.cell), r.cell.timeIn ?? "", r.cell.timeOut ?? "", r.cell.lateMinutes || "", hoursText(r.cell.workedMinutes)])}
          total={["", "Total", "", `${single.present} present, ${single.late} late, ${single.absent} absent, ${single.leave} leave`, "", "", single.lateMinutes || "", hoursText(single.workedMinutes)]}
          signatures={["Office", "Principal"]}
        />,
        "A4",
      );
    print(
      <ReportDoc
        campus={campusHeading(ctx.campus as CampusCode)}
        title={`Staff attendance · ${heading}`}
        sub={sub(x)}
        small
        head={["Name", ...x.days.map((day) => day.date.slice(8)), "P", "LT", "A", "LV", "HD", times ? "Hours" : "%"]}
        rows={x.rows.map((r) => [
          r.name,
          ...x.days.map((day) => {
            const c = r.cells[day.date];
            return times && c?.timeIn ? (
              <>
                {c.timeIn}
                <br />
                {c.timeOut ?? ""}
              </>
            ) : (
              rangeCellText(c, false).replace("LV", "L")
            );
          }),
          r.present,
          r.late,
          r.absent,
          r.leave,
          r.halfDay,
          times ? hoursText(r.workedMinutes) : (r.percent ?? ""),
        ])}
        signatures={["Office", "Principal"]}
      />,
      "A4L",
    );
  };
  const exportRange = (x: HrAttendanceRange) =>
    single
      ? downloadCsv(
          `time-in-out-${single.employeeNo.toLowerCase()}-${from}-${to}.csv`,
          ["Date", "Day", "Status", "Time in", "Time out", "Late (min)", "Hours worked"],
          dayRows.map((r) => [formatDate(r.date), formatWeekday(r.date), dayStatusText(r.cell), r.cell.timeIn ?? "", r.cell.timeOut ?? "", r.cell.lateMinutes || "", hoursText(r.cell.workedMinutes)]),
        )
      : downloadCsv(
          `staff-attendance-${ctx.campus.toLowerCase()}-${from}-${to}.csv`,
          ["Employee no", "Name", "Designation", ...x.days.map((day) => day.date), "Present", "Late", "Absent", "Leave", "Half day", "Minutes late", "Hours worked", "Attendance %"],
          x.rows.map((r) => [r.employeeNo, r.name, r.designation, ...x.days.map((day) => rangeCellText(r.cells[day.date], times)), r.present, r.late, r.absent, r.leave, r.halfDay, r.lateMinutes, hoursText(r.workedMinutes), r.percent ?? ""]),
        );

  const dayColumns: Array<Column<(typeof dayRows)[number]>> = [
    { key: "date", header: "Date", render: (r) => <span className="mtb-num">{formatDate(r.date)}</span> },
    { key: "day", header: "Day", render: (r) => <span className="text-small text-ink-muted">{formatWeekday(r.date)}</span> },
    { key: "status", header: "Status", render: (r) => (r.cell.status ? <StatusBadge status={STATUS_BADGE[r.cell.status]}>{dayStatusText(r.cell)}</StatusBadge> : <span className="text-small text-ink-muted">Not marked</span>) },
    { key: "in", header: "Time in", render: (r) => <span className="mtb-num">{r.cell.timeIn ?? "—"}</span> },
    { key: "out", header: "Time out", render: (r) => <span className="mtb-num">{r.cell.timeOut ?? "—"}</span> },
    { key: "late", header: "Late", align: "right", render: (r) => <span className="mtb-num">{r.cell.lateMinutes ? `${r.cell.lateMinutes} min` : ""}</span> },
    { key: "hours", header: "Hours worked", align: "right", render: (r) => <span className="mtb-num">{hoursText(r.cell.workedMinutes)}</span> },
  ];

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <DatePicker label="From" required value={from} onValueChange={(v) => v && set({ from: v })} today={TODAY} maxDate={TODAY} error={err("from")} />
        </div>
        <div className="w-44">
          <DatePicker label="To" required value={to} onValueChange={(v) => v && set({ to: v })} today={TODAY} maxDate={TODAY} minDate={from} error={err("to")} />
        </div>
        <DesignationSelect
          label="Designation"
          value={des}
          onChange={(v) => {
            setDes(v);
            if (v && person && person.designationId !== v) set({ staff: undefined });
          }}
        />
        <div className="w-64">
          <Combobox
            label="Staff member"
            value={staffId}
            onValueChange={(v) => set({ staff: v || undefined })}
            options={[{ value: "", label: "Everyone" }, ...staffOptions(staff.data, (s) => !des || s.designationId === des)]}
            placeholder={staff.isLoading ? "Loading staff…" : "Everyone"}
          />
        </div>
        <Segmented
          aria-label="Show"
          value={show}
          onChange={(v) => setShow(v as "codes" | "times")}
          options={[
            { value: "codes", label: "Status codes" },
            { value: "times", label: "Time in–out" },
          ]}
        />
        {d && (
          <span className="ml-auto flex gap-2">
            <Button icon="download" onClick={() => exportRange(d)} disabled={!d.rows.length}>
              Export
            </Button>
            <Button icon="printer" onClick={() => printRange(d)} disabled={!d.rows.length}>
              Print
            </Button>
          </span>
        )}
      </div>
      {q.isError && !sf && <LoadError what="The attendance report" error={q.error} onRetry={() => void q.refetch()} />}
      <Panel
        id="range"
        title={single ? `${single.name} · ${heading}` : `${heading} · ${campusLabel(ctx.campus)}`}
        description={
          d
            ? single
              ? `${single.employeeNo} · ${single.designation} · ${single.present} present, ${single.late} late, ${single.absent} absent, ${single.leave} on leave${single.halfDay ? `, ${single.halfDay} half days` : ""} · ${hoursText(single.workedMinutes) || "0:00"} hours worked`
              : `${d.workingDays} working days · ${d.rows.length} staff${d.days.length > 31 ? " · long ranges print small; export to Excel to work with them" : ""}`
            : "Choose up to three months. One staff member gives the day-by-day time in and out."
        }
        rise={0}
      >
        {!parsed.success ? (
          <EmptyState icon="calendar" title="Choose the dates" description="Fix the dates above to see the report." />
        ) : !d ? (
          q.isError ? <EmptyState icon="calendar" title="No report for these dates" description={errorText(q.error)} /> : <Skeleton height={320} />
        ) : d.rows.length === 0 ? (
          <EmptyState icon="hr" title="Nobody matches" description="Nobody with this designation or name worked here in these dates." />
        ) : single ? (
          <DataTable caption={`Time in and out, ${single.name}, ${heading}`} columns={dayColumns} rows={dayRows} rowKey="date" empty={<EmptyState icon="calendar" title="No days in this range" />} />
        ) : (
          <>
            <div className="hr-sheet-scroll">
              <table className="hr-sheet">
                <thead>
                  <tr>
                    <th className="hr-name">Staff</th>
                    {d.days.map((x) => (
                      <th key={x.date} className={x.weekday === 0 || x.holiday ? "is-off" : undefined} title={`${formatWeekday(x.date)} ${formatDate(x.date)}${x.holiday ? ` · ${x.holiday}` : ""}`}>
                        {x.date.slice(8) === "01" || x.date === d.from ? `${x.date.slice(8)}/${x.date.slice(5, 7)}` : x.date.slice(8)}
                      </th>
                    ))}
                    <th>P</th>
                    <th>LT</th>
                    <th>A</th>
                    <th>LV</th>
                    <th>{times ? "Hours" : "%"}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r, i) => (
                    <tr key={r.staffId} style={slide(i)}>
                      <td className="hr-name">
                        <button type="button" className="grid text-left" onClick={() => set({ staff: r.staffId })} title="Show this person day by day">
                          <span className="font-medium">{r.name}</span>
                          <span className="text-small text-ink-muted">{r.designation}</span>
                        </button>
                      </td>
                      {d.days.map((x) => (
                        <td key={x.date}>
                          <RangeCell c={r.cells[x.date]} date={x.date} times={times} />
                        </td>
                      ))}
                      <td className="hr-tot">{r.present}</td>
                      <td className="hr-tot">{r.late}</td>
                      <td className="hr-tot">{r.absent}</td>
                      <td className="hr-tot">{r.leave}</td>
                      <td className="hr-tot">{times ? hoursText(r.workedMinutes) || "—" : (r.percent ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-0 mt-3 flex flex-wrap gap-3 text-small text-ink-muted">
              {(["P", "LT", "A", "LV", "HD", "H"] as HrMonthCode[]).map((c) => (
                <span key={c} className="flex items-center gap-1">
                  <span className={`hr-code hr-code-${c}`}>{c === "LV" ? "L" : c}</span> {CODE_LABEL[c]}
                </span>
              ))}
              <span>{times ? "Time in above time out. " : ""}Click a name to see that person day by day.</span>
            </p>
          </>
        )}
      </Panel>
      {single && (
        <Button variant="quiet" icon="chevronLeft" className="justify-self-start" onClick={() => set({ staff: undefined })}>
          Back to everyone
        </Button>
      )}
      {area}
    </>
  );
}

/* ---------------------------------------------------------------- Late arrivals */

function LateView({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const ctx = useCtx();
  const { m, q } = useMonth(month);
  const [show, setShow] = useState("chart");
  const d = q.data;
  const people = useMemo(() => {
    const map = new Map<string, { staffId: string; name: string; designation: string; count: number; minutes: number; dates: string[] }>();
    for (const e of d?.late ?? []) {
      const x = map.get(e.staffId) ?? { staffId: e.staffId, name: e.name, designation: e.designation, count: 0, minutes: 0, dates: [] };
      x.count++;
      x.minutes += e.lateMinutes;
      x.dates.push(e.date);
      map.set(e.staffId, x);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || b.minutes - a.minutes);
  }, [d]);
  const columns: Array<Column<(typeof people)[number]>> = [
    { key: "name", header: "Staff", render: (r) => <span className="grid"><span className="font-medium">{r.name}</span><span className="text-small text-ink-muted">{r.designation}</span></span> },
    { key: "count", header: "Late arrivals", align: "right", render: (r) => <span className="mtb-num">{r.count}</span> },
    { key: "minutes", header: "Minutes late in all", align: "right", render: (r) => <span className="mtb-num">{r.minutes}</span> },
    { key: "pay", header: "Pay effect", render: (r) => (r.count >= 3 ? <StatusBadge status="warning">{Math.floor(r.count / 3) * 0.5} day's pay</StatusBadge> : <span className="text-small text-ink-muted">None</span>) },
    { key: "dates", header: "Days", render: (r) => <span className="text-small text-ink-muted">{r.dates.slice(0, 6).map((x) => x.slice(8)).join(", ")}{r.dates.length > 6 ? "…" : ""}</span> },
  ];
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <MonthPicker month={m} setMonth={setMonth} />
      </div>
      {q.isError && <LoadError what="Late arrivals" error={q.error} onRetry={() => void q.refetch()} />}
      <Panel
        id="late-trend"
        title="Late arrivals by day"
        description={`${hrMonthLabel(m)} · ${campusLabel(ctx.campus)}. Every three late arrivals cost half a day's pay (set in Settings).`}
        rise={0}
        actions={<Segmented aria-label="Show late arrivals as" value={show} onChange={setShow} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
      >
        {!d ? (
          <Skeleton height={220} />
        ) : d.byDay.length === 0 ? (
          <EmptyState icon="clock" title="No working days yet this month" />
        ) : show === "chart" ? (
          <ColumnChart data={d.byDay} value={(x) => x.late} axisLabel={(x) => x.date.slice(8)} formatAxis={(v) => String(v)} tooltip={(x) => <><div className="mtb-chart-tip-title">{formatWeekday(x.date)} {formatDate(x.date)}</div><div className="mtb-chart-tip-value">{x.late} late</div><div className="mtb-chart-tip-row"><span>Present</span><span>{x.present}</span></div></>} describe={(x) => `${formatDate(x.date)}: ${x.late} late, ${x.present} on time`} label={`Late arrivals each day in ${hrMonthLabel(m)}`} height={220} />
        ) : (
          <table className="w-full text-small">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="py-1 font-medium">Day</th>
                <th className="py-1 text-right font-medium">On time</th>
                <th className="py-1 text-right font-medium">Late</th>
                <th className="py-1 text-right font-medium">Absent</th>
                <th className="py-1 text-right font-medium">On leave</th>
              </tr>
            </thead>
            <tbody>
              {d.byDay.map((x) => (
                <tr key={x.date} className="border-t border-border">
                  <td className="py-1">{formatWeekday(x.date)} {formatDate(x.date)}</td>
                  <td className="py-1 text-right tabular-nums">{x.present}</td>
                  <td className="py-1 text-right tabular-nums">{x.late}</td>
                  <td className="py-1 text-right tabular-nums">{x.absent}</td>
                  <td className="py-1 text-right tabular-nums">{x.leave}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <DataTable caption={`Late arrivals, ${hrMonthLabel(m)}`} columns={columns} rows={people} rowKey="staffId" loading={q.isLoading} empty={<EmptyState icon="checkCircle" title="Nobody was late" description="Everyone arrived on time this month." />} />
    </>
  );
}

/* ---------------------------------------------------------------- Imports */

function ImportsView() {
  const ctx = useCtx();
  const q = useQuery(hrQueries.imports(ctx));
  return (
    <>
      {q.isError && <LoadError what="Machine imports" error={q.error} onRetry={() => void q.refetch()} />}
      <Banner tone="info" title="Punches are stored once.">
        Importing the same file twice adds nothing: punches already in the system are skipped. The machine's own log is never cleared by the system, so nothing is lost if an import fails.
      </Banner>
      <DataTable
        caption="Imports from the fingerprint machine"
        rows={q.data ?? []}
        loading={q.isLoading}
        columns={[
          { key: "at", header: "Imported", render: (b) => <span className="grid"><span>{formatDateTime(b.importedAt)}</span><span className="text-small text-ink-muted">{b.importedBy}</span></span> },
          { key: "file", header: "File", render: (b) => <span className="grid"><span className="mtb-num">{b.fileName}</span><span className="text-small text-ink-muted">{b.deviceName}</span></span> },
          { key: "days", header: "Days", render: (b) => <span className="text-small">{b.days.map((x) => formatDate(x)).join(", ")}</span> },
          { key: "new", header: "New punches", align: "right", render: (b) => <span className="mtb-num">{formatCount(b.newPunches)}</span> },
          { key: "dup", header: "Already in", align: "right", render: (b) => <span className="mtb-num">{formatCount(b.duplicates)}</span> },
          { key: "ign", header: "Ignored", align: "right", render: (b) => <span className="mtb-num">{formatCount(b.ignored)}</span> },
          { key: "staff", header: "Staff", align: "right", render: (b) => <span className="mtb-num">{formatCount(b.staff)}</span> },
        ]}
        empty={<EmptyState icon="upload" title="No imports yet" description="Import the machine's attendance file from the daily register." />}
      />
    </>
  );
}

/* ---------------------------------------------------------------- Import wizard */

function ImportModal({ campus, deviceName, onClose, onDone }: { campus: CampusCode; deviceName: string; onClose: () => void; onDone: (date: string) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const staff = useQuery(hrQueries.staff(ctx));
  const [step, setStep] = useState(0);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<HrImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(true);
  const [result, setResult] = useState<HrImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const key = useMemo(() => newIdempotencyKey(), [preview?.previewId]);
  const read = useMutation({
    mutationFn: (file: { name: string; text: string }) => hrApi.importPreview({ campus, fileName: file.name, text: file.text }),
    onSuccess: (p) => {
      setPreview(p);
      setMapping(Object.fromEntries(p.unknown.map((u) => [u.enrolNo, u.suggestions[0]?.staffId ?? ""])));
      setStep(1);
    },
  });
  const sample = useMutation({ mutationFn: () => hrApi.deviceFile(campus), onSuccess: (f) => read.mutate({ name: f.fileName, text: f.text }) });
  const commit = useMutation({
    mutationFn: () => hrApi.importCommit({ campus, previewId: preview!.previewId, mapping, remember }, key),
    onSuccess: (r) => {
      setResult(r);
      setStep(2);
      toast({ title: `${formatCount(r.batch.newPunches)} punches imported`, message: `${r.staffUpdated} staff updated${r.late ? ` · ${r.late} late` : ""}` });
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
    },
  });
  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) {
      toast({ tone: "danger", title: "File too large", message: "Export one month at a time from the machine." });
      return;
    }
    read.mutate({ name: f.name, text: await f.text() });
  };
  const unmapped = preview?.unknown.filter((u) => !mapping[u.enrolNo]).length ?? 0;
  const candidates = (staff.data ?? []).filter((s) => s.status === "ACTIVE" && s.campus === campus);
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Import from the fingerprint machine"
      description={`${deviceName} · ${campusLabel(campus)}`}
      footer={
        step === 0 ? (
          <Button onClick={onClose}>Cancel</Button>
        ) : step === 1 ? (
          <>
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button variant="primary" icon="check" loading={commit.isPending} loadingLabel="Importing…" disabled={unmapped > 0 || !preview?.newPunches} onClick={() => commit.mutate()}>
              Import {formatCount(preview?.newPunches ?? 0)} punches
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            onClick={() => {
              onDone(result?.batch.days.at(-1) ?? TODAY);
              onClose();
            }}
          >
            Open the register
          </Button>
        )
      }
    >
      <div className="grid gap-4">
        <Stepper steps={["Choose the file", "Check", "Done"]} current={step} label="Import steps" />
        {step === 0 && (
          <>
            <div
              className={`hr-drop${over ? " is-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                void readFile(e.dataTransfer.files[0]);
              }}
            >
              <span className="text-title-3">Drop the attendance file here</span>
              <span className="text-small text-ink-muted">The CSV or attlog file exported from the machine (USB or the ZKTeco software). Punches already imported are skipped.</span>
              <span className="flex flex-wrap justify-center gap-2">
                <Button icon="upload" loading={read.isPending && !sample.isPending} onClick={() => fileRef.current?.click()}>
                  Choose file
                </Button>
                <Button variant="quiet" icon="download" loading={sample.isPending} onClick={() => sample.mutate()}>
                  Use today's file from the machine (demo)
                </Button>
              </span>
              <input ref={fileRef} type="file" accept=".csv,.txt,.dat" hidden onChange={(e) => void readFile(e.target.files?.[0])} />
            </div>
            {(read.error || sample.error) && <Banner tone="danger">{errorText(read.error ?? sample.error)}</Banner>}
          </>
        )}
        {step === 1 && preview && (
          <>
            <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Punches in the file", preview.totalPunches],
                ["New", preview.newPunches],
                ["Already imported (skipped)", preview.duplicates],
                ["Staff matched", preview.matchedStaff],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-md bg-surface-sunken p-3">
                  <dt className="text-small text-ink-muted">{k}</dt>
                  <dd className="m-0 text-title-3 tabular-nums">{formatCount(v as number)}</dd>
                </div>
              ))}
            </dl>
            <p className="m-0 text-small text-ink-muted">
              {preview.fileName} · {preview.from && preview.to ? `${formatDate(preview.from)}${preview.to !== preview.from ? ` to ${formatDate(preview.to)}` : ""}` : ""} · first punch of the day is the time in, the last (an hour or more later) the time out.
            </p>
            {preview.badLines.length > 0 && (
              <Banner tone="warning" title={`${preview.badLines.length} line${preview.badLines.length === 1 ? "" : "s"} couldn't be read and will be left out`}>
                {preview.badLines.slice(0, 3).map((b) => (
                  <div key={b.line}>
                    Line {b.line}: {b.problem} <span className="mtb-num text-ink-muted">({b.text})</span>
                  </div>
                ))}
              </Banner>
            )}
            {preview.unknown.length > 0 && (
              <div className="grid gap-3 rounded-md border border-border p-4">
                <span className="font-medium">
                  {preview.unknown.length} machine number{preview.unknown.length === 1 ? "" : "s"} not linked to anyone
                </span>
                {preview.unknown.map((u) => (
                  <div key={u.enrolNo} className="grid gap-2 sm:grid-cols-[1fr_1.4fr] sm:items-end">
                    <span className="text-small">
                      <span className="mtb-num font-medium">No. {u.enrolNo}</span> · {u.punches} punch{u.punches === 1 ? "" : "es"}, first {u.firstPunch}
                      {u.suggestions[0] && <span className="block text-ink-muted">Suggested: {u.suggestions[0].reason}.</span>}
                    </span>
                    <Select
                      aria-label={`Who is machine number ${u.enrolNo}?`}
                      value={mapping[u.enrolNo] ?? ""}
                      onChange={(e) => setMapping((m) => ({ ...m, [u.enrolNo]: e.target.value }))}
                      options={[
                        { value: "", label: "Choose who this is…" },
                        { value: "IGNORE", label: "Ignore these punches (test or visitor)" },
                        ...u.suggestions.map((s) => ({ value: s.staffId, label: `${s.name} (${s.employeeNo}) · suggested` })),
                        ...candidates.filter((s) => !u.suggestions.some((x) => x.staffId === s.id)).map((s) => ({ value: s.id, label: `${s.name} (${s.employeeNo})` })),
                      ]}
                    />
                  </div>
                ))}
                <Checkbox label="Remember these numbers on the staff profiles for next time" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              </div>
            )}
            {preview.sample.length > 0 && (
              <table className="w-full text-small">
                <thead>
                  <tr className="text-left text-ink-muted">
                    <th className="py-1 font-medium">Staff</th>
                    <th className="py-1 font-medium">Day</th>
                    <th className="py-1 font-medium">In</th>
                    <th className="py-1 font-medium">Out</th>
                    <th className="py-1 font-medium">Late</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((x) => (
                    <tr key={`${x.staffId}${x.date}`} className="border-t border-border">
                      <td className="py-1">{x.name}</td>
                      <td className="py-1">{formatDate(x.date)}</td>
                      <td className="py-1 tabular-nums">{x.firstIn}</td>
                      <td className="py-1 tabular-nums">{x.lastOut ?? "—"}</td>
                      <td className="py-1">{x.lateMinutes ? `${x.lateMinutes} min` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {commit.error && <Banner tone="danger">{errorText(commit.error)}</Banner>}
          </>
        )}
        {step === 2 && result && (
          <Banner tone="success" title={`${formatCount(result.batch.newPunches)} punches imported for ${result.staffUpdated} staff`}>
            {result.daysUpdated} day{result.daysUpdated === 1 ? "" : "s"} updated · {result.late} late arrival{result.late === 1 ? "" : "s"} · {result.batch.duplicates} already in and skipped
            {result.batch.ignored ? ` · ${result.batch.ignored} ignored` : ""}
            {result.mapped ? ` · ${result.mapped} machine number${result.mapped === 1 ? "" : "s"} linked` : ""}.
          </Banner>
        )}
      </div>
    </Modal>
  );
}
