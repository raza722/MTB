import { createFileRoute } from "@tanstack/react-router";
import { MembersPage, type MemberSearch } from "../../../features/library";

/** /library/members?type=STUDENT&id=KC-14823 — one borrower's history. */
export const Route = createFileRoute("/_app/library/members")({
  validateSearch: (s: Record<string, unknown>): MemberSearch =>
    (s.type === "STUDENT" || s.type === "STAFF") && typeof s.id === "string" && s.id ? { type: s.type, id: s.id } : {},
  component: function MembersRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <MembersPage search={search} setSearch={(next) => void navigate({ search: next as never })} />;
  },
});
