import { LIBRARY_COUNT_RESULT_LABEL, libraryApi, libraryQueries, type LibraryCountDetail, type LibraryCountResult, type LibraryCountRow, type LibraryCountSummary } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatSession } from "@mtb/domain";
import {
  AnimatedNumber,
  Banner,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  IconButton,
  Input,
  Modal,
  Panel,
  Segmented,
  Select,
  Skeleton,
  StatCard,
  StatusBadge,
  Textarea,
  useToast,
  type Column,
  type Status,
} from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { RequireSingleCampus } from "../../app/shell/page";
import { DocHead, errorText, LoadError, slide, Spine, TODAY, usePrinter } from "./common";
import { LibraryShell } from "./shared";

const RESULT_TONE: Record<LibraryCountResult, Status> = { FOUND: "paid", MISSING: "overdue", WRONG_SHELF: "warning", ON_LOAN_FOUND: "info", WRITTEN_OFF_FOUND: "info", UNKNOWN: "late", ON_LOAN: "neutral" };

function StartCount({ onClose }: { onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setup = useQuery(libraryQueries.setup(ctx));
  const [name, setName] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => libraryApi.startCount(ctx, { name, cabinetIds: ids }),
    onSuccess: (d) => {
      toast({ title: `Count started: ${d.name}`, message: `${d.expected} copies are expected on the shelves.` });
      void qc.invalidateQueries({ queryKey: ["library"] });
      void navigate({ to: "/library/counts/$countId", params: { countId: d.id } } as never);
    },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 3) e.name = 'Give the count a name, for example "Urdu cabinet, November".';
    if (ids.length === 0) e.cabinets = "Choose at least one cabinet.";
    setErrors(e);
    if (!Object.keys(e).length) m.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Start a stock count"
      description="Count one or more cabinets. Copies out on loan are not expected on the shelf."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="play" loading={m.isPending} onClick={submit}>
            Start counting
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="Urdu cabinet, November check" />
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mtb-label">Cabinets</legend>
          {(setup.data?.cabinets ?? []).map((c) => (
            <Checkbox key={c.id} label={`${c.code} · ${c.title} (${c.copies} copies)`} checked={ids.includes(c.id)} onChange={(e) => setIds((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))} />
          ))}
          {errors.cabinets && <span className="mtb-error">{errors.cabinets}</span>}
        </fieldset>
        {m.isError && <Banner tone="danger">{errorText(m.error)}</Banner>}
      </div>
    </Modal>
  );
}

export function CountsPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const canManage = useCan("library.manage") && !readOnly && ctx.campus !== "ALL";
  const q = useQuery(libraryQueries.counts(ctx));
  const [starting, setStarting] = useState(false);
  const columns: Array<Column<LibraryCountSummary>> = [
    { key: "name", header: "Count", render: (c) => <span className="grid"><span className="font-medium">{c.name}</span><span className="text-small text-ink-muted">Cabinets {c.cabinets}{ctx.campus === "ALL" ? ` · ${campusLabel(c.campus)}` : ""}</span></span> },
    { key: "started", header: "Started", render: (c) => <span className="grid"><span className="mtb-num">{formatDate(c.startedOn)}</span><span className="text-small text-ink-muted">{c.startedBy}</span></span> },
    { key: "status", header: "Status", render: (c) => (c.status === "OPEN" ? <StatusBadge status="pending">Counting</StatusBadge> : <StatusBadge status="declared" icon="lock">Closed {c.closedOn ? formatDate(c.closedOn) : ""}</StatusBadge>) },
    { key: "scanned", header: "Scanned", align: "right", render: (c) => <span className="mtb-num">{c.scanned} of {c.expected}</span> },
    { key: "missing", header: "Not found", align: "right", render: (c) => <span className={`mtb-num ${c.missing ? "text-status-overdue-ink font-medium" : ""}`}>{c.missing}</span> },
    { key: "disc", header: "To correct", align: "right", render: (c) => <span className="mtb-num">{c.discrepancies}</span> },
  ];
  return (
    <LibraryShell
      title="Stock count"
      actions={
        canManage ? (
          <Button variant="primary" icon="checkSquare" onClick={() => setStarting(true)}>
            Start a count
          </Button>
        ) : undefined
      }
    >
      <Banner tone="info" icon="info" title="How a count works">
        Scan every copy on a shelf. The count lists what is missing, what sits on the wrong shelf and what the records show on loan but is actually on the shelf. Closing it corrects the catalogue in one step.
      </Banner>
      {q.isError && <LoadError what="Stock counts" error={q.error} onRetry={() => void q.refetch()} />}
      <DataTable
        caption="Library stock counts"
        rows={q.data ?? []}
        loading={q.isLoading}
        columns={columns}
        onRowClick={(c) => void navigate({ to: "/library/counts/$countId", params: { countId: c.id } } as never)}
        empty={<EmptyState icon="checkSquare" title="No counts this session" description="Start one for a cabinet; it takes a few minutes per shelf." />}
      />
      {starting && <StartCount onClose={() => setStarting(false)} />}
    </LibraryShell>
  );
}

