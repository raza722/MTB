import { createFileRoute } from "@tanstack/react-router";
import { IssuePage, type IssueTab } from "../../../features/warehouse";

/** /warehouse/issue?tab=requests&new=1 — issues to departments, requests and returns. */
export const Route = createFileRoute("/_app/warehouse/issue")({
  validateSearch: (s: Record<string, unknown>): { tab?: IssueTab; new?: 1 } => ({
    ...(s.tab === "requests" || s.tab === "returns" ? { tab: s.tab } : {}),
    ...(s.new === 1 || s.new === "1" ? { new: 1 as const } : {}),
  }),
  component: function IssueRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    const tab = search.tab ?? "issues";
    return (
      <IssuePage
        tab={tab}
        setTab={(t) => void navigate({ search: (t === "issues" ? {} : { tab: t }) as never, replace: true })}
        openNew={search.new === 1}
        setOpenNew={(v) => void navigate({ search: { ...(tab === "issues" ? {} : { tab }), ...(v ? { new: 1 } : {}) } as never, replace: true })}
      />
    );
  },
});
