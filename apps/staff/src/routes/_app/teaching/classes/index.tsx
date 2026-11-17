import { createFileRoute } from "@tanstack/react-router";
import { ClassesPage } from "../../../../features/teaching";

/** /teaching/classes — where the teacher is class teacher or teaches a subject. */
export const Route = createFileRoute("/_app/teaching/classes/")({ component: ClassesPage });
