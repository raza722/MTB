import {
  can,
  type DeclaredResult,
  type Family,
  type GlobalSearchResult,
  type SmsHistoryItem,
  type StudentAddressLabel,
  type StudentAttendance,
  type StudentListDetail,
  type StudentProfile,
  type StudentQualification,
  type StudentQualificationInput,
  type StudentStrength,
  type StudentUpdate,
} from "@mtb/api";
import { isValidCnic, normalizeCnic, normalizeMobile, type AttendanceCode, type IsoDate } from "@mtb/domain";
import { http } from "msw";
import { CURRENT_SESSION, DEMO_TODAY, demoNow } from "../clock";
import { CLASSES } from "../fixtures/campuses";
import { groupsOfClass, seatsFor } from "../fixtures/student-records";
import { findStudent, STUDENTS, type StudentRecord } from "../fixtures/students";
import { ctxFrom, fail, HttpResponse, latency, requirePermission } from "../util";
import { admissionsStore } from "./admissions";
import { attendanceMarkOf, closedOn } from "./attendance";
import { declaredResultsFor } from "./exams";
import { feesStore } from "./fees-state";
import {
  addEvent,
  classHistoryOf,
  documentsIssuedCount,
  familyIdOf,
  familyKeyOf,
  nextSessionOf,
  patchStudent,
  recordsStore,
  statusNoteOf,
  streamOf,
  toSummary,
} from "./student-records";

export { toSummary };

const live = (s: StudentRecord) => !s.mergedInto;

/** Checks a board exam entry; returns the clean entry or a 422 next to the field. */
function cleanQualification(b: Partial<StudentQualificationInput>): StudentQualificationInput | Response {
  const exam = (b.exam ?? "").trim();
  const board = (b.board ?? "").trim();
  const rollNo = (b.rollNo ?? "").replace(/\s/g, "");
  const year = Number(b.year);
  const total = Number(b.total);
  const obtained = Number(b.obtained);
  const thisYear = Number(DEMO_TODAY.slice(0, 4));
  if (exam.length < 3 || exam.length > 80) return fail(422, "VALIDATION", "Enter the exam, e.g. SSC Part-I (Class 9) Annual 2026.", { field: "exam" });
  if (board.length < 3 || board.length > 60) return fail(422, "VALIDATION", "Enter the board, e.g. BISE Bahawalpur.", { field: "board" });
  if (!Number.isInteger(year) || year < 1990 || year > thisYear) return fail(422, "VALIDATION", `Enter the year of the exam, 1990 to ${thisYear}.`, { field: "year" });
  if (!/^[A-Za-z0-9-]{3,12}$/.test(rollNo)) return fail(422, "VALIDATION", "The roll no. is 3 to 12 letters or digits.", { field: "rollNo" });
  if (!Number.isInteger(total) || total < 1 || total > 2000) return fail(422, "VALIDATION", "Enter the total marks, 1 to 2,000.", { field: "total" });
  if (!Number.isFinite(obtained) || obtained < 0 || obtained > total) return fail(422, "VALIDATION", `Marks obtained are 0 to ${total}.`, { field: "obtained" });
  const group = (b.group ?? "").trim();
  return { exam, board, year, rollNo, obtained, total, ...(group ? { group } : {}) };
}

const sortQualifications = (list: StudentQualification[]) => [...list].sort((a, b) => a.year - b.year || a.exam.localeCompare(b.exam));

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

function familyOf(cnic: string): Family | undefined {
  const members = STUDENTS.filter((s) => live(s) && s.fatherCnic === cnic);
  const first = members[0];
  if (!first) return undefined;
  const familyId = familyIdOf(first);
  return { fatherCnic: cnic, fatherName: first.father, members: members.map(toSummary), ...(familyId ? { familyId } : {}) };
}

const sessionStart = `${CURRENT_SESSION}-04-01`;
const weekAgo = "2026-10-29";

