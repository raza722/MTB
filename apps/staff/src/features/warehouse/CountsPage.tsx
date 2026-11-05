import { WAREHOUSE_COUNT_STATUS_LABEL, warehouseApi, warehouseQueries, type WarehouseCount, type WarehouseCountLine, type WarehouseCountStatus } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatRs, formatSession } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, DataTable, EmptyState, Input, Modal, Panel, Select, Skeleton, StatCard, StatusBadge, Switch, Textarea, useToast, type Column, type Status } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useCan, useCtx, useReadOnly, useSessionUser } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { CampusNote, DocHead, errorText, LoadError, RequireSingleCampusOverlay, slide, usePrinter } from "../library/common";
import { WarehouseShell } from "./shared";

const STATUS_TONE: Record<WarehouseCountStatus, Status> = { COUNTING: "draft", SUBMITTED: "pending", APPROVED: "approved", REJECTED: "rejected" };

export function CountStatusBadge({ status }: { status: WarehouseCountStatus }) {
  return <StatusBadge status={STATUS_TONE[status]}>{WAREHOUSE_COUNT_STATUS_LABEL[status]}</StatusBadge>;
}

function StartCount({ onClose }: { onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setup = useQuery(warehouseQueries.setup(ctx));
  const [name, setName] = useState("");
  const [categoryId, setCategory] = useState("");
  const [err, setErr] = useState<string | undefined>();
  const m = useMutation({
    mutationFn: () => warehouseApi.startCount(ctx, { name, categoryId: categoryId || null }),
    onSuccess: (c) => {
      toast({ title: `${c.no} started`, message: `${c.lines.length} items to count. Today's store figures are kept for comparison.` });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      void navigate({ to: "/warehouse/counts/$countId", params: { countId: c.id } } as never);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Start a stock count"
      description="Count what is physically on the shelf. Differences are posted only after another person approves them."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="play" loading={m.isPending} onClick={() => (name.trim().length < 3 ? setErr('Give the count a name, for example "Stationery, November".') : m.mutate())}>
            Start counting
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={err} placeholder="Stationery, November count" />
        <Select label="Items to count" value={categoryId} onChange={(e) => setCategory(e.target.value)} options={[{ value: "", label: "Every item in the store" }, ...(setup.data?.categories ?? []).filter((c) => c.items > 0).map((c) => ({ value: c.id, label: `${c.name} (${c.items} items)` }))]} />
        {m.isError && <Banner tone="danger">{errorText(m.error)}</Banner>}
      </div>
    </Modal>
  );
}

export function WhCountsPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const canManage = useCan("warehouse.manage") && !readOnly;
  const q = useQuery(warehouseQueries.counts(ctx));
  const [starting, setStarting] = useState(false);
  const columns: Array<Column<WarehouseCount>> = [
    { key: "no", header: "Count", render: (c) => <span className="grid"><span className="font-medium">{c.name}</span><span className="text-small text-ink-muted">{c.no} · {c.category}{ctx.campus === "ALL" ? ` · ${campusLabel(c.campus)}` : ""}</span></span> },
    { key: "started", header: "Started", render: (c) => <span className="grid"><span className="mtb-num">{formatDate(c.startedOn)}</span><span className="text-small text-ink-muted">{c.startedBy}</span></span> },
    { key: "status", header: "Status", render: (c) => <CountStatusBadge status={c.status} /> },
    { key: "counted", header: "Counted", align: "right", render: (c) => <span className="mtb-num">{c.counted} of {c.lines.length}</span> },
    { key: "diff", header: "Differences", align: "right", render: (c) => <span className="mtb-num">{c.differences}</span> },
    { key: "value", header: "Net value", align: "right", render: (c) => <span className={`mtb-num ${c.gainValue - c.lossValue < 0 ? "text-status-overdue-ink" : ""}`}>{formatRs(c.gainValue - c.lossValue, { sign: "always" })}</span> },
    { key: "by", header: "Approved by", render: (c) => (c.decidedBy ? <span className="text-small">{c.decidedBy}</span> : <span className="text-ink-subtle">—</span>) },
  ];
  return (
    <WarehouseShell
      title="Stock count"
      actions={
        canManage && ctx.campus !== "ALL" ? (
          <Button variant="primary" icon="checkSquare" onClick={() => setStarting(true)}>
            Start a count
          </Button>
        ) : undefined
      }
    >
      <Banner tone="info" icon="info" title="Counts correct the stock, with a second pair of eyes">
        Count the shelf, give a reason for every difference and submit. The principal or an admin approves it, and only then is an adjustment posted to the stock ledger. Nobody can overwrite a stock figure directly.
      </Banner>
      {q.isError && <LoadError what="Stock counts" error={q.error} onRetry={() => void q.refetch()} />}
      <DataTable
        caption="Warehouse stock counts"
        rows={q.data ?? []}
        loading={q.isLoading}
        columns={columns}
        onRowClick={(c) => void navigate({ to: "/warehouse/counts/$countId", params: { countId: c.id } } as never)}
        empty={<EmptyState icon="checkSquare" title="No counts this session" description="Start one for a category, or for the whole store." />}
      />
      <CampusNote />
      {starting && (
        <RequireSingleCampusOverlay onClose={() => setStarting(false)}>
          <StartCount onClose={() => setStarting(false)} />
        </RequireSingleCampusOverlay>
      )}
    </WarehouseShell>
  );
}

function CountSheet({ c, campus, blind }: { c: WarehouseCount; campus: string; blind: boolean }) {
  return (
    <div className="ops-doc">
      <DocHead title={`Count sheet ${c.no}: ${c.name}`} subtitle={`${c.category} · started ${formatDate(c.startedOn)} by ${c.startedBy}`} campus={campus} />
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Item</th>
            <th>Unit</th>
            {!blind && <th className="n">In the system</th>}
            <th className="n">Counted</th>
            {!blind && <th className="n">Difference</th>}
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {c.lines.map((l) => (
            <tr key={l.itemId}>
              <td>{l.code}</td>
              <td>{l.itemName}</td>
              <td>{l.unit}</td>
              {!blind && <td className="n">{l.systemQty}</td>}
              <td className="n">{blind ? "" : (l.countedQty ?? "")}</td>
              {!blind && <td className="n">{l.countedQty === null ? "" : l.difference > 0 ? `+${l.difference}` : l.difference}</td>}
              <td>{blind ? "" : l.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ops-doc-sign">
        <div>Counted by</div>
        <div>Store keeper</div>
        <div>Approved by</div>
      </div>
    </div>
  );
}

interface Draft {
  counted: string;
  reason: string;
}

export function WhCountPage({ countId }: { countId: string }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const user = useSessionUser();
  const readOnly = useReadOnly();
  const canManage = useCan("warehouse.manage") && !readOnly;
  const canApprove = useCan("approvals.decide") && !readOnly;
  const q = useQuery(warehouseQueries.count(ctx, countId));
  const c = q.data;
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [showSystem, setShowSystem] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deciding, setDeciding] = useState<"APPROVE" | "REJECT" | null>(null);
  const [note, setNote] = useState("");
  const [noteErr, setNoteErr] = useState<string | undefined>();
  const printer = usePrinter();
  useEffect(() => {
    if (c) setDraft(Object.fromEntries(c.lines.map((l) => [l.itemId, { counted: l.countedQty === null ? "" : String(l.countedQty), reason: l.reason }])));
  }, [c?.id, c?.status]);
  const editable = Boolean(c && canManage && (c.status === "COUNTING" || c.status === "REJECTED"));
  const payload = () => (c?.lines ?? []).map((l) => ({ itemId: l.itemId, countedQty: draft[l.itemId]?.counted === "" || draft[l.itemId] === undefined ? null : Number(draft[l.itemId]!.counted), reason: draft[l.itemId]?.reason ?? "" }));
  const refresh = (next: WarehouseCount) => {
    qc.setQueryData(warehouseQueries.count(ctx, countId).queryKey, next);
    void qc.invalidateQueries({ queryKey: ["warehouse"] });
  };
  const save = useMutation({ mutationFn: () => warehouseApi.saveCountLines(ctx, countId, payload()), onSuccess: (n) => { refresh(n); toast({ title: "Count saved", message: `${n.counted} of ${n.lines.length} items counted.` }); } });
  const submit = useMutation({
    mutationFn: async () => {
      await warehouseApi.saveCountLines(ctx, countId, payload());
      return warehouseApi.submitCount(ctx, countId);
    },
    onSuccess: (n) => {
      refresh(n);
      toast({ title: `${n.no} sent for approval`, message: "The principal or an admin approves it; the stock changes only then." });
    },
  });
  const decide = useMutation({
    mutationFn: (decision: "APPROVE" | "REJECT") => warehouseApi.decideCount(ctx, countId, { decision, note }),
    onSuccess: (n) => {
      refresh(n);
      setDeciding(null);
      toast({ title: n.status === "APPROVED" ? `${n.no} approved` : `${n.no} sent back`, message: n.status === "APPROVED" ? `${n.differences} adjustments posted to the stock ledger.` : "The counter can check and submit again." });
    },
  });

  if (q.isError) return <WarehouseShell title="Stock count"><LoadError what="This count" error={q.error} onRetry={() => void q.refetch()} /></WarehouseShell>;
  if (!c) return <WarehouseShell title="Stock count"><Skeleton height={360} /></WarehouseShell>;

  const lineOf = (l: WarehouseCountLine) => {
    const d = draft[l.itemId];
    const counted = d && d.counted !== "" ? Number(d.counted) : null;
    return { counted, diff: counted === null ? 0 : counted - l.systemQty };
  };
  const counted = c.lines.filter((l) => lineOf(l).counted !== null).length;
  const diffs = c.lines.filter((l) => lineOf(l).diff !== 0);
  const net = c.lines.reduce((a, l) => a + lineOf(l).diff * l.unitCost, 0);
  const validateAll = () => {
    const e: Record<string, string> = {};
    for (const l of c.lines) {
      const d = draft[l.itemId];
      if (!d || d.counted === "") e[l.itemId] = "Enter the count (0 if none).";
      else if (!/^\d+$/.test(d.counted)) e[l.itemId] = "A whole number.";
      else if (Number(d.counted) !== l.systemQty && d.reason.trim().length < 3) e[`${l.itemId}.reason`] = "Say why it differs.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const isSubmitter = c.submittedBy === user?.name;
  const visibleSystem = showSystem || !editable;

  const columns: Array<Column<WarehouseCountLine>> = [
    { key: "item", header: "Item", render: (l) => <span className="grid"><span className="font-medium">{l.itemName}</span><span className="text-small text-ink-muted">{l.code} · {l.unit}</span></span> },
    ...(visibleSystem ? [{ key: "sys", header: "In the system", align: "right" as const, render: (l: WarehouseCountLine) => <span className="mtb-num text-ink-muted">{formatCount(l.systemQty)}</span> }] : []),
    {
      key: "counted",
      header: "Counted",
      align: "right",
      width: 130,
      render: (l) =>
        editable ? (
          <Input aria-label={`Counted ${l.itemName}`} inputMode="numeric" value={draft[l.itemId]?.counted ?? ""} onChange={(e) => setDraft({ ...draft, [l.itemId]: { counted: e.target.value.replace(/\D/g, ""), reason: draft[l.itemId]?.reason ?? "" } })} error={errors[l.itemId]} inputClassName="text-right" />
        ) : (
          <span className="mtb-num font-medium">{l.countedQty ?? "—"}</span>
        ),
    },
    ...(visibleSystem
      ? [
          {
            key: "diff",
            header: "Difference",
            align: "right" as const,
            render: (l: WarehouseCountLine) => {
              const { diff, counted: n } = lineOf(l);
              return n === null ? <span className="text-ink-subtle">—</span> : <span className={`mtb-num font-medium ${diff < 0 ? "text-status-overdue-ink" : diff > 0 ? "text-status-paid-ink" : "text-ink-muted"}`}>{diff > 0 ? `+${diff}` : diff === 0 ? "0" : `−${-diff}`}</span>;
            },
          },
        ]
      : []),
    {
      key: "reason",
      header: "Reason for a difference",
      render: (l) =>
        editable ? (
          <Input aria-label={`Reason for ${l.itemName}`} value={draft[l.itemId]?.reason ?? ""} onChange={(e) => setDraft({ ...draft, [l.itemId]: { counted: draft[l.itemId]?.counted ?? "", reason: e.target.value } })} error={errors[`${l.itemId}.reason`]} placeholder={lineOf(l).diff !== 0 ? "Broken, dried out, found elsewhere…" : ""} />
        ) : (
          <span className="text-small">{l.reason || <span className="text-ink-subtle">—</span>}</span>
        ),
    },
    ...(visibleSystem ? [{ key: "value", header: "Value", align: "right" as const, render: (l: WarehouseCountLine) => (lineOf(l).diff ? <span className="mtb-num">{formatRs(lineOf(l).diff * l.unitCost, { sign: "always" })}</span> : "") }] : []),
  ];

  return (
    <WarehouseShell
      title={c.name}
      context={`${campusLabel(c.campus)} · Session ${formatSession(ctx.session)} · ${c.no} · ${c.category} · started ${formatDate(c.startedOn)} by ${c.startedBy}`}
      meta={<CountStatusBadge status={c.status} />}
      actions={
        <>
          <Button icon="printer" onClick={() => printer.print(<CountSheet c={c} campus={campusLabel(c.campus)} blind={c.status === "COUNTING" && c.counted === 0} />)}>
            {c.status === "COUNTING" && c.counted === 0 ? "Print blank count sheet" : "Print count sheet"}
          </Button>
          {editable && (
            <>
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
              <Button variant="primary" icon="send" loading={submit.isPending} onClick={() => validateAll() && submit.mutate()}>
                Submit for approval
              </Button>
            </>
          )}
          {c.status === "SUBMITTED" && canApprove && !isSubmitter && (
            <>
              <Button variant="danger-quiet" onClick={() => setDeciding("REJECT")}>
                Send back
              </Button>
              <Button variant="primary" icon="check" onClick={() => setDeciding("APPROVE")}>
                Approve and post
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Items", value: c.lines.length, icon: "layers" as const, foot: c.category },
          { label: "Counted", value: counted, icon: "checkSquare" as const, foot: `${Math.round((counted / Math.max(1, c.lines.length)) * 100)}% done` },
          { label: "Differences", value: diffs.length, icon: "alert" as const, tone: diffs.length ? ("warning" as const) : undefined, foot: visibleSystem ? "Against the system figure" : "Shown after counting" },
          { label: "Net value", value: net, icon: "fees" as const, money: true, foot: visibleSystem ? `${formatRs(c.gainValue)} found · ${formatRs(c.lossValue)} short` : "Shown after counting" },
        ].map((k, i) => (
          <div key={k.label} className="mtb-rise" style={slide(i)}>
            <StatCard label={k.label} icon={k.icon} tone={k.tone} value={k.money ? (visibleSystem ? <AnimatedNumber value={k.value} format={(v) => formatRs(v, { sign: "always" })} /> : "—") : <AnimatedNumber value={k.value} format={formatCount} />} foot={k.foot} />
          </div>
        ))}
      </div>

      {c.status === "SUBMITTED" && (
        <Banner tone="warning" icon="clock" title={`Submitted by ${c.submittedBy} on ${c.submittedAt ? formatDateTime(c.submittedAt) : ""}`}>
          {isSubmitter ? "Another person (the principal or an admin) must approve it. Nothing has changed in the stock yet." : canApprove ? "Check the differences and their reasons, then approve to post the adjustment, or send it back." : "Waiting for the principal or an admin to approve. Nothing has changed in the stock yet."}
        </Banner>
      )}
      {c.status === "APPROVED" && (
        <Banner tone="success" icon="checkCircle" title={`Approved by ${c.decidedBy} on ${c.decidedAt ? formatDateTime(c.decidedAt) : ""}`}>
          {c.differences} adjustments were posted to the stock ledger as {c.no}. {c.decisionNote}
        </Banner>
      )}
      {c.status === "REJECTED" && (
        <Banner tone="danger" icon="refresh" title={`Sent back by ${c.decidedBy}`}>
          {c.decisionNote} Recount the items and submit again.
        </Banner>
      )}

      <Panel
        id="count-sheet"
        rise={1}
        title="Count sheet"
        description={editable ? "Enter what is physically on the shelf. The system figure is hidden by default so it doesn't steer the count." : "What was counted and why it differs."}
        actions={editable ? <Switch label="Show the system figure" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} /> : undefined}
        flush
      >
        <DataTable caption="Count sheet" rowKey="itemId" rows={c.lines} columns={columns} density="dense" empty={<EmptyState title="No items" />} />
      </Panel>
      {(save.isError || submit.isError) && <Banner tone="danger">{errorText(save.error ?? submit.error)}</Banner>}

      <Modal
        open={deciding !== null}
        onClose={() => setDeciding(null)}
        title={deciding === "APPROVE" ? `Approve ${c.no} and post the adjustment?` : `Send ${c.no} back?`}
        description={deciding === "APPROVE" ? `${c.differences} items change: ${formatRs(c.gainValue)} found and ${formatRs(c.lossValue)} short at average cost. This posts to the stock ledger and can't be undone.` : "The counter sees your note and counts again."}
        footer={
          <>
            <Button onClick={() => setDeciding(null)}>Cancel</Button>
            <Button
              variant={deciding === "APPROVE" ? "primary" : "danger"}
              loading={decide.isPending}
              onClick={() => {
                if (deciding === "REJECT" && note.trim().length < 5) return setNoteErr("Say what needs checking again.");
                setNoteErr(undefined);
                decide.mutate(deciding!);
              }}
            >
              {deciding === "APPROVE" ? "Approve and post" : "Send back"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Textarea label={deciding === "APPROVE" ? "Note (optional)" : "What needs checking"} rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={noteErr} />
          {decide.isError && <Banner tone="danger">{errorText(decide.error)}</Banner>}
        </div>
      </Modal>
      {printer.element}
    </WarehouseShell>
  );
}
