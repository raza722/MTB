import { createFileRoute } from "@tanstack/react-router";
import { ClassesPage } from "../../../../features/more/ClassesPage";

export const Route = createFileRoute("/_app/more/classes/")({
  component: ClassesPage,
});
