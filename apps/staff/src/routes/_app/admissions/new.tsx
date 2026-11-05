import { createFileRoute } from "@tanstack/react-router";
import { NewApplicationPage } from "../../../features/admissions";

export const Route = createFileRoute("/_app/admissions/new")({
  validateSearch: (s: Record<string, unknown>): { enquiry?: string } => (typeof s.enquiry === "string" && s.enquiry ? { enquiry: s.enquiry } : {}),
  component: function NewApplicationRoute() {
    const { enquiry } = Route.useSearch();
    return <NewApplicationPage key={enquiry ?? "blank"} enquiryId={enquiry ?? ""} />;
  },
});
