import { API_BASE } from "./client";
import type { CampusScope } from "./context";

/**
 * Photos moved over from the old system, served by the API from backend/uploads behind the same sign-in and permission
 * as the record (students.view at the student's campus, hr.view for staff, the parent's own child on the portal).
 * A record without a photo answers 404: `<Avatar>` then shows initials and the printouts keep the old empty photo box.
 */
const enc = encodeURIComponent;

/** The campus a G.R. number belongs to: "KC-P-1234" -> "KC". */
export function grCampus(grNo: string): string {
  return grNo.split("-", 1)[0]!.toUpperCase();
}

export const photoUrl = {
  student: (grNo: string | null | undefined) => (grNo ? `${API_BASE}/students/${enc(grNo)}/photo?campus=${grCampus(grNo)}` : undefined),
  /** The guardian's photo the old system kept on the student's record. */
  guardian: (grNo: string | null | undefined) => (grNo ? `${API_BASE}/students/${enc(grNo)}/guardian-photo?campus=${grCampus(grNo)}` : undefined),
  staff: (employeeNo: string | null | undefined, campus: CampusScope | string) =>
    employeeNo ? `${API_BASE}/hr/photos/${enc(employeeNo)}?campus=${enc(campus)}` : undefined,
  /** The parent portal's own child (the portal session cookie, not the staff one). */
  portalChild: (grNo: string | null | undefined) => (grNo ? `${API_BASE}/portal/children/${enc(grNo)}/photo` : undefined),
};
