import { STUDENT_DOC_TYPES, type StudentDocType } from "@mtb/api";
import { createFileRoute } from "@tanstack/react-router";
import { DocumentsPage } from "../../../features/students/documents/DocumentsPage";

export const Route = createFileRoute("/_app/students/documents")({
  validateSearch: (s: Record<string, unknown>): { type?: StudentDocType } => (STUDENT_DOC_TYPES.includes(s.type as StudentDocType) ? { type: s.type as StudentDocType } : {}),
  component: function DocumentsRoute() {
    const { type } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <DocumentsPage type={type ?? ""} setType={(next) => navigate({ search: (prev) => ({ ...prev, type: next || undefined }), replace: true })} />;
  },
});