function Discrepancies({ d, campus }: { d: LibraryCountDetail; campus: string }) {
  const rows = d.rows.filter((r) => r.result !== "FOUND" && r.result !== "ON_LOAN");
  return (
    <div className="ops-doc">
      <DocHead title={`Stock count: ${d.name}`} subtitle={`Cabinets ${d.cabinets} · started ${formatDate(d.startedOn)} by ${d.startedBy} · ${d.scanned} scanned of ${d.expected} expected`} campus={campus} />
      <table>
        <thead>
          <tr>
            <th>Accession</th>
            <th>Title</th>
            <th>Recorded shelf</th>
            <th>Found on</th>
            <th>Finding</th>
            <th>Correction</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.accessionNo}>
              <td>{r.accessionNo}</td>
              <td>{r.title || "—"}</td>
              <td>{r.recordedShelf || "—"}</td>
              <td>{r.scannedShelf || "—"}</td>
              <td>{LIBRARY_COUNT_RESULT_LABEL[r.result]}</td>
              <td>{r.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ops-doc-sign">
        <div>Counted by</div>
        <div>Checked by</div>
        <div>Principal</div>
      </div>
    </div>
  );
}

export function CountPage({ countId }: { countId: string }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const canManage = useCan("library.manage") && !readOnly;
  const q = useQuery(libraryQueries.count(ctx, countId));
  const d = q.data;
  const [shelfId, setShelfId] = useState("");
  const [typed, setTyped] = useState("");
  const [bulk, setBulk] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [view, setView] = useState("issues");
  const [closing, setClosing] = useState(false);
  const [flash, setFlash] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const printer = usePrinter();
  const shelf = shelfId || d?.shelves[0]?.id || "";
  const set = (next: LibraryCountDetail) => qc.setQueryData(libraryQueries.count(ctx, countId).queryKey, next);
  const scan = useMutation({
    mutationFn: (nos: string[]) => libraryApi.scan(ctx, countId, { accessionNos: nos, shelfId: shelf }),
    onSuccess: (next, nos) => {
      set(next);
      setFlash(nos[nos.length - 1] ?? "");
      setTyped("");
      setBulk("");
      setShowBulk(false);
      input.current?.focus();
    },
  });
  const unscan = useMutation({ mutationFn: (no: string) => libraryApi.unscan(ctx, countId, no), onSuccess: set });
  const close = useMutation({
    mutationFn: () => libraryApi.closeCount(ctx, countId),
    onSuccess: (next) => {
      set(next);
      setClosing(false);
      void qc.invalidateQueries({ queryKey: ["library"] });
      toast({ title: "Count closed and the catalogue corrected", message: next.applied.join(" ") });
    },
  });

  if (q.isError) return <LibraryShell title="Stock count"><LoadError what="This count" error={q.error} onRetry={() => void q.refetch()} /></LibraryShell>;
  if (!d) return <LibraryShell title="Stock count"><Skeleton height={320} /></LibraryShell>;

  const open = d.status === "OPEN";
  const rows = view === "issues" ? d.rows.filter((r) => r.result !== "FOUND" && r.result !== "ON_LOAN") : d.rows;
  const pct = d.expected ? Math.min(100, Math.round((d.found / d.expected) * 100)) : 0;
  const columns: Array<Column<LibraryCountRow>> = [
    { key: "acc", header: "Accession", render: (r) => <Spine>{r.accessionNo}</Spine> },
    { key: "title", header: "Title", render: (r) => r.title || <span className="text-ink-subtle">Not in the catalogue</span> },
    { key: "rec", header: "Recorded shelf", render: (r) => r.recordedShelf || "—" },
    { key: "found", header: "Found on", render: (r) => r.scannedShelf || "—" },
    { key: "res", header: "Finding", render: (r) => <StatusBadge status={RESULT_TONE[r.result]}>{LIBRARY_COUNT_RESULT_LABEL[r.result]}</StatusBadge> },
    { key: "act", header: open ? "When closed" : "Correction", render: (r) => <span className="text-small">{r.action}</span> },
  ];

  return (
    <LibraryShell
      title={d.name}
      context={`${campusLabel(d.campus)} · Session ${formatSession(ctx.session)} · Cabinets ${d.cabinets} · started ${formatDate(d.startedOn)} by ${d.startedBy}`}
      meta={open ? <StatusBadge status="pending">Counting</StatusBadge> : <StatusBadge status="declared" icon="lock">Closed {d.closedOn ? formatDate(d.closedOn) : ""} by {d.closedBy}</StatusBadge>}
      actions={
        <>
          <Button icon="printer" onClick={() => printer.print(<Discrepancies d={d} campus={campusLabel(d.campus)} />)}>
            Print findings
          </Button>
          {open && canManage && (
            <Button variant="primary" icon="lock" disabled={d.scanned === 0} onClick={() => setClosing(true)}>
              Close and correct records
            </Button>
          )}
        </>
      }
    >
      <RequireSingleCampus action="a stock count">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Expected on the shelves", value: d.expected, icon: "book" as const, foot: "Copies not out on loan" },
            { label: "Found", value: d.found, icon: "checkCircle" as const, foot: `${pct}% of expected`, meter: pct },
            { label: "Not found yet", value: d.missing, icon: "alert" as const, tone: d.missing ? ("warning" as const) : undefined, foot: open ? "Keep scanning" : "Marked as missing" },
            { label: "To correct", value: d.discrepancies, icon: "edit" as const, foot: "Missing, wrong shelf, wrong status" },
          ].map((k, i) => (
            <div key={k.label} className="mtb-rise" style={slide(i)}>
              <StatCard label={k.label} icon={k.icon} tone={k.tone} value={<AnimatedNumber value={k.value} format={formatCount} />} foot={k.foot} {...(k.meter !== undefined ? { meter: k.meter, meterLabel: `${k.meter}% found` } : {})} />
            </div>
          ))}
        </div>

        {!open && d.applied.length > 0 && (
          <Banner tone="success" icon="checkCircle" title="Corrections made when the count was closed">
            <ul className="m-0 grid gap-1 pl-4">
              {d.applied.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </Banner>
        )}

        {open && canManage && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Panel id="count-scan" rise={1} title="Scan the shelf" description="Choose the shelf in front of you, then scan or type each accession number and press Enter.">
              <form
                className="grid gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const nos = showBulk ? bulk.split(/[\s,]+/).filter(Boolean) : [typed.trim()].filter(Boolean);
                  if (nos.length) scan.mutate(nos);
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select label="Shelf" value={shelf} onChange={(e) => setShelfId(e.target.value)} options={d.shelves.map((s) => ({ value: s.id, label: `${s.fullLabel} (${s.copies} on record)` }))} />
                  {!showBulk && <Input ref={input} label="Accession number" mono icon="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="KC-L-14063 or 14063" autoFocus />}
                </div>
                {showBulk && <Textarea label="Many accession numbers" rows={4} value={bulk} onChange={(e) => setBulk(e.target.value)} help="Paste from a scanner file: one per line, or separated by commas." />}
                {scan.isError && <Banner tone="danger">{errorText(scan.error)}</Banner>}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="primary" icon="plus" loading={scan.isPending}>
                    {showBulk ? "Add all" : "Add"}
                  </Button>
                  <Button variant="quiet" onClick={() => setShowBulk((x) => !x)}>
                    {showBulk ? "Scan one at a time" : "Paste many at once"}
                  </Button>
                </div>
              </form>
            </Panel>
            <Panel id="count-recent" rise={2} title="Scanned so far" description={`${d.scanned} copies. Remove one scanned by mistake.`} flush>
              {d.scans.length === 0 ? (
                <EmptyState icon="checkSquare" title="Nothing scanned yet" />
              ) : (
                <ul className="m-0 max-h-[300px] list-none overflow-y-auto p-0">
                  {d.scans.slice(0, 40).map((s) => (
                    <li key={s.accessionNo} className={`flex items-center gap-3 border-b border-border px-5 py-2 last:border-b-0 ${s.accessionNo === flash ? "ops-scan-flash" : ""}`}>
                      <Spine>{s.accessionNo}</Spine>
                      <span className="flex-1 text-small text-ink-muted">
                        {s.shelfLabel} · {formatDateTime(s.at).split(", ")[1] ?? ""}
                      </span>
                      <IconButton icon="x" label={`Remove ${s.accessionNo}`} size="sm" onClick={() => unscan.mutate(s.accessionNo)} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )}

        <Panel
          id="count-results"
          rise={3}
          title={open ? "What the count shows so far" : "Findings"}
          description={open ? "Nothing changes in the catalogue until the count is closed." : `Closed on ${d.closedOn ? formatDate(d.closedOn) : TODAY}.`}
          actions={
            <Segmented
              aria-label="Rows to show"
              value={view}
              onChange={setView}
              options={[
                { value: "issues", label: `To correct (${d.discrepancies})` },
                { value: "all", label: `Every copy (${d.rows.length})` },
              ]}
            />
          }
          flush
        >
          <DataTable caption="Stock count findings" rowKey="accessionNo" rows={rows} columns={columns} density="dense" empty={<EmptyState icon="checkCircle" title={view === "issues" ? "Nothing to correct" : "Nothing scanned yet"} description={view === "issues" ? "Every copy scanned is where the catalogue says." : undefined} />} />
        </Panel>
      </RequireSingleCampus>

      <ConfirmDialog
        open={closing}
        onClose={() => setClosing(false)}
        onConfirm={() => close.mutate()}
        tone="warning"
        title="Close the count and correct the catalogue?"
        message={`${d.missing} copies not found will be marked missing, and ${d.discrepancies - d.missing} other findings corrected. A closed count can't be scanned again.`}
        details={[
          ["Expected", formatCount(d.expected)],
          ["Scanned", formatCount(d.scanned)],
          ["Not found", formatCount(d.missing)],
        ]}
        requireText="CLOSE"
        confirmLabel="Close and correct"
        loading={close.isPending}
        loadingLabel="Correcting…"
        error={close.isError ? errorText(close.error) : undefined}
      />
      {printer.element}
    </LibraryShell>
  );
}
