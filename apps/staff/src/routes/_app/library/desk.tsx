import { createFileRoute } from "@tanstack/react-router";
import { DeskPage } from "../../../features/library";

/** /library/desk?accession=KC-L-14063 — scan a copy to issue it or take it back. */
export const Route = createFileRoute("/_app/library/desk")({
  validateSearch: (s: Record<string, unknown>): { accession?: string } => (typeof s.accession === "string" && s.accession.trim() ? { accession: s.accession.trim().slice(0, 30) } : {}),
  component: function DeskRoute() {
    const { accession } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <DeskPage accession={accession ?? ""} setAccession={(v) => void navigate({ search: (v ? { accession: v } : {}) as never, replace: true })} />;
  },
});
