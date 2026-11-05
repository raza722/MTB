import { activitiesQueries, type ActivitiesAward, type ActivitiesAwardStatus } from "@mtb/api";
import { formatDate, formatRs, formatSession } from "@mtb/domain";
import { Button, DataTable, EmptyState, Input, Pagination, Segmented, Select, TabPanel, Tabs, type Column } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { AwardPanel } from "./AwardPanel";
import { NewAwardPanel } from "./NewAwardPanel";
import { ScholarshipListDoc } from "./print";
import { RenewalsView } from "./RenewalsView";
import { ActivitiesNav, AwardBadge, LoadError, PrintLayer } from "./shared";

export interface ScholarshipsSearch {
  view?: "renewals";
  award?: string;
  status?: ActivitiesAwardStatus;
  scheme?: string;
  new?: boolean;
}

const STATUS_OPTIONS: Array<{ value: "ALL" | ActivitiesAwardStatus; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "PENDING", label: "Waiting" },
  { value: "APPROVED", label: "Approved" },
  { value: "ENDED", label: "Ended" },
  { value: "REJECTED", label: "Rejected" },
];

/** Every scholarship and concession of the session: who has what, what it does to fees, and what waits for approval. */
export function ScholarshipsPage({ search, onSearch }: { search: ScholarshipsSearch; onSearch: (patch: Partial<ScholarshipsSearch>) => void }) {
  const ctx = useCtx();
  const canManage = useCan("activities.manage");
  const readOnly = useReadOnly();
  const awards = useQuery(activitiesQueries.awards(ctx));
  const schemes = useQuery(activitiesQueries.schemes(ctx));
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [printing, setPrinting] = useState(false);
  // Class (the class part of "7-B", or "Class 6" for applicants) and boys/girls, for the table and the printed list.
  const [cls, setCls] = useState("");
  const [gender, setGender] = useState<"" | "F" | "M">("");
  const status = search.status ?? "ALL";
  const view = search.view ?? "awards";
  const all = awards.data ?? [];
  const term = q.trim().toLowerCase();
  const classOf = (a: ActivitiesAward) => (/^Prep/.test(a.classSection) ? "Prep" : (/(\d+)/.exec(a.classSection)?.[1] ?? a.classSection));
  const classList = [...new Set(all.map(classOf))].sort((x, y) => (x === "Prep" ? -1 : y === "Prep" ? 1 : Number(x) - Number(y)));
  const rows = all.filter(
    (a) =>
      (status === "ALL" || a.status === status) &&
      (!search.scheme || a.schemeId === search.scheme) &&
      (!cls || classOf(a) === cls) &&
      (!gender || a.gender === gender) &&
      (!term || `${a.studentName} ${a.studentId} ${a.awardNo} ${a.father} ${a.classSection}`.toLowerCase().includes(term)),
  );
  const pageSize = 25;
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);
  const pending = all.filter((a) => a.status === "PENDING").length;
  const atRisk = all.filter((a) => a.renewal && (a.renewal.outcome === "NOT_MET" || a.renewal.outcome === "AT_RISK") && !a.renewal.decision).length;
  const approvedMonthly = rows.filter((a) => a.status === "APPROVED").reduce((s, a) => s + a.feeEffect.monthly, 0);
  const schemeName = schemes.data?.find((s) => s.id === search.scheme)?.name;

  const columns: Array<Column<ActivitiesAward>> = [
    {
      key: "student",
      header: "Student",
      render: (a) => (
        <span className="grid">
          <span className="mtb-cell-primary">{a.studentName}</span>
          <span className="mtb-cell-secondary">
            <span className="mtb-num">{a.studentId}</span> · {a.classSection}
            {ctx.campus === "ALL" ? ` · ${campusLabel(a.campus)}` : ""}
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
      key: "fees",
      header: "Tuition a month",
      width: 190,
      render: (a) => {
        const t = a.feeEffect.lines.find((l) => l.head === "TUITION");
        return t ? (
          <span className="mtb-num whitespace-nowrap">
            <span className="text-ink-muted line-through">{formatRs(t.before)}</span> → {formatRs(t.after)}
          </span>
        ) : (
          "—"
        );
      },
    },
    { key: "monthly", header: "Off a month", align: "right", width: 120, render: (a) => <span className="mtb-num">{formatRs(a.feeEffect.monthly)}</span> },
    { key: "from", header: "From", width: 120, render: (a) => <span className="mtb-num">{formatDate(a.effectiveFrom)}</span> },
    {
      key: "status",
      header: "Status",
      width: 190,
      render: (a) => (
        <span className="grid gap-0.5">
          <AwardBadge status={a.status} />
          <span className="mtb-cell-secondary mtb-num">{a.awardNo}</span>
        </span>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Scholarships"
        actions={
          <>
            <Button icon="printer" onClick={() => setPrinting(true)} disabled={rows.length === 0 || ctx.campus === "ALL"} title={ctx.campus === "ALL" ? "Choose a campus to print its list" : undefined}>
              Print list
            </Button>
            {canManage && !readOnly && ctx.campus !== "ALL" && (
              <Button variant="primary" icon="plus" onClick={() => onSearch({ new: true })}>
                Propose a scholarship
              </Button>
            )}
          </>
        }
      />
      <ActivitiesNav />
      {awards.isError && <LoadError what="Scholarships" error={awards.error} onRetry={() => void awards.refetch()} />}

      <Tabs
        aria-label="Scholarship views"
        idPrefix="sch-"
        value={view}
        onChange={(v) => onSearch({ view: v === "renewals" ? "renewals" : undefined })}
        tabs={[
          { id: "awards", label: "Awards", icon: "award", ...(pending ? { count: pending } : {}) },
          { id: "renewals", label: "Renewal review", icon: "refresh", ...(atRisk ? { count: atRisk } : {}) },
        ]}
      />

      <TabPanel id="renewals" idPrefix="sch-" active={view === "renewals"}>
        <RenewalsView awards={all} loading={awards.isLoading} onOpen={(id) => onSearch({ award: id })} />
      </TabPanel>
      <TabPanel id="awards" idPrefix="sch-" active={view !== "renewals"}>
        <DataTable
          caption={`Scholarship awards, ${campusLabel(ctx.campus)}, session ${formatSession(ctx.session)}`}
          columns={columns}
          rows={shown}
          loading={awards.isLoading}
          onRowClick={(a) => onSearch({ award: a.id })}
          footer={rows.length ? { student: `${rows.length} awards`, monthly: <span className="mtb-num font-semibold">{formatRs(approvedMonthly)}</span>, fees: <span className="text-small text-ink-muted">Approved, off each month</span> } : undefined}
          toolbar={
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-64">
                  <Input
                    aria-label="Search awards"
                    icon="search"
                    placeholder="Student, G.R. or award number"
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
                <Segmented
                  aria-label="Status"
                  value={status}
                  onChange={(v) => {
                    onSearch({ status: v === "ALL" ? undefined : (v as ActivitiesAwardStatus) });
                    setPage(1);
                  }}
                  options={STATUS_OPTIONS}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
              <div className="w-36">
                <Select
                  aria-label="Class"
                  value={cls}
                  onChange={(e) => {
                    setCls(e.target.value);
                    setPage(1);
                  }}
                  options={[{ value: "", label: "Every class" }, ...classList.map((c) => ({ value: c, label: c === "Prep" ? "Prep" : `Class ${c}` }))]}
                />
              </div>
              <div className="w-36">
                <Select
                  aria-label="Boys or girls"
                  value={gender}
                  onChange={(e) => {
                    setGender(e.target.value as "" | "F" | "M");
                    setPage(1);
                  }}
                  options={[
                    { value: "", label: "Boys and girls" },
                    { value: "F", label: "Girls" },
                    { value: "M", label: "Boys" },
                  ]}
                />
              </div>
              <div className="w-60">
                <Select
                  aria-label="Scheme"
                  value={search.scheme ?? ""}
                  onChange={(e) => {
                    onSearch({ scheme: e.target.value || undefined });
                    setPage(1);
                  }}
                  options={[{ value: "", label: "Every scheme" }, ...(schemes.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
                />
              </div>
              </div>
            </>
          }
          pagination={rows.length > pageSize ? <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} /> : undefined}
          empty={
            <EmptyState
              icon="award"
              title={term || status !== "ALL" || search.scheme || cls || gender ? "No awards match" : `No scholarships for ${campusLabel(ctx.campus)} in ${formatSession(ctx.session)}`}
              description={term || status !== "ALL" || search.scheme || cls || gender ? "Clear the search or choose another status, scheme, class or boys/girls." : "Propose one for a student, or give awards from a scholarship test's merit list."}
              action={
                term || status !== "ALL" || search.scheme || cls || gender ? (
                  <Button
                    onClick={() => {
                      setQ("");
                      setCls("");
                      setGender("");
                      onSearch({ status: undefined, scheme: undefined });
                    }}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </TabPanel>

      {search.award && <AwardPanel id={search.award} onClose={() => onSearch({ award: undefined })} />}
      {search.new && <NewAwardPanel onClose={(id) => onSearch({ new: undefined, ...(id ? { award: id } : {}) })} />}
      {printing && ctx.campus !== "ALL" && (
        <PrintLayer paper="A4L" onDone={() => setPrinting(false)}>
          <ScholarshipListDoc
            awards={rows}
            campus={ctx.campus}
            session={ctx.session}
            title={`${status === "ALL" ? "All awards" : STATUS_OPTIONS.find((s) => s.value === status)?.label ?? ""}${schemeName ? ` · ${schemeName}` : ""}${cls ? ` · ${cls === "Prep" ? "Prep" : `Class ${cls}`}` : ""}${gender ? (gender === "F" ? " · girls" : " · boys") : ""} · ${campusLabel(ctx.campus)}`}
          />
        </PrintLayer>
      )}
    </Page>
  );
}
