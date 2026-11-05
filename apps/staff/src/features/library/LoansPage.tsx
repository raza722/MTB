import { libraryQueries, LIBRARY_FINE_STATUS_LABEL, LIBRARY_STAFF_GROUPS, metaQueries, type LibraryLoan, type LibraryLoansQuery } from "@mtb/api";
import { formatCount, formatDate, formatRs } from "@mtb/domain";
import { Button, DataTable, DatePicker, EmptyState, Input, Pagination, Segmented, Select, type Column } from "@mtb/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useCtx } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { DocHead, LoadError, periodText, Spine, TODAY, usePrinter } from "./common";
import { FineText, LibraryShell, LoanStatus, MemberLink, TitleText } from "./shared";

const STATUS_LABEL: Record<NonNullable<LibraryLoansQuery["status"]>, string> = { OPEN: "On loan", OVERDUE: "Overdue", RETURNED: "Returned", ALL: "All loans" };

function Register({ rows, title, subtitle, campus }: { rows: LibraryLoan[]; title: string; subtitle: string; campus: string }) {
  return (
    <div className="ops-doc">
      <DocHead title={title} subtitle={`${subtitle} · ${rows.length} loans`} campus={campus} />
      <table>
        <thead>
          <tr>
            <th className="n">Sr</th>
            <th>G.R. / staff no.</th>
            <th>Borrower</th>
            <th>Class or post</th>
            <th>Book</th>
            <th>Author</th>
            <th>Accession</th>
            <th>Issued</th>
            <th>Due</th>
            <th>Returned</th>
            <th className="n">Fine</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={l.id}>
              <td className="n">{i + 1}</td>
              <td>{l.borrowerId}</td>
              <td>{l.borrowerName}</td>
              <td>{l.borrowerDetail}</td>
              <td>{l.title || l.titleUr}</td>
              <td>{l.authors.join(", ")}</td>
              <td>{l.accessionNo}</td>
              <td>{formatDate(l.issuedOn)}</td>
              <td>{formatDate(l.dueOn)}</td>
              <td>{l.returnedOn ? formatDate(l.returnedOn) : l.dueOn < TODAY ? `Overdue ${l.daysLate} d` : "Out"}</td>
              <td className="n">{l.fine > 0 ? `${formatRs(l.fine)}${l.returnedOn ? ` (${LIBRARY_FINE_STATUS_LABEL[l.fineStatus].toLowerCase()})` : ""}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Every loan with filters: the legacy student and staff issuance reports, on screen first. */
export function LoansPage() {
  const ctx = useCtx();
  const classes = useQuery(metaQueries.classes(ctx.campus));
  const [status, setStatus] = useState<NonNullable<LibraryLoansQuery["status"]>>("OPEN");
  const [type, setType] = useState<"" | "STUDENT" | "STAFF">("");
  const [cls, setCls] = useState("");
  const [section, setSection] = useState("");
  const [staffGroup, setStaffGroup] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const query: LibraryLoansQuery = {
    status,
    borrowerType: type,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(type === "STUDENT" && cls ? { cls } : {}),
    ...(type === "STUDENT" && section ? { section } : {}),
    ...(type === "STAFF" && staffGroup ? { staffGroup } : {}),
  };
  const q = useQuery({ ...libraryQueries.loans(ctx, query), placeholderData: keepPreviousData });
  const printer = usePrinter();
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((l) => !s || `${l.title} ${l.titleUr} ${l.borrowerName} ${l.borrowerId} ${l.accessionNo} ${l.authors.join(" ")}`.toLowerCase().includes(s));
  }, [q.data, search]);
  useEffect(() => setPage(1), [status, type, cls, section, staffGroup, from, to, search, ctx.campus, ctx.session]);
  const shown = rows.slice((page - 1) * size, page * size);
  const fines = rows.filter((l) => l.returnedOn && l.fineStatus !== "WAIVED").reduce((a, l) => a + l.fine, 0);
  const sections = classes.data?.find((c) => c.short === cls)?.sections ?? [];

  const columns: Array<Column<LibraryLoan>> = [
    { key: "book", header: "Book", render: (l) => <TitleText title={l.title} titleUr={l.titleUr} sub={<Spine>{l.accessionNo}</Spine>} /> },
    { key: "author", header: "Author", render: (l) => <span className="text-small">{l.authors.join(", ")}</span> },
    {
      key: "who",
      header: "Borrower",
      render: (l) => (
        <span className="grid">
          <MemberLink type={l.borrowerType} id={l.borrowerId}>
            {l.borrowerName}
          </MemberLink>
          <span className="text-small text-ink-muted">
            {l.borrowerType === "STUDENT" ? "Student" : `Staff${l.borrowerGroup ? ` (${l.borrowerGroup.toLowerCase()})` : ""}`} · {l.borrowerDetail}
            {ctx.campus === "ALL" ? ` · ${campusLabel(l.campus)}` : ""}
          </span>
        </span>
      ),
    },
    { key: "borrowerId", header: "G.R. / staff no.", render: (l) => <span className="mtb-mono text-small">{l.borrowerId}</span> },
    { key: "issued", header: "Issued", width: 110, render: (l) => <span className="mtb-num">{formatDate(l.issuedOn)}</span> },
    { key: "due", header: "Due", width: 110, render: (l) => <span className="mtb-num">{formatDate(l.dueOn)}</span> },
    { key: "back", header: "Returned", width: 110, render: (l) => (l.returnedOn ? <span className="mtb-num">{formatDate(l.returnedOn)}</span> : <span className="text-ink-subtle">—</span>) },
    { key: "status", header: "Status", render: (l) => <LoanStatus loan={l} /> },
    { key: "fine", header: "Fine", align: "right", render: (l) => <FineText loan={l} /> },
  ];

  const who = type === "STUDENT" ? `students${cls ? `, class ${cls}${section ? `-${section}` : ""}` : ""}` : type === "STAFF" ? `staff${staffGroup ? `, ${staffGroup.toLowerCase()}` : ""}` : "";
  const title = `Loans register: ${STATUS_LABEL[status].toLowerCase()}${who ? ` (${who})` : ""}`;
  return (
    <LibraryShell
      title="Loans"
      actions={
        <Button icon="printer" disabled={!rows.length} onClick={() => printer.print(<Register rows={rows} title={title} subtitle={`Issued ${periodText(from, to, ctx.session).replace(/^Session/, "in session")}${search ? ` · “${search}”` : ""}`} campus={campusLabel(ctx.campus)} />, "A4L")}>
          Print register
        </Button>
      }
    >
      {q.isError && <LoadError what="The loans" error={q.error} onRetry={() => void q.refetch()} />}
      <DataTable
        caption="Library loans"
        rows={shown}
        loading={q.isLoading}
        columns={columns}
        toolbar={
          <div className="flex w-full flex-wrap items-end gap-3">
            <Segmented aria-label="Loans to show" value={status} onChange={(v) => setStatus(v as typeof status)} options={(["OPEN", "OVERDUE", "RETURNED", "ALL"] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
            <Select
              label="Borrower"
              value={type}
              onChange={(e) => {
                setType(e.target.value as typeof type);
                setCls("");
                setSection("");
                setStaffGroup("");
              }}
              options={[
                { value: "", label: "Students and staff" },
                { value: "STUDENT", label: "Students" },
                { value: "STAFF", label: "Staff" },
              ]}
            />
            {type === "STUDENT" && (
              <>
                <Select
                  label="Class"
                  value={cls}
                  onChange={(e) => {
                    setCls(e.target.value);
                    setSection("");
                  }}
                  options={[{ value: "", label: "All classes" }, ...(classes.data ?? []).map((c) => ({ value: c.short, label: c.name }))]}
                />
                <Select label="Section" value={section} disabled={!cls} onChange={(e) => setSection(e.target.value)} options={[{ value: "", label: cls ? "All sections" : "Choose a class" }, ...sections.map((s) => ({ value: s, label: s }))]} />
              </>
            )}
            {type === "STAFF" && <Select label="Staff group" value={staffGroup} onChange={(e) => setStaffGroup(e.target.value)} options={[{ value: "", label: "All staff" }, ...LIBRARY_STAFF_GROUPS.map((g) => ({ value: g, label: g }))]} />}
            <DatePicker label="Issued from" value={from} onValueChange={setFrom} />
            <DatePicker label="to" value={to} onValueChange={setTo} {...(from ? { minDate: from } : {})} />
            <div className="min-w-[200px] flex-1">
              <Input label="Search" icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Book, author, borrower, G.R. or accession" />
            </div>
          </div>
        }
        footer={rows.length ? { book: <span className="font-semibold">{formatCount(rows.length)} loans</span>, fine: fines > 0 ? <span className="mtb-num font-semibold">{formatRs(fines)} charged</span> : "" } : undefined}
        pagination={rows.length > size ? <Pagination page={page} pageSize={size} total={rows.length} onPageChange={setPage} onPageSizeChange={(s) => { setSize(s); setPage(1); }} /> : undefined}
        empty={<EmptyState icon="book" title="No loans match" description={status === "OVERDUE" ? "Nothing is overdue. Good." : "Change the filters or the dates."} />}
      />
      {printer.element}
    </LibraryShell>
  );
}
