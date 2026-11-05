import { ADMISSIONS_FIELD_LABEL, type AdmissionsField, type AdmissionsPersonFields } from "@mtb/api";
import { formatCnic, formatDate, formatMobile } from "@mtb/domain";

export type FieldMatch = "same" | "similar" | "different" | "missing";

export const COMPARED_FIELDS: AdmissionsField[] = ["name", "father", "fatherCnic", "dob", "gender", "mobile", "address"];

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
const words = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z\s.]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Levenshtein similarity, 0–1. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - (prev[n] ?? 0) / Math.max(m, n);
}

/** "M. Bilal" and "Muhammad Bilal": an initial for the first name, the rest the same. */
function initialMatch(a: string, b: string): boolean {
  const [wa, wb] = [words(a), words(b)];
  if (wa.length !== wb.length || wa.length < 2) return false;
  return wa.every((w, i) => {
    const o = wb[i] ?? "";
    const x = w.replace(".", "");
    const y = o.replace(".", "");
    return x === y || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y));
  });
}

export function compareField(field: AdmissionsField, a: AdmissionsPersonFields, b: AdmissionsPersonFields): FieldMatch {
  const x = String(a[field] ?? "");
  const y = String(b[field] ?? "");
  if (!x.trim() || !y.trim()) return "missing";
  if (norm(x) === norm(y)) return "same";
  if ((field === "name" || field === "father") && (initialMatch(x, y) || similarity(norm(x), norm(y)) >= 0.8)) return "similar";
  return "different";
}

export function displayValue(field: AdmissionsField, f: AdmissionsPersonFields): string {
  const v = f[field];
  if (!v) return "Not given";
  if (field === "fatherCnic") return formatCnic(v);
  if (field === "dob") return formatDate(v);
  if (field === "mobile") return formatMobile(v);
  if (field === "gender") return v === "F" ? "Female" : "Male";
  return v;
}

export const MATCH_LABEL: Record<FieldMatch, string> = { same: "Same", similar: "Similar", different: "Different", missing: "Missing on one record" };

export const fieldLabel = (f: AdmissionsField) => ADMISSIONS_FIELD_LABEL[f];
