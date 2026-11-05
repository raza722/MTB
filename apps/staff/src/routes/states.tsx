import { createFileRoute } from "@tanstack/react-router";
import { StatesPage } from "../features/states/StatesPage";

/** Deliverable 4: every screen state on the real components. Public, like /design-system (fictional data only, no API calls). */
export const Route = createFileRoute("/states")({
  component: StatesPage,
});
