import { feeSetupQueries, type FeeClassArrearsRow, type FeeDefaulter } from "@mtb/api";
import { formatCount, formatDate, formatMobile, formatRs, formatSession } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, buttonClassName, ColumnChart, DataTable, DatePicker, EmptyState, Icon, Pagination, Panel, Segmented, Select, Skeleton, StatCard, Switch, type Column } from "@mtb/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { campusLabel } from "../../../app/shell/campus";
import { Page, PageHeader, RequirePermission } from "../../../app/shell/page";
import { useCtx } from "../../../app/session";
import { feeToday, FeesNav, HeadPicker, lakhTick, LoadError, PaperSize, pctText, useFeeClasses } from "../shared";

interface ClassRow {
  key: string;
  label: string;
  /** Class strength (enrolled students). */
  strength: number;
  students: number;
  billed: number;
  paid: number;
  outstanding: number;
  fine: number;
  total: number;
  threePlus: number;
  /** Overdue fees as a share of billed; null when nothing was billed. */
  pct: number | null;
}

/** a as a share of b, one decimal; null when b is 0 (shown as "—"). */
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function ArrearsReport() {
  const ctx = useCtx();
  const classList = useFeeClasses(ctx.campus);
  const { nameOf, sectionsOf } = classList;
  const [includeLeft, setIncludeLeft] = useState(false);
  const [view, setView] = useState("chart");
  const [cls, setCls] = useState<string | null>(null);
  const [section, setSection] = useState("");
  const [heads, setHeads] = useState<string[]>([]);
  const [dueFrom, setDueFrom] = useState<string | null>(null);
  const [dueTo, setDueTo] = useState<string | null>(null);
  const dueError = dueFrom && dueTo && dueFrom > dueTo ? "The first date must be on or before the second." : undefined;
  const filter = { heads: heads.join(","), dueFrom: dueFrom ?? "", dueTo: dueTo ?? "", classShort: cls ?? "", section: cls ? section : "" };
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [includeLeft, cls, section, heads, dueFrom, dueTo, ctx.campus, ctx.session]);
  // The defaulters come a page at a time (contract C8); the summary and the per-class totals cover every one.
  const q = useQuery({ ...feeSetupQueries.defaulters(ctx, { includeLeft, ...filter, page, pageSize: 100 }), enabled: !dueError, placeholderData: keepPreviousData });
  // Billed and paid per class for the same heads and due dates (every class, so the table compares them).
  const billedQ = useQuery({ ...feeSetupQueries.classArrears(ctx, { heads: filter.heads, dueFrom: filter.dueFrom, dueTo: filter.dueTo }), enabled: !dueError, placeholderData: keepPreviousData });
  const rows = q.data?.rows ?? [];
  // With a class chosen, the per-class totals of every class come from the same query without the class.
  const allQ = useQuery({ ...feeSetupQueries.defaulters(ctx, { includeLeft, heads: filter.heads, dueFrom: filter.dueFrom, dueTo: filter.dueTo, pageSize: 1 }), enabled: !dueError && Boolean(cls), placeholderData: keepPreviousData });
  const classTotals = (cls ? allQ.data?.byClass : q.data?.byClass) ?? [];

  const byClass = useMemo<ClassRow[]>(() => {
    const m = new Map<string, ClassRow>();
    // Setup's class order; a class Setup does not list (yet) goes last.
    const order = (k: string) => {
      const i = classList.classes.findIndex((c) => c.short === k);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const blank = (k: string): ClassRow => ({ key: k, label: nameOf(k), strength: 0, students: 0, billed: 0, paid: 0, outstanding: 0, fine: 0, total: 0, threePlus: 0, pct: 0 });
    for (const b of billedQ.data?.rows ?? []) {
      const g = m.get(b.classShort) ?? blank(b.classShort);
      g.strength += b.strength;
      g.billed += b.billed;
      g.paid += b.paid;
      m.set(b.classShort, g);
    }
    for (const t of classTotals) {
      const k = t.classShort;
      const g = m.get(k) ?? blank(k);
      g.students += t.students;
      g.outstanding += t.outstanding;
      g.fine += t.fine;
      g.total += t.total;
      g.threePlus += t.threePlus;
      m.set(k, g);
    }
    return [...m.values()]
      .map((g) => ({ ...g, pct: pctOf(g.outstanding, g.billed) }))
      .filter((g) => g.students > 0 || g.billed > 0)
      .sort((a, b) => order(a.key) - order(b.key));
  }, [classTotals, billedQ.data, nameOf, classList.classes]);

  const sections = (billedQ.data?.rows ?? []).filter((r) => !cls || r.classShort === cls);
  const students = rows;
  const sum = (xs: FeeDefaulter[], f: (r: FeeDefaulter) => number) => xs.reduce((a, r) => a + f(r), 0);
  const totals = byClass.reduce((a, c) => ({ strength: a.strength + c.strength, students: a.students + c.students, billed: a.billed + c.billed, paid: a.paid + c.paid, outstanding: a.outstanding + c.outstanding, fine: a.fine + c.fine, total: a.total + c.total }), { strength: 0, students: 0, billed: 0, paid: 0, outstanding: 0, fine: 0, total: 0 });
  const headText = heads.map((h) => q.data?.heads.find((x) => x.code === h)?.title ?? h).join(", ");
  const filterText = [headText, dueFrom || dueTo ? `due ${dueFrom ? formatDate(dueFrom) : "from the start"} to ${dueTo ? formatDate(dueTo) : "today"}` : ""].filter(Boolean).join(" · ");

  const classCols: Array<Column<ClassRow>> = [
    { key: "label", header: "Class", render: (c) => <span className="font-medium">{c.label}</span> },
    { key: "strength", header: "Total students", align: "right", render: (c) => formatCount(c.strength) },
    { key: "students", header: "In arrears", align: "right", render: (c) => formatCount(c.students) },
    { key: "billed", header: "Billed", align: "right", render: (c) => <span className="mtb-num">{formatRs(c.billed)}</span> },
    { key: "paid", header: "Paid", align: "right", render: (c) => <span className="mtb-num">{formatRs(c.paid)}</span> },
    { key: "outstanding", header: "Overdue fees", align: "right", render: (c) => <span className="mtb-num">{formatRs(c.outstanding)}</span> },
    { key: "pct", header: "Arrear %", align: "right", render: (c) => <span className="mtb-num">{pctText(c.pct)}</span> },
    { key: "fine", header: "Late fine", align: "right", render: (c) => <span className="mtb-num">{formatRs(c.fine)}</span> },
    { key: "total", header: "Total", align: "right", render: (c) => <span className="mtb-num font-semibold">{formatRs(c.total)}</span> },
    { key: "threePlus", header: "3+ months", align: "right", render: (c) => (c.threePlus ? <span className="text-status-overdue-ink">{formatCount(c.threePlus)}</span> : "0") },
  ];
  const sectionCols: Array<Column<FeeClassArrearsRow>> = [
    { key: "classSection", header: "Section", render: (r) => <span className="font-medium">{r.classSection}</span> },
    { key: "strength", header: "Total students", align: "right", render: (r) => formatCount(r.strength) },
    { key: "students", header: "In arrears", align: "right", render: (r) => formatCount(r.students) },
    { key: "billed", header: "Billed", align: "right", render: (r) => <span className="mtb-num">{formatRs(r.billed)}</span> },
    { key: "paid", header: "Paid", align: "right", render: (r) => <span className="mtb-num">{formatRs(r.paid)}</span> },
    { key: "arrears", header: "Arrears", align: "right", render: (r) => <span className="mtb-num font-semibold">{formatRs(r.arrears)}</span> },
    { key: "pct", header: "Arrear %", align: "right", render: (r) => <span className="mtb-num">{pctText(r.pct)}</span> },
  ];
  const studentCols: Array<Column<FeeDefaulter>> = [
    { key: "student", header: "Student", render: (r) => <span className="grid"><span className="font-medium">{r.studentName}</span><span className="text-small text-ink-muted">{r.grNo} · {r.father}{r.enrolment !== "ACTIVE" ? " · left" : ""}</span></span> },
    { key: "class", header: "Class", render: (r) => r.classSection },
    { key: "mobile", header: "Mobile", render: (r) => <span className="mtb-num">{formatMobile(r.mobile)}</span> },
    { key: "since", header: "Oldest unpaid", render: (r) => <span className="mtb-num">{formatDate(r.oldestDue)}</span> },
    { key: "session", header: "This session", align: "right", render: (r) => <span className="mtb-num text-ink-muted">{formatRs(r.sessionTotal)}</span> },
    { key: "prev", header: "Last class", align: "right", render: (r) => (r.previousSessionArrears ? <span className="mtb-num">{formatRs(r.previousSessionArrears)}</span> : "") },
    { key: "fees", header: "Overdue fees", align: "right", render: (r) => <span className="mtb-num">{formatRs(r.outstanding)}</span> },
    { key: "fine", header: "Late fine", align: "right", render: (r) => <span className="mtb-num">{formatRs(r.fine)}</span> },
    { key: "total", header: "Total", align: "right", render: (r) => <span className="mtb-num font-semibold">{formatRs(r.total)}</span> },
  ];

  return (
    <RequirePermission permission="fees.reports" page="the arrears report">
      <Page>
        <PageHeader
          title="Arrears"
          context={`${campusLabel(ctx.campus)} · Session ${formatSession(ctx.session)} · as of ${formatDate(q.data?.today ?? feeToday())}`}
          actions={
            <>
              <Button icon="printer" onClick={() => window.print()} disabled={!q.data}>
                Print report
              </Button>
              <Link to="/fees/defaulters" className={buttonClassName({ variant: "primary" })}>
                <Icon name="send" size={16} />
                Remind families
              </Link>
            </>
          }
        />
        <FeesNav />
        <Banner tone="info">Arrears are fees past their due date and still unpaid, worked out from each student's ledger with today's late fine. Nobody types a balance in.</Banner>
        {q.isError && <LoadError what="Arrears" error={q.error} onRetry={() => void q.refetch()} />}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Students in arrears" icon="students" loading={q.isLoading} value={<AnimatedNumber value={q.data?.summary.students ?? 0} format={formatCount} />} foot={includeLeft ? "Including families who left" : "Enrolled students"} />
          <StatCard label="Overdue fees" icon="fees" loading={q.isLoading} value={<AnimatedNumber value={q.data?.summary.outstanding ?? 0} format={formatRs} />} foot={totals.billed ? `${pctText(pctOf(totals.outstanding, totals.billed))} of ${formatRs(totals.billed)} billed` : "Before late fine"} />
          <StatCard label="Late fine to today" icon="clock" loading={q.isLoading} value={<AnimatedNumber value={q.data?.summary.fine ?? 0} format={formatRs} />} foot="Each campus's own rule" />
          <StatCard label="Three months or more" icon="alertCircle" tone="danger" loading={q.isLoading} value={<AnimatedNumber value={q.data?.summary.threePlus ?? 0} format={formatCount} />} foot="The hardest to recover" />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <HeadPicker heads={q.data?.heads ?? []} value={heads} onChange={setHeads} />
          <div className="w-40">
            <DatePicker label="Due from" value={dueFrom} onValueChange={setDueFrom} today={feeToday()} maxDate={feeToday()} />
          </div>
          <div className="w-40">
            <DatePicker label="Due to" value={dueTo} onValueChange={setDueTo} today={feeToday()} maxDate={feeToday()} error={dueError} />
          </div>
          <div className="w-36">
            <Select
              label="Class"
              value={cls ?? ""}
              onChange={(e) => {
                setCls(e.target.value || null);
                setSection("");
              }}
              options={[{ value: "", label: "Every class" }, ...classList.options]}
            />
          </div>
          <div className="w-32">
            <Select label="Section" value={section} disabled={!cls} onChange={(e) => setSection(e.target.value)} options={[{ value: "", label: cls ? "Every section" : "—" }, ...sectionsOf(cls ?? "").map((x) => ({ value: x, label: `${cls}-${x}` }))]} />
          </div>
          <Switch label="Include families who have left (still owing)" checked={includeLeft} onChange={(e) => setIncludeLeft(e.target.checked)} />
        </div>
        {(q.isLoading || billedQ.isLoading) && <Skeleton height={300} />}
        {q.data && byClass.length === 0 && (
          <div className="mtb-card">
            <EmptyState icon="checkCircle" title="No arrears" description={filterText ? "Nobody owes anything for these heads and dates." : "Every student is up to date."} />
          </div>
        )}
        {q.data && byClass.length > 0 && (
          <Panel
            id="arrears-class"
            title="By class"
            description={`Billed to date against what is overdue${filterText ? ` · ${filterText}` : ""}. Choose a class to see its students below.`}
            rise={1}
            flush={view !== "chart"}
            actions={<Segmented aria-label="Show as" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }, { value: "sections", label: "Sections" }]} />}
          >
            {view === "chart" && (
              <ColumnChart
                data={byClass}
                value={(c) => c.total}
                axisLabel={(c) => (c.key === "Prep" ? "Prep" : c.key)}
                formatAxis={lakhTick}
                tooltip={(c) => (
                  <>
                    <div className="mtb-chart-tip-title">{c.label}</div>
                    <div className="mtb-chart-tip-value">{formatRs(c.total)}</div>
                    <div className="mtb-chart-tip-row">
                      <span>Students</span>
                      <span>
                        {formatCount(c.students)} of {formatCount(c.strength)}
                      </span>
                    </div>
                    <div className="mtb-chart-tip-row">
                      <span>Arrear %</span>
                      <span>{pctText(c.pct)}</span>
                    </div>
                    <div className="mtb-chart-tip-row">
                      <span>Late fine</span>
                      <span>{formatRs(c.fine)}</span>
                    </div>
                  </>
                )}
                describe={(c) => `${c.label}: ${formatRs(c.total)} owed by ${formatCount(c.students)} of ${formatCount(c.strength)} students, ${pctText(c.pct)} of billed`}
                label="Arrears by class, with late fine"
                height={240}
              />
            )}
            {view === "table" && (
              <DataTable
                caption="Arrears by class"
                rows={byClass}
                rowKey="key"
                columns={classCols}
                onRowClick={(c) => setCls(c.key)}
                footer={{
                  label: "All classes",
                  strength: formatCount(totals.strength),
                  students: formatCount(totals.students),
                  billed: formatRs(totals.billed),
                  paid: formatRs(totals.paid),
                  outstanding: formatRs(totals.outstanding),
                  pct: pctText(pctOf(totals.outstanding, totals.billed)),
                  fine: formatRs(totals.fine),
                  total: formatRs(totals.total),
                }}
              />
            )}
            {view === "sections" && (
              <DataTable
                caption="Arrears by class and section"
                rows={sections}
                rowKey="classSection"
                columns={sectionCols}
                density="dense"
                onRowClick={(r) => {
                  setCls(r.classShort);
                  setSection(r.section);
                }}
                footer={{
                  classSection: cls ? nameOf(cls) : "All sections",
                  strength: formatCount(sections.reduce((a, r) => a + r.strength, 0)),
                  students: formatCount(sections.reduce((a, r) => a + r.students, 0)),
                  billed: formatRs(sections.reduce((a, r) => a + r.billed, 0)),
                  paid: formatRs(sections.reduce((a, r) => a + r.paid, 0)),
                  arrears: formatRs(sections.reduce((a, r) => a + r.arrears, 0)),
                  pct: pctText(pctOf(sections.reduce((a, r) => a + r.arrears, 0), sections.reduce((a, r) => a + r.billed, 0))),
                }}
              />
            )}
            {view === "chart" && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant={cls === null ? "primary" : "secondary"} onClick={() => setCls(null)}>
                  Every class
                </Button>
                {byClass.map((c) => (
                  <Button key={c.key} size="sm" variant={cls === c.key ? "primary" : "secondary"} onClick={() => setCls(c.key)}>
                    {c.label} · {formatRs(c.total)}
                  </Button>
                ))}
              </div>
            )}
          </Panel>
        )}
        {q.data && rows.length > 0 && (
          <DataTable
            caption={cls ? `Arrears, ${nameOf(cls)}${section ? `-${section}` : ""}` : "Arrears, every student"}
            columns={studentCols}
            rows={students}
            rowKey="grNo"
            toolbar={
              <div className="flex w-full items-center justify-between gap-3">
                <span className="font-medium">{cls ? `${nameOf(cls)}${section ? `-${section}` : ""} · ${formatCount(q.data.total)} students` : `Every class · ${formatCount(q.data.total)} students`}</span>
                {cls && (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="x"
                    onClick={() => {
                      setCls(null);
                      setSection("");
                    }}
                  >
                    Show every class
                  </Button>
                )}
              </div>
            }
            pagination={q.data.total > q.data.pageSize ? <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={setPage} /> : undefined}
            footer={{ student: q.data.total > students.length ? `${formatCount(students.length)} on this page` : `${formatCount(students.length)} students`, session: formatRs(sum(students, (r) => r.sessionTotal)), prev: formatRs(sum(students, (r) => r.previousSessionArrears)), fees: formatRs(sum(students, (r) => r.outstanding)), fine: formatRs(sum(students, (r) => r.fine)), total: formatRs(sum(students, (r) => r.total)) }}
          />
        )}
        {q.data && (
          <div className="fees-print-only mtb-print-area fees-print-a4">
            <PaperSize size="A4" />
            <div className="fees-doc" data-theme="light">
              <div className="fees-doc-head">
                <div>
                  <h1>Arrears by class and student</h1>
                  <p>
                    {campusLabel(ctx.campus)} · Session {formatSession(ctx.session)}
                    {filterText ? ` · ${filterText}` : ""}
                    {includeLeft ? " · including families who left" : ""}
                  </p>
                </div>
                <p>As of {formatDate(q.data?.today ?? feeToday())}</p>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Class</th>
                    <th className="n">Students</th>
                    <th className="n">In arrears</th>
                    <th className="n">Billed</th>
                    <th className="n">Paid</th>
                    <th className="n">Overdue fees</th>
                    <th className="n">Arrear %</th>
                    <th className="n">Late fine</th>
                    <th className="n">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {byClass.map((c) => (
                    <tr key={c.key}>
                      <td>{c.label}</td>
                      <td className="n">{formatCount(c.strength)}</td>
                      <td className="n">{formatCount(c.students)}</td>
                      <td className="n">{formatRs(c.billed)}</td>
                      <td className="n">{formatRs(c.paid)}</td>
                      <td className="n">{formatRs(c.outstanding)}</td>
                      <td className="n">{pctText(c.pct)}</td>
                      <td className="n">{formatRs(c.fine)}</td>
                      <td className="n">{formatRs(c.total)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>Total</strong>
                    </td>
                    <td className="n">
                      <strong>{formatCount(totals.strength)}</strong>
                    </td>
                    <td className="n">
                      <strong>{formatCount(totals.students)}</strong>
                    </td>
                    <td className="n">
                      <strong>{formatRs(totals.billed)}</strong>
                    </td>
                    <td className="n">
                      <strong>{formatRs(totals.paid)}</strong>
                    </td>
                    <td className="n">
                      <strong>{formatRs(totals.outstanding)}</strong>
                    </td>
                    <td className="n">
                      <strong>{pctText(pctOf(totals.outstanding, totals.billed))}</strong>
                    </td>
                    <td className="n">
                      <strong>{formatRs(totals.fine)}</strong>
                    </td>
                    <td className="n">
                      <strong>{formatRs(totals.total)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
              <h2>Students{cls ? ` · ${nameOf(cls)}${section ? `-${section}` : ""}` : ""}</h2>
              <table>
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>G.R. no.</th>
                    <th>Student</th>
                    <th>Mobile</th>
                    <th>Since</th>
                    <th className="n">Session</th>
                    <th className="n">Last class</th>
                    <th className="n">Fees</th>
                    <th className="n">Fine</th>
                    <th className="n">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...students]
                    .sort((a, b) => a.classSection.localeCompare(b.classSection, "en", { numeric: true }))
                    .map((r) => (
                      <tr key={r.grNo}>
                        <td>{r.classSection}</td>
                        <td>{r.grNo}</td>
                        <td>{r.studentName}</td>
                        <td>{formatMobile(r.mobile)}</td>
                        <td>{formatDate(r.oldestDue)}</td>
                        <td className="n">{formatRs(r.sessionTotal)}</td>
                        <td className="n">{r.previousSessionArrears ? formatRs(r.previousSessionArrears) : ""}</td>
                        <td className="n">{formatRs(r.outstanding)}</td>
                        <td className="n">{formatRs(r.fine)}</td>
                        <td className="n">{formatRs(r.total)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <div className="fees-doc-sign">
                <div>Accountant</div>
                <div>Principal</div>
                <div>Date</div>
              </div>
            </div>
          </div>
        )}
      </Page>
    </RequirePermission>
  );
}
