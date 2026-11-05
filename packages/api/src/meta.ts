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
