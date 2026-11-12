import type { PortalLang, PortalRelation } from "@mtb/api";
import type { IsoDateTime } from "@mtb/domain";
import { findStudent } from "./students";

/**
 * Parent and student portal fixtures (fictional). The portal itself is real now (/api/portal/*: module 12); what is
 * left here are the two demo families the mock-only /api/portal/demo hint lists (the report centre's "Parent portal
 * accounts" report is real since module 13b; handlers/portal-model.ts is dead code). The demo code works only against the old mock, never the server.
 */
export const PORTAL_DEMO_CODE = "135790";

export interface PortalParentRecord {
  id: string;
  name: string;
  nameUr: string;
  relation: PortalRelation;
  /** G.R. numbers, in the order the switcher lists them. Children at other campuses are included. */
  children: string[];
  smsLanguage: PortalLang;
  /** The sign-in before the demo's. */
  lastSignInAt?: IsoDateTime;
}

/** The brief's family (Imran Khan, three children across two campuses) and one single-child family. */
export const PORTAL_PARENTS: PortalParentRecord[] = [
  { id: "pg-imran", name: "Imran Khan", nameUr: "عمران خان", relation: "Father", children: ["KC-14823", "KC-15102", "UC-08831"], smsLanguage: "ur", lastSignInAt: "2026-10-30T19:12:00+05:00" },
  { id: "pg-tariq", name: "Tariq Mahmood", nameUr: "طارق محمود", relation: "Father", children: ["KC-14650"], smsLanguage: "en" },
];

/** A parent's registered mobile is the one on the children's records (the office keeps it up to date). */
export function parentMobile(p: PortalParentRecord): string {
  return findStudent(p.children[0] ?? "")?.guardian.mobile ?? "";
}

/** Students who can sign in themselves: the children of the families above. */
export const PORTAL_STUDENTS: string[] = PORTAL_PARENTS.flatMap((p) => p.children);
