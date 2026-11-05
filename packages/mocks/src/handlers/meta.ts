import { http } from "msw";
import { CAMPUSES, CLASSES } from "../fixtures/campuses";
import { groupsOfClass } from "../fixtures/student-records";
import { HttpResponse, latency } from "../util";
import { setupSessions } from "./setup";

export const metaHandlers = [
  http.get("/api/meta/campuses", async () => {
    await latency();
    return HttpResponse.json(CAMPUSES);
  }),
  http.get("/api/meta/sessions", async () => {
    await latency();
    // Setup → Sessions decides which years exist and their status (planned, current, ended, closed).
    return HttpResponse.json(setupSessions());
  }),
  http.get("/api/meta/classes", async () => {
    await latency();
    // Classes with groups (9 and 10) list them, so pages offer a Group filter only where it applies.
    return HttpResponse.json(
      CLASSES.map((c) => {
        const groups = groupsOfClass(c.short);
        return groups.length ? { ...c, groups } : c;
      }),
    );
  }),
];