/** Headline figures and seats per class for the Students page. */
function strengthOf(campus: StudentRecord["campus"] | "ALL"): StudentStrength {
  const scope = STUDENTS.filter((s) => live(s) && (campus === "ALL" || s.campus === campus));
  const active = scope.filter((s) => s.status === "ACTIVE");
  const campuses = campus === "ALL" ? 5 : 1;
  const movements = recordsStore.get().movements.filter((m) => (campus === "ALL" || m.campus === campus) && m.date >= sessionStart);
  const families = new Map<string, Set<string>>();
  for (const s of STUDENTS.filter(live)) {
    const k = familyKeyOf(s);
    families.set(k, (families.get(k) ?? new Set()).add(s.campus));
  }
  const inScopeFamilies = [...new Set(scope.map(familyKeyOf))];
  const dupCases = admissionsStore.get().cases.filter((c) => campus === "ALL" || c.campus === campus).length;
  return {
    enrolled: active.length,
    girls: active.filter((s) => s.gender === "F").length,
    boys: active.filter((s) => s.gender === "M").length,
    newThisSession: active.filter((s) => s.admissionDate >= sessionStart).length,
    newThisWeek: active.filter((s) => s.admissionDate >= weekAgo).length,
    leftThisSession: movements.filter((m) => m.kind === "LEFT" || m.kind === "EXPELLED" || m.kind === "STRUCK_OFF").length,
    struckOff: scope.filter((s) => s.status === "STRUCK_OFF").length,
    families: inScopeFamilies.length,
    crossCampusFamilies: inScopeFamilies.filter((k) => (families.get(k)?.size ?? 0) > 1).length,
    classes: CLASSES.map((c) => {
      const sections = c.sections.map((sec) => {
        const kids = active.filter((s) => s.classSection === `${c.short}-${sec}`);
        return { section: sec, enrolled: kids.length, seats: seatsFor(c.short) * campuses, girls: kids.filter((k) => k.gender === "F").length, boys: kids.filter((k) => k.gender === "M").length };
      });
      return { className: c.short, label: c.name, enrolled: sections.reduce((a, x) => a + x.enrolled, 0), seats: sections.reduce((a, x) => a + x.seats, 0), sections };
    }),
    duplicatesToReview: dupCases,
  };
}

function matches(s: StudentRecord, q: string): boolean {
  const n = norm(q);
  if (!n) return true;
  const digits = normalizeCnic(q);
  if (digits.length >= 5 && /^[\d\s-]+$/.test(q.trim())) return s.fatherCnic.startsWith(digits) || s.guardian.mobile.includes(digits);
  return norm(s.name).includes(n) || norm(s.grNo) === n || norm(s.grNo).includes(n) || norm(s.father).includes(n);
}

/** Ayesha's attendance: Monday–Saturday school, Sundays off. */
function ayeshaMonth(year: number, month: number): StudentAttendance {
  const days: Partial<Record<IsoDate, AttendanceCode>> = {};
  const holidayNames: Partial<Record<IsoDate, string>> = {};
  const special: Record<string, AttendanceCode> = { "2026-09-22": "A", "2026-10-07": "A", "2026-10-08": "L", "2026-10-14": "LT", "2026-10-21": "A", "2026-10-28": "LT", "2026-11-02": "LT" };
  const holidays: Record<string, string> = { "2026-09-06": "Defence Day", "2026-10-24": "Parent–teacher day (no classes)" };
  const last = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const date = new Date(year, month, d);
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (iso > DEMO_TODAY) break;
    if (date.getDay() === 0) continue;
    if (holidays[iso]) {
      days[iso] = "H";
      holidayNames[iso] = holidays[iso];
    } else days[iso] = special[iso] ?? "P";
  }
  return { month: `${year}-${String(month + 1).padStart(2, "0")}`, days, holidayNames };
}

