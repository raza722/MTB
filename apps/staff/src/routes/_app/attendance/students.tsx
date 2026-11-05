import { createFileRoute } from "@tanstack/react-router";
import { StudentReportPage, type StudentReportSearch } from "../../../features/attendance";

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** /attendance/students — one student's report for any period, or a class's students below a percentage. */
export const Route = createFileRoute("/_app/attendance/students")({
  validateSearch: (s: Record<string, unknown>): StudentReportSearch => {
    const out: StudentReportSearch = {};
    if (s.view === "student" || s.view === "class") out.view = s.view;
    const grNo = str(s.grNo);
    if (grNo) out.grNo = grNo;
    const cls = str(s.cls);
    if (cls) out.cls = cls;
    const from = iso(s.from);
    if (from) out.from = from;
    const to = iso(s.to);
    if (to) out.to = to;
    const below = Number(s.below);
    if (Number.isFinite(below) && below > 0 && below <= 100) out.below = below;
    return out;
  },
  component: function StudentReportsRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <StudentReportPage
        search={search}
        setSearch={(next) => void navigate({ search: (prev) => ({ ...prev, view: next.view, grNo: next.grNo, cls: next.cls, from: next.from, to: next.to, below: next.below }) })}
      />
    );
  },
});
