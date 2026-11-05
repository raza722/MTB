import type { StudentMovementKind } from "@mtb/api";
import { createFileRoute } from "@tanstack/react-router";
import { MovementsPage } from "../../../features/students/movements/MovementsPage";

const KINDS: StudentMovementKind[] = ["LEFT", "STRUCK_OFF", "EXPELLED", "RESTORED", "TRANSFER", "PASSED_OUT"];

export const Route = createFileRoute("/_app/students/leaving")({
  validateSearch: (s: Record<string, unknown>): { kind?: StudentMovementKind } => (KINDS.includes(s.kind as StudentMovementKind) ? { kind: s.kind as StudentMovementKind } : {}),
  component: function LeavingRoute() {
    const { kind } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <MovementsPage kind={kind ?? ""} setKind={(next) => navigate({ search: (prev) => ({ ...prev, kind: next || undefined }), replace: true })} />;
  },
});
