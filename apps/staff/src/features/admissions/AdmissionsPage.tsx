import { admissionsQueries, type AdmissionsApplicant, type AdmissionsPipeline } from "@mtb/api";
import { formatCount, formatSession } from "@mtb/domain";
import { AnimatedNumber, buttonClassName, DataTable, Panel, Segmented, Skeleton, StatCard } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { LoadError, stagger } from "../students/shared";
import { AdmitPanel } from "./AdmitPanel";
import { ApplicantPanel } from "./ApplicantPanel";
import { PipelineView } from "./PipelineView";
import { AdmissionsSubNav } from "./shared";

export type AdmissionsTab = "pipeline" | "merit" | "duplicates";

export interface AdmissionsPageProps {
  view: "board" | "table";
  applicant: string;
  onChange: (patch: { view?: "board" | "table"; applicant?: string }) => void;
}

interface FunnelStep {
  key: string;
  label: string;
  value: number;
  note: string;
}

function funnelOf(d: AdmissionsPipeline): FunnelStep[] {
  const live = d.applicants.filter((a) => a.stage !== "WITHDRAWN");
  const tested = d.applicants.filter((a) => a.testScore !== null || a.directAdmission).filter((a) => a.stage !== "APPLIED" && a.stage !== "TEST").length;
  const offered = d.applicants.filter((a) => a.stage === "OFFERED" || (a.stage === "ADMITTED" && a.offeredOn)).length;
  const converted = d.applicants.filter((a) => a.enquiryNo).length;
  return [
    { key: "enq", label: "Enquiries", value: d.openEnquiries + converted, note: `${d.openEnquiries} still open` },
    { key: "app", label: "Applications", value: live.length + d.counts.WITHDRAWN, note: `${d.counts.WITHDRAWN} withdrawn` },
    { key: "test", label: "Tested or interviewed", value: tested, note: `${d.counts.TEST} booked for a test` },
    { key: "offer", label: "Offered a seat", value: offered, note: `${d.counts.OFFERED} waiting to complete` },
    { key: "adm", label: "Admitted", value: d.counts.ADMITTED, note: `${d.admittedThisWeek} this week` },
  ];
}

/** Share of the step before that reached this step. None when the step also counts families who skipped the one before (most applications are walk-ins, not enquiries), since a rate above 100% would mean nothing. */
function rateOf(steps: FunnelStep[], i: number): number | null {
  const prev = steps[i - 1];
  const s = steps[i]!;
  if (!prev || !prev.value || s.value > prev.value) return null;
  return Math.round((s.value / prev.value) * 100);
}

