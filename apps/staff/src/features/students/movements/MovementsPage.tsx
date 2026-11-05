import { metaQueries, STUDENT_MOVEMENT_LABEL, studentMovementsQueries, studentsQueries, type StudentMovement, type StudentMovementKind, type StudentMovementsFilter } from "@mtb/api";
import { formatCount, formatDate, formatSession } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, buttonClassName, DataTable, DatePicker, EmptyState, Input, KeyValue, Money, Segmented, Select, SidePanel, StatCard, StatusBadge, type Column, type Status } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Page, PageHeader, RequirePermission } from "../../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../../app/session";
import { PrintSheet, printNow } from "../documents/print";
import { StatusNotice } from "../documents/templates";
import { EnrolmentBadge, LoadError, stagger, StudentsSubNav, today } from "../shared";
import { StatusChangePanel } from "./StatusChangePanel";

const KIND_TONE: Record<StudentMovementKind, Status> = { LEFT: "neutral", STRUCK_OFF: "warning", EXPELLED: "danger", RESTORED: "success", TRANSFER: "info", PASSED_OUT: "info" };

export function KindBadge({ kind }: { kind: StudentMovementKind }) {
  return <StatusBadge status={KIND_TONE[kind]}>{STUDENT_MOVEMENT_LABEL[kind]}</StatusBadge>;
}

