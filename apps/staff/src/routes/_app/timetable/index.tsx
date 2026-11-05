import { createFileRoute } from "@tanstack/react-router";
import { ClassTimetablePage, type ClassTimetableSearch } from "../../../features/timetable";

/** /timetable — each class's weekly timetable (editor with live clash checks), the all-classes day sheet and the section-wise master sheet. */
export const Route = createFileRoute("/_app/timetable/")({
  validateSearch: (s: Record<string, unknown>): ClassTimetableSearch => {
    const out: ClassTimetableSearch = {};
    if (typeof s.cls === "string" && s.cls) out.cls = s.cls;
    if (s.view === "class" || s.view === "day" || s.view === "week") out.view = s.view;
    if (typeof s.klass === "string" && s.klass) out.klass = s.klass;
    const day = Number(s.day);
    if (Number.isInteger(day) && day >= 1 && day <= 6) out.day = day;
    return out;
  },
  component: function ClassTimetableRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <ClassTimetablePage search={search} setSearch={(next) => void navigate({ search: (prev) => ({ ...prev, cls: next.cls, view: next.view, day: next.day, klass: next.klass }) })} />;
  },
});
