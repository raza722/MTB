import { createFileRoute } from "@tanstack/react-router";
import { MarksPage } from "../../../features/marks/MarksPage";

interface MarksSearch {
  exam?: string;
  cls?: string;
}

export const Route = createFileRoute("/_app/marks/")({
  validateSearch: (s: Record<string, unknown>): MarksSearch => ({
    ...(typeof s.exam === "string" && s.exam ? { exam: s.exam } : {}),
    ...(typeof s.cls === "string" && s.cls ? { cls: s.cls } : {}),
  }),
  component: function MarksRoute() {
    const { exam, cls } = Route.useSearch();
    return <MarksPage {...(exam ? { exam } : {})} {...(cls ? { cls } : {})} />;
  },
});