function MovementPanel({ m, open, onClose, onRestore }: { m: StudentMovement | null; open: boolean; onClose: () => void; onRestore: (grNo: string) => void }) {
  const profile = useQuery({ ...studentsQueries.profile(m?.grNo ?? ""), enabled: open && Boolean(m) });
  const canEdit = useCan("students.edit");
  const readOnly = useReadOnly();
  if (!m) return null;
  const p = profile.data;
  const notice = m.kind === "STRUCK_OFF" || m.kind === "EXPELLED";
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      wide={notice}
      title={`${STUDENT_MOVEMENT_LABEL[m.kind]} · ${m.name}`}
      description={`${m.grNo} · ${m.classSection} · ${m.campusName}`}
      footer={
        <>
          <Link to="/students/$grNo" params={{ grNo: m.grNo }} className={buttonClassName({ variant: "secondary" })}>
            Open student record
          </Link>
          {notice && (
            <Button icon="printer" onClick={printNow}>
              Print notice
            </Button>
          )}
          {canEdit && !readOnly && p && (p.status === "STRUCK_OFF" || p.status === "LEFT") && p.statusNote?.on === m.date && (
            <Button variant="primary" icon="refresh" onClick={() => onRestore(m.grNo)}>
              Restore to class
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-5">
        <KeyValue
          items={[
            ["Change", <KindBadge kind={m.kind} />],
            ["Effective", <span className="tabular-nums">{formatDate(m.date)}</span>],
            ["Reason", m.reason],
            ...(m.remarks ? ([["Remarks", m.remarks]] as Array<[string, string]>) : []),
            ...(m.toCampusName ? ([["Moved to", `${m.toCampusName} · ${m.toClassSection}`]] as Array<[string, string]>) : []),
            ["Recorded by", m.by],
            ...(m.approvedBy ? ([["Approved by", m.approvedBy]] as Array<[string, string]>) : []),
            ["Dues at the time", <Money value={m.balanceAtTime} />],
            ["Status now", p ? <EnrolmentBadge status={p.status} /> : "…"],
          ]}
        />
        {notice && (
          <div className="grid gap-2">
            <span className="mtb-label">Notice to parents</span>
            <PrintSheet paper="A5" label="Notice to parents" zoom={0.6}>
              <StatusNotice m={m} {...(p ? { mobile: p.guardian.mobile } : {})} />
            </PrintSheet>
          </div>
        )}
      </div>
    </SidePanel>
  );
}

/** Everyone who left, was struck off, expelled, restored or moved campus this session, with reasons and dues. */
export function MovementsPage({ kind, setKind }: { kind: StudentMovementKind | ""; setKind: (k: StudentMovementKind | "") => void }) {
  const ctx = useCtx();
  const canEdit = useCan("students.edit");
  const readOnly = useReadOnly();
  const classes = useQuery(metaQueries.classes(ctx.campus));
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [cls, setCls] = useState("");
  const sessionStart = `${ctx.session}-04-01`;
  const sessionEnd = `${ctx.session + 1}-03-31` < today() ? `${ctx.session + 1}-03-31` : today();
  const rangeError = from && to && from > to ? "The first date must be on or before the second." : undefined;
  const filter: StudentMovementsFilter = rangeError ? {} : { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(cls ? { className: cls } : {}) };
  const list = useQuery(studentMovementsQueries.list(ctx, kind, filter));
  const [q, setQ] = useState("");
  // The same records as the report "Students who left or were expelled", which prints and exports them.
  const reportKind = kind === "LEFT" || kind === "STRUCK_OFF" || kind === "EXPELLED" || kind === "PASSED_OUT" ? kind : "";
  const reportFilters = { range: `${from ?? sessionStart}|${to ?? sessionEnd}`, status: reportKind, class: cls };
  const [open, setOpen] = useState<StudentMovement | null>(null);
  const [recording, setRecording] = useState<{ grNo?: string; kind?: "RESTORED" } | null>(null);
  const d = list.data;
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (d?.items ?? []).filter((m) => !n || m.name.toLowerCase().includes(n) || m.grNo.toLowerCase().includes(n) || m.reason.toLowerCase().includes(n));
  }, [d, q]);

  const columns: Array<Column<StudentMovement>> = [
    { key: "date", header: "Date", width: 120, render: (m) => <span className="tabular-nums">{formatDate(m.date)}</span> },
    {
      key: "name",
      header: "Student",
      render: (m) => (
        <span className="grid">
          <span className="mtb-cell-primary">{m.name}</span>
          <span className="mtb-cell-secondary">
            <span className="mtb-mono">{m.grNo}</span> · {m.classSection}
            {ctx.campus === "ALL" ? ` · ${m.campusName}` : ""}
          </span>
        </span>
      ),
    },
    { key: "kind", header: "Change", width: 150, render: (m) => <KindBadge kind={m.kind} /> },
    { key: "reason", header: "Reason", render: (m) => (m.kind === "TRANSFER" ? `${m.reason} · to ${m.toCampusName} ${m.toClassSection}` : m.reason) },
    { key: "by", header: "Recorded by", width: 200, render: (m) => <span className="text-small">{m.by}{m.approvedBy ? <span className="text-ink-muted"> · approved by {m.approvedBy}</span> : null}</span> },
    { key: "balanceAtTime", header: "Dues then", align: "right", width: 120, render: (m) => <Money value={m.balanceAtTime} /> },
  ];

  return (
    <RequirePermission permission="students.view" page="Leaving and transfers">
      <Page>
        <PageHeader
          title="Leaving & transfers"
          actions={
            <>
              <Link
                to="/reports/$reportId"
                params={{ reportId: "students-left" }}
                search={(prev: Record<string, unknown>) => ({ ...prev, kind: undefined, f: reportFilters }) as never}
                className={buttonClassName({ variant: "secondary" })}
                title="Print or export these leavers, with father, contact, recorded by and approved by"
              >
                Open as report
              </Link>
              {canEdit && !readOnly && (
                <Button variant="primary" icon="plus" onClick={() => setRecording({})}>
                  Record a change
                </Button>
              )}
            </>
          }
        />
        <StudentsSubNav />
        {list.isError && <LoadError what="list of changes" error={list.error} onRetry={() => void list.refetch()} />}
        {readOnly && <Banner tone="info">{`Session ${formatSession(ctx.session)} is closed. This is its record of leavers and transfers.`}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="mtb-rise" style={stagger(1)}>
            <StatCard label="Left this session" icon="logout" loading={!d} value={d ? <AnimatedNumber value={d.counts.LEFT + d.counts.PASSED_OUT} format={formatCount} /> : undefined} foot={d ? `${d.counts.PASSED_OUT} passed out after Class 10` : undefined} onClick={() => setKind("LEFT")} />
          </div>
          <div className="mtb-rise" style={stagger(2)}>
            <StatCard label="Struck off now" icon="ban" tone="warning" loading={!d} value={d ? <AnimatedNumber value={d.struckOffNow} format={formatCount} /> : undefined} foot={d ? `${d.counts.RESTORED} restored this session` : undefined} onClick={() => setKind("STRUCK_OFF")} />
          </div>
          <div className="mtb-rise" style={stagger(3)}>
            <StatCard label="Expelled" icon="ban" tone="danger" loading={!d} value={d ? <AnimatedNumber value={d.counts.EXPELLED} format={formatCount} /> : undefined} foot="principal's decisions" onClick={() => setKind("EXPELLED")} />
          </div>
          <div className="mtb-rise" style={stagger(4)}>
            <StatCard label="Campus transfers" icon="building" tone="info" loading={!d} value={d ? <AnimatedNumber value={d.counts.TRANSFER} format={formatCount} /> : undefined} foot="history and G.R. number kept" onClick={() => setKind("TRANSFER")} />
          </div>
        </div>
        <DataTable
          caption="Leaving and transfers"
          columns={columns}
          rows={rows}
          loading={list.isLoading}
          onRowClick={setOpen}
          empty={<EmptyState icon="logout" title={kind ? `No ${STUDENT_MOVEMENT_LABEL[kind].toLowerCase()} records this session` : "No changes this session"} description="Leavers, struck-off students, expulsions, restorations and campus transfers appear here with the reason and the dues at the time." />}
          toolbar={
            <div className="flex w-full flex-wrap items-end gap-3">
              <Segmented
                aria-label="Change"
                value={kind}
                onChange={(v) => setKind(v as StudentMovementKind | "")}
                options={[{ value: "", label: "All" }, ...(["LEFT", "STRUCK_OFF", "EXPELLED", "RESTORED", "TRANSFER", "PASSED_OUT"] as StudentMovementKind[]).map((k) => ({ value: k, label: `${STUDENT_MOVEMENT_LABEL[k]}${d ? ` · ${d.counts[k]}` : ""}` }))]}
              />
              <div className="min-w-56 flex-1">
                <Input label="Search" icon="search" placeholder="Name, G.R. or reason" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="w-40">
                <DatePicker label="From" value={from} onValueChange={setFrom} today={today()} minDate={sessionStart} maxDate={sessionEnd} error={rangeError} />
              </div>
              <div className="w-40">
                <DatePicker label="To" value={to} onValueChange={setTo} today={today()} minDate={sessionStart} maxDate={sessionEnd} />
              </div>
              <Select label="Class" value={cls} onChange={(e) => setCls(e.target.value)} options={[{ value: "", label: "All classes" }, ...(classes.data ?? []).map((c) => ({ value: c.short, label: c.name }))]} />
              {(from || to || cls) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setFrom(null);
                    setTo(null);
                    setCls("");
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          }
        />
        <MovementPanel
          m={open}
          open={open !== null}
          onClose={() => setOpen(null)}
          onRestore={(grNo) => {
            setOpen(null);
            setRecording({ grNo, kind: "RESTORED" });
          }}
        />
        <StatusChangePanel open={recording !== null} onClose={() => setRecording(null)} {...(recording?.grNo ? { grNo: recording.grNo } : {})} {...(recording?.kind ? { initialKind: recording.kind } : {})} />
      </Page>
    </RequirePermission>
  );
}
