import { createFileRoute } from "@tanstack/react-router";
import { DeskPage } from "../../../features/library";

/** /library/desk?accession=KC-L-14063 — scan a copy to issue it or take it back. */
export const Route = createFileRoute("/_app/library/desk")({
  // ?accession=224 (typed, scanned or linked) is parsed as the number 224: take it as text. The key is always returned,
  // so a value of another type never reaches the page as it was parsed.
  validateSearch: (s: Record<string, unknown>): { accession?: string } => {
    const raw = typeof s.accession === "number" ? String(s.accession) : s.accession;
    return { accession: typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 30) : undefined };
  },
  component: function DeskRoute() {
    const { accession } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <DeskPage accession={accession ?? ""} setAccession={(v) => void navigate({ resetScroll: false, search: (v ? { accession: v } : {}) as never, replace: true })} />;
  },
});
