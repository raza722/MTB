import { ENROLMENT_STATUS_LABEL, metaQueries, studentsApi, studentsQueries, type EnrolmentStatusCode, type FeeStatusCode, type StudentListDetail, type StudentListQuery, type StudentStrength, type StudentSummary } from "@mtb/api";
import { formatCnic, formatCount, formatDate, formatMobile, looksLikeCnic } from "@mtb/domain";
import {
  AnimatedNumber,
  Avatar,
  Banner,
  Button,
  buttonClassName,
  DataTable,
  EmptyState,
  Input,
  Money,
  Pagination,
  Panel,
  Segmented,
  SegmentedBar,
  Select,
  Skeleton,
  StatCard,
  StatusBadge,
  useToast,
  type Column,
  type SortState,
} from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Page, PageHeader, RequirePermission } from "../../app/shell/page";
import { useCan, useCtx } from "../../app/session";
import { AddressLabelsPanel } from "./documents/AddressLabelsPanel";
import { EnrolmentBadge, LoadError, SeatMeter, stagger, StudentsSubNav } from "./shared";

export { EnrolmentBadge };

export interface StudentsSearch {
  q?: string;
  cls?: string;
  sec?: string;
  /** Group (stream), in classes that have groups. */
  grp?: string;
  status?: EnrolmentStatusCode;
  fee?: FeeStatusCode;
}

/** Headline figures: enrolled, new admissions, leavers and families. */
function StrengthCards({ s }: { s: StudentStrength | undefined }) {
  const navigate = useNavigate();
  const canAdmissions = useCan("admissions.view");
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="mtb-rise" style={stagger(1)}>
        <StatCard label="Enrolled" icon="students" loading={!s} value={s ? <AnimatedNumber value={s.enrolled} format={formatCount} /> : undefined} foot={s ? `${formatCount(s.girls)} girls · ${formatCount(s.boys)} boys` : undefined} />
      </div>
      <div className="mtb-rise" style={stagger(2)}>
        <StatCard
          label="New this session"
          icon="admissions"
          tone="info"
          loading={!s}
          value={s ? <AnimatedNumber value={s.newThisSession} format={formatCount} /> : undefined}
          {...(s && s.newThisWeek ? { delta: s.newThisWeek, deltaLabel: `+${s.newThisWeek} this week` } : {})}
          foot="admitted since 01-Apr"
          {...(canAdmissions ? { onClick: () => void navigate({ to: "/admissions/offers" }) } : {})}
        />
      </div>
      <div className="mtb-rise" style={stagger(3)}>
        <StatCard
          label="Left this session"
          icon="logout"
          tone={s && s.struckOff > 0 ? "warning" : "neutral"}
          loading={!s}
          value={s ? <AnimatedNumber value={s.leftThisSession} format={formatCount} /> : undefined}
          foot={s ? `${s.struckOff} struck off now, can be restored` : undefined}
          onClick={() => void navigate({ to: "/students/leaving" })}
        />
      </div>
      <div className="mtb-rise" style={stagger(4)}>
        <StatCard
          label="Families"
          icon="home"
          loading={!s}
          value={s ? <AnimatedNumber value={s.families} format={formatCount} /> : undefined}
          foot={s ? `${s.crossCampusFamilies} with children at more than one campus` : undefined}
          onClick={() => void navigate({ to: "/students/families" })}
        />
      </div>
    </div>
  );
}

