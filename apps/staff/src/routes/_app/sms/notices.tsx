import { createFileRoute } from "@tanstack/react-router";
import { NoticesPage, type NoticesSearch } from "../../../features/sms";

/** /sms/notices — notices in English and Urdu for the parent portal and app: drafts, published, taken down. */
export const Route = createFileRoute("/_app/sms/notices")({
  validateSearch: (s: Record<string, unknown>): NoticesSearch => ({
    ...(s.new === 1 || s.new === "1" || s.new === true ? { new: 1 as const } : {}),
    ...(typeof s.notice === "string" && s.notice ? { notice: s.notice } : {}),
    ...(s.show === "PUBLISHED" || s.show === "DRAFT" || s.show === "ALL" ? { show: s.show } : {}),
  }),
  component: function NoticesRoute() {
    const navigate = Route.useNavigate();
    return <NoticesPage search={Route.useSearch()} setSearch={(next) => void navigate({ search: next as never })} />;
  },
});
