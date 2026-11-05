import {
  newIdempotencyKey,
  WAREHOUSE_REQUEST_STATUS_LABEL,
  warehouseApi,
  warehouseQueries,
  type WarehouseDepartment,
  type WarehouseIssue,
  type WarehouseItem,
  type WarehouseRequest,
  type WarehouseRequestStatus,
  type WarehouseReturn,
} from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatRs, type IsoDate } from "@mtb/domain";
import { Banner, Button, Combobox, DataTable, DatePicker, EmptyState, IconButton, Input, KeyValue, Modal, Select, SidePanel, StatusBadge, TabPanel, Tabs, Textarea, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { CampusNote, DocHead, errorField, errorText, inRange, LoadError, periodText, RequireSingleCampusOverlay, SignLines, usePrinter } from "../library/common";
import { checkLines, itemOptions, LineEditor, newLine, WarehouseShell, type LineDraft } from "./shared";

/* ---------------------------------------------------------------- Rooms */

/** "Class 7-B · room 104" */
export const roomLabel = (r: { name: string; roomNo: string }) => (r.roomNo ? `${r.name} · room ${r.roomNo}` : r.name);

function DeptRoom({ departmentId, room, onDept, onRoom, errors }: { departmentId: string; room: string; onDept: (v: string) => void; onRoom: (v: string) => void; errors: Record<string, string> }) {
  const ctx = useCtx();
  const setup = useQuery(warehouseQueries.setup(ctx));
  const deps = (setup.data?.departments ?? []).filter((d) => d.active);
  const dep = deps.find((d) => d.id === departmentId);
  // Rooms taken out of use are not offered; a request already made for one keeps its room.
  const rooms = (dep?.rooms ?? []).filter((r) => r.active || r.name === room);
  return (
    <>
      <Select label="Department" required value={departmentId} onChange={(e) => { onDept(e.target.value); onRoom(""); }} error={errors.departmentId} options={[{ value: "", label: "Choose…" }, ...deps.map((d) => ({ value: d.id, label: d.name }))]} />
      <Select label="Room or class" required value={room} onChange={(e) => onRoom(e.target.value)} error={errors.room} disabled={!dep} options={[{ value: "", label: dep ? "Choose…" : "Choose the department first" }, ...rooms.map((r) => ({ value: r.name, label: roomLabel(r) }))]} />
    </>
  );
}

/* ---------------------------------------------------------------- Filters */

type Kind = "" | "USED" | "KEPT";
const KIND_LABEL: Record<Exclude<Kind, "">, string> = { USED: "Used up", KEPT: "Kept" };
const kindOf = (consumable: boolean) => (consumable ? "Used up" : "Kept");

interface Filters {
  from: IsoDate | null;
  to: IsoDate | null;
  departmentId: string;
  room: string;
  itemId: string;
  kind: Kind;
  status: "" | WarehouseRequestStatus;
  q: string;
}
const NO_FILTERS: Filters = { from: null, to: null, departmentId: "", room: "", itemId: "", kind: "", status: "", q: "" };
const anyFilter = (f: Filters) => Boolean(f.from || f.to || f.departmentId || f.room || f.itemId || f.kind || f.status || f.q.trim());
/** An issue line matches the item and kind filters. */
const lineMatches = (f: Filters) => (l: { itemId: string; consumable: boolean }) => (!f.itemId || l.itemId === f.itemId) && (!f.kind || (f.kind === "USED") === l.consumable);

function RegisterFilters({
  f,
  set,
  departments,
  items,
  show,
  searchLabel,
}: {
  f: Filters;
  set: (next: Filters) => void;
  departments: WarehouseDepartment[];
  items: WarehouseItem[];
  show: { kind?: boolean; status?: boolean; search?: boolean };
  searchLabel?: string;
}) {
  const dep = departments.find((d) => d.id === f.departmentId);
  const rooms = dep ? dep.rooms : departments.flatMap((d) => d.rooms);
  const roomOptions = [...new Map(rooms.map((r) => [r.name, r])).values()];
  return (
    <div className="flex w-full flex-wrap items-end gap-3">
      <DatePicker label="From" value={f.from} onValueChange={(v) => set({ ...f, from: v })} />
      <DatePicker label="To" value={f.to} onValueChange={(v) => set({ ...f, to: v })} {...(f.from ? { minDate: f.from } : {})} />
      <Select label="Department" value={f.departmentId} onChange={(e) => set({ ...f, departmentId: e.target.value, room: "" })} options={[{ value: "", label: "All departments" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />
      <Select label="Room" value={f.room} onChange={(e) => set({ ...f, room: e.target.value })} options={[{ value: "", label: "All rooms" }, ...roomOptions.map((r) => ({ value: r.name, label: roomLabel(r) }))]} />
      <div className="min-w-[200px]">
        <Combobox label="Item" options={[{ value: "", label: "All items" }, ...itemOptions(items, false)]} value={f.itemId} onValueChange={(v) => set({ ...f, itemId: v })} placeholder="All items" searchPlaceholder="Name or code" />
      </div>
      {show.kind && (
        <Select
          label="Kind"
          value={f.kind}
          onChange={(e) => set({ ...f, kind: e.target.value as Kind })}
          options={[
            { value: "", label: "All" },
            { value: "USED", label: "Used up" },
            { value: "KEPT", label: "Kept in rooms" },
          ]}
        />
      )}
      {show.status && (
        <Select label="Status" value={f.status} onChange={(e) => set({ ...f, status: e.target.value as Filters["status"] })} options={[{ value: "", label: "Any status" }, ...(["OPEN", "PARTIAL", "FULFILLED", "CANCELLED"] as const).map((s) => ({ value: s, label: WAREHOUSE_REQUEST_STATUS_LABEL[s] }))]} />
      )}
      {show.search && (
        <div className="min-w-[200px] flex-1">
          <Input label="Search" icon="search" value={f.q} onChange={(e) => set({ ...f, q: e.target.value })} placeholder={searchLabel} />
        </div>
      )}
      {anyFilter(f) && (
        <Button size="sm" variant="quiet" onClick={() => set(NO_FILTERS)}>
          Clear filters
        </Button>
      )}
    </div>
  );
}

/** "Middle · Class 7-B · Black marker · Kept" — what the filters narrowed the print to. */
function filterText(f: Filters, departments: WarehouseDepartment[], items: WarehouseItem[]): string {
  return [
    departments.find((d) => d.id === f.departmentId)?.name,
    f.room || undefined,
    items.find((i) => i.id === f.itemId)?.name,
    f.kind ? KIND_LABEL[f.kind] : undefined,
    f.status ? WAREHOUSE_REQUEST_STATUS_LABEL[f.status] : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

/* ---------------------------------------------------------------- Forms */

function NewIssue({ request, onClose }: { request: WarehouseRequest | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const items = useQuery(warehouseQueries.items(ctx));
  const [departmentId, setDept] = useState(request?.departmentId ?? "");
  const [room, setRoom] = useState(request?.room ?? "");
  const [receivedBy, setReceivedBy] = useState(request?.requestedBy ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    request ? request.lines.filter((l) => l.issued < l.qty).map((l) => ({ ...newLine(), itemId: l.itemId, qty: l.qty - l.issued })) : [newLine()],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const key = useMemo(() => newIdempotencyKey(), []);
  const all = items.data ?? [];
  const post = useMutation({
    mutationFn: () => warehouseApi.postIssue(ctx, { departmentId, room, receivedBy, requestId: request?.id ?? null, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty!, remarks: l.remarks ?? "" })) }, key),
    onSuccess: (i) => {
      toast({ title: `${i.no} posted`, message: `${i.lines.length} ${i.lines.length === 1 ? "item" : "items"} issued to ${i.department} · ${i.room}.` });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      onClose();
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const submit = () => {
    const e = checkLines(lines, all, { stock: true });
    if (!departmentId) e.departmentId = "Choose the department.";
    if (!room) e.room = "Choose the room or class it goes to.";
    if (receivedBy.trim().length < 3) e.receivedBy = "Enter who received it.";
    setErrors(e);
    if (Object.keys(e).length === 0) post.mutate();
  };
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={request ? `Issue against ${request.no}` : "Issue stock"}
      description="Stock leaves the store now. Nothing can be issued beyond what is on the shelf."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="upload" loading={post.isPending} loadingLabel="Posting…" onClick={submit}>
            Post issue
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {request && (
          <Banner tone="info" title={`${request.requestedBy} asked on ${formatDate(request.requestedOn)}`}>
            {request.note || "Quantities still waiting are filled in. Change them if you issue part now."}
          </Banner>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <DeptRoom departmentId={departmentId} room={room} onDept={setDept} onRoom={setRoom} errors={errors} />
          <Input label="Received by" required value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} error={errors.receivedBy} placeholder="Ms Hina Javed" />
        </div>
        <LineEditor items={all} lines={lines} onChange={setLines} errors={errors} remarks />
        {post.isError && !errorField(post.error) && <Banner tone="danger">{errorText(post.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

function NewRequest({ onClose }: { onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const items = useQuery(warehouseQueries.items(ctx));
  const [departmentId, setDept] = useState("");
  const [room, setRoom] = useState("");
  const [requestedBy, setBy] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => warehouseApi.saveRequest(ctx, { departmentId, room, requestedBy, note, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty! })) }),
    onSuccess: (r) => {
      toast({ title: `${r.no} recorded`, message: `${r.department} · ${r.room}. It waits in Requests until issued.` });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      onClose();
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const submit = () => {
    const e = checkLines(lines, items.data ?? []);
    if (!departmentId) e.departmentId = "Choose the department.";
    if (!room) e.room = "Choose the room or class.";
    if (requestedBy.trim().length < 3) e.requestedBy = "Enter who asked for it.";
    setErrors(e);
    if (Object.keys(e).length === 0) save.mutate();
  };
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title="Record a request"
      description="A department or class asks for stock. Issue it now or later; the request shows what is still waiting."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Save request
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <DeptRoom departmentId={departmentId} room={room} onDept={setDept} onRoom={setRoom} errors={errors} />
          <Input label="Asked by" required value={requestedBy} onChange={(e) => setBy(e.target.value)} error={errors.requestedBy} />
        </div>
        <Textarea label="Why (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        <LineEditor items={items.data ?? []} lines={lines} onChange={setLines} errors={errors} />
        {save.isError && !errorField(save.error) && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

function ReturnModal({ issue, onClose }: { issue: WarehouseIssue; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const key = useMemo(() => newIdempotencyKey(), []);
  const m = useMutation({
    mutationFn: () => warehouseApi.postReturn(ctx, { issueId: issue.id, reason, lines: issue.lines.map((l) => ({ issueLineId: l.id, qty: Number(qty[l.id] || 0) })).filter((l) => l.qty > 0) }, key),
    onSuccess: (r) => {
      toast({ title: `${r.no} posted`, message: `${r.lines.reduce((a, l) => a + l.qty, 0)} back in the store from ${r.department} · ${r.room}.` });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      onClose();
    },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    let any = false;
    for (const l of issue.lines) {
      const v = Number(qty[l.id] || 0);
      if (!Number.isInteger(v) || v < 0) e[l.id] = "A whole number.";
      else if (v > l.qty - l.returned) e[l.id] = `Only ${l.qty - l.returned} still out.`;
      if (v > 0) any = true;
    }
    if (!any) e.form = "Enter how many of at least one item came back.";
    if (reason.trim().length < 3) e.reason = "Say why they are coming back.";
    setErrors(e);
    if (Object.keys(e).length === 0) m.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Take back items from ${issue.no}`}
      description={`${issue.department} · ${issue.room}. A return can't be more than what is still out.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="download" loading={m.isPending} onClick={submit}>
            Post return
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {issue.lines.map((l) => (
          <div key={l.id} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
            <span className="grid">
              <span className="font-medium">{l.itemName}</span>
              <span className="text-small text-ink-muted">
                {l.qty} issued{l.returned ? ` · ${l.returned} already back` : ""} · {l.qty - l.returned} still out
              </span>
            </span>
            <Input label="Coming back" inputMode="numeric" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value.replace(/\D/g, "") })} error={errors[l.id]} disabled={l.qty - l.returned === 0} />
          </div>
        ))}
        {errors.form && <span className="mtb-error">{errors.form}</span>}
        <Textarea label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} placeholder="Not needed after the test week" />
        {m.isError && <Banner tone="danger">{errorText(m.error)}</Banner>}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Printouts */

function IssueDoc({ i, campus }: { i: WarehouseIssue; campus: string }) {
  return (
    <div className="ops-doc">
      <DocHead title={`Issue note ${i.no}`} subtitle={`${formatDate(i.date)}${i.requestNo ? ` · against ${i.requestNo}` : ""}`} campus={campus} />
      <dl className="ops-doc-kv">
        <dt>Department</dt>
        <dd>{i.department}</dd>
        <dt>Room or class</dt>
        <dd>{i.room}</dd>
        <dt>Received by</dt>
        <dd>{i.receivedBy}</dd>
        <dt>Issued by</dt>
        <dd>{i.issuedBy}</dd>
      </dl>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th className="n">Qty</th>
            <th>Unit</th>
            <th className="n">Returned</th>
            <th>For</th>
          </tr>
        </thead>
        <tbody>
          {i.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.itemName}</td>
              <td className="n">{l.qty}</td>
              <td>{l.unit}</td>
              <td className="n">{l.returned || "—"}</td>
              <td>{l.remarks}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <SignLines labels={["Store keeper", "Received by", "Head of department"]} />
    </div>
  );
}

interface IssueRegisterLine {
  key: string;
  issueNo: string;
  date: IsoDate;
  item: string;
  unit: string;
  kind: string;
  qty: number;
  returned: number;
}

/** Issue register: every issued line for the period, grouped by department and room, with what is still out. */
function IssueRegister({ groups, subtitle, campus }: { groups: Array<{ label: string; lines: IssueRegisterLine[] }>; subtitle: string; campus: string }) {
  const sum = (ls: IssueRegisterLine[], k: "qty" | "returned") => ls.reduce((a, l) => a + l[k], 0);
  const all = groups.flatMap((g) => g.lines);
  let sr = 0;
  return (
    <div className="ops-doc">
      <DocHead title="Issue register" subtitle={subtitle} campus={campus} />
      <table>
        <thead>
          <tr>
            <th className="n">Sr</th>
            <th>Issue no.</th>
            <th>Date</th>
            <th>Item</th>
            <th>Kind</th>
            <th className="n">Issued</th>
            <th className="n">Returned</th>
            <th className="n">Still out</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.label}>
              <tr>
                <th colSpan={8}>{g.label}</th>
              </tr>
              {g.lines.map((l) => (
                <tr key={l.key}>
                  <td className="n">{++sr}</td>
                  <td>{l.issueNo}</td>
                  <td>{formatDate(l.date)}</td>
                  <td>{l.item}</td>
                  <td>{l.kind}</td>
                  <td className="n">{formatCount(l.qty)}</td>
                  <td className="n">{formatCount(l.returned)}</td>
                  <td className="n">{formatCount(l.qty - l.returned)}</td>
                </tr>
              ))}
              <tr className="tot">
                <td colSpan={5}>Total for {g.label}</td>
                <td className="n">{formatCount(sum(g.lines, "qty"))}</td>
                <td className="n">{formatCount(sum(g.lines, "returned"))}</td>
                <td className="n">{formatCount(sum(g.lines, "qty") - sum(g.lines, "returned"))}</td>
              </tr>
            </Fragment>
          ))}
          <tr className="tot">
            <td colSpan={5}>Grand total ({formatCount(all.length)} lines)</td>
            <td className="n">{formatCount(sum(all, "qty"))}</td>
            <td className="n">{formatCount(sum(all, "returned"))}</td>
            <td className="n">{formatCount(sum(all, "qty") - sum(all, "returned"))}</td>
          </tr>
        </tbody>
      </table>
      <SignLines />
    </div>
  );
}

const issuedText = (s: WarehouseRequestStatus) => (s === "FULFILLED" ? "Yes" : s === "PARTIAL" ? "Part" : s === "CANCELLED" ? "Cancelled" : "No");

/** One request slip, or the request register when given several. */
function RequestDoc({ requests, kindOf: kind, subtitle, campus, single }: { requests: WarehouseRequest[]; kindOf: (itemId: string) => string; subtitle: string; campus: string; single?: boolean }) {
  const r0 = requests[0];
  return (
    <div className="ops-doc">
      <DocHead title={single && r0 ? `Item request ${r0.no}` : "Request register"} subtitle={subtitle} campus={campus} />
      {single && r0 && (
        <dl className="ops-doc-kv">
          <dt>Department</dt>
          <dd>{r0.department}</dd>
          <dt>Room or class</dt>
          <dd>{r0.room}</dd>
          <dt>Request no.</dt>
          <dd>{r0.no}</dd>
          <dt>Date</dt>
          <dd>{formatDate(r0.requestedOn)}</dd>
          <dt>Asked by</dt>
          <dd>{r0.requestedBy}</dd>
          <dt>Items issued</dt>
          <dd>{issuedText(r0.status)}</dd>
        </dl>
      )}
      <table>
        <thead>
          <tr>
            <th className="n">Sr</th>
            <th>Item</th>
            <th>Kind</th>
            <th className="n">Asked</th>
            <th className="n">Issued</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <Fragment key={r.id}>
              {!single && (
                <tr>
                  <th colSpan={5}>
                    {r.no} · {formatDate(r.requestedOn)} · {r.department} · {r.room} · asked by {r.requestedBy} · items issued: {issuedText(r.status)}
                  </th>
                </tr>
              )}
              {r.lines.map((l, i) => (
                <tr key={`${r.id}-${l.itemId}`}>
                  <td className="n">{i + 1}</td>
                  <td>{l.itemName}</td>
                  <td>{kind(l.itemId)}</td>
                  <td className="n">
                    {formatCount(l.qty)} {l.unit.toLowerCase()}
                  </td>
                  <td className="n">{formatCount(l.issued)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      {single && r0?.note && <p>Why: {r0.note}</p>}
      {single && r0?.cancelReason && <p>Cancelled: {r0.cancelReason}</p>}
      <SignLines />
    </div>
  );
}

function ReturnsRegister({ rows, kindOf: kind, subtitle, campus }: { rows: WarehouseReturn[]; kindOf: (itemId: string) => string; subtitle: string; campus: string }) {
  const total = rows.reduce((a, r) => a + r.lines.reduce((s, l) => s + l.qty, 0), 0);
  return (
    <div className="ops-doc">
      <DocHead title="Returns register" subtitle={subtitle} campus={campus} />
      <table>
        <thead>
          <tr>
            <th>Return no.</th>
            <th>Date</th>
            <th>From issue</th>
            <th>Department · room</th>
            <th>Item</th>
            <th>Kind</th>
            <th className="n">Qty</th>
            <th>Reason</th>
            <th>Taken in by</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((r) =>
            r.lines.map((l) => (
              <tr key={`${r.id}-${l.issueLineId}`}>
                <td>{r.no}</td>
                <td>{formatDate(r.date)}</td>
                <td>{r.issueNo}</td>
                <td>
                  {r.department} · {r.room}
                </td>
                <td>{l.itemName}</td>
                <td>{kind(l.itemId)}</td>
                <td className="n">{formatCount(l.qty)}</td>
                <td>{r.reason}</td>
                <td>{r.receivedBy}</td>
              </tr>
            )),
          )}
          <tr className="tot">
            <td colSpan={6}>
              Total ({formatCount(rows.length)} {rows.length === 1 ? "return" : "returns"})
            </td>
            <td className="n">{formatCount(total)}</td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
      <SignLines />
    </div>
  );
}

/* ---------------------------------------------------------------- Issue panel */

function IssuePanel({ i, onClose }: { i: WarehouseIssue; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const canManage = useCan("warehouse.manage") && !readOnly;
  const [returning, setReturning] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [remark, setRemark] = useState("");
  const printer = usePrinter();
  const save = useMutation({
    mutationFn: (lineId: string) => warehouseApi.setRemarks(ctx, i.id, lineId, remark),
    onSuccess: () => {
      toast({ title: "Remark saved" });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      setEditing(null);
    },
  });
  const anyOut = i.lines.some((l) => l.qty > l.returned);
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={i.no}
      description={`${i.department} · ${i.room} · ${formatDate(i.date)}`}
      footer={
        <>
          <Button icon="printer" onClick={() => printer.print(<IssueDoc i={i} campus={campusLabel(i.campus)} />)}>
            Print issue note
          </Button>
          {canManage && anyOut && (
            <Button variant="primary" icon="download" onClick={() => setReturning(true)}>
              Take back items
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-5">
        <KeyValue
          items={[
            ["Received by", i.receivedBy],
            ["Issued by", `${i.issuedBy}, ${formatDateTime(i.postedAt)}`],
            ["Against request", i.requestNo ?? "No request"],
            ["Value at cost", formatRs(i.value)],
            ["Returns", i.returns.length ? i.returns.map((r) => `${r.no} (${r.qty}) on ${formatDate(r.date)}`).join(", ") : "None"],
          ]}
        />
        <DataTable
          caption="Items issued"
          rows={i.lines}
          density="dense"
          columns={[
            { key: "item", header: "Item", render: (l) => <span className="grid"><span>{l.itemName}</span>{!l.consumable && <span className="text-small text-ink-muted">Kept in the room</span>}</span> },
            { key: "qty", header: "Issued", align: "right", render: (l) => <span className="mtb-num">{l.qty}</span> },
            { key: "ret", header: "Returned", align: "right", render: (l) => <span className="mtb-num">{l.returned || "—"}</span> },
            {
              key: "remarks",
              header: "Used for",
              render: (l) =>
                editing === l.id ? (
                  <span className="flex items-center gap-2">
                    <Input aria-label="Used for" value={remark} onChange={(e) => setRemark(e.target.value)} />
                    <IconButton icon="check" label="Save remark" onClick={() => save.mutate(l.id)} />
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-small">{l.remarks || <span className="text-ink-subtle">—</span>}</span>
                    {canManage && (
                      <IconButton
                        icon="edit"
                        size="sm"
                        label="Edit remark"
                        onClick={() => {
                          setEditing(l.id);
                          setRemark(l.remarks);
                        }}
                      />
                    )}
                  </span>
                ),
            },
          ]}
        />
        {save.isError && <Banner tone="danger">{errorText(save.error)}</Banner>}
        <p className="m-0 text-small text-ink-muted">The "used for" remark replaces the old consumption remarks screen. It can be added any time without changing the stock.</p>
      </div>
      {returning && <ReturnModal issue={i} onClose={() => setReturning(false)} />}
      {printer.element}
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Page */

export type IssueTab = "issues" | "requests" | "returns";

function PrintButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button size="sm" icon="printer" disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}

export function IssuePage({ tab, setTab, openNew, setOpenNew }: { tab: IssueTab; setTab: (t: IssueTab) => void; openNew: boolean; setOpenNew: (v: boolean) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const canManage = useCan("warehouse.manage") && !readOnly;
  const issues = useQuery(warehouseQueries.issues(ctx));
  const requests = useQuery(warehouseQueries.requests(ctx));
  const returns = useQuery(warehouseQueries.returns(ctx));
  const setup = useQuery(warehouseQueries.setup(ctx));
  const items = useQuery(warehouseQueries.items(ctx));
  const [issueF, setIssueF] = useState<Filters>(NO_FILTERS);
  const [reqF, setReqF] = useState<Filters>(NO_FILTERS);
  const [retF, setRetF] = useState<Filters>(NO_FILTERS);
  const [open, setOpen] = useState<WarehouseIssue | null>(null);
  const [fromRequest, setFromRequest] = useState<WarehouseRequest | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [cancelling, setCancelling] = useState<WarehouseRequest | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const printer = usePrinter();
  const departments = setup.data?.departments ?? [];
  const allItems = items.data ?? [];
  const consumable = useMemo(() => new Map(allItems.map((i) => [i.id, i.consumable])), [allItems]);
  const kindOfItem = (itemId: string) => (consumable.has(itemId) ? kindOf(consumable.get(itemId)!) : "");
  const campus = campusLabel(ctx.campus);

  /* Issued: an issue shows when any of its lines matches the item and kind filters; the register prints the matching lines. */
  const issueRows = useMemo(() => {
    const s = issueF.q.trim().toLowerCase();
    return (issues.data ?? []).filter(
      (i) =>
        inRange(i.date, issueF.from, issueF.to) &&
        (!issueF.departmentId || i.departmentId === issueF.departmentId) &&
        (!issueF.room || i.room === issueF.room) &&
        i.lines.some(lineMatches(issueF)) &&
        (!s || `${i.no} ${i.requestNo ?? ""} ${i.department} ${i.room} ${i.receivedBy} ${i.lines.map((l) => l.itemName).join(" ")}`.toLowerCase().includes(s)),
    );
  }, [issues.data, issueF]);

  const printIssueRegister = () => {
    const groups = new Map<string, IssueRegisterLine[]>();
    for (const i of [...issueRows].sort((a, b) => a.department.localeCompare(b.department) || a.room.localeCompare(b.room) || a.date.localeCompare(b.date) || a.no.localeCompare(b.no))) {
      const label = `${i.department} · ${i.room}`;
      const lines = i.lines.filter(lineMatches(issueF)).map((l) => ({ key: `${i.id}-${l.id}`, issueNo: i.no, date: i.date, item: l.itemName, unit: l.unit, kind: kindOf(l.consumable), qty: l.qty, returned: l.returned }));
      groups.set(label, [...(groups.get(label) ?? []), ...lines]);
    }
    const narrowed = filterText(issueF, departments, allItems);
    printer.print(<IssueRegister groups={[...groups.entries()].map(([label, lines]) => ({ label, lines }))} subtitle={[periodText(issueF.from, issueF.to, ctx.session), narrowed].filter(Boolean).join(" · ")} campus={campus} />, "A4");
  };

  /* Requests */
  const reqRows = useMemo(
    () =>
      (requests.data ?? []).filter(
        (r) =>
          inRange(r.requestedOn, reqF.from, reqF.to) &&
          (!reqF.departmentId || r.departmentId === reqF.departmentId) &&
          (!reqF.room || r.room === reqF.room) &&
          (!reqF.status || r.status === reqF.status) &&
          (!reqF.itemId || r.lines.some((l) => l.itemId === reqF.itemId)),
      ),
    [requests.data, reqF],
  );
  const waiting = (requests.data ?? []).filter((r) => r.status === "OPEN" || r.status === "PARTIAL").length;

  /* Returns (a return names the department; the filter matches it by name) */
  const retRows = useMemo(() => {
    const dep = departments.find((d) => d.id === retF.departmentId)?.name ?? "";
    return (returns.data ?? []).filter(
      (r) => inRange(r.date, retF.from, retF.to) && (!retF.departmentId || r.department === dep) && (!retF.room || r.room === retF.room) && (!retF.itemId || r.lines.some((l) => l.itemId === retF.itemId)),
    );
  }, [returns.data, retF, departments]);

  const cancel = useMutation({
    mutationFn: () => warehouseApi.cancelRequest(ctx, cancelling!.id, cancelReason),
    onSuccess: (r) => {
      toast({ title: `${r.no} cancelled` });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      setCancelling(null);
      setCancelReason("");
    },
  });

  const issueCols: Array<Column<WarehouseIssue>> = [
    { key: "no", header: "Issue note", render: (i) => <span className="grid"><span className="mtb-mono font-medium">{i.no}</span><span className="text-small text-ink-muted">{formatDate(i.date)}{i.requestNo ? ` · ${i.requestNo}` : ""}{ctx.campus === "ALL" ? ` · ${campusLabel(i.campus)}` : ""}</span></span> },
    { key: "to", header: "Issued to", render: (i) => <span className="grid"><span>{i.department} · {i.room}</span><span className="text-small text-ink-muted">Received by {i.receivedBy}</span></span> },
    { key: "items", header: "Items", render: (i) => <span className="text-small">{i.lines.slice(0, 2).map((l) => `${l.itemName} × ${l.qty}`).join(", ")}{i.lines.length > 2 ? ` and ${i.lines.length - 2} more` : ""}</span> },
    { key: "value", header: "Value", align: "right", render: (i) => <span className="mtb-num">{formatRs(i.value)}</span> },
    { key: "ret", header: "Returned", render: (i) => (i.returns.length ? <StatusBadge status="info">{i.returns.reduce((a, r) => a + r.qty, 0)} back</StatusBadge> : <span className="text-ink-subtle">—</span>) },
  ];
  const reqCols: Array<Column<WarehouseRequest>> = [
    { key: "no", header: "Request", render: (r) => <span className="grid"><span className="mtb-mono font-medium">{r.no}</span><span className="text-small text-ink-muted">{formatDate(r.requestedOn)}</span></span> },
    { key: "from", header: "From", render: (r) => <span className="grid"><span>{r.department} · {r.room}</span><span className="text-small text-ink-muted">{r.requestedBy}</span></span> },
    { key: "items", header: "Items (issued of asked)", render: (r) => <span className="text-small">{r.lines.map((l) => `${l.itemName} ${l.issued}/${l.qty}`).join(", ")}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status === "FULFILLED" ? "paid" : r.status === "CANCELLED" ? "cancelled" : r.status === "PARTIAL" ? "warning" : "pending"}>{WAREHOUSE_REQUEST_STATUS_LABEL[r.status]}</StatusBadge> },
    {
      key: "act",
      header: <span className="mtb-sr-only">Actions</span>,
      render: (r) => (
        <span className="flex items-center justify-end gap-2">
          {r.cancelReason && <span className="text-small text-ink-muted">{r.cancelReason}</span>}
          <IconButton icon="printer" size="sm" label={`Print request ${r.no}`} onClick={() => printer.print(<RequestDoc requests={[r]} kindOf={kindOfItem} subtitle={`${r.department} · ${r.room} · ${formatDate(r.requestedOn)}`} campus={campusLabel(r.campus)} single />)} />
          {canManage && (r.status === "OPEN" || r.status === "PARTIAL") && (
            <>
              <Button size="sm" variant="primary" icon="upload" onClick={() => setFromRequest(r)}>
                Issue
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setCancelling(r)}>
                Cancel
              </Button>
            </>
          )}
        </span>
      ),
    },
  ];
  const retCols: Array<Column<WarehouseReturn>> = [
    { key: "no", header: "Return", render: (r) => <span className="grid"><span className="mtb-mono font-medium">{r.no}</span><span className="text-small text-ink-muted">{formatDate(r.date)} · from {r.issueNo}</span></span> },
    { key: "from", header: "From", render: (r) => `${r.department} · ${r.room}` },
    { key: "items", header: "Items", render: (r) => <span className="text-small">{r.lines.map((l) => `${l.itemName} × ${l.qty}`).join(", ")}</span> },
    { key: "why", header: "Reason", render: (r) => <span className="text-small">{r.reason}</span> },
    { key: "by", header: "Taken in by", render: (r) => <span className="text-small">{r.receivedBy}</span> },
  ];

  const filtered = (f: Filters) => anyFilter(f);
  return (
    <WarehouseShell
      title="Issue and return"
      actions={
        canManage && ctx.campus !== "ALL" ? (
          <>
            <Button icon="inbox" onClick={() => setRequesting(true)}>
              Record a request
            </Button>
            <Button variant="primary" icon="upload" onClick={() => setOpenNew(true)}>
              Issue stock
            </Button>
          </>
        ) : undefined
      }
    >
      <Tabs
        aria-label="Issues, requests and returns"
        value={tab}
        onChange={(v) => setTab(v as IssueTab)}
        tabs={[
          { id: "issues", label: "Issued", icon: "upload", ...(issues.data ? { count: issues.data.length } : {}) },
          { id: "requests", label: "Requests", icon: "inbox", count: waiting },
          { id: "returns", label: "Returned", icon: "download", ...(returns.data ? { count: returns.data.length } : {}) },
        ]}
      />
      <TabPanel id="issues" active={tab === "issues"}>
        {issues.isError && <LoadError what="Issues" error={issues.error} onRetry={() => void issues.refetch()} />}
        <DataTable
          caption="Stock issued to departments"
          rows={issueRows}
          loading={issues.isLoading}
          columns={issueCols}
          onRowClick={setOpen}
          toolbar={
            <div className="grid w-full gap-3">
              <RegisterFilters f={issueF} set={setIssueF} departments={departments} items={allItems} show={{ kind: true, search: true }} searchLabel="Issue or request no., person or item" />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-small text-ink-muted">
                  {formatCount(issueRows.length)} issue notes · {formatRs(issueRows.reduce((a, i) => a + i.value, 0))} at cost
                </span>
                <PrintButton disabled={!issueRows.length} onClick={printIssueRegister}>
                  Print issue register
                </PrintButton>
              </div>
            </div>
          }
          empty={<EmptyState icon="upload" title={filtered(issueF) ? "No issues match" : "Nothing issued this session"} description={filtered(issueF) ? "Change or clear the filters." : undefined} />}
        />
      </TabPanel>
      <TabPanel id="requests" active={tab === "requests"}>
        {requests.isError && <LoadError what="Requests" error={requests.error} onRetry={() => void requests.refetch()} />}
        <DataTable
          caption="Requests from departments"
          rows={reqRows}
          loading={requests.isLoading}
          columns={reqCols}
          toolbar={
            <div className="grid w-full gap-3">
              <RegisterFilters f={reqF} set={setReqF} departments={departments} items={allItems} show={{ status: true }} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-small text-ink-muted">
                  {formatCount(reqRows.length)} requests · {formatCount(reqRows.filter((r) => r.status === "OPEN" || r.status === "PARTIAL").length)} waiting
                </span>
                <PrintButton
                  disabled={!reqRows.length}
                  onClick={() =>
                    printer.print(<RequestDoc requests={reqRows} kindOf={kindOfItem} subtitle={[periodText(reqF.from, reqF.to, ctx.session), filterText(reqF, departments, allItems)].filter(Boolean).join(" · ")} campus={campus} />, "A4")
                  }
                >
                  Print request register
                </PrintButton>
              </div>
            </div>
          }
          empty={<EmptyState icon="inbox" title={filtered(reqF) ? "No requests match" : "No requests"} description={filtered(reqF) ? "Change or clear the filters." : "Record one when a teacher or department asks for stock."} />}
        />
      </TabPanel>
      <TabPanel id="returns" active={tab === "returns"}>
        {returns.isError && <LoadError what="Returns" error={returns.error} onRetry={() => void returns.refetch()} />}
        <DataTable
          caption="Stock returned to the store"
          rows={retRows}
          loading={returns.isLoading}
          columns={retCols}
          toolbar={
            <div className="grid w-full gap-3">
              <RegisterFilters f={retF} set={setRetF} departments={departments} items={allItems} show={{}} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-small text-ink-muted">
                  {formatCount(retRows.length)} returns · {formatCount(retRows.reduce((a, r) => a + r.lines.reduce((s, l) => s + l.qty, 0), 0))} items back
                </span>
                <PrintButton
                  disabled={!retRows.length}
                  onClick={() =>
                    printer.print(<ReturnsRegister rows={retRows} kindOf={kindOfItem} subtitle={[periodText(retF.from, retF.to, ctx.session), filterText(retF, departments, allItems)].filter(Boolean).join(" · ")} campus={campus} />, "A4")
                  }
                >
                  Print returns register
                </PrintButton>
              </div>
            </div>
          }
          empty={<EmptyState icon="download" title={filtered(retF) ? "No returns match" : "Nothing returned this session"} description={filtered(retF) ? "Change or clear the filters." : "Open an issue note to take back unused items."} />}
        />
      </TabPanel>
      <CampusNote />
      {open && <IssuePanel i={open} onClose={() => setOpen(null)} />}
      {(openNew || fromRequest) && (
        <RequireSingleCampusOverlay
          onClose={() => {
            setOpenNew(false);
            setFromRequest(null);
          }}
        >
          <NewIssue
            request={fromRequest}
            onClose={() => {
              setOpenNew(false);
              setFromRequest(null);
            }}
          />
        </RequireSingleCampusOverlay>
      )}
      {requesting && <NewRequest onClose={() => setRequesting(false)} />}
      <Modal
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={`Cancel ${cancelling?.no ?? ""}?`}
        description="Anything already issued against it stays issued."
        footer={
          <>
            <Button onClick={() => setCancelling(null)}>Keep it</Button>
            <Button variant="danger" loading={cancel.isPending} disabled={cancelReason.trim().length < 3} onClick={() => cancel.mutate()}>
              Cancel request
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Textarea label="Reason" rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} help="At least a few words." />
          {cancel.isError && <Banner tone="danger">{errorText(cancel.error)}</Banner>}
        </div>
      </Modal>
      {printer.element}
    </WarehouseShell>
  );
}
