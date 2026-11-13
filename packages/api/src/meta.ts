import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { CampusCode } from "./context";

export interface Campus {
  code: CampusCode;
  name: string;
  city: string;
  address: string;
  /** Campus code inside G.R. and receipt numbers: "KC". */
  docPrefix: string;
}

export interface SessionInfo {
  startYear: number;
  label: string;
  current: boolean;
  /** From Setup → Sessions. PLANNED: next year, being prepared. ENDED: read-only. CLOSED: locked. */
  status: "PLANNED" | "CURRENT" | "ENDED" | "CLOSED";
}

export interface ClassInfo {
  /** "Class 7" */
  name: string;
  /** "7" — combined with a section: "7-B" */
  short: string;
  sections: string[];
  /** Groups (streams) offered in this class, e.g. "Science (Biology)". Missing when the class has none. */
  groups?: string[];
  /**
   * Board exam part sat at the end of this class: "I" (Class 9, First year), "II" (Class 10, Second year), null for
   * other classes (acad.Class.BoardExamPart, spec 01_students D8). Board roll numbers and board documents are for
   * these classes only. The server sends it for every class (null = not a board class); optional only so
   * fictional mocks may leave it out.
   */
  boardExamPart?: "I" | "II" | null;
}

export const metaApi = {
  campuses: () => apiFetch<Campus[]>("/meta/campuses"),
  sessions: () => apiFetch<SessionInfo[]>("/meta/sessions"),
  classes: (campus: CampusCode | "ALL") => apiFetch<ClassInfo[]>("/meta/classes", { query: { campus } }),
};

export const metaQueries = {
  campuses: () => queryOptions({ queryKey: ["meta", "campuses"], queryFn: metaApi.campuses, staleTime: Infinity }),
  sessions: () => queryOptions({ queryKey: ["meta", "sessions"], queryFn: metaApi.sessions, staleTime: Infinity }),
  classes: (campus: CampusCode | "ALL") => queryOptions({ queryKey: ["meta", "classes", campus], queryFn: () => metaApi.classes(campus), staleTime: Infinity }),
};
