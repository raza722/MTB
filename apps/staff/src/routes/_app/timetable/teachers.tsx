import { createFileRoute } from "@tanstack/react-router";
import { TeacherTimetablePage, type TeacherTimetableSearch } from "../../../features/timetable";

/** /timetable/teachers — one teacher's week, every teacher on one day or the whole week (master sheet), printable slips, and hand-over. */
export const Route = createFileRoute("/_app/timetable/teachers")({
  validateSearch: (s: Record<string, unknown>): TeacherTimetableSearch => {
    const out: TeacherTimetableSearch = {};
    if (typeof s.teacher === "string" && s.teacher) out.teacher = s.teacher;
    if (s.view === "teacher" || s.view === "day" || s.view === "week") out.view = s.view;
    if (typeof s.level === "string" && s.level) out.level = s.level;
    if (s.gender === "F" || s.gender === "M") out.gender = s.gender;
    const day = Number(s.day);
    if (Number.isInteger(day) && day >= 1 && day <= 6) out.day = day;
    return out;
  },
  component: function TeacherTimetableRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <TeacherTimetablePage search={search} setSearch={(next) => void navigate({ search: (prev) => ({ ...prev, teacher: next.teacher, view: next.view, day: next.day, level: next.level, gender: next.gender }) })} />;
  },
});