/** Seats filled per class, as meters (chart) or a table. */
function StrengthPanel({ s, onPick }: { s: StudentStrength | undefined; onPick: (cls: string) => void }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const classes = (s?.classes ?? []).filter((c) => c.enrolled > 0);
  const girls = s?.girls ?? 0;
  const boys = s?.boys ?? 0;
  return (
    <Panel
      id="strength"
      rise={5}
      title="Class strength"
      description="Enrolled students against seats, per class"
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
      {!s ? (
        <div className="grid gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={28} />
          ))}
        </div>
      ) : classes.length === 0 ? (
        <EmptyState icon="students" title="No students enrolled" description="Students appear here once they are admitted." />
      ) : view === "chart" ? (
        <div className="grid gap-5">
          <div className="grid gap-2">
            <SegmentedBar
              label="Enrolled students by gender"
              format={formatCount}
              segments={[
                { key: "girls", label: "Girls", value: girls, color: "var(--chart-1)" },
                { key: "boys", label: "Boys", value: boys, color: "var(--chart-2)" },
              ]}
            />
            <div className="flex flex-wrap gap-4 text-small text-ink-muted">
              <span className="flex items-center gap-2">
                <span className="mtb-chart-key" style={{ background: "var(--chart-1)" }} aria-hidden="true" /> Girls <b className="tabular-nums text-ink">{formatCount(girls)}</b>
              </span>
              <span className="flex items-center gap-2">
                <span className="mtb-chart-key" style={{ background: "var(--chart-2)" }} aria-hidden="true" /> Boys <b className="tabular-nums text-ink">{formatCount(boys)}</b>
              </span>
            </div>
          </div>
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
            {classes.map((c, i) => (
              <li key={c.className} className="mtb-slide-in" style={stagger(i)}>
                <button type="button" onClick={() => onPick(c.className)} className="grid w-full gap-1.5 rounded-lg border border-border px-3 py-2.5 text-left hover:bg-surface-hover" aria-label={`${c.label}: ${c.enrolled} of ${c.seats} seats. Show these students`}>
                  <span className="flex items-baseline justify-between gap-2">
                    <b className="font-medium text-ink">{c.label}</b>
                    <span className="text-small text-ink-muted">{c.sections.filter((x) => x.enrolled > 0).map((x) => `${x.section} ${x.enrolled}`).join(" · ")}</span>
                  </span>
                  <SeatMeter enrolled={c.enrolled} seats={c.seats} label={c.label} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <DataTable
          caption="Class strength"
          rows={classes.map((c) => ({ ...c, id: c.className }))}
          stickyHeader={false}
          density="dense"
          onRowClick={(c) => onPick(c.className)}
          columns={[
            { key: "label", header: "Class" },
            { key: "sections", header: "Sections", render: (c) => c.sections.filter((x) => x.enrolled > 0).map((x) => `${x.section} (${x.enrolled})`).join(", ") },
            { key: "girls", header: "Girls", align: "right", render: (c) => <span className="tabular-nums">{c.sections.reduce((a, x) => a + x.girls, 0)}</span> },
            { key: "boys", header: "Boys", align: "right", render: (c) => <span className="tabular-nums">{c.sections.reduce((a, x) => a + x.boys, 0)}</span> },
            { key: "enrolled", header: "Enrolled", align: "right", render: (c) => <b className="tabular-nums">{c.enrolled}</b> },
            { key: "seats", header: "Seats", align: "right", render: (c) => <span className="tabular-nums">{c.seats}</span> },
            { key: "free", header: "Free", align: "right", render: (c) => <span className="tabular-nums">{c.seats - c.enrolled}</span> },
          ]}
        />
      )}
    </Panel>
  );
}

/**
 * Builds a CSV of the rows on screen (the General Student List of the old reports), in the order on screen,
 * with the register columns: date of birth, gender, B-form, group, board roll no., previous school, guardian
 * mobile and address. Fee columns only for roles that see fees.
 */
