import { createFileRoute } from "@tanstack/react-router";
import { EXAM_DOCS, ExamPrint, type ExamPrintSearch } from "../../../../features/exams/ExamPrint";

const flag = (v: unknown) => v === true || v === "true";
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);

export const Route = createFileRoute("/_app/exams/$examId/print")({
  validateSearch: (s: Record<string, unknown>): ExamPrintSearch => {
    const top = int(s.top);
    const dates = int(s.dates);
    return {
      ...(EXAM_DOCS.some((d) => d.id === s.doc) ? { doc: s.doc as ExamPrintSearch["doc"] } : {}),
      ...(str(s.section) ? { section: str(s.section)! } : {}),
      ...(str(s.group) ? { group: str(s.group)! } : {}),
      ...(str(s.subject) ? { subject: str(s.subject)! } : {}),
      ...(str(s.student) ? { student: str(s.student)! } : {}),
      ...(flag(s.urdu) ? { urdu: true } : {}),
      ...(s.layout === "half" || s.layout === "pair" ? { layout: s.layout } : {}),
      ...(top !== undefined && top >= 0 && top <= 200 ? { top } : {}),
      ...(s.gender === "M" || s.gender === "F" ? { gender: s.gender } : {}),
      ...(flag(s.rerank) ? { rerank: true } : {}),
      ...(flag(s.perSection) ? { perSection: true } : {}),
      ...(s.cols === "marks" || s.cols === "sign" || s.cols === "split" || s.cols === "monthly" ? { cols: s.cols } : {}),
      ...(dates !== undefined && dates >= 3 && dates <= 6 ? { dates } : {}),
      ...(flag(s.blank) ? { blank: true } : {}),
      ...(flag(s.contact) ? { contact: true } : {}),
      ...(s.who === "resit" || s.who === "failed" ? { who: s.who } : {}),
      ...(s.order === "position" ? { order: "position" as const } : {}),
      ...(flag(s.filled) ? { filled: true } : {}),
    };
  },
  component: function PrintRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    // Every option lives in the address, so a print can be bookmarked or shared.
    return <ExamPrint search={search} onSearch={(next) => void navigate({ search: () => ({ ...next }), replace: true })} />;
  },
});
