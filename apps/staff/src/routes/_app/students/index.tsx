import { createFileRoute } from "@tanstack/react-router";
import { StudentsPage, type StudentsSearch } from "../../../features/students/StudentsPage";

/** A typed link like ?cls=10 arrives as the number 10; keep it as text. */
const str = (v: unknown) => (typeof v === "number" ? String(v) : typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/_app/students/")({
  validateSearch: (s: Record<string, unknown>): StudentsSearch => {
    const out: StudentsSearch = {};
    const q = str(s.q);
    if (q) out.q = q;
    const cls = str(s.cls);
    if (cls) out.cls = cls;
    const sec = str(s.sec);
    if (sec) out.sec = sec;
    const grp = str(s.grp);
    if (grp) out.grp = grp;
    if (s.status === "ACTIVE" || s.status === "LEFT" || s.status === "STRUCK_OFF" || s.status === "PASSED_OUT" || s.status === "EXPELLED") out.status = s.status;
    if (s.fee === "paid" || s.fee === "unpaid" || s.fee === "overdue" || s.fee === "cancelled") out.fee = s.fee;
    return out;
  },
  component: function StudentsRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    const { q, cls, sec, grp, status, fee } = search;
    return (
      <StudentsPage
        search={{ ...(q ? { q } : {}), ...(cls ? { cls } : {}), ...(sec ? { sec } : {}), ...(grp ? { grp } : {}), ...(status ? { status } : {}), ...(fee ? { fee } : {}) }}
        setSearch={(next) => navigate({ search: (prev) => ({ ...prev, q: next.q, cls: next.cls, sec: next.sec, grp: next.grp, status: next.status, fee: next.fee }) })}
      />
    );
  },
});