function downloadCsv(rows: StudentSummary[], detail: Map<string, StudentListDetail>, withFees: boolean) {
  const head = [
    "G.R. no.",
    "Name",
    "Relation",
    "Father's name",
    "Date of birth",
    "Gender",
    "B-form no.",
    "Class",
    "Group",
    "Board roll no.",
    "Previous school",
    "Guardian mobile",
    "Address",
    "Campus",
    "Status",
    ...(withFees ? ["Fee status", "Balance (Rs)"] : []),
  ];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const body = rows.map((r) => {
    const d = detail.get(r.grNo);
    const roll = [d?.boardRollNo?.partI, d?.boardRollNo?.partII].filter(Boolean).join(" / ");
    return [
      r.grNo,
      r.name,
      r.relation,
      r.father,
      d?.dob ? formatDate(d.dob) : "",
      r.gender === "F" ? "Female" : "Male",
      d?.bForm ? formatCnic(d.bForm) : "",
      r.classSection,
      r.stream ?? "",
      roll,
      d?.previousSchool ?? "",
      d ? formatMobile(d.guardianMobile) : "",
      d?.address ?? "",
      r.campusName,
      ENROLMENT_STATUS_LABEL[r.status],
      ...(withFees ? [r.feeStatus, r.balance] : []),
    ]
      .map(esc)
      .join(",");
  });
  const blob = new Blob([`﻿${[head.map(esc).join(","), ...body].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "students.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function StudentsPage({ search, setSearch }: { search: StudentsSearch; setSearch: (s: StudentsSearch) => void }) {
  const ctx = useCtx();
  const navigate = useNavigate();
  const canAdmit = useCan("admissions.manage");
  const canAdmissions = useCan("admissions.view");
  const canFees = useCan("fees.view");
  const toast = useToast();
  const [q, setQ] = useState(search.q ?? "");
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<unknown>>(new Set());
  const [labels, setLabels] = useState<{ grNos: string[]; title: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  useEffect(() => setQ(search.q ?? ""), [search.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((search.q ?? "") !== q) setSearch({ ...search, ...(q ? { q } : { q: undefined }) });
    }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [search, ctx.campus, ctx.session]);

  const classes = useQuery(metaQueries.classes(ctx.campus));
  const strength = useQuery(studentsQueries.strength(ctx));
  const listQuery: StudentListQuery = {
    ...(search.q ? { q: search.q } : {}),
    ...(search.cls ? { className: search.cls } : {}),
    ...(search.sec ? { section: search.sec } : {}),
    ...(search.grp ? { stream: search.grp } : {}),
    ...(search.status ? { status: search.status } : {}),
    ...(search.fee ? { feeStatus: search.fee } : {}),
  };
  const list = useQuery(studentsQueries.list(ctx, listQuery));
  const family = list.data?.family;
  const chosenClass = classes.data?.find((c) => c.short === String(search.cls ?? ""));
  const sections = chosenClass?.sections ?? [];
  const groups = chosenClass?.groups ?? [];

  const rows = useMemo(() => {
    const items = [...(list.data?.items ?? [])];
    const dir = sort.dir === "asc" ? 1 : -1;
    items.sort((a, b) => {
      const k = sort.key as keyof StudentSummary;
      const av = a[k];
      const bv = b[k];
      return (typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv))) * dir;
    });
    return items;
  }, [list.data, sort]);
  const pageRows = rows.slice((page - 1) * 25, page * 25);

  const columns: Array<Column<StudentSummary>> = [
    { key: "photo", header: <span className="mtb-sr-only">Photo</span>, width: 52, render: (s) => <Avatar name={s.name} size="sm" /> },
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (s) => (
        <span className="grid">
          <span className="mtb-cell-primary">{s.name}</span>
          {s.nameUr && (
            <span lang="ur" dir="rtl" className="urdu-small justify-self-start text-ink-muted">
              {s.nameUr}
            </span>
          )}
        </span>
      ),
    },
    { key: "grNo", header: "G.R.", width: 120, sortable: true, render: (s) => <span className="mtb-mono">{s.grNo}</span> },
    { key: "classSection", header: "Class", width: 90, sortable: true },
    ...(groups.length || rows.some((r) => r.stream) ? [{ key: "stream", header: "Group", width: 160, sortable: true, render: (s: StudentSummary) => s.stream ?? <span className="text-ink-subtle">—</span> } as Column<StudentSummary>] : []),
    { key: "father", header: "Father's name", sortable: true, render: (s) => `${s.relation} ${s.father}` },
    ...(ctx.campus === "ALL" || family ? [{ key: "campusName", header: "Campus", width: 150, sortable: true } as Column<StudentSummary>] : []),
    { key: "status", header: "Enrolment", width: 120, render: (s) => <EnrolmentBadge status={s.status} /> },
    ...(canFees
      ? [
          { key: "feeStatus", header: "Fee status", width: 120, render: (s: StudentSummary) => <StatusBadge status={s.feeStatus} /> } as Column<StudentSummary>,
          { key: "balance", header: "Balance", align: "right", width: 120, sortable: true, render: (s: StudentSummary) => <Money value={s.balance} /> } as Column<StudentSummary>,
        ]
      : []),
  ];

  const filtered = Boolean(search.q || search.cls || search.sec || search.grp || search.status || search.fee);
  const ticked = rows.filter((r) => selected.has(r.grNo));

  /** The download carries the register columns, fetched for exactly the rows on screen. */
  const download = async () => {
    setDownloading(true);
    try {
      const res = await studentsApi.listDetail(ctx, listQuery);
      downloadCsv(rows, new Map(res.items.map((x) => [x.grNo, x])), canFees);
    } catch {
      toast({ tone: "danger", title: "The list could not be downloaded", message: "Check the connection and try again." });
    } finally {
      setDownloading(false);
    }
  };

  const openLabels = () => {
    const chosen = ticked.length ? ticked : rows;
    const what = ticked.length ? `${ticked.length} ticked ${ticked.length === 1 ? "student" : "students"}` : filtered ? `${rows.length} students in this list` : `all ${rows.length} students`;
    setLabels({ grNos: chosen.map((r) => r.grNo), title: what });
  };

  return (
    <RequirePermission permission="students.view" page="Students">
      <Page>
        <PageHeader
          title="Students"
          meta={list.data ? <span className="text-small text-ink-muted">{formatCount(list.data.total)} {filtered ? "matching" : "students"}</span> : undefined}
          actions={
            <>
              <Button icon="mapPin" disabled={!rows.length} onClick={openLabels}>
                {ticked.length ? `Address labels (${ticked.length})` : "Address labels"}
              </Button>
              <Button icon="download" disabled={!rows.length} loading={downloading} loadingLabel="Preparing…" onClick={() => void download()}>
                Download list
              </Button>
              {canAdmit && (
                <Link to="/admissions/new" className={buttonClassName({ variant: "primary" })}>
                  New admission
                </Link>
              )}
            </>
          }
        />
        <StudentsSubNav />
        {canAdmissions && strength.data && strength.data.duplicatesToReview > 0 && (
          <Banner
            tone="info"
            icon="merge"
            title={`${strength.data.duplicatesToReview} possible duplicate records to review`}
            actions={
              <Link to="/admissions/duplicates" className={buttonClassName({ size: "sm" })}>
                Review
              </Link>
            }
          >
            The same child may have been entered twice (for example at two campuses). Merging keeps the history of both records.
          </Banner>
        )}
        {strength.isError && <LoadError what="student figures" error={strength.error} onRetry={() => void strength.refetch()} />}
        {!filtered && <StrengthCards s={strength.data} />}
        {!filtered && <StrengthPanel s={strength.data} onPick={(cls) => setSearch({ cls })} />}
        {family && (
          <section className="mtb-card mtb-rise grid gap-3 p-5" aria-label="Family">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="m-0 text-title-2">{family.fatherName}'s family</h2>
              <span className="flex flex-wrap items-baseline gap-3 text-small text-ink-muted">
                <span>
                  Father's CNIC <span className="mtb-mono text-ink">{formatCnic(family.fatherCnic)}</span> · {family.members.length} children across {new Set(family.members.map((m) => m.campus)).size} campuses
                </span>
                {family.familyId && (
                  <Link to="/students/families/$familyId" params={{ familyId: family.familyId }} className="font-medium text-brand-ink underline-offset-2 hover:underline">
                    Open family record
                  </Link>
                )}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {family.members.map((m, i) => (
                <button key={m.grNo} type="button" onClick={() => navigate({ to: "/students/$grNo", params: { grNo: m.grNo } })} className="mtb-slide-in flex items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-surface-hover" style={stagger(i)}>
                  <Avatar name={m.name} />
                  <span className="grid min-w-0 flex-1">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-small text-ink-muted">
                      <span className="mtb-mono">{m.grNo}</span> · {m.classSection} · {m.campusName}
                    </span>
                  </span>
                  {canFees && <StatusBadge status={m.feeStatus} />}
                </button>
              ))}
            </div>
          </section>
        )}
        {list.isError && <LoadError what="student list" error={list.error} onRetry={() => void list.refetch()} />}
        <DataTable
          caption="Students"
          columns={columns}
          rows={pageRows}
          rowKey="grNo"
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          loading={list.isLoading}
          sort={sort}
          onSortChange={setSort}
          onRowClick={(s) => navigate({ to: "/students/$grNo", params: { grNo: s.grNo } })}
          empty={
            <EmptyState
              icon="search"
              title="No students match"
              description={looksLikeCnic(q) ? "No family is registered with this CNIC. Check the 13 digits." : "Check the spelling, or search by G.R. number or father's CNIC."}
              action={filtered ? <Button size="sm" onClick={() => setSearch({})}>Clear filters</Button> : undefined}
            />
          }
          toolbar={
            <div className="flex w-full flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1">
                <Input label="Search" icon="search" placeholder="Name, G.R. or father's CNIC (with or without dashes)" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <Select
                label="Class"
                value={search.cls ?? ""}
                onChange={(e) => setSearch({ ...search, cls: e.target.value || undefined, sec: undefined, grp: undefined })}
                options={[{ value: "", label: "All classes" }, ...(classes.data ?? []).map((c) => ({ value: c.short, label: c.name }))]}
              />
              <Select label="Section" value={search.sec ?? ""} disabled={!search.cls} onChange={(e) => setSearch({ ...search, sec: e.target.value || undefined })} options={[{ value: "", label: "All" }, ...sections]} />
              {groups.length > 0 && <Select label="Group" value={search.grp ?? ""} onChange={(e) => setSearch({ ...search, grp: e.target.value || undefined })} options={[{ value: "", label: "All groups" }, ...groups]} />}
              <Select
                label="Enrolment"
                value={search.status ?? ""}
                onChange={(e) => setSearch({ ...search, status: (e.target.value || undefined) as EnrolmentStatusCode | undefined })}
                options={[{ value: "", label: "All" }, ...(Object.keys(ENROLMENT_STATUS_LABEL) as EnrolmentStatusCode[]).map((k) => ({ value: k, label: ENROLMENT_STATUS_LABEL[k] }))]}
              />
              {canFees && (
                <Select
                  label="Fee status"
                  value={search.fee ?? ""}
                  onChange={(e) => setSearch({ ...search, fee: (e.target.value || undefined) as FeeStatusCode | undefined })}
                  options={[
                    { value: "", label: "All" },
                    { value: "paid", label: "Paid" },
                    { value: "unpaid", label: "Unpaid" },
                    { value: "overdue", label: "Overdue" },
                  ]}
                />
              )}
              {filtered && (
                <Button variant="ghost" onClick={() => setSearch({})}>
                  Clear
                </Button>
              )}
              {selected.size > 0 && (
                <span className="flex items-center gap-2 text-small text-ink-muted" aria-live="polite">
                  {selected.size} ticked
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Untick all
                  </Button>
                </span>
              )}
            </div>
          }
          pagination={rows.length > 25 ? <Pagination page={page} pageSize={25} total={rows.length} onPageChange={setPage} /> : undefined}
        />
        {/* The server sends at most 2,000 rows (no paging in the contract yet, spec 01_students D2 / C4). */}
        {list.data && list.data.total > list.data.items.length && (
          <p className="m-0 text-small text-ink-muted" role="status">
            Showing the first {formatCount(list.data.items.length)} of {formatCount(list.data.total)} students. Search or choose a class to narrow the list.
          </p>
        )}
        <AddressLabelsPanel open={labels !== null} onClose={() => setLabels(null)} query={{ grNos: labels?.grNos ?? [] }} title={labels?.title ?? ""} />
      </Page>
    </RequirePermission>
  );
}