const AYESHA_RESULTS: DeclaredResult[] = [
  {
    examId: "ex-ft-2627",
    exam: "First Term 2026–27",
    session: 2026,
    declaredOn: "2026-10-20",
    obtained: 512,
    total: 600,
    percent: 85.3,
    grade: "A+",
    position: 3,
    subjects: [
      { subject: "English", obtained: 88, max: 100, grade: "A+" },
      { subject: "Urdu", obtained: 82, max: 100, grade: "A+" },
      { subject: "Mathematics", obtained: 92, max: 100, grade: "A+" },
      { subject: "Science", obtained: 85, max: 100, grade: "A+" },
      { subject: "Social Studies", obtained: 79, max: 100, grade: "A" },
      { subject: "Islamiyat", obtained: 86, max: 100, grade: "A+" },
    ],
  },
  {
    examId: "ex-an-2526",
    exam: "Annual 2025–26",
    session: 2025,
    declaredOn: "2026-03-28",
    obtained: 497,
    total: 600,
    percent: 82.8,
    grade: "A+",
    position: 5,
    subjects: [
      { subject: "English", obtained: 84, max: 100, grade: "A+" },
      { subject: "Urdu", obtained: 80, max: 100, grade: "A+" },
      { subject: "Mathematics", obtained: 90, max: 100, grade: "A+" },
      { subject: "Science", obtained: 81, max: 100, grade: "A+" },
      { subject: "Social Studies", obtained: 76, max: 100, grade: "A" },
      { subject: "Islamiyat", obtained: 86, max: 100, grade: "A+" },
    ],
  },
];

const AYESHA_SMS: SmsHistoryItem[] = [
  { id: "m1", sentAt: "2026-11-01T09:00:00+05:00", to: "0300-1234567", language: "en", status: "delivered", message: "Dear Parent, the fee of Rs 8,500 for Ayesha Khan (7-B) is due on 10-Nov-2026. Please pay on time to avoid a late fine of Rs 10 per day. – MTB Khalid Campus" },
  { id: "m2", sentAt: "2026-10-21T08:41:00+05:00", to: "0300-1234567", language: "ur", status: "delivered", message: "محترم والدین، عائشہ خان (7-B) آج 21-Oct-2026 کو اسکول میں غیر حاضر ہے۔ — MTB Khalid Campus" },
  { id: "m3", sentAt: "2026-10-20T16:05:00+05:00", to: "0300-1234567", language: "en", status: "delivered", message: "First Term 2026–27 result for Ayesha Khan (7-B): 512/600 (85.3%), grade A+. – MTB Khalid Campus" },
  { id: "m4", sentAt: "2026-10-15T09:00:00+05:00", to: "0300-1234567", language: "en", status: "failed", message: "Dear Parent, the fee of Rs 8,500 for Ayesha Khan (7-B) was due on 10-Oct-2026 and is now overdue. A late fine of Rs 10 per day applies. – MTB Khalid Campus" },
  { id: "m5", sentAt: "2026-10-07T08:39:00+05:00", to: "0300-1234567", language: "ur", status: "delivered", message: "محترم والدین، عائشہ خان (7-B) آج 07-Oct-2026 کو اسکول میں غیر حاضر ہے۔ — MTB Khalid Campus" },
];

