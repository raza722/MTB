import { activitiesApi, ACTIVITIES_RENEWAL_DECISION_LABEL, type ActivitiesAward, type ActivitiesRenewalDecision } from "@mtb/api";
import { formatCount, formatRs, formatSession } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, ConfirmDialog, DataTable, EmptyState, Input, Modal, Segmented, StatCard, StatusBadge, Textarea, useToast, type Column } from "@mtb/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { errorText, plural, RenewalBadge, useRefresh } from "./shared";

type Filter = "OPEN" | "DECIDED" | "ALL";

/**
 * Before the session ends every approved award is checked against its scheme's rules (latest declared result,
 * attendance this session) so the committee renews, reduces or ends it with the figures in front of them.
 */
export function RenewalsView({ awards, loading, onOpen }: { awards: ActivitiesAward[]; loading: boolean; onOpen: (id: string) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const refresh = useRefresh();
  const readOnly = useReadOnly();
  const canManage = useCan("activities.manage") && !readOnly;
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [bulk, setBulk] = useState(false);
  const [dialog, setDialog] = useState<{ award: ActivitiesAward; decision: ActivitiesRenewalDecision } | null>(null);
  const [newValue, setNewValue] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);

  const approved = awards.filter((a) => a.status === "APPROVED" && a.renewal);
  const count = (o: string) => approved.filter((a) => a.renewal!.outcome === o).length;
  const ready = approved.filter((a) => !a.renewal!.decision && (a.renewal!.outcome === "MEETS" || a.renewal!.outcome === "AUTOMATIC"));
  const rows = approved
    .filter((a) => (filter === "ALL" ? true : filter === "DECIDED" ? Boolean(a.renewal!.decision) : !a.renewal!.decision))
    .sort((a, b) => rank(a) - rank(b) || a.studentName.localeCompare(b.studentName));

  const many = useMutation({
    mutationFn: () => activitiesApi.renewMany(ctx, ready.map((a) => a.id)),
    onSuccess: (r) => {
      refresh();
      setBulk(false);
      toast({ title: `${plural(r.renewed, "award")} renewed for ${formatSession(ctx.session + 1)}`, message: "Awards close to or below the line still need a decision." });
    },
  });
  const one = useMutation({
    mutationFn: (x: { award: ActivitiesAward; decision: ActivitiesRenewalDecision }) =>
      activitiesApi.decideRenewal(x.award.id, { decision: x.decision, note: note.trim(), ...(x.decision === "REDUCE" ? { newValue: Number(newValue) } : {}) }),
    onSuccess: (a, x) => {
      refresh();
      setDialog(null);
      toast({ tone: x.decision === "END" ? "info" : "success", title: ACTIVITIES_RENEWAL_DECISION_LABEL[x.decision], message: `${a.studentName} · ${a.schemeName}` });
    },
  });

  const columns: Array<Column<ActivitiesAward>> = [
    {
      key: "student",
      header: "Student",
      render: (a) => (
        <span className="grid">
          <span className="mtb-cell-primary">{a.studentName}</span>
          <span className="mtb-cell-secondary">
            <span className="mtb-num">{a.studentId}</span> · {a.classSection}
          </span>
        </span>
      ),
    },
    {
      key: "scheme",
      header: "Scholarship",
      render: (a) => (
        <span className="grid">
          <span>{a.schemeName}</span>
          <span className="mtb-cell-secondary">{a.valueText}</span>
        </span>
      ),
    },
    {
      key: "result",
      header: "Latest result",
      width: 200,
      render: (a) =>
        a.renewal?.latestResult ? (
          <span className="grid">
            <span className="mtb-num">{a.renewal.latestResult.percent.toFixed(1)}%</span>
            <span className="mtb-cell-secondary truncate">{a.renewal.latestResult.exam}</span>
          </span>
        ) : (
          <span className="text-ink-muted">Not declared yet</span>
        ),
    },
    { key: "att", header: "Attendance", align: "right", width: 110, render: (a) => (a.renewal?.attendancePercent !== null && a.renewal?.attendancePercent !== undefined ? <span className="mtb-num">{a.renewal.attendancePercent.toFixed(1)}%</span> : "—") },
    { key: "check", header: "Check", width: 180, render: (a) => <RenewalBadge outcome={a.renewal!.outcome} /> },
    {
      key: "decision",
      header: "Decision",
      width: 260,
      render: (a) =>
        a.renewal?.decision ? (
          <span className="grid">
            <StatusBadge status={a.renewal.decision === "END" ? "neutral" : "success"} dot={false}>
              {a.renewal.decision === "REDUCE" ? `Renew at ${a.basis === "FIXED" ? formatRs(a.renewal.newValue ?? 0) : `${a.renewal.newValue}%`}` : ACTIVITIES_RENEWAL_DECISION_LABEL[a.renewal.decision]}
            </StatusBadge>
            <span className="mtb-cell-secondary">{a.renewal.decidedBy}</span>
          </span>
        ) : canManage ? (
          <span className="flex flex-wrap gap-1">
            <Button size="sm" onClick={() => one.mutate({ award: a, decision: "RENEW" })} disabled={one.isPending}>
              Renew
            </Button>
            <Button size="sm" variant="quiet" onClick={() => openDialog(a, "REDUCE")}>
              Reduce
            </Button>
            <Button size="sm" variant="danger-quiet" onClick={() => openDialog(a, "END")}>
              End
            </Button>
          </span>
        ) : (
          <span className="text-ink-muted">Waiting</span>
        ),
    },
  ];

  function openDialog(award: ActivitiesAward, decision: ActivitiesRenewalDecision) {
    setNote("");
    setNewValue("");
    setTried(false);
    one.reset();
    setDialog({ award, decision });
  }

  const reduceError = dialog?.decision === "REDUCE" && (newValue === "" || !(Number(newValue) > 0) || Number(newValue) >= dialog.award.value) ? `Enter a ${dialog.award.basis === "FIXED" ? "rupee amount" : "percentage"} below the current ${dialog.award.basis === "FIXED" ? formatRs(dialog.award.value) : `${dialog.award.value}%`}.` : undefined;
  const noteError = dialog?.decision === "END" && note.trim().length < 5 ? "Say why it won't continue; the office tells the family." : undefined;

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Meet the criteria" icon="checkCircle" loading={loading} value={<AnimatedNumber value={count("MEETS")} format={formatCount} />} foot="Result and attendance above the line" />
        <StatCard label="Close to the line" icon="alert" tone={count("AT_RISK") ? "warning" : "neutral"} loading={loading} value={<AnimatedNumber value={count("AT_RISK")} format={formatCount} />} foot="Within a few points" onClick={() => setFilter("OPEN")} />
        <StatCard label="Below the criteria" icon="alertCircle" tone={count("NOT_MET") ? "danger" : "neutral"} loading={loading} value={<AnimatedNumber value={count("NOT_MET")} format={formatCount} />} foot="Reduce or end, or renew with a note" onClick={() => setFilter("OPEN")} />
        <StatCard label="Continue automatically" icon="refresh" loading={loading} value={<AnimatedNumber value={count("AUTOMATIC")} format={formatCount} />} foot="Sibling, staff child, shuhada" />
      </div>

      {canManage && ready.length > 0 && (
        <Banner
          tone="info"
          title={`${plural(ready.length, "award")} can be renewed together`}
          actions={
            <Button size="sm" variant="primary" icon="refresh" onClick={() => setBulk(true)}>
              Renew {ready.length}
            </Button>
          }
        >
          They meet every condition of their scheme, or continue automatically. The rest need a decision one by one.
        </Banner>
      )}

      <DataTable
        caption="Renewal review"
        columns={columns}
        rows={rows}
        loading={loading}
        onRowClick={(a) => onOpen(a.id)}
        toolbar={
          <Segmented
            aria-label="Show"
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            options={[
              { value: "OPEN", label: "Needs a decision" },
              { value: "DECIDED", label: "Decided" },
              { value: "ALL", label: "All" },
            ]}
          />
        }
        empty={<EmptyState icon="checkCircle" title={filter === "OPEN" ? "Every award has a decision" : "No awards here"} description={filter === "OPEN" ? "Switch to Decided to see what was agreed." : "Approved awards appear here for review before the session ends."} />}
      />

      <ConfirmDialog
        open={bulk}
        onClose={() => setBulk(false)}
        onConfirm={() => many.mutate()}
        title={`Renew ${plural(ready.length, "award")} for ${formatSession(ctx.session + 1)}?`}
        message="Each continues at the same rate next session. You can still change any of them before the session ends."
        details={[
          ["Awards", formatCount(ready.length)],
          ["Fee relief a month", formatRs(ready.reduce((s, a) => s + a.feeEffect.monthly, 0))],
        ]}
        confirmLabel={`Renew ${ready.length}`}
        loading={many.isPending}
        error={many.isError ? errorText(many.error) : undefined}
      />

      <Modal
        open={dialog !== null && dialog.decision !== "RENEW"}
        onClose={() => setDialog(null)}
        title={dialog ? `${dialog.decision === "REDUCE" ? "Renew at a lower rate" : "End at session end"}: ${dialog.award.studentName}` : ""}
        description={dialog ? `${dialog.award.schemeName} · now ${dialog.award.valueText}` : undefined}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              variant={dialog?.decision === "END" ? "danger" : "primary"}
              loading={one.isPending}
              onClick={() => {
                setTried(true);
                if (dialog && !reduceError && !noteError) one.mutate(dialog);
              }}
            >
              {dialog?.decision === "END" ? "End at session end" : "Save"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {dialog?.decision === "REDUCE" && (
            <Input
              label={dialog.award.basis === "FIXED" ? "New amount off each month" : "New percentage off"}
              required
              inputMode="numeric"
              amount
              prefix={dialog.award.basis === "FIXED" ? "Rs" : undefined}
              suffix={dialog.award.basis === "FIXED" ? undefined : "%"}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value.replace(/[^\d]/g, ""))}
              error={tried ? reduceError : undefined}
            />
          )}
          <Textarea label="Note" required={dialog?.decision === "END"} rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={tried ? noteError : undefined} placeholder={dialog?.decision === "END" ? "For example: annual result 61%, below the 80% the scheme needs." : "Optional"} />
          {one.isError && <Banner tone="danger">{errorText(one.error)}</Banner>}
        </div>
      </Modal>
      {one.isError && !dialog && <Banner tone="danger">{errorText(one.error)}</Banner>}
    </div>
  );
}

function rank(a: ActivitiesAward) {
  const o = a.renewal?.outcome;
  return o === "NOT_MET" ? 0 : o === "AT_RISK" ? 1 : o === "MEETS" ? 2 : 3;
}
