import { createFileRoute } from "@tanstack/react-router";
import { FamilyPage } from "../../../../features/students/families/FamilyPage";

export const Route = createFileRoute("/_app/students/families/$familyId")({
  component: function FamilyRoute() {
    const { familyId } = Route.useParams();
    return <FamilyPage familyId={familyId.toUpperCase()} />;
  },
});
