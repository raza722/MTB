import { HR_CATEGORY_LABEL, hrQueries, type CampusCode, type HrCategory, type HrGender, type HrStaffSummary } from "@mtb/api";
import { formatCnic, formatCount, formatDate, formatMobile, formatRs } from "@mtb/domain";
import { AnimatedNumber, Avatar, Banner, Button, DataTable, EmptyState, Input, Menu, MenuItem, Panel, SegmentedBar, Select, StatCard, type Column, type SortState } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { campusLabel } from "../../app/shell/campus";
import { RequirePermission } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { ReportDoc } from "./print";
import { useHrSettings } from "./StaffPanels";
import { campusHeading, CampusTags, cnicOrDash, dateOrDash, downloadCsv, filterNote, HrShell, LoadError, mobileOrDash, slide, StaffStatusBadge, usePayAccess, usePrint, years } from "./shared";

const CAT_COLOR: Record<HrCategory, string> = {
  TEACHING: "var(--chart-1)",
  MANAGEMENT: "var(--chart-2)",
  HIFZ: "var(--chart-3)",
  VISITING: "var(--chart-4)",
  NON_TEACHING: "var(--chart-5)",
};

const PAGE = 25;
/** Department filter value for staff whose posting has no department (migrated records). */
const NO_DEPT = "__none__";

