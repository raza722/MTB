import { studentFamiliesQueries, type StudentFamilyRow } from "@mtb/api";
import { formatCnic, formatCount, formatMobile, formatRs } from "@mtb/domain";
import { AnimatedNumber, DataTable, EmptyState, Input, Money, Pagination, StatCard, StatusBadge, type Column } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Page, PageHeader, RequirePermission } from "../../../app/shell/page";
import { useCan, useCtx } from "../../../app/session";
import { LoadError, stagger, StudentsSubNav } from "../shared";

/** One record per family: siblings across campuses, guardians and the family's fees. */
export function FamiliesPage({ q: initialQ, setQ: pushQ }: { q: string; setQ: (q: string) => void }) {
  const ctx = useCtx();
  const navigate = useNavigate();
  const canFees = useCan("fees.view");
  const [q, setQ] = useState(initialQ);
  const [page, setPage] = useState(1);
  useEffect(() => setQ(initialQ), [initialQ]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== initialQ) pushQ(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useQuery(studentFamiliesQueries.list(ctx, initialQ));
  const s = list.data?.stats;
  const rows = list.data?.items ?? [];

  const columns: Array<Column<StudentFamilyRow>> = [
    {
      key: "fatherName",
      header: "Family",
      render: (f) => (
        <span className="grid">
          <span className="mtb-cell-primary">{f.fatherName}</span>
          <span className="mtb-cell-secondary">
            <span className="mtb-mono">{f.id}</span> · CNIC <span className="mtb-mono">{f.fatherCnic ? formatCnic(f.fatherCnic) : "not given"}</span>
          </span>
        </span>
      ),
    },
    {
      key: "children",
      header: "Children",
      render: (f) => (
        <span className="grid">
          <span>{f.childNames}</span>
          <span className="mtb-cell-secondary">
            {f.children} {f.children === 1 ? "child" : "children"}
            {f.enrolledChildren !== f.children ? ` · ${f.enrolledChildren} enrolled` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "campuses",
      header: "Campuses",
      width: 200,
      render: (f) => (
        <span className="flex flex-wrap gap-1">
          {f.campusNames.map((c) => (
            <StatusBadge key={c} status={f.campuses.length > 1 ? "info" : "neutral"}>
              {c.replace(" Campus", "")}
            </StatusBadge>
          ))}
        </span>
      ),
    },
    { key: "mobile", header: "Father's mobile", width: 140, render: (f) => <span className="tabular-nums">{formatMobile(f.mobile)}</span> },
    ...(canFees
      ? [
          { key: "feeStatus", header: "Fees", width: 110, render: (f: StudentFamilyRow) => <StatusBadge status={f.feeStatus} /> } as Column<StudentFamilyRow>,
          { key: "balance", header: "Family balance", align: "right", width: 140, render: (f: StudentFamilyRow) => <Money value={f.balance} /> } as Column<StudentFamilyRow>,
        ]
      : []),
  ];

  return (
    <RequirePermission permission="students.view" page="Families">
      <Page>
        <PageHeader title="Families" meta={list.data ? <span className="text-small text-ink-muted">{formatCount(list.data.total)} {initialQ ? "matching" : "families"}</span> : undefined} />
        <StudentsSubNav />
        {list.isError && <LoadError what="families" error={list.error} onRetry={() => void list.refetch()} />}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="mtb-rise" style={stagger(1)}>
            <StatCard label="Families" icon="home" loading={!s} value={s ? <AnimatedNumber value={s.families} format={formatCount} /> : undefined} foot="grouped by the father's CNIC" />
          </div>
          <div className="mtb-rise" style={stagger(2)}>
            <StatCard label="With two or more children" icon="students" tone="info" loading={!s} value={s ? <AnimatedNumber value={s.multiChild} format={formatCount} /> : undefined} foot="eligible for the sibling concession" />
          </div>
          <div className="mtb-rise" style={stagger(3)}>
            <StatCard label="Across campuses" icon="building" loading={!s} value={s ? <AnimatedNumber value={s.crossCampus} format={formatCount} /> : undefined} foot="children at more than one campus" />
          </div>
          {canFees && (
            <div className="mtb-rise" style={stagger(4)}>
              <StatCard label="Families with dues" icon="fees" tone="warning" loading={!s} value={s ? <AnimatedNumber value={s.withDues} format={formatCount} /> : undefined} foot={s ? `${formatRs(s.balance)} outstanding in all` : undefined} />
            </div>
          )}
        </div>
        <DataTable
          caption="Families"
          columns={columns}
          rows={rows.slice((page - 1) * 25, page * 25)}
          loading={list.isLoading}
          onRowClick={(f) => navigate({ to: "/students/families/$familyId", params: { familyId: f.id } })}
          empty={<EmptyState icon="home" title="No families match" description="Search by the father's name, a child's name or G.R. number, the father's CNIC or a mobile number." />}
          toolbar={
            <div className="min-w-64 flex-1">
              <Input label="Search" icon="search" placeholder="Father's name, child's name, G.R., CNIC or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          }
          pagination={rows.length > 25 ? <Pagination page={page} pageSize={25} total={rows.length} onPageChange={setPage} /> : undefined}
        />
        {/* The server sends at most 1,000 families (no paging in the contract yet, spec 01_students D2 / C4). */}
        {list.data && list.data.total > list.data.items.length && (
          <p className="m-0 text-small text-ink-muted" role="status">
            Showing the first {formatCount(list.data.items.length)} of {formatCount(list.data.total)} families. Search to find the others.
          </p>
        )}
      </Page>
    </RequirePermission>
  );
}
