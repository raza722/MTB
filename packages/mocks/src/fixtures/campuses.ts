import type { Campus, CampusCode, ClassInfo, SessionInfo } from "@mtb/api";

/**
 * MTB's five campuses, named as in the legacy docs (one database each today).
 * Khalid Campus is the main campus, in Sadiqabad; Humaira Campus is in Lahore. The other cities are not
 * recorded in the docs, so they are left blank rather than invented.
 */
export const CAMPUSES: Campus[] = [
  { code: "KC", name: "Khalid Campus", city: "Sadiqabad", address: "Khalid Campus, Sadiqabad", docPrefix: "KC" },
  { code: "SM", name: "Sugar Mill Campus", city: "", address: "Sugar Mill Campus", docPrefix: "SM" },
  { code: "UC", name: "Ubaid Campus", city: "", address: "Ubaid Campus", docPrefix: "UC" },
  { code: "MC", name: "Majeed Campus", city: "", address: "Majeed Campus (Country Branch)", docPrefix: "MC" },
  { code: "HC", name: "Humaira Campus", city: "Lahore", address: "Humaira Campus, Lahore", docPrefix: "HC" },
];

export const campusName = (code: CampusCode | "ALL") => (code === "ALL" ? "All campuses" : (CAMPUSES.find((c) => c.code === code)?.name ?? code));
export const campusOf = (code: CampusCode) => CAMPUSES.find((c) => c.code === code)!;

export const SESSIONS: SessionInfo[] = [
  { startYear: 2026, label: "2026–27", current: true, status: "CURRENT" },
  { startYear: 2025, label: "2025–26", current: false, status: "ENDED" },
];

export const CLASSES: ClassInfo[] = [
  { name: "Prep", short: "Prep", sections: ["A", "B"] },
  ...Array.from({ length: 10 }, (_, i) => ({ name: `Class ${i + 1}`, short: String(i + 1), sections: i >= 5 && i <= 7 ? ["A", "B", "C"] : ["A", "B"] })),
];

/** Monthly tuition by class (fictional). */
export function tuitionFor(classShort: string): number {
  const n = Number(classShort);
  if (Number.isNaN(n)) return 6000;
  if (n <= 3) return 6500;
  if (n <= 5) return 7000;
  if (n <= 8) return 8500;
  return 9000;
}
