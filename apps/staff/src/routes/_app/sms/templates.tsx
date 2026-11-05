import { createFileRoute } from "@tanstack/react-router";
import { TemplatesPage } from "../../../features/sms";

/** /sms/templates — ready-made messages in English and Urdu with variables, counts and previews. */
export const Route = createFileRoute("/_app/sms/templates")({
  validateSearch: (s: Record<string, unknown>): { id?: string } => (typeof s.id === "string" && s.id ? { id: s.id } : {}),
  component: function TemplatesRoute() {
    const navigate = Route.useNavigate();
    const { id } = Route.useSearch();
    return <TemplatesPage selected={id ?? null} onSelect={(next) => void navigate({ search: (next ? { id: next } : {}) as never })} />;
  },
});
