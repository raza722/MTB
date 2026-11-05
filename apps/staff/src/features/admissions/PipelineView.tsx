import { ADMISSIONS_STAGE_LABEL, ADMISSIONS_STAGES, type AdmissionsApplicant, type AdmissionsPipeline, type AdmissionsStage } from "@mtb/api";
import { formatCnic, formatDate, formatMobile } from "@mtb/domain";
import { Button, Checkbox, cx, DataTable, DateText, EmptyState, Icon, Input, Segmented, Select, Skeleton, StatusBadge, type Column, type SortState } from "@mtb/ui";
import { useMemo, useState } from "react";
import { stagger } from "../students/shared";
import { DiamondMindsBadge, downloadCsv, matchesApplicant, offerDeadline, relationName, scoreText, StageBadge } from "./shared";

/** Columns the table can add (the legacy Candidate Detail report's fields). */
const EXTRA_COLUMNS = [
  { key: "dob", label: "Date of birth" },
  { key: "bForm", label: "B-form" },
  { key: "previousSchool", label: "Previous school" },
  { key: "mobile", label: "Mobile" },
  { key: "address", label: "Address" },
] as const;
type ExtraKey = (typeof EXTRA_COLUMNS)[number]["key"];

function ApplicantCard({ a, i, showCampus, onOpen }: { a: AdmissionsApplicant; i: number; showCampus: boolean; onOpen: (id: string) => void }) {
  const deadline = a.stage === "OFFERED" ? offerDeadline(a.offerValidUntil) : null;
  return (
    <li className="mtb-slide-in" style={stagger(i)}>
      <button type="button" onClick={() => onOpen(a.id)} className="grid w-full gap-2 rounded-lg border border-border bg-surface-raised p-3 text-left shadow-sm transition-colors hover:border-brand" aria-label={`${a.name}, ${a.classApplied}. Open application`}>
        <div className="flex items-start justify-between gap-2">
          <span className="grid min-w-0">
            <span className="truncate font-medium text-ink">{a.name}</span>
            <span className="truncate text-small text-ink-muted">{relationName(a)}</span>
          </span>
          {a.diamondMinds && <DiamondMindsBadge />}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
          <span className="rounded-sm bg-surface-sunken px-2 py-0.5 font-medium text-ink">{a.classApplied}</span>
          <span className={cx("mtb-num", a.testScore !== null ? "font-medium text-ink" : "text-ink-muted")}>{a.testScore !== null ? `Test ${scoreText(a)}` : scoreText(a)}</span>
          {a.fee?.status === "DUE" && <StatusBadge status="unpaid">Fee due</StatusBadge>}
          {a.siblings && a.siblings.length > 0 && (
            <span className="flex items-center gap-1 text-ink-muted" title="Siblings already at MTB">
              <Icon name="home" size={14} /> {a.siblings.length}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-2 text-small text-ink-muted">
          <span className="mtb-mono" style={{ fontSize: 12 }}>
            {a.applicationNo}
          </span>
          {a.stage === "ADMITTED" ? (
            <span>
              G.R. <span className="mtb-mono" style={{ fontSize: 12 }}>{a.grNo}</span>
            </span>
          ) : deadline ? (
            <span className={deadline.urgent ? "font-medium text-warning-ink" : undefined}>{deadline.text}</span>
          ) : (
            <span className="mtb-num">Applied {formatDate(a.appliedOn)}</span>
          )}
        </div>
        {showCampus && <span className="text-small text-ink-muted">{a.campusName}</span>}
      </button>
    </li>
  );
}

function Board({ applicants, showCampus, onOpen }: { applicants: AdmissionsApplicant[]; showCampus: boolean; onOpen: (id: string) => void }) {
  return (
    <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-5">
      {ADMISSIONS_STAGES.map((s) => {
        const list = applicants.filter((a) => a.stage === s);
        return (
          <section key={s} aria-labelledby={`stage-${s}`} className="grid gap-3 rounded-lg bg-surface-sunken p-3">
            <header className="flex items-center justify-between">
              <h3 id={`stage-${s}`} className="m-0 text-title-3">
                {ADMISSIONS_STAGE_LABEL[s]}
              </h3>
              <span className="grid h-6 min-w-6 place-content-center rounded-full bg-neutral-tint px-2 text-small font-medium text-neutral-ink tabular-nums" aria-label={`${list.length} applicants`}>
                {list.length}
              </span>
            </header>
            {list.length === 0 ? (
              <p className="m-0 rounded-md border border-dashed border-border-strong px-3 py-6 text-center text-small text-ink-muted">No applicants at this stage.</p>
            ) : (
              <ul className="m-0 grid max-h-[620px] list-none gap-2 overflow-y-auto p-0">
                {list.map((a, i) => (
                  <ApplicantCard key={a.id} a={a} i={i} showCampus={showCampus} onOpen={onOpen} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

const STAGE_ORDER: Record<AdmissionsStage, number> = { APPLIED: 0, TEST: 1, MERIT: 2, OFFERED: 3, ADMITTED: 4, WITHDRAWN: 5 };

function Table({ applicants, showCampus, onOpen, extra }: { applicants: AdmissionsApplicant[]; showCampus: boolean; onOpen: (id: string) => void; extra: Set<ExtraKey> }) {
  const [sort, setSort] = useState<SortState>({ key: "appliedOn", dir: "desc" });
  const rows = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const value = (a: AdmissionsApplicant): string | number =>
      sort.key === "name" ? a.name : sort.key === "stage" ? STAGE_ORDER[a.stage] : sort.key === "score" ? (a.testScore === null ? -1 : a.testScore / a.testMax) : sort.key === "classApplied" ? a.classApplied : a.appliedOn;
    return [...applicants].sort((x, y) => {
      const [a, b] = [value(x), value(y)];
      return (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))) * dir;
    });
  }, [applicants, sort]);

  const columns: Array<Column<AdmissionsApplicant>> = [
    {
      key: "name",
      header: "Applicant",
      sortable: true,
      render: (a) => (
        <span className="grid">
          <span className="mtb-cell-primary flex items-center gap-2">
            {a.name} {a.diamondMinds && <DiamondMindsBadge />}
          </span>
          <span className="mtb-cell-secondary">{relationName(a)}</span>
        </span>
      ),
    },
    { key: "applicationNo", header: "Application", width: 170, render: (a) => <span className="mtb-mono">{a.applicationNo}</span> },
    { key: "classApplied", header: "Class", width: 100, sortable: true },
    { key: "stage", header: "Stage", width: 120, sortable: true, render: (a) => <StageBadge stage={a.stage} /> },
    { key: "fee", header: "Candidate fee", width: 130, render: (a) => (a.fee ? <StatusBadge status={a.fee.status === "DUE" ? "unpaid" : "paid"}>{a.fee.status === "DUE" ? "Due" : "Paid"}</StatusBadge> : <span className="text-ink-subtle">—</span>) },
    { key: "score", header: "Test score", align: "right", width: 170, sortable: true, render: (a) => <span className={a.testScore === null ? "text-ink-muted" : undefined}>{scoreText(a)}</span> },
    { key: "appliedOn", header: "Applied on", width: 130, sortable: true, render: (a) => <DateText value={a.appliedOn} /> },
    ...(extra.has("dob") ? [{ key: "dob", header: "Date of birth", width: 130, render: (a: AdmissionsApplicant) => <DateText value={a.dob} /> }] : []),
    ...(extra.has("bForm") ? [{ key: "bForm", header: "B-form", width: 160, render: (a: AdmissionsApplicant) => (a.bForm ? <span className="mtb-mono">{formatCnic(a.bForm)}</span> : <span className="text-ink-subtle">—</span>) }] : []),
    ...(extra.has("previousSchool") ? [{ key: "previousSchool", header: "Previous school", width: 190, render: (a: AdmissionsApplicant) => a.previousSchool ?? <span className="text-ink-subtle">—</span> }] : []),
    ...(extra.has("mobile") ? [{ key: "mobile", header: "Mobile", width: 140, render: (a: AdmissionsApplicant) => <span className="tabular-nums">{formatMobile(a.mobile)}</span> }] : []),
    ...(extra.has("address") ? [{ key: "address", header: "Address", width: 260, render: (a: AdmissionsApplicant) => a.address }] : []),
    ...(showCampus ? [{ key: "campus", header: "Campus", width: 150, render: (a: AdmissionsApplicant) => a.campusName }] : []),
  ];
  return <DataTable caption="Applicants" columns={columns} rows={rows} sort={sort} onSortChange={setSort} maxHeight={560} onRowClick={(a) => onOpen(a.id)} empty={<EmptyState icon="admissions" title="No applicants" description="No applications match the search and filters." />} />;
}

function csvOf(list: AdmissionsApplicant[], showCampus: boolean) {
  downloadCsv(
    "applicants.csv",
    ["Application no.", "Name", "Relation", "Father", "Father's CNIC", "Gender", "Date of birth", "B-form", "Class applied", "Group", "Stage", "Test score", "Previous school", "Mobile", "Address", "Applied on", ...(showCampus ? ["Campus"] : [])],
    list.map((a) => [
      a.applicationNo,
      a.name,
      a.relation,
      a.father,
      a.fatherCnic ? formatCnic(a.fatherCnic) : "",
      a.gender === "F" ? "Girl" : "Boy",
      formatDate(a.dob),
      a.bForm ? formatCnic(a.bForm) : "",
      a.classApplied,
      a.stream ?? "",
      ADMISSIONS_STAGE_LABEL[a.stage],
      a.testScore !== null ? `${a.testScore}/${a.testMax}` : "",
      a.previousSchool ?? "",
      formatMobile(a.mobile),
      a.address,
      formatDate(a.appliedOn),
      ...(showCampus ? [a.campusName] : []),
    ]),
  );
}

export function PipelineView({ data, loading, view, onViewChange, showCampus, onOpen }: { data: AdmissionsPipeline | undefined; loading: boolean; view: "board" | "table"; onViewChange: (v: "board" | "table") => void; showCampus: boolean; onOpen: (id: string) => void }) {
  const [cls, setCls] = useState("");
  const [gender, setGender] = useState<"" | "F" | "M">("");
  const [q, setQ] = useState("");
  const [withdrawn, setWithdrawn] = useState(false);
  const [extra, setExtra] = useState<Set<ExtraKey>>(new Set());
  const classes = useMemo(() => [...new Set((data?.applicants ?? []).map((a) => a.classApplied))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [data]);
  const applicants = useMemo(() => (data?.applicants ?? []).filter((a) => (!cls || a.classApplied === cls) && (!gender || a.gender === gender) && matchesApplicant(a, q) && (withdrawn || a.stage !== "WITHDRAWN" || (q.trim().length > 0 && view === "table"))), [data, cls, gender, q, withdrawn, view]);

  if (loading || !data) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading applicants">
        <Skeleton height={44} />
        <Skeleton height={320} style={{ borderRadius: "var(--radius-lg)" }} />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-64">
            <Input label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, application no., father, CNIC or mobile" />
          </div>
          <div className="w-48">
            <Select label="Class applied for" value={cls} onChange={(e) => setCls(e.target.value)} options={[{ value: "", label: "All classes" }, ...classes.map((c) => ({ value: c, label: c }))]} />
          </div>
          <div className="w-36">
            <Select
              label="Boys or girls"
              value={gender}
              onChange={(e) => setGender(e.target.value as "" | "F" | "M")}
              options={[
                { value: "", label: "Both" },
                { value: "F", label: "Girls" },
                { value: "M", label: "Boys" },
              ]}
            />
          </div>
          {view === "table" && <Checkbox label={`Show withdrawn (${data.counts.WITHDRAWN})`} checked={withdrawn} onChange={(e) => setWithdrawn(e.target.checked)} />}
          {view === "table" && (
            <Button size="sm" icon="download" disabled={applicants.length === 0} onClick={() => csvOf(applicants, showCampus)}>
              Download CSV ({applicants.length})
            </Button>
          )}
        </div>
        <Segmented
          aria-label="View"
          value={view}
          onChange={(v) => onViewChange(v as "board" | "table")}
          options={[
            { value: "board", label: "Board" },
            { value: "table", label: "Table" },
          ]}
        />
      </div>
      {view === "table" && data.applicants.length > 0 && (
        <fieldset className="m-0 flex flex-wrap items-center gap-4 border-0 p-0">
          <legend className="mtb-label float-left mr-2">More columns</legend>
          {EXTRA_COLUMNS.map((c) => (
            <Checkbox key={c.key} label={c.label} checked={extra.has(c.key)} onChange={(e) => setExtra((s) => (e.target.checked ? new Set([...s, c.key]) : new Set([...s].filter((x) => x !== c.key))))} />
          ))}
        </fieldset>
      )}
      {data.applicants.length === 0 ? (
        <EmptyState icon="admissions" title="No applications this session" description="Applications for this campus and session appear here as the office enters them." />
      ) : q.trim() && applicants.length === 0 ? (
        <EmptyState icon="search" title="No applicant matches" description={`Nobody matches “${q.trim()}”. Check the spelling, or search by the application or mobile number.`} />
      ) : view === "board" ? (
        <Board applicants={applicants} showCampus={showCampus} onOpen={onOpen} />
      ) : (
        <Table applicants={applicants} showCampus={showCampus} onOpen={onOpen} extra={extra} />
      )}
    </div>
  );
}