/** Enquiry to admission as one funnel: how many families reach each step. */
function Funnel({ d }: { d: AdmissionsPipeline | undefined }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const steps = d ? funnelOf(d) : [];
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <Panel
      id="funnel"
      rise={5}
      title="From enquiry to admission"
      description={d ? `Session ${formatSession(d.session)}: how many families reach each step` : "How many families reach each step"}
      actions={
        <Segmented
          aria-label="Show as"
          value={view}
          onChange={(v) => setView(v as "chart" | "table")}
          options={[
            { value: "chart", label: "Chart" },
            { value: "table", label: "Table" },
          ]}
        />
      }
    >
      {!d ? (
        <div className="grid gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={28} />
          ))}
        </div>
      ) : view === "chart" ? (
        <ol className="m-0 grid list-none gap-2.5 p-0" aria-label="Admissions funnel">
          {steps.map((s, i) => {
            const conv = rateOf(steps, i);
            return (
              <li key={s.key} className="mtb-slide-in grid items-center gap-x-4 gap-y-1 sm:grid-cols-[180px_minmax(0,1fr)_120px]" style={stagger(i)}>
                <span className="grid">
                  <b className="text-small font-medium text-ink">{s.label}</b>
                  <span className="text-small text-ink-muted">{s.note}</span>
                </span>
                <span className="relative h-7 overflow-hidden rounded-md bg-surface-sunken" aria-hidden="true">
                  <span className="mtb-meter-animate absolute inset-y-0 left-0 rounded-md" style={{ width: `${Math.max(2, (s.value / max) * 100)}%`, background: "var(--chart-1)", opacity: 1 - i * 0.12 }} />
                </span>
                <span className="flex items-baseline justify-end gap-2">
                  <b className="text-title-3 tabular-nums text-ink">{formatCount(s.value)}</b>
                  {conv !== null && <span className="text-small tabular-nums text-ink-muted">{conv}%</span>}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <DataTable
          caption="Admissions funnel"
          rows={steps.map((s, i) => ({ ...s, id: s.key, conv: rateOf(steps, i) === null ? "—" : `${rateOf(steps, i)}%` }))}
          stickyHeader={false}
          density="dense"
          columns={[
            { key: "label", header: "Step" },
            { key: "value", header: "Families", align: "right", render: (s) => <b className="tabular-nums">{formatCount(s.value)}</b> },
            { key: "conv", header: "From the step before", align: "right" },
            { key: "note", header: "Note" },
          ]}
        />
      )}
    </Panel>
  );
}

/** Admissions overview: headline figures, the funnel, and the pipeline board with every applicant one click away. */
export function AdmissionsPage({ view, applicant, onChange }: AdmissionsPageProps) {
  const ctx = useCtx();
  const navigate = useNavigate();
  const canManage = useCan("admissions.manage");
  const readOnly = useReadOnly();
  const pipeline = useQuery(admissionsQueries.pipeline(ctx));
  const [admitting, setAdmitting] = useState<AdmissionsApplicant | null>(null);
  const d = pipeline.data;
  const total = d ? d.applicants.length : undefined;
  const marking = d ? d.applicants.filter((a) => a.stage === "TEST").length : 0;

  return (
    <Page>
      <PageHeader
        title="Admissions"
        meta={total !== undefined ? <span className="text-small text-ink-muted tabular-nums">{total} applications this session</span> : undefined}
        actions={
          canManage && !readOnly ? (
            <>
              <Link to="/admissions/enquiries" search={(prev: Record<string, unknown>) => ({ ...prev, new: true }) as never} className={buttonClassName({})}>
                New enquiry
              </Link>
              <Link to="/admissions/new" className={buttonClassName({ variant: "primary" })}>
                New application
              </Link>
            </>
          ) : undefined
        }
      />
      <AdmissionsSubNav />
      {pipeline.isError && <LoadError what="admissions pipeline" error={pipeline.error} onRetry={() => void pipeline.refetch()} />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="mtb-rise" style={stagger(1)}>
          <StatCard label="Open enquiries" icon="phone" loading={!d} value={d ? <AnimatedNumber value={d.openEnquiries} format={formatCount} /> : undefined} foot="waiting for a follow-up call" onClick={() => void navigate({ to: "/admissions/enquiries" })} />
        </div>
        <div className="mtb-rise" style={stagger(2)}>
          <StatCard label="Booked for a test" icon="edit" tone="info" loading={!d} value={d ? <AnimatedNumber value={marking} format={formatCount} /> : undefined} foot="tests and marks to enter" onClick={() => void navigate({ to: "/admissions/tests" })} />
        </div>
        <div className="mtb-rise" style={stagger(3)}>
          <StatCard label="Offers waiting" icon="send" tone="warning" loading={!d} value={d ? <AnimatedNumber value={d.counts.OFFERED} format={formatCount} /> : undefined} foot="families still to complete admission" onClick={() => void navigate({ to: "/admissions/offers" })} />
        </div>
        <div className="mtb-rise" style={stagger(4)}>
          <StatCard label="Admitted" icon="checkCircle" loading={!d} value={d ? <AnimatedNumber value={d.counts.ADMITTED} format={formatCount} /> : undefined} {...(d && d.admittedThisWeek ? { delta: d.admittedThisWeek, deltaLabel: `+${d.admittedThisWeek} this week` } : {})} foot="this session" />
        </div>
      </div>
      <Funnel d={d} />
      <Panel id="pipeline" rise={6} title="Pipeline" description="Every application by stage. Open one to record the fee, book the test, offer a seat or admit.">
        <PipelineView data={d} loading={pipeline.isLoading} view={view} onViewChange={(v) => onChange({ view: v })} showCampus={ctx.campus === "ALL"} onOpen={(id) => onChange({ applicant: id })} />
      </Panel>
      <ApplicantPanel
        id={applicant || null}
        onClose={() => onChange({ applicant: "" })}
        onAdmit={(a) => {
          onChange({ applicant: "" });
          setAdmitting(a);
        }}
      />
      <AdmitPanel applicant={admitting} open={admitting !== null} onClose={() => setAdmitting(null)} />
    </Page>
  );
}
