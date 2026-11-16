// Teacher app: the More tab's Demo panel (/api/teacher/demo, GET / PUT). Mock-only: the real API has no such route
// and answers 404 (backend/docs/modules/14_home.md D16). Today, classes, class detail and notifications are real
// (module 14) and fall through to the backend, so the holiday switch is only remembered here for the panel.
import type { TeacherDemoState } from "@mtb/api";
import { http, type HttpHandler } from "msw";
import { createStore } from "../db";
import { HttpResponse, latency, requireUser } from "../util";

const store = createStore<TeacherDemoState>("teacher-demo", () => ({ holiday: false }));

export const teacherDemoHandlers: HttpHandler[] = [
  http.get("/api/teacher/demo", async () => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    return HttpResponse.json(store.get());
  }),

  http.put("/api/teacher/demo", async ({ request }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    const body = (await request.json()) as Partial<TeacherDemoState>;
    store.set((s) => ({ holiday: typeof body.holiday === "boolean" ? body.holiday : s.holiday }));
    return HttpResponse.json(store.get());
  }),
];
