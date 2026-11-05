import { createFileRoute } from "@tanstack/react-router";
import { AbsenteesPage } from "../../../features/attendance";

/** /attendance/absentees — today's absent, leave and late students, with parent SMS. */
export const Route = createFileRoute("/_app/attendance/absentees")({ component: AbsenteesPage });
