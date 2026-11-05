import { hrApi, hrQueries, newIdempotencyKey, type CampusCode, type HrLeaveBalanceRow, type HrLeaveRequest, type HrLeaveStatus, type HrLeaveType } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatSession } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, Checkbox, Combobox, DataTable, DatePicker, EmptyState, IconButton, Input, KeyValue, Menu, MenuItem, Panel, Segmented, Select, SidePanel, StatCard, StatusBadge, Textarea, Timeline, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { RequirePermission } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { ReportDoc } from "./print";
import { issues, useHrSettings } from "./StaffPanels";
import { campusHeading, DesignationSelect, errorField, errorText, filterNote, HrShell, LeaveBadge, LoadError, slide, staffOptions, TODAY, useDesignationTitle, usePrint } from "./shared";

/* ---------------------------------------------------------------- Record leave */

function NewLeavePanel({ campus, types, onClose }: { campus: CampusCode; types: HrLeaveType[]; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const staff = useQuery(hrQueries.staff(ctx));
  const settings = useHrSettings();
  const canDecide = useCan("approvals.decide");
  const [staffId, setStaffId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [from, setFrom] = useState<string | null>(TODAY);
  const [to, setTo] = useState<string | null>(TODAY);
  const [half, setHalf] = useState(false);
  const [reason, setReason] = useState("");
  const [approved, setApproved] = useState(false);
  const [tried, setTried] = useState(false);
  // The same leave for several staff (legacy Manual Attendance → Leaves & Holidays): one request per person.
  const [several, setSeveral] = useState(false);
  const [many, setMany] = useState<string[]>([]);
  const [refused, setRefused] = useState<Array<{ staffId: string; name: string; message: string }>>([]);
  const nameOf = (id: string) => staff.data?.find((s) => s.id === id)?.name ?? id;
  const addMany = (ids: string[]) => setMany((xs) => [...xs, ...ids.filter((id) => !xs.includes(id))]);
  const schema = z
    .object({
      staffId: z.string({ error: "Choose the staff member." }).min(1, several ? "Add at least one staff member." : "Choose the staff member."),
      from: z.string({ error: "Enter the first day." }).min(1, "Enter the first day."),
      to: z.string({ error: "Enter the last day." }).min(1, "Enter the last day."),
      reason: z.string().trim().min(5, "Say why in a few words; the principal reads this."),
    })
    .refine((v) => v.to >= v.from, { path: ["to"], message: "The last day can't be before the first day." })
    .refine((v) => !half || v.to === v.from, { path: ["to"], message: "A half day is one date." });
  const values = { staffId: several ? (many[0] ?? "") : (staffId ?? ""), from: from ?? "", to: to ?? "", reason };
  const parsed = schema.safeParse(values);
  const errors = issues(parsed);
  const key = useMemo(() => newIdempotencyKey(), [JSON.stringify(values), typeId, half, approved]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = (id: string) => ({ campus, session: ctx.session, staffId: id, typeId, from: from!, to: to!, halfDay: half, reason: reason.trim(), approved });
  const save = useMutation({
    mutationFn: () => hrApi.requestLeave(body(staffId!), key),
    onSuccess: (r) => {
      toast({ title: r.status === "APPROVED" ? "Leave recorded as approved" : "Leave request sent to the principal", message: `${r.staffName} · ${r.typeName} · ${r.days} day${r.days === 1 ? "" : "s"}` });
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
      onClose();
    },
  });
  // One request per person; the balance and overlap checks run for each, so some may be refused.
  const saveMany = useMutation({
    mutationFn: async () => {
      const done: string[] = [];
      const failed: Array<{ staffId: string; name: string; message: string }> = [];
      for (const id of many) {
        try {
          const r = await hrApi.requestLeave(body(id), `${key}-${id}`);
          done.push(r.staffName);
        } catch (e) {
          failed.push({ staffId: id, name: nameOf(id), message: errorText(e) });
        }
      }
      return { done, failed };
    },
    onSuccess: ({ done, failed }) => {
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
      if (done.length) toast({ title: approved ? `Leave recorded for ${done.length} staff` : `${done.length} leave request${done.length === 1 ? "" : "s"} sent to the principal`, message: failed.length ? `${failed.length} not recorded: see the panel.` : done.slice(0, 3).join(", ") + (done.length > 3 ? ` and ${done.length - 3} more` : "") });
      if (!failed.length) return onClose();
      setMany(failed.map((f) => f.staffId));
      setRefused(failed);
    },
  });
  const pending = save.isPending || saveMany.isPending;
  const sf = errorField(save.error);
  const err = (k: string) => (tried ? (errors[k] ?? (sf === k ? errorText(save.error) : undefined)) : undefined);
  return (
    <SidePanel
      open
      onClose={onClose}
      title="Record leave"
      description={`${campusLabel(campus)} · for staff without the teacher app, or leave given on paper`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="check"
            loading={pending}
            onClick={() => {
              setTried(true);
              setRefused([]);
              if (parsed.success) (several ? saveMany : save).mutate();
            }}
          >
            {several && many.length > 1 ? `${approved ? "Record" : "Send"} for ${many.length} staff` : approved ? "Record as approved" : "Send for approval"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Segmented
          aria-label="Who"
          value={several ? "many" : "one"}
          onChange={(v) => {
            setSeveral(v === "many");
            setRefused([]);
            if (v === "many" && staffId && !many.length) setMany([staffId]);
          }}
          options={[
            { value: "one", label: "One person" },
            { value: "many", label: "Several staff" },
          ]}
          className="justify-self-start"
        />
        {!several ? (
          <Combobox label="Staff member" required value={staffId} onValueChange={setStaffId} options={staffOptions(staff.data)} placeholder={staff.isLoading ? "Loading staff…" : "Search by name or employee no."} error={err("staffId")} />
        ) : (
          <div className="grid gap-3 rounded-md border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Combobox label="Add a staff member" value={null} onValueChange={(id) => id && addMany([id])} options={staffOptions(staff.data, (s) => s.status === "ACTIVE" && !many.includes(s.id))} placeholder={staff.isLoading ? "Loading staff…" : "Search by name or employee no."} error={err("staffId")} />
              <Select
                label="Or add a whole designation"
                value=""
                onChange={(e) => e.target.value && addMany((staff.data ?? []).filter((s) => s.status === "ACTIVE" && s.campus === campus && s.designationId === e.target.value).map((s) => s.id))}
                options={[{ value: "", label: "Choose a designation…" }, ...(settings.data?.designations ?? []).filter((d) => d.active).map((d) => ({ value: d.id, label: d.title }))]}
              />
            </div>
            {many.length > 0 ? (
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Staff chosen">
                {many.map((id) => (
                  <li key={id} className="flex items-center gap-1 rounded-md bg-surface-sunken py-0.5 pl-2 text-small">
                    {nameOf(id)}
                    <IconButton icon="x" size="sm" label={`Remove ${nameOf(id)}`} onClick={() => setMany((xs) => xs.filter((x) => x !== id))} />
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-small text-ink-muted">Nobody chosen yet.</span>
            )}
            {many.length > 0 && <span className="text-small text-ink-muted">{many.length} staff · one request each, with the same kind, dates and reason.</span>}
          </div>
        )}
        {refused.length > 0 && (
          <Banner tone="warning" title={`${refused.length} not recorded`}>
            {refused.map((f) => (
              <div key={f.staffId}>
                <span className="font-medium">{f.name}:</span> {f.message}
              </div>
            ))}
            <div className="mt-1">They are still listed above. Change the dates or kind, or remove them, then try again.</div>
          </Banner>
        )}
        <Select label="Kind of leave" value={typeId} onChange={(e) => setTypeId(e.target.value)} options={types.filter((t) => t.active).map((t) => ({ value: t.id, label: `${t.name}${t.daysPerYear !== null ? ` (${t.daysPerYear} days a year)` : ""}` }))} error={err("typeId")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <DatePicker label="First day" required value={from} onValueChange={(d) => { setFrom(d); if (d && (!to || to < d)) setTo(d); }} today={TODAY} error={err("from")} />
          <DatePicker label="Last day" required value={to} onValueChange={setTo} today={TODAY} error={err("to")} />
        </div>
        <Checkbox label="Half day only" checked={half} onChange={(e) => setHalf(e.target.checked)} />
        <Textarea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={err("reason")} placeholder="Family wedding in Bahawalpur" />
        {canDecide && <Checkbox label="Already approved on paper: record it as approved" checked={approved} onChange={(e) => setApproved(e.target.checked)} />}
        <p className="m-0 text-small text-ink-muted">Sundays and holidays inside the dates don't count. The balance is checked before sending.</p>
        {save.error && !sf && <Banner tone="danger">{errorText(save.error)}</Banner>}
        {save.error && sf && !(sf in values) && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- One request */

function LeavePanel({ r, onClose }: { r: HrLeaveRequest; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const canDecide = useCan("approvals.decide");
  const canManage = useCan("hr.manage");
  const [mode, setMode] = useState<"view" | "reject" | "cancel">("view");
  const [note, setNote] = useState("");
  const done = (title: string, message: string) => {
    toast({ title, message });
    void queryClient.invalidateQueries({ queryKey: ["hr"] });
    onClose();
  };
  const decide = useMutation({ mutationFn: (approve: boolean) => hrApi.decideLeave(r.id, { approve, note }), onSuccess: (x) => done(x.status === "APPROVED" ? "Leave approved" : "Leave rejected", `${x.staffName} · ${x.typeName} · ${formatDate(x.from)}${x.to !== x.from ? ` to ${formatDate(x.to)}` : ""}`) });
  const cancel = useMutation({ mutationFn: () => hrApi.cancelLeave(r.id, { reason: note }), onSuccess: (x) => done("Leave cancelled", x.staffName) });
  const error = decide.error ?? cancel.error;
  const decider = (canDecide || canManage) && !readOnly;
  return (
    <SidePanel
      open
      onClose={onClose}
      title={`${r.staffName} · ${r.typeName}`}
      description={`${r.employeeNo} · ${r.designation} · ${r.campusName}`}
      footer={
        r.status === "PENDING" && decider ? (
          mode === "reject" ? (
            <>
              <Button onClick={() => setMode("view")}>Back</Button>
              <Button variant="danger" loading={decide.isPending} disabled={note.trim().length < 5} onClick={() => decide.mutate(false)}>
                Reject
              </Button>
            </>
          ) : (
            <>
              <Button variant="danger-quiet" icon="x" onClick={() => setMode("reject")}>
                Reject
              </Button>
              <Button variant="primary" icon="check" loading={decide.isPending} loadingLabel="Approving…" onClick={() => decide.mutate(true)} disabled={r.overBalance}>
                Approve {r.days} day{r.days === 1 ? "" : "s"}
              </Button>
            </>
          )
        ) : (r.status === "PENDING" || (r.status === "APPROVED" && r.from > TODAY)) && canManage && !readOnly ? (
          mode === "cancel" ? (
            <>
              <Button onClick={() => setMode("view")}>Back</Button>
              <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                Cancel this leave
              </Button>
            </>
          ) : (
            <>
              <Button onClick={onClose}>Close</Button>
              <Button variant="danger-quiet" onClick={() => setMode("cancel")}>
                Cancel leave
              </Button>
            </>
          )
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <LeaveBadge status={r.status} />
          {!r.paid && <StatusBadge status="warning">Unpaid: deducted from salary</StatusBadge>}
          {r.source === "TEACHER_APP" && <StatusBadge status="neutral" icon="smartphone">From the teacher app</StatusBadge>}
        </div>
        <KeyValue
          items={[
            ["Dates", `${formatDate(r.from)}${r.to !== r.from ? ` to ${formatDate(r.to)}` : ""}${r.halfDay ? " (half day)" : ""}`],
            ["Working days", String(r.days)],
            ["Reason", r.reason],
            ["Left after this", r.leftAfter === null ? "No yearly limit" : `${r.leftAfter} day${r.leftAfter === 1 ? "" : "s"} of ${r.typeName.toLowerCase()}`],
            ...(r.periodsToCover ? ([["Periods to cover", `About ${r.periodsToCover}; the timetable's cover list picks them up once approved`]] as Array<[string, string]>) : []),
            ["Asked", `${r.requestedBy}, ${formatDateTime(r.requestedAt)}`],
            ...(r.decidedBy ? ([["Decided", `${r.decidedBy}, ${r.decidedAt ? formatDateTime(r.decidedAt) : ""}${r.decisionNote ? ` · ${r.decisionNote}` : ""}`]] as Array<[string, string]>) : []),
          ]}
        />
        {r.overBalance && <Banner tone="warning" title="More than the days left">Approve only the days left and record the rest as unpaid leave, or reject.</Banner>}
        {r.clashes.length > 0 && (
          <Banner tone="info" title="Happening on those days">
            {r.clashes.join("; ")}
          </Banner>
        )}
        {(mode === "reject" || mode === "cancel") && <Textarea label={mode === "reject" ? "Why is it rejected?" : "Why is it cancelled?"} required={mode === "reject"} rows={3} value={note} onChange={(e) => setNote(e.target.value)} help={mode === "reject" ? "The staff member sees this in the teacher app." : undefined} />}
        {error && <Banner tone="danger">{errorText(error)}</Banner>}
        <Timeline label="Request history" items={r.history.map((h) => ({ id: h.id, date: h.at.slice(0, 10), title: h.text, description: `${h.by}${h.detail ? ` · ${h.detail}` : ""}`, tone: h.text === "Approved" ? ("success" as const) : h.text === "Rejected" ? ("danger" as const) : ("neutral" as const) }))} />
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Page */

export function LeavePage() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("hr.manage");
  const q = useQuery(hrQueries.leave(ctx));
  const balances = useQuery(hrQueries.leaveBalances(ctx));
  const { print, area } = usePrint();
  const [view, setView] = useState("requests");
  const [status, setStatus] = useState<HrLeaveStatus | "">("");
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [des, setDes] = useState("");
  const desTitle = useDesignationTitle(des);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => setOpenId(null), [ctx.campus, ctx.session]);
  const d = q.data;
  const rangeError = from && to && to < from ? "The last day can't be before the first day." : undefined;
  // Requests whose dates overlap the range (legacy "Date From / Date To").
  const inRange = (r: HrLeaveRequest) => rangeError !== undefined || ((!from || r.to >= from) && (!to || r.from <= to));
  const rows = (d?.requests ?? []).filter((r) => (!status || r.status === status) && (!type || r.typeId === type) && (!des || r.designationId === des) && inRange(r) && (!query || `${r.staffName} ${r.employeeNo}`.toLowerCase().includes(query.toLowerCase())));
  const open = d?.requests.find((r) => r.id === openId);
  const mainTypes = (d?.types ?? []).filter((t) => t.active && t.daysPerYear !== null && t.daysPerYear <= 14);
  const filtered = Boolean(status || type || query || des || from || to);
  const rangeText = from || to ? `${from ? formatDate(from) : "start of session"} to ${to ? formatDate(to) : "end of session"}` : `Session ${formatSession(ctx.session)}`;
  const statusLabel = (s: HrLeaveStatus) => ({ PENDING: "Waiting", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled" })[s];
  const printList = (list: HrLeaveRequest[], approvedOnly: boolean) =>
    print(
      <ReportDoc
        campus={ctx.campus === "ALL" ? "All campuses" : campusHeading(ctx.campus)}
        title={approvedOnly ? "Staff leave · approved" : "Staff leave"}
        sub={filterNote([rangeText, desTitle, type && (d?.types.find((t) => t.id === type)?.name ?? ""), !approvedOnly && status && statusLabel(status), query && `matching “${query}”`, `${list.length} request${list.length === 1 ? "" : "s"}`, `${list.reduce((a, r) => a + r.days, 0)} days`])}
        head={["#", "Staff", "Designation", "Leave", "From", "To", "Days", "Status", "Decided by"]}
        numeric={[6]}
        rows={list.map((r, i) => [i + 1, `${r.staffName} (${r.employeeNo})`, r.designation, `${r.typeName}${r.paid ? "" : " (unpaid)"}`, formatDate(r.from), formatDate(r.to), r.days, statusLabel(r.status), r.decidedBy ?? ""])}
        total={["", "Total", "", "", "", "", list.reduce((a, r) => a + r.days, 0), "", ""]}
        signatures={["Office", "Principal"]}
      />,
      "A4",
    );
  const balanceRows = (balances.data ?? []).filter((b) => (!desTitle || b.designation === desTitle) && (!query || `${b.name} ${b.employeeNo}`.toLowerCase().includes(query.toLowerCase())));
  const printBalances = () =>
    print(
      <ReportDoc
        campus={ctx.campus === "ALL" ? "All campuses" : campusHeading(ctx.campus)}
        title="Staff leave balances"
        sub={filterNote([`Session ${formatSession(ctx.session)}`, desTitle, `${balanceRows.length} staff`, "taken / allowed this session"])}
        head={["#", "Emp. no", "Name", "Designation", ...mainTypes.map((t) => t.name.replace(" leave", "")), "Unpaid taken"]}
        numeric={mainTypes.map((_, i) => i + 4).concat([mainTypes.length + 4])}
        rows={balanceRows.map((b, i) => [
          i + 1,
          b.employeeNo,
          b.name,
          b.designation,
          ...mainTypes.map((t) => {
            const x = b.balances.find((y) => y.typeId === t.id);
            return x && x.entitled !== null ? `${x.taken} / ${x.entitled}` : "—";
          }),
          b.balances.find((x) => x.typeId === "lt-unpaid")?.taken ?? 0,
        ])}
        signatures={["Office", "Principal"]}
      />,
      "A4",
    );

  const columns: Array<Column<HrLeaveRequest>> = [
    { key: "staff", header: "Staff", render: (r) => <span className="grid"><span className="font-medium">{r.staffName}</span><span className="text-small text-ink-muted">{r.employeeNo} · {r.designation}{ctx.campus === "ALL" ? ` · ${r.campusName}` : ""}</span></span> },
    { key: "type", header: "Leave", render: (r) => <span className="grid"><span>{r.typeName}</span>{!r.paid && <span className="text-small text-warning-ink">Unpaid</span>}</span> },
    { key: "dates", header: "Dates", render: (r) => <span className="mtb-num text-small">{formatDate(r.from)}{r.to !== r.from ? ` – ${formatDate(r.to)}` : ""}</span> },
    { key: "days", header: "Days", align: "right", render: (r) => <span className="mtb-num">{r.days}</span> },
    { key: "left", header: "Left after", align: "right", render: (r) => <span className={`mtb-num ${r.overBalance ? "text-danger-ink" : ""}`}>{r.leftAfter ?? "—"}</span> },
    { key: "status", header: "Status", render: (r) => <LeaveBadge status={r.status} /> },
    { key: "from", header: "Asked through", render: (r) => <span className="text-small text-ink-muted">{r.source === "TEACHER_APP" ? "Teacher app" : "Office"}</span> },
  ];
  const balColumns: Array<Column<HrLeaveBalanceRow>> = [
    { key: "name", header: "Staff", render: (b) => <span className="grid"><span className="font-medium">{b.name}</span><span className="text-small text-ink-muted">{b.employeeNo} · {b.designation}</span></span> },
    ...mainTypes.map((t) => ({
      key: t.id,
      header: t.name.replace(" leave", ""),
      render: (b: HrLeaveBalanceRow) => {
        const x = b.balances.find((y) => y.typeId === t.id);
        if (!x || x.entitled === null) return "—";
        return (
          <span className="grid min-w-[90px] gap-1">
            <span className="text-small tabular-nums">{x.left} of {x.entitled} left{x.pending ? ` · ${x.pending} waiting` : ""}</span>
            <span className={`hr-meter${(x.left ?? 0) <= 2 ? " is-low" : ""}`} aria-hidden="true"><span style={{ width: `${(x.taken / Math.max(1, x.entitled)) * 100}%` }} /></span>
          </span>
        );
      },
    })),
    { key: "unpaid", header: "Unpaid taken", align: "right", render: (b) => <span className="mtb-num">{b.balances.find((x) => x.typeId === "lt-unpaid")?.taken ?? 0}</span> },
  ];

  return (
    <RequirePermission permission="hr.view" page="Leave">
      <HrShell
        title="Leave"
        actions={
          <>
            {view === "requests" ? (
              <Menu
                trigger={
                  <Button icon="printer" iconRight="chevronDown" disabled={!d}>
                    Print
                  </Button>
                }
              >
                <MenuItem icon="file" disabled={!rows.length} onSelect={() => printList(rows, false)}>
                  Leave list as shown ({rows.length})
                </MenuItem>
                <MenuItem icon="checkCircle" disabled={!rows.some((r) => r.status === "APPROVED")} onSelect={() => printList(rows.filter((r) => r.status === "APPROVED"), true)}>
                  Approved leave only ({rows.filter((r) => r.status === "APPROVED").length})
                </MenuItem>
              </Menu>
            ) : (
              <Button icon="printer" disabled={!balanceRows.length} onClick={printBalances}>
                Print balances
              </Button>
            )}
            {canManage && !readOnly && ctx.campus !== "ALL" && (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                Record leave
              </Button>
            )}
          </>
        }
      >
        {q.isError && <LoadError what="Leave" error={q.error} onRetry={() => void q.refetch()} />}
        <div className="hr-kpis">
          <StatCard label="Waiting for a decision" icon="clock" tone={(d?.summary.pending ?? 0) > 0 ? "warning" : "neutral"} loading={q.isLoading} value={<AnimatedNumber value={d?.summary.pending ?? 0} format={formatCount} />} foot="Principal or HR decides" onClick={() => setStatus("PENDING")} />
          <StatCard label="On leave today" icon="calendar" loading={q.isLoading} value={<AnimatedNumber value={d?.summary.onLeaveToday.length ?? 0} format={formatCount} />} foot={d?.summary.onLeaveToday.map((x) => x.name).slice(0, 2).join(", ") || "Nobody"} />
          <StatCard label="Leave days this month" icon="listChecks" loading={q.isLoading} value={<AnimatedNumber value={d?.summary.daysThisMonth ?? 0} format={(v) => formatCount(Math.round(v * 10) / 10)} />} foot="Approved, working days" />
          <StatCard label="Approved this session" icon="checkCircle" loading={q.isLoading} value={<AnimatedNumber value={d?.summary.approvedThisSession ?? 0} format={formatCount} />} foot="Requests" />
        </div>
        {d && d.summary.onLeaveToday.length > 0 && (
          <Panel id="today" title="Away today" description="Approved leave; the timetable's cover list shows their periods." rise={1}>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {d.summary.onLeaveToday.map((x, i) => (
                <li key={x.staffId} className="mtb-slide-in rounded-md bg-surface-sunken px-3 py-2 text-small" style={slide(i)}>
                  <span className="font-medium">{x.name}</span> · {x.typeName}
                  {x.until !== TODAY ? ` until ${formatDate(x.until)}` : " · back tomorrow"}
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <Segmented aria-label="Show" value={view} onChange={setView} options={[{ value: "requests", label: "Requests" }, { value: "balances", label: "Balances" }]} className="justify-self-start" />
        {view === "requests" ? (
          <DataTable
            caption="Leave requests"
            columns={columns}
            rows={rows}
            loading={q.isLoading}
            onRowClick={(r) => setOpenId(r.id)}
            rowClassName={(r) => (r.status === "PENDING" ? "mtb-slide-in" : undefined)}
            toolbar={
              <div className="flex w-full flex-wrap items-end gap-3">
                <div className="w-56">
                  <Input aria-label="Search" placeholder="Staff name or number" icon="search" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <div className="w-44">
                  <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as HrLeaveStatus | "")} options={[{ value: "", label: "Every status" }, { value: "PENDING", label: "Waiting" }, { value: "APPROVED", label: "Approved" }, { value: "REJECTED", label: "Rejected" }, { value: "CANCELLED", label: "Cancelled" }]} />
                </div>
                <div className="w-44">
                  <Select aria-label="Kind" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: "", label: "Every kind" }, ...(d?.types ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
                </div>
                <DesignationSelect value={des} onChange={setDes} />
                <div className="w-40">
                  <DatePicker aria-label="From" placeholder="From" value={from} onValueChange={setFrom} today={TODAY} />
                </div>
                <div className="w-40">
                  <DatePicker aria-label="To" placeholder="To" value={to} onValueChange={setTo} today={TODAY} {...(from ? { minDate: from } : {})} error={rangeError} />
                </div>
                {filtered && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setStatus("");
                      setType("");
                      setQuery("");
                      setDes("");
                      setFrom(null);
                      setTo(null);
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            }
            empty={<EmptyState icon="calendar" title={filtered ? "No requests match" : "No leave requests this session"} description={filtered ? "Clear the filters to see them all." : "Requests from the teacher app and the office appear here."} />}
          />
        ) : (
          <DataTable
            caption="Leave balances"
            columns={balColumns}
            rows={balanceRows}
            rowKey="staffId"
            loading={balances.isLoading}
            toolbar={
              <div className="flex w-full flex-wrap items-end gap-3">
                <div className="w-56">
                  <Input aria-label="Search" placeholder="Staff name or number" icon="search" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <DesignationSelect value={des} onChange={setDes} />
              </div>
            }
            empty={<EmptyState icon="calendar" title={des || query ? "Nobody matches" : "No staff"} />}
          />
        )}
        {open && <LeavePanel r={open} onClose={() => setOpenId(null)} />}
        {creating && d && ctx.campus !== "ALL" && <NewLeavePanel campus={ctx.campus} types={d.types} onClose={() => setCreating(false)} />}
        {area}
      </HrShell>
    </RequirePermission>
  );
}
