import { LIBRARY_COPY_STATUS_LABEL, LIBRARY_FINE_STATUS_LABEL, type LibraryCopyStatus, type LibraryLoan } from "@mtb/api";
import { formatRs } from "@mtb/domain";
import { StatusBadge, Urdu } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { SubNavItem } from "../../app/shell/SubNav";
import { ModuleShell, opsToday } from "./common";

export const LIBRARY_NAV: SubNavItem[] = [
  { to: "/library", label: "Overview", icon: "dashboard", exact: true },
  { to: "/library/desk", label: "Issue and return", icon: "refresh" },
  { to: "/library/catalogue", label: "Catalogue", icon: "book" },
  { to: "/library/loans", label: "Loans", icon: "listChecks" },
  { to: "/library/overdue", label: "Overdue", icon: "clock" },
  { to: "/library/members", label: "Member history", icon: "user" },
  { to: "/library/counts", label: "Stock count", icon: "checkSquare" },
  { to: "/library/setup", label: "Shelves and rules", icon: "settings" },
];

export function LibraryShell(props: { title: string; context?: ReactNode; actions?: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return <ModuleShell nav={LIBRARY_NAV} navLabel="Library" readOnlyNote="Loans, counts and the catalogue stay available to read and print." {...props} />;
}

export function CopyStatusBadge({ status }: { status: LibraryCopyStatus }) {
  const tone = status === "AVAILABLE" ? "paid" : status === "ON_LOAN" ? "info" : status === "MISSING" ? "warning" : status === "DAMAGED" ? "late" : "cancelled";
  return <StatusBadge status={tone}>{LIBRARY_COPY_STATUS_LABEL[status]}</StatusBadge>;
}

/** Where a loan stands: on loan, due today, overdue by n days, returned (late). */
export function LoanStatus({ loan }: { loan: LibraryLoan }) {
  if (loan.lost) return <StatusBadge status="cancelled">Lost</StatusBadge>;
  if (loan.returnedOn) return loan.daysLate > 0 ? <StatusBadge status="late">Returned {loan.daysLate} days late</StatusBadge> : <StatusBadge status="paid">Returned</StatusBadge>;
  // Overdue comes from the server's daysLate (worked out to its today); "due today" only needs today's date.
  if (loan.daysLate > 0) return <StatusBadge status="overdue">{loan.daysLate} {loan.daysLate === 1 ? "day" : "days"} overdue</StatusBadge>;
  if (loan.dueOn === opsToday()) return <StatusBadge status="pending">Due today</StatusBadge>;
  return <StatusBadge status="info">On loan</StatusBadge>;
}

export function FineText({ loan }: { loan: LibraryLoan }) {
  if (loan.fine <= 0) return <span className="text-ink-subtle">—</span>;
  return (
    <span className="grid justify-items-end">
      <span className="mtb-num">{formatRs(loan.fine)}</span>
      <span className="text-small text-ink-muted">{loan.returnedOn ? LIBRARY_FINE_STATUS_LABEL[loan.fineStatus] : "if returned today"}</span>
    </span>
  );
}

/** Title in English with the Urdu title beside it when the book has one. */
export function TitleText({ title, titleUr, sub }: { title: string; titleUr: string; sub?: ReactNode }) {
  return (
    <span className="grid min-w-0">
      <span className="flex flex-wrap items-baseline gap-x-2">
        {title && <span className="font-medium">{title}</span>}
        {titleUr && <Urdu size="small">{titleUr}</Urdu>}
      </span>
      {sub && <span className="text-small text-ink-muted">{sub}</span>}
    </span>
  );
}

export function MemberLink({ type, id, children }: { type: "STUDENT" | "STAFF"; id: string; children: ReactNode }) {
  return (
    <Link to={"/library/members" as never} search={{ type, id } as never} className="font-medium text-brand-ink underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