export const studentsHandlers = [
  // Registered before /api/students/:grNo so "strength" is never read as a G.R. number.
  http.get("/api/students/strength", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("students.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(strengthOf(ctx.campus));
  }),

  http.get("/api/students", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("students.view", ctx.campus);
    if (user instanceof Response) return user;
    const p = url.searchParams;
    const q = p.get("q") ?? "";
    const className = p.get("className") ?? "";
    const section = p.get("section") ?? "";
    const status = p.get("status") ?? "";
    const feeStatus = p.get("feeStatus") ?? "";
    const gender = p.get("gender") ?? "";
    const stream = p.get("stream") ?? "";
    const detail = p.get("detail") === "1";

    // A father's CNIC finds the whole family, across campuses.
    const cnic = normalizeCnic(q);
    const family = cnic.length === 13 ? familyOf(cnic) : undefined;
    const records = STUDENTS.filter(live)
      .filter((s) => (family ? s.fatherCnic === cnic : ctx.campus === "ALL" || s.campus === ctx.campus))
      .filter((s) => family || matches(s, q))
      .filter((s) => !className || s.classSection.split("-")[0] === className)
      .filter((s) => !section || s.classSection.split("-")[1] === section)
      .filter((s) => !status || s.status === status)
      .filter((s) => !gender || s.gender === gender)
      .filter((s) => !stream || streamOf(s) === stream);
    let items = records
      .map((s) => {
        const g = streamOf(s);
        const sum = { ...toSummary(s), ...(g ? { stream: g } : {}) };
        if (!detail) return sum;
        // The register columns for the downloaded list (General Student List).
        const extra: StudentListDetail = {
          dob: s.dob,
          ...(s.bForm ? { bForm: s.bForm } : {}),
          ...(s.previousSchool ? { previousSchool: s.previousSchool } : {}),
          guardianMobile: s.guardian.mobile,
          address: s.guardian.address,
          ...(s.boardRollNo ? { boardRollNo: s.boardRollNo } : {}),
        };
        return { ...sum, ...extra };
      })
      .filter((s) => !feeStatus || s.feeStatus === feeStatus);
    items = items.sort((a, b) => a.name.localeCompare(b.name));
    return HttpResponse.json({ items, total: items.length, ...(family ? { family } : {}) });
  }),

  // Registered before /api/students/:grNo so "labels" is never read as a G.R. number.
  http.get("/api/students/labels", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("students.view", ctx.campus);
    if (user instanceof Response) return user;
    const p = url.searchParams;
    const className = p.get("className") ?? "";
    const section = p.get("section") ?? "";
    const grNos = (p.get("grNos") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!className && !grNos.length) return fail(422, "VALIDATION", "Choose a class or tick the students first.", { field: "className" });
    const wanted = new Set(grNos.map((g) => findStudent(g)?.grNo ?? g));
    const labels: StudentAddressLabel[] = STUDENTS.filter(live)
      .filter((s) => ctx.campus === "ALL" || s.campus === ctx.campus)
      .filter((s) => (wanted.size ? wanted.has(s.grNo) : s.status === "ACTIVE" && s.classSection.split("-")[0] === className && (!section || s.classSection.split("-")[1] === section)))
      .sort((a, b) => a.classSection.localeCompare(b.classSection, "en", { numeric: true }) || a.name.localeCompare(b.name))
      .map((s) => {
        const [short = "", sec = ""] = s.classSection.split("-");
        return {
          grNo: s.grNo,
          name: s.name,
          relation: s.relation,
          father: s.father,
          className: short === "Prep" ? "Prep" : `Class ${short}`,
          section: sec,
          classSection: s.classSection,
          guardian: s.guardian.name,
          address: s.guardian.address,
          mobile: s.guardian.mobile,
          campusName: s.campusName,
        };
      });
    return HttpResponse.json(labels);
  }),

  http.get("/api/students/:grNo", async ({ params }) => {
    await latency();
    const s = findStudent(String(params.grNo));
    if (!s) return fail(404, "NOT_FOUND", "No student with this G.R. number.");
    const user = requirePermission("students.view", s.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(profileOf(s));
  }),

  http.patch("/api/students/:grNo", async ({ params, request }) => {
    await latency();
    const s = findStudent(String(params.grNo));
    if (!s || !live(s)) return fail(404, "NOT_FOUND", "No student with this G.R. number.");
    const user = requirePermission("students.edit", s.campus);
    if (user instanceof Response) return user;
    const body = (await request.json()) as StudentUpdate;
    const patch: Partial<StudentRecord> = {};
    const guardian = { ...s.guardian };
    const changed: string[] = [];
    if (body.mobile !== undefined) {
      const m = normalizeMobile(body.mobile);
      if (!m) return fail(422, "VALIDATION", "Enter a Pakistani mobile number, e.g. 0300-1234567.", { field: "mobile" });
      if (m !== guardian.mobile) changed.push("guardian mobile");
      guardian.mobile = m;
    }
    if (body.address !== undefined) {
      if (body.address.trim().length < 8) return fail(422, "VALIDATION", "Enter the full address: house, street and area.", { field: "address" });
      if (body.address.trim() !== guardian.address) changed.push("address");
      guardian.address = body.address.trim();
    }
    if (body.occupation !== undefined) guardian.occupation = body.occupation.trim();
    patch.guardian = guardian;
    if (body.nameUr !== undefined && body.nameUr.trim() !== (s.nameUr ?? "")) {
      patch.nameUr = body.nameUr.trim();
      changed.push("name in Urdu");
    }
    if (body.mother !== undefined && body.mother.trim() !== (s.mother ?? "")) {
      patch.mother = body.mother.trim();
      changed.push("mother's name");
    }
    if (body.bloodGroup !== undefined) patch.bloodGroup = body.bloodGroup;
    if (body.religion !== undefined) patch.religion = body.religion;
    if (body.bForm !== undefined) {
      const b = normalizeCnic(body.bForm);
      if (b && !isValidCnic(b)) return fail(422, "VALIDATION", "A B-form number has 13 digits.", { field: "bForm" });
      patch.bForm = b;
    }
    if (body.boardRollNo !== undefined) {
      const next: NonNullable<StudentRecord["boardRollNo"]> = {};
      for (const [part, field, label] of [["partI", "boardRollPartI", "Part-I"], ["partII", "boardRollPartII", "Part-II"]] as const) {
        const v = (body.boardRollNo[part] ?? s.boardRollNo?.[part] ?? "").replace(/\s/g, "");
        if (!v) continue;
        if (!/^\d{4,9}$/.test(v)) return fail(422, "VALIDATION", `The board roll no. ${label} is 4 to 9 digits.`, { field });
        if (!/^(9|10)-/.test(s.classSection)) return fail(422, "VALIDATION", "Board roll numbers are for Class 9 and 10 students.", { field });
        const other = STUDENTS.find((x) => live(x) && x.grNo !== s.grNo && (x.boardRollNo?.partI === v || x.boardRollNo?.partII === v));
        if (other) return fail(422, "VALIDATION", `Roll no. ${v} is already on ${other.name}'s record (${other.grNo}).`, { field });
        next[part] = v;
      }
      if ((next.partI ?? "") !== (s.boardRollNo?.partI ?? "") || (next.partII ?? "") !== (s.boardRollNo?.partII ?? "")) changed.push("board roll no.");
      patch.boardRollNo = next;
    }
    if (body.fatherCnic !== undefined) {
      const c = normalizeCnic(body.fatherCnic);
      if (!isValidCnic(c)) return fail(422, "VALIDATION", "A CNIC has 13 digits, e.g. 36302-4567890-1.", { field: "fatherCnic" });
      if (c !== s.fatherCnic) {
        patch.fatherCnic = c;
        if (guardian.relation === "Father") guardian.cnic = c;
        changed.push("father's CNIC (family link updated)");
      }
    }
    // The rest of the admission form (religion, disability, contact, parents' work and education, emergency contact).
    const LABEL = {
      disability: "disability",
      identificationMark: "mark of identification",
      birthCertificateNo: "birth certificate no.",
      city: "city",
      tempAddress: "temporary address",
      fatherQualification: "father's qualification",
      fatherOccupation: "father's occupation",
      motherQualification: "mother's qualification",
      motherOccupation: "mother's occupation",
      admissionReference: "admission reference",
    } as const;
    for (const k of Object.keys(LABEL) as Array<keyof typeof LABEL>) {
      const v = body[k];
      if (v === undefined) continue;
      const t = v.trim();
      if (t.length > 120) return fail(422, "VALIDATION", "Keep this under 120 letters.", { field: k });
      if (k === "birthCertificateNo" && t && !/^[A-Za-z0-9/-]{4,20}$/.test(t)) return fail(422, "VALIDATION", "A birth certificate number is 4 to 20 letters, digits or dashes.", { field: k });
      if (t !== (s[k] ?? "")) changed.push(LABEL[k]);
      patch[k] = t;
    }
    if (body.email !== undefined) {
      const e = body.email.trim().toLowerCase();
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return fail(422, "VALIDATION", "Enter an email address such as name@example.com.", { field: "email" });
      if (e !== (s.email ?? "")) changed.push("email");
      patch.email = e;
    }
    if (body.homePhone !== undefined) {
      const h = body.homePhone.replace(/[\s-]/g, "");
      if (h && !/^0\d{9,10}$/.test(h)) return fail(422, "VALIDATION", "Enter a landline with the area code, e.g. 068-5551234.", { field: "homePhone" });
      if (h !== (s.homePhone ?? "")) changed.push("home phone");
      patch.homePhone = h;
    }
    if (body.hostel !== undefined && Boolean(body.hostel) !== Boolean(s.hostel)) {
      patch.hostel = Boolean(body.hostel);
      changed.push(body.hostel ? "now in the hostel" : "left the hostel");
    }
    if (body.emergencyContact !== undefined) {
      const ec = body.emergencyContact;
      if (!ec || (!ec.name.trim() && !ec.mobile1.trim())) {
        if (s.emergencyContact) changed.push("emergency contact removed");
        patch.emergencyContact = undefined;
      } else {
        if (ec.name.trim().length < 3) return fail(422, "VALIDATION", "Enter the emergency contact's name.", { field: "emergencyName" });
        const m1 = normalizeMobile(ec.mobile1 ?? "");
        if (!m1) return fail(422, "VALIDATION", "Enter the emergency contact's mobile, e.g. 0300-1234567.", { field: "emergencyMobile1" });
        const m2 = ec.mobile2?.trim() ? normalizeMobile(ec.mobile2) : "";
        if (m2 === null) return fail(422, "VALIDATION", "The second mobile is not a Pakistani mobile number.", { field: "emergencyMobile2" });
        const next = { name: ec.name.trim(), mobile1: m1, ...(m2 ? { mobile2: m2 } : {}) };
        if (JSON.stringify(next) !== JSON.stringify(s.emergencyContact ?? null)) changed.push("emergency contact");
        patch.emergencyContact = next;
      }
    }
    patchStudent(s.grNo, patch);
    if (changed.length) addEvent(s.grNo, "NOTE", "Record corrected", `Changed: ${changed.join(", ")}`, user.name);
    return HttpResponse.json(profileOf(s));
  }),

  // Board exams and other earlier qualifications on the record (the legacy academic record tab).
  http.post("/api/students/:grNo/qualifications", async ({ params, request }) => {
    await latency();
    const s = findStudent(String(params.grNo));
    if (!s || !live(s)) return fail(404, "NOT_FOUND", "No student with this G.R. number.");
    const user = requirePermission("students.edit", s.campus);
    if (user instanceof Response) return user;
    const key = request.headers.get("Idempotency-Key");
    if (key && s.qualifications?.some((q) => q.id === `q-${key}`)) return HttpResponse.json(profileOf(s));
    const clean = cleanQualification((await request.json()) as Partial<StudentQualificationInput>);
    if (clean instanceof Response) return clean;
    if (clean.group && !groupsOfClass("9").includes(clean.group)) return fail(422, "VALIDATION", "Choose one of the groups in Setup.", { field: "group" });
    if ((s.qualifications ?? []).some((q) => q.exam.toLowerCase() === clean.exam.toLowerCase() && q.year === clean.year)) return fail(422, "VALIDATION", `${clean.exam} (${clean.year}) is already on the record. Correct that entry instead.`, { field: "exam" });
    const q: StudentQualification = { id: `q-${key ?? Date.now().toString(36)}`, ...clean, rowVer: 1, updatedBy: user.name, updatedAt: demoNow() };
    patchStudent(s.grNo, { qualifications: sortQualifications([...(s.qualifications ?? []), q]) });
    addEvent(s.grNo, "NOTE", "Board exam added", `${clean.exam}, ${clean.board} · roll no. ${clean.rollNo} · ${clean.obtained}/${clean.total}`, user.name);
    return HttpResponse.json(profileOf(s), { status: 201 });
  }),

  http.put("/api/students/:grNo/qualifications/:id", async ({ params, request }) => {
    await latency();
    const s = findStudent(String(params.grNo));
    if (!s || !live(s)) return fail(404, "NOT_FOUND", "No student with this G.R. number.");
    const user = requirePermission("students.edit", s.campus);
    if (user instanceof Response) return user;
    const cur = (s.qualifications ?? []).find((q) => q.id === String(params.id));
    if (!cur) return fail(404, "NOT_FOUND", "This board exam is no longer on the record. Reload the page.");
    const body = (await request.json()) as Partial<StudentQualificationInput> & { rowVer?: number };
    if (body.rowVer !== cur.rowVer) {
      const at = cur.updatedAt ?? demoNow();
      return fail(409, "CONCURRENCY", `This entry was changed by ${cur.updatedBy ?? "someone else"}. Reload to see their change, then make yours again.`, { details: { changedBy: cur.updatedBy ?? "someone else", changedAt: at } });
    }
    const clean = cleanQualification(body);
    if (clean instanceof Response) return clean;
    if (clean.group && !groupsOfClass("9").includes(clean.group)) return fail(422, "VALIDATION", "Choose one of the groups in Setup.", { field: "group" });
    if ((s.qualifications ?? []).some((q) => q.id !== cur.id && q.exam.toLowerCase() === clean.exam.toLowerCase() && q.year === clean.year)) return fail(422, "VALIDATION", `${clean.exam} (${clean.year}) is already on the record.`, { field: "exam" });
    const { group: _g, ...base } = cur;
    const next: StudentQualification = { ...base, ...clean, rowVer: cur.rowVer + 1, updatedBy: user.name, updatedAt: demoNow() };
    const changed = (["exam", "board", "year", "rollNo", "obtained", "total", "group"] as const).filter((k) => String(cur[k] ?? "") !== String(next[k] ?? ""));
    patchStudent(s.grNo, { qualifications: sortQualifications((s.qualifications ?? []).map((q) => (q.id === cur.id ? next : q))) });
    if (changed.length) addEvent(s.grNo, "NOTE", "Board exam corrected", `${next.exam}: ${changed.map((k) => (k === "rollNo" ? "roll no." : k)).join(", ")}`, user.name);
    return HttpResponse.json(profileOf(s));
  }),

  http.get("/api/students/:grNo/attendance", async ({ params, request }) => {
    await latency();
    const s = findStudent(String(params.grNo));
    if (!s) return fail(404, "NOT_FOUND", "No student with this G.R. number.");
    const month = new URL(request.url).searchParams.get("month") ?? DEMO_TODAY.slice(0, 7);
    const [y, m] = month.split("-").map(Number) as [number, number];
    const data = ayeshaMonth(y, m - 1);
    if (s.grNo !== "KC-14823") {
      // Other students: same calendar, mostly present.
      for (const k of Object.keys(data.days) as IsoDate[]) if (data.days[k] !== "H") data.days[k] = Number(k.slice(-2)) % 11 === 0 ? "A" : "P";
    }
    // This session's days come from the class registers (Attendance module), so the profile shows the same mark
    // as the register: office marking, a change still waiting for the principal, an approved change, holidays.
    for (const k of Object.keys(data.days) as IsoDate[]) {
      if (k < sessionStart) continue;
      const mark = attendanceMarkOf(s.campus, s.classSection, k, s.grNo);
      if (!mark) continue;
      if (mark === "H") {
        data.days[k] = "H";
        const closed = closedOn(s.campus, k);
        if (closed) data.holidayNames[k] = closed.name;
      } else {
        data.days[k] = mark;
        delete data.holidayNames[k];
      }
    }
    // Nothing before admission, and nothing after the student stopped attending.
    const stop = s.status !== "ACTIVE" ? (statusNoteOf(s)?.on ?? s.leftOn) : undefined;
    for (const k of Object.keys(data.days) as IsoDate[]) if (k < s.admissionDate || (stop && k > stop)) delete data.days[k];
    return HttpResponse.json(data);
  }),

  http.get("/api/students/:grNo/results", async ({ params }) => {
    await latency();
    const s = findStudent(String(params.grNo));
    if (!s) return fail(404, "NOT_FOUND", "No student with this G.R. number.");
    // Declared results from the Exams module (drafts and withheld results never show); Ayesha's fixed list as a fallback.
    const declared = declaredResultsFor(s.grNo);
    return HttpResponse.json(declared.length > 0 ? declared : s.grNo === "KC-14823" ? AYESHA_RESULTS : []);
  }),

  http.get("/api/students/:grNo/sms", async ({ params }) => {
    await latency();
    const s = findStudent(String(params.grNo));
    if (!s) return fail(404, "NOT_FOUND", "No student with this G.R. number.");
    return HttpResponse.json(s.grNo === "KC-14823" ? AYESHA_SMS : []);
  }),

  http.get("/api/search", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("students.view", ctx.campus);
    if (user instanceof Response) return user;
    const q = (url.searchParams.get("q") ?? "").trim();
    const inScope = (s: StudentRecord) => ctx.campus === "ALL" || s.campus === ctx.campus;
    const cnic = normalizeCnic(q);
    const isCnic = /^[\d\s-]+$/.test(q) && cnic.length >= 5;
    const students = STUDENTS.filter(live)
      .filter((s) => (isCnic ? s.fatherCnic.startsWith(cnic) : inScope(s) && matches(s, q)))
      .slice(0, 8);
    const cnics = [...new Set(students.map((s) => s.fatherCnic))];
    const families = cnics.map(familyOf).filter((f): f is Family => Boolean(f && f.members.length > 1));
    const nq = norm(q);
    const receipts = nq.length >= 4
      ? Object.values(feesStore.get().receipts)
          .filter((r) => norm(r.receiptNo).includes(nq))
          .slice(0, 5)
          .map((r) => ({ receiptNo: r.receiptNo, studentName: r.studentName, grNo: r.grNo, total: r.total, postedAt: r.postedAt, status: r.status }))
      : [];
    // Applicants not yet admitted, for users who can see Admissions: name, application no., father's CNIC or mobile.
    const digits = q.replace(/\D/g, "");
    const applicants = can(user, "admissions.view", ctx.campus) && nq.length >= 2
      ? admissionsStore
          .get()
          .applicants.filter((a) => a.session === ctx.session && (ctx.campus === "ALL" || a.campus === ctx.campus) && a.stage !== "ADMITTED")
          .filter((a) => (isCnic ? a.fatherCnic.startsWith(cnic) || (digits.length >= 5 && normalizeMobile(a.mobile)?.includes(digits)) : norm(a.name).includes(nq) || norm(a.applicationNo).includes(nq) || norm(a.father).includes(nq)))
          .sort((a, b) => Number(a.stage === "WITHDRAWN") - Number(b.stage === "WITHDRAWN") || a.name.localeCompare(b.name))
          .slice(0, 6)
          .map((a) => ({ id: a.id, applicationNo: a.applicationNo, name: a.name, relation: a.relation, father: a.father, classApplied: a.classApplied, campusName: a.campusName, stage: a.stage }))
      : [];
    const result: GlobalSearchResult = { students: students.map(toSummary), families, receipts, applicants };
    return HttpResponse.json(result);
  }),
];

/** The full profile: record, live balance, family, class history, next session and status note. */
function profileOf(s: StudentRecord): StudentProfile {
  const stream = streamOf(s);
  const nextSession = nextSessionOf(s.grNo);
  const statusNote = statusNoteOf(s);
  const familyId = familyIdOf(s);
  return {
    ...s,
    ...toSummary(s),
    siblings: STUDENTS.filter((x) => live(x) && familyKeyOf(x) === familyKeyOf(s) && x.grNo !== s.grNo).map(toSummary),
    history: classHistoryOf(s),
    documentsIssued: documentsIssuedCount(s.grNo),
    ...(stream ? { stream } : {}),
    ...(nextSession ? { nextSession } : {}),
    ...(statusNote ? { statusNote } : {}),
    ...(familyId ? { familyId } : {}),
  };
}