/** Staff directory across campuses: one row per person, filters in one row, click through to the profile. */
export function StaffDirectoryPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const canManage = useCan("hr.manage");
  const showPay = usePayAccess();
  const overview = useQuery(hrQueries.overview(ctx));
  const list = useQuery(hrQueries.staff(ctx));
  const { print, area } = usePrint();
  const [query, setQuery] = useState("");
  const [campus, setCampus] = useState<CampusCode | "">("");
  const [category, setCategory] = useState<HrCategory | "">("");
  const [designation, setDesignation] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "LEFT" | "PROBATION" | "LEAVE" | "DOCS" | "">("ACTIVE");
  // Legacy staff list parameters: class level, subject and gender.
  const [gender, setGender] = useState<HrGender | "">("");
  const [level, setLevel] = useState("");
  const [subject, setSubject] = useState("");
  const settings = useHrSettings();
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [query, campus, category, designation, department, status, gender, level, subject, ctx.campus]);

  const all = list.data ?? [];
  const designations = useMemo(() => [...new Map(all.map((s) => [s.designationId, s.designation])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [all]);
  // Migrated postings have no department (null): they are found under "No department".
  const departments = useMemo(
    () => [...new Map(all.filter((s) => s.departmentId).map((s) => [s.departmentId as string, s.department ?? ""])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [all],
  );
  const noDepartment = useMemo(() => all.some((s) => !s.departmentId), [all]);
  const q = query.trim().toLowerCase().replace(/-/g, "");
  const rows = all
    .filter((s) => {
      if (q && !`${s.name} ${s.employeeNo} ${s.cnic} ${s.mobile} ${s.designation}`.toLowerCase().replace(/-/g, "").includes(q)) return false;
      if (campus && s.campus !== campus && !s.otherCampuses.includes(campus)) return false;
      if (category && s.category !== category) return false;
      if (designation && s.designationId !== designation) return false;
      if (department && (department === NO_DEPT ? Boolean(s.departmentId) : s.departmentId !== department)) return false;
      if (gender && s.gender !== gender) return false;
      if (level && !s.teachingLevels.includes(level)) return false;
      if (subject && !s.subjects.includes(subject)) return false;
      if (status === "ACTIVE" && s.status !== "ACTIVE") return false;
      if (status === "LEFT" && s.status !== "LEFT") return false;
      if (status === "PROBATION" && (s.status !== "ACTIVE" || s.employmentType !== "PROBATION")) return false;
      if (status === "LEAVE" && !s.onLeaveToday) return false;
      if (status === "DOCS" && (s.status !== "ACTIVE" || s.missingDocuments === 0)) return false;
      return true;
    })
    .sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      const strip = (n: string) => n.replace(/^(Mr|Ms|Mrs|Dr|Qari)\s+/, "");
      if (sort.key === "service") return (a.serviceYears - b.serviceYears) * dir;
      if (sort.key === "joined") return a.joiningDate.localeCompare(b.joiningDate) * dir;
      if (sort.key === "basic") return ((a.basic ?? 0) - (b.basic ?? 0)) * dir;
      if (sort.key === "designation") return a.designation.localeCompare(b.designation) * dir;
      return strip(a.name).localeCompare(strip(b.name)) * dir;
    });
  const filtered = Boolean(query || campus || category || designation || department || gender || level || subject || status !== "ACTIVE");
  const o = overview.data;
  const filterText = filterNote([
    category && HR_CATEGORY_LABEL[category],
    designation && designations.find(([id]) => id === designation)?.[1],
    department && (department === NO_DEPT ? "No department" : departments.find(([id]) => id === department)?.[1]),
    level && `Level: ${level}`,
    subject && `Subject: ${subject}`,
    gender === "F" ? "Women" : gender === "M" ? "Men" : "",
    { ACTIVE: "", PROBATION: "On probation", LEAVE: "On leave today", DOCS: "Documents missing", LEFT: "Left", "": "Everyone, including staff who left" }[status],
    query && `matching “${query}”`,
  ]);

  const columns: Array<Column<HrStaffSummary>> = [
    {
      key: "name",
      header: "Staff",
      sortable: true,
      render: (s) => (
        <span className="flex items-center gap-3">
          <Avatar name={s.name.replace(/^(Mr|Ms|Mrs|Dr|Qari)\s+/, "")} size="sm" tone={((s.employeeNo.charCodeAt(s.employeeNo.length - 1) % 4) + 1) as 1 | 2 | 3 | 4} />
          <span className="grid min-w-0">
            <span className="font-medium">{s.name}</span>
            <span className="text-small text-ink-muted">
              {s.employeeNo}
              {s.classTeacherOf ? ` · class teacher ${s.classTeacherOf}` : ""}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "designation",
      header: "Designation",
      sortable: true,
      render: (s) => (
        <span className="grid">
          <span>{s.designation}</span>
          {s.department && <span className="text-small text-ink-muted">{s.department}</span>}
        </span>
      ),
    },
    { key: "campus", header: "Campus", render: (s) => <CampusTags campus={s.campus} others={s.otherCampuses} /> },
    { key: "joined", header: "Joined", sortable: true, render: (s) => <span className="mtb-num text-small">{formatDate(s.joiningDate)}</span> },
    { key: "service", header: "Service", sortable: true, align: "right", render: (s) => <span className="mtb-num">{years(s.serviceYears)}</span> },
    ...(showPay ? [{ key: "basic", header: "Basic pay", sortable: true, align: "right" as const, render: (s: HrStaffSummary) => <span className="mtb-num">{s.basic ? formatRs(s.basic) : "—"}</span> }] : []),
    { key: "mobile", header: "Mobile", render: (s) => <span className="mtb-num text-small">{mobileOrDash(s.mobile)}</span> },
    {
      key: "status",
      header: "Status",
      render: (s) => (
        <span className="flex flex-wrap items-center gap-1">
          <StaffStatusBadge s={s} />
          {s.status === "ACTIVE" && s.missingDocuments > 0 && <span className="text-small text-warning-ink">{s.missingDocuments} doc missing</span>}
        </span>
      ),
    },
  ];

  const guardianLabel = (s: HrStaffSummary) => (s.guardianName ? `${s.relation} ${s.guardianName}` : "—");
  const exportRows = () =>
    downloadCsv(
      `staff-${ctx.campus.toLowerCase()}.csv`,
      ["Employee no", "Name", "Father/husband name", "Gender", "Date of birth", "Qualification", "Designation", "Department", "Category", "Levels taught", "Subjects", "CNIC", "Campus", "Also at", "Joined", "Service (years)", "Mobile", "Status"],
      rows.map((s) => [s.employeeNo, s.name, guardianLabel(s), s.gender === "F" ? "Female" : "Male", s.dob ? formatDate(s.dob) : "", s.highestQualification ?? "", s.designation, s.department ?? "", HR_CATEGORY_LABEL[s.category], s.teachingLevels.join("; "), s.subjects.join("; "), formatCnic(s.cnic), campusLabel(s.campus), s.otherCampuses.map(campusLabel).join("; "), formatDate(s.joiningDate), s.serviceYears, formatMobile(s.mobile), s.status === "LEFT" ? "Left" : "Active"]),
    );

  const heading = ctx.campus === "ALL" ? "All campuses" : campusHeading(ctx.campus);
  const printList = () =>
    print(
      <ReportDoc
        campus={heading}
        title="Staff list"
        sub={filterNote([`Total staff: ${rows.length}`, filterText])}
        head={["#", "Emp. no", "Name", "Designation", "Department", "Joined", "Service", "Mobile"]}
        numeric={[6]}
        rows={rows.map((s, i) => [i + 1, s.employeeNo, s.name, s.designation, s.department ?? "", formatDate(s.joiningDate), years(s.serviceYears), mobileOrDash(s.mobile)])}
        signatures={["Office", "Principal"]}
      />,
      "A4",
    );

  /** Legacy "Bio Data Report": personal details for each person on one line, A4 landscape. */
  const printBioData = () =>
    print(
      <ReportDoc
        campus={heading}
        title="Staff bio-data"
        sub={filterNote([`Total staff: ${rows.length}`, filterText])}
        small
        head={["#", "Emp. no", "Name", "Father/husband name", "Date of birth", "Joined", "Qualification", "Designation", "Subjects", "CNIC", "Mobile"]}
        rows={rows.map((s, i) => [i + 1, s.employeeNo, s.name, guardianLabel(s), dateOrDash(s.dob), formatDate(s.joiningDate), s.highestQualification ?? "", s.designation, s.subjects.join(", "), cnicOrDash(s.cnic), mobileOrDash(s.mobile)])}
        signatures={["Office", "Principal"]}
      />,
      "A4L",
    );

  return (
    <RequirePermission permission="hr.view" page="Staff">
      <HrShell
        title="Staff"
        actions={
          <>
            <Button icon="download" onClick={exportRows} disabled={!rows.length}>
              Export
            </Button>
            <Menu
              trigger={
                <Button icon="printer" iconRight="chevronDown" disabled={!rows.length}>
                  Print list
                </Button>
              }
            >
              <MenuItem icon="file" onSelect={printList}>
                Staff list
              </MenuItem>
              <MenuItem icon="listChecks" onSelect={printBioData}>
                Bio-data list (A4 landscape)
              </MenuItem>
            </Menu>
            {canManage && !readOnly && (
              <Button variant="primary" icon="plus" onClick={() => void navigate({ to: "/hr/new" })}>
                Add staff
              </Button>
            )}
          </>
        }
      >
        {(overview.isError || list.isError) && <LoadError what="Staff" error={overview.error ?? list.error} onRetry={() => void Promise.all([overview.refetch(), list.refetch()])} />}

        <div className="hr-kpis">
          <StatCard label="Staff working now" icon="hr" loading={overview.isLoading} value={<AnimatedNumber value={o?.active ?? 0} format={formatCount} />} foot={o ? `${formatCount(o.female)} women · ${formatCount(o.male)} men` : undefined} onClick={() => setStatus("ACTIVE")} />
          <StatCard label="On leave today" icon="calendar" tone={(o?.onLeaveToday ?? 0) > 0 ? "info" : "neutral"} loading={overview.isLoading} value={<AnimatedNumber value={o?.onLeaveToday ?? 0} format={formatCount} />} foot={o?.pendingLeave ? `${o.pendingLeave} leave request${o.pendingLeave === 1 ? "" : "s"} waiting` : "No requests waiting"} onClick={() => setStatus("LEAVE")} />
          <StatCard label="Joined this session" icon="plus" loading={overview.isLoading} value={<AnimatedNumber value={o?.joinedThisSession ?? 0} format={formatCount} />} foot={o ? `${o.onProbation} on probation · ${o.leftThisSession} left` : undefined} onClick={() => setStatus("PROBATION")} />
          <StatCard
            label="Files missing a document"
            icon="file"
            tone={(o?.missingDocuments ?? 0) > 0 ? "warning" : "neutral"}
            loading={overview.isLoading}
            value={<AnimatedNumber value={o?.missingDocuments ?? 0} format={formatCount} />}
            foot="CNIC copy, degree or police verification"
            onClick={() => setStatus("DOCS")}
          />
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Panel id="by-category" title="Who works here" description={`${campusLabel(ctx.campus)}: staff by kind of work. Click a kind to filter the list.`} rise={1}>
            {!o ? (
              <div className="h-24" />
            ) : (
              <div className="grid gap-4">
                <SegmentedBar label="Staff by kind of work" format={formatCount} segments={o.byCategory.map((c) => ({ key: c.category, label: HR_CATEGORY_LABEL[c.category], value: c.count, color: CAT_COLOR[c.category] }))} />
                <ul className="m-0 grid list-none gap-1.5 p-0 text-small sm:grid-cols-2">
                  {o.byCategory.map((c, i) => (
                    <li key={c.category} className="mtb-slide-in" style={slide(i)}>
                      <button type="button" className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left hover:bg-surface-hover" onClick={() => setCategory(category === c.category ? "" : c.category)} aria-pressed={category === c.category}>
                        <span className="flex items-center gap-2">
                          <span className="mtb-chart-key" style={{ background: CAT_COLOR[c.category] }} aria-hidden="true" />
                          {HR_CATEGORY_LABEL[c.category]}
                        </span>
                        <span className="tabular-nums">{formatCount(c.count)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
          <Panel id="one-profile" title="One profile per person" description="Staff who work at two campuses have one record with a posting at each." rise={2}>
            {o && o.sharedWithOtherCampuses > 0 ? (
              <p className="m-0 text-small text-ink-muted">
                <span className="text-title-3 text-ink tabular-nums">{o.sharedWithOtherCampuses}</span> {o.sharedWithOtherCampuses === 1 ? "person works" : "people work"} at another campus too. Their salary, leave and documents stay on the one profile; each campus sees its own timetable and attendance.
              </p>
            ) : (
              <p className="m-0 text-small text-ink-muted">Nobody here works at a second campus right now.</p>
            )}
            {o && (o.pendingIncrements > 0 || o.pendingLoans > 0) && showPay && (
              <Banner tone="info" className="mt-3" title="Waiting for a decision">
                {[o.pendingIncrements && `${o.pendingIncrements} increment run`, o.pendingLoans && `${o.pendingLoans} loan request`].filter(Boolean).join(" and ")}. Open Increments or Loans to decide.
              </Banner>
            )}
          </Panel>
        </div>

        <DataTable
          caption={`Staff, ${campusLabel(ctx.campus)}`}
          columns={columns}
          rows={rows.slice((page - 1) * PAGE, page * PAGE)}
          loading={list.isLoading}
          sort={sort}
          onSortChange={setSort}
          onRowClick={(s) => void navigate({ to: "/hr/staff/$staffId", params: { staffId: s.id } })}
          rowClassName={() => "mtb-slide-in"}
          toolbar={
            <div className="flex w-full flex-wrap items-end gap-3">
              <div className="w-64">
                <Input aria-label="Search staff" placeholder="Name, employee no., CNIC or mobile" icon="search" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              {ctx.campus === "ALL" && (
                <div className="w-44">
                  <Select aria-label="Campus" value={campus} onChange={(e) => setCampus(e.target.value as CampusCode | "")} options={[{ value: "", label: "Every campus" }, ...(["KC", "SM", "UC", "MC", "HC"] as const).map((c) => ({ value: c, label: campusLabel(c) }))]} />
                </div>
              )}
              <div className="w-44">
                <Select aria-label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} options={[{ value: "", label: "Every department" }, ...departments.map(([v, l]) => ({ value: v, label: l })), ...(noDepartment ? [{ value: NO_DEPT, label: "No department" }] : [])]} />
              </div>
              <div className="w-48">
                <Select aria-label="Designation" value={designation} onChange={(e) => setDesignation(e.target.value)} options={[{ value: "", label: "Every designation" }, ...designations.map(([v, l]) => ({ value: v, label: l }))]} />
              </div>
              <div className="w-40">
                <Select aria-label="Level taught" value={level} onChange={(e) => setLevel(e.target.value)} options={[{ value: "", label: "Every level" }, ...(settings.data?.teachingLevels ?? []).map((l) => ({ value: l, label: l }))]} />
              </div>
              <div className="w-40">
                <Select aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} options={[{ value: "", label: "Every subject" }, ...(settings.data?.subjects ?? []).map((x) => ({ value: x.name, label: x.name }))]} />
              </div>
              <div className="w-36">
                <Select
                  aria-label="Gender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value as HrGender | "")}
                  options={[
                    { value: "", label: "Women and men" },
                    { value: "F", label: "Women" },
                    { value: "M", label: "Men" },
                  ]}
                />
              </div>
              <div className="w-44">
                <Select
                  aria-label="Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                  options={[
                    { value: "ACTIVE", label: "Working now" },
                    { value: "PROBATION", label: "On probation" },
                    { value: "LEAVE", label: "On leave today" },
                    { value: "DOCS", label: "Documents missing" },
                    { value: "LEFT", label: "Left" },
                    { value: "", label: "Everyone" },
                  ]}
                />
              </div>
              {filtered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setCampus("");
                    setCategory("");
                    setDesignation("");
                    setDepartment("");
                    setGender("");
                    setLevel("");
                    setSubject("");
                    setStatus("ACTIVE");
                  }}
                >
                  Clear filters
                </Button>
              )}
              <span className="ml-auto text-small text-ink-muted">
                {formatCount(rows.length)} of {formatCount(all.length)}
              </span>
            </div>
          }
          pagination={
            rows.length > PAGE ? (
              <div className="flex items-center justify-between gap-3 px-4 py-2 text-small text-ink-muted">
                <span>
                  Showing {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, rows.length)} of {rows.length}
                </span>
                <span className="flex gap-2">
                  <Button size="sm" icon="chevronLeft" disabled={page === 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" iconRight="chevronRight" disabled={page * PAGE >= rows.length} onClick={() => setPage(page + 1)}>
                    Next
                  </Button>
                </span>
              </div>
            ) : undefined
          }
          empty={
            <EmptyState
              icon="hr"
              title={filtered ? "No staff match" : "No staff yet"}
              description={filtered ? "Clear the filters to see everyone." : "Add the first staff member to start the register."}
              action={!filtered && canManage && !readOnly ? <Button variant="primary" onClick={() => void navigate({ to: "/hr/new" })}>Add staff</Button> : undefined}
            />
          }
        />
        {area}
      </HrShell>
    </RequirePermission>
  );
}
