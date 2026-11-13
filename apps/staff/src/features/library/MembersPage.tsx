import { libraryQueries, type OperationsPerson, type OperationsPersonType } from "@mtb/api";
import { formatCount, formatDate, formatMobile, formatRs } from "@mtb/domain";
import { AnimatedNumber, Banner, buttonClassName, DataTable, EmptyState, Icon, Panel, Skeleton, StatCard } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCan, useCtx } from "../../app/session";
import { LoadError, PersonPicker, slide, Spine } from "./common";
import { FineText, LibraryShell, LoanStatus, TitleText } from "./shared";

export interface MemberSearch {
  type?: OperationsPersonType;
  id?: string;
}

/** One borrower's whole history: what they have now, what they returned late, fines charged and waived. */
export function MembersPage({ search, setSearch }: { search: MemberSearch; setSearch: (s: MemberSearch) => void }) {
  const ctx = useCtx();
  const canStudents = useCan("students.view");
  const q = useQuery(libraryQueries.member(ctx, search.type ?? "STUDENT", search.id ?? ""));
  const m = q.data;
  const chosen: OperationsPerson | null = m ? m.person : null;

  return (
    <LibraryShell title="Member history">
      <Panel id="member-find" rise={0} title="Find a borrower" description="A student by name, father or G.R. number; a staff member by name or staff number.">
        <div className="max-w-[560px]">
          <PersonPicker label="Borrower" value={chosen} onChange={(p) => setSearch(p ? { type: p.type, id: p.id } : {})} autoFocus={!search.id} />
        </div>
      </Panel>

      {!search.id ? (
        <div className="mtb-card">
          <EmptyState icon="user" title="Choose a borrower" description="Their books on loan, returns, late days and fines show here." />
        </div>
      ) : q.isError ? (
        <LoadError what="This borrower's history" error={q.error} onRetry={() => void q.refetch()} />
      ) : !m ? (
        <Skeleton height={300} />
      ) : (
        <>
          {m.blockReason && <Banner tone="warning" title="Can't borrow now.">{m.blockReason}</Banner>}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Borrowed in all", value: m.totals.borrowed, icon: "book" as const, foot: `${m.policy.loanDays}-day loans, up to ${m.policy.maxLoans} at a time` },
              { label: "On loan now", value: m.totals.open, icon: "arrowRight" as const, foot: m.totals.overdue ? `${m.totals.overdue} overdue` : "None overdue", tone: m.totals.overdue ? ("danger" as const) : undefined },
              { label: "Returned late", value: m.totals.returnedLate, icon: "clock" as const, foot: "Over every session" },
              { label: "Fines charged", value: m.totals.finesCharged, icon: "fees" as const, money: true, foot: m.totals.finesWaived ? `${formatRs(m.totals.finesWaived)} waived` : "None waived" },
            ].map((k, i) => (
              <div key={k.label} className="mtb-rise" style={slide(i)}>
                <StatCard label={k.label} icon={k.icon} tone={k.tone} value={<AnimatedNumber value={k.value} format={k.money ? formatRs : formatCount} />} foot={k.foot} />
              </div>
            ))}
          </div>
          <Panel
            id="member-loans"
            rise={1}
            title={`${m.person.name}`}
            description={`${m.person.type === "STUDENT" ? `${m.person.detail} · ${m.person.relation} ${m.person.father}` : m.person.detail} · ${m.person.mobile ? formatMobile(m.person.mobile) : "No mobile"}`}
            actions={
              m.person.type === "STUDENT" && canStudents ? (
                <Link to="/students/$grNo" params={{ grNo: m.person.id }} className={buttonClassName({ size: "sm" })}>
                  <Icon name="students" size={14} />
                  Student profile
                </Link>
              ) : undefined
            }
            flush
          >
            <DataTable
              caption="Loans of this borrower"
              rows={m.loans}
              columns={[
                { key: "book", header: "Book", render: (l) => <TitleText title={l.title} titleUr={l.titleUr} sub={<Spine>{l.accessionNo}</Spine>} /> },
                { key: "issued", header: "Issued", render: (l) => <span className="mtb-num">{formatDate(l.issuedOn)}</span> },
                { key: "due", header: "Due", render: (l) => <span className="mtb-num">{formatDate(l.dueOn)}</span> },
                { key: "back", header: "Returned", render: (l) => (l.returnedOn ? <span className="mtb-num">{formatDate(l.returnedOn)}</span> : "—") },
                { key: "st", header: "Status", render: (l) => <LoanStatus loan={l} /> },
                { key: "fine", header: "Fine", align: "right", render: (l) => <FineText loan={l} /> },
                { key: "note", header: "Note", render: (l) => <span className="text-small text-ink-muted">{l.fineNote}</span> },
              ]}
              empty={<EmptyState icon="book" title="Never borrowed a book" />}
            />
          </Panel>
        </>
      )}
    </LibraryShell>
  );
}
