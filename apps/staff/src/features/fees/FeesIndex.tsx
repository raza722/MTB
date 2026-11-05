import { Navigate } from "@tanstack/react-router";
import { useCan } from "../../app/session";

/** /fees — cashiers land on the counter; the accountant and the principal on the reports. */
export function FeesIndex() {
  const collect = useCan("fees.collect");
  const reports = useCan("fees.reports");
  if (collect) return <Navigate to="/fees/counter" replace />;
  if (reports) return <Navigate to="/fees/reports" replace />;
  return <Navigate to="/fees/vouchers" replace />;
}
