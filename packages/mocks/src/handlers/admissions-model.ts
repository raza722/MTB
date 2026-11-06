// The fictional admissions data the unfinished modules' mocks still share (no routes).
//
// Admissions is served by the real backend now (backend/docs/modules/03_admissions.md): every /api/admissions request
// falls through to it. What is left here is the mock store that other still-fictional modules read and write
// (conventions §5): Exams starts an application for a Diamond Minds participant, Fees › Candidates takes the candidate
// fee, Reports lists candidates, sittings and merit, Messages and Activities pick applicants. These stay fictional until
// those modules read adm.vw_ApplicationAudience / adm.vw_ApplicationPaymentSource.
import type { AdmissionsApplicant, AdmissionsTest, CampusCode } from "@mtb/api";
import { createStore } from "../db";
import { initialApplicants, initialTests, ruleFor } from "../fixtures/admissions";

type TestRecord = Omit<AdmissionsTest, "candidates" | "feePaid" | "marked" | "status">;

interface AdmissionsState {
  applicants: AdmissionsApplicant[];
  tests: TestRecord[];
  /** Last application number used per campus (Exams' "start admission"). */
  appSeq: Partial<Record<CampusCode, number>>;
  /** Last candidate-fee receipt number used per campus (Fees › Candidates). */
  feeSeq: Partial<Record<CampusCode, number>>;
}

export const admissionsStore = createStore<AdmissionsState>("admissions", () => {
  const applicants = initialApplicants();
  const maxOf = (xs: string[]) => Math.max(0, ...xs.map((x) => Number(x.split("-").pop())));
  const seqFor = (campus: CampusCode, list: string[]) => maxOf(list.filter((n) => n.startsWith(campus)));
  const campuses: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];
  return {
    applicants,
    tests: initialTests(),
    appSeq: Object.fromEntries(campuses.map((c) => [c, seqFor(c, applicants.map((a) => a.applicationNo))])),
    feeSeq: Object.fromEntries(campuses.map((c) => [c, seqFor(c, applicants.map((a) => a.fee?.receiptNo ?? "").filter(Boolean))])),
  };
});

/** Seats on a class's merit list (the class's default). */
export const admissionsSeats = (cls: string) => {
  const rule = ruleFor(cls);
  return rule.classApplied === cls ? rule.seatsOnMeritList : 0;
};

/** Applications at a campus in a session, as the fictional store holds them (Messages → Admission candidates, Scholarships). */
export function admissionApplicants(campus: CampusCode, session: number): AdmissionsApplicant[] {
  return admissionsStore.get().applicants.filter((a) => a.campus === campus && a.session === session);
}
