import type {
  ActivitiesAwardApplication,
  ActivitiesCatalogItem,
  ActivitiesCertType,
  ActivitiesEventKind,
  ActivitiesEventStatus,
  ActivitiesFeeHead,
  ActivitiesHeadValues,
  ActivitiesHistoryItem,
  ActivitiesHouseTone,
  ActivitiesMark,
  ActivitiesPointsCategory,
  ActivitiesPointsRule,
  ActivitiesPosition,
  ActivitiesRenewalDecision,
  ActivitiesRole,
  ActivitiesScheme,
  ActivitiesAwardStatus,
  ActivitiesTestPaper,
  ActivitiesTestSource,
  ActivitiesTestStatus,
  CampusCode,
} from "@mtb/api";
import type { IsoDate, IsoDateTime } from "@mtb/domain";
import { hash32, registerSections, rosterFor, type RosterEntry } from "./attendance";
import { findStudent } from "./students";

/*
 * Scholarships and activities — fictional fixtures for the mock server.
 * Students come from the attendance registers (fixture students keep their profiles), so names, classes and
 * G.R. numbers match every other module. Nothing here is copied from the legacy screenshots.
 */

// ---------------------------------------------------------------------------------------------------------
// Picking students from the registers
// ---------------------------------------------------------------------------------------------------------

/** The n-th generated classmate (no profile) of a class-section, so fixture students stay free for the story. */
export function classmate(campus: CampusCode, classSection: string, n: number): RosterEntry & { classSection: string } {
  const list = rosterFor(campus, classSection).filter((e) => !e.hasProfile);
  const e = list[n % Math.max(1, list.length)] ?? rosterFor(campus, classSection)[0]!;
  return { ...e, classSection };
}

/** A senior student (highest classes first) at a campus. */
export function senior(campus: CampusCode, n: number): RosterEntry & { classSection: string } {
  const sections = [...registerSections(campus)].sort((a, b) => classNo(b) - classNo(a));
  const top = sections.slice(0, 3);
  const cs = top[n % top.length] ?? sections[0] ?? "10-A";
  return classmate(campus, cs, Math.floor(n / Math.max(1, top.length)) + 2);
}

export const classNo = (cs: string) => {
  const n = Number(cs.split("-")[0]);
  return Number.isNaN(n) ? 0 : n;
};

const h = (id: string, at: IsoDateTime, by: string, action: string, detail?: string): ActivitiesHistoryItem => ({ id, at, by, action, ...(detail ? { detail } : {}) });

// ---------------------------------------------------------------------------------------------------------
// Scholarship schemes (organisation-wide; the old "Scholarship Info" categories)
// ---------------------------------------------------------------------------------------------------------

export type SchemeRecord = Omit<ActivitiesScheme, "awards" | "pending" | "monthlyRelief">;

const rule = (minResultPercent: number | null, minAttendancePercent: number | null, note = "") => ({ minResultPercent, minAttendancePercent, note });

export function initialSchemes(): SchemeRecord[] {
  return [
    {
      id: "sc-merit",
      name: "Merit scholarship",
      nameUrdu: "میرٹ اسکالرشپ",
      kind: "MERIT",
      basis: "PERCENT",
      value: 25,
      feeHeads: ["TUITION"],
      criteria: "Top places in a scholarship test or a declared term result. Given from the merit list, at most three in a class.",
      evidence: ["Merit list signed by the exam office"],
      meritBands: [
        { fromPercent: 90, toPercent: 100, value: 50 },
        { fromPercent: 85, toPercent: 89.99, value: 25 },
        { fromPercent: 80, toPercent: 84.99, value: 15 },
      ],
      renewal: rule(80, 90, "Checked again on the annual result."),
      seatsPerClass: 3,
      needsTest: true,
      active: true,
    },
    {
      id: "sc-need",
      name: "Need-based scholarship",
      nameUrdu: "مستحق طلبہ اسکالرشپ",
      kind: "NEED",
      basis: "PERCENT",
      value: 50,
      feeHeads: ["TUITION", "ANNUAL"],
      criteria: "Family income below Rs 60,000 a month, confirmed by an interview with the principal and a home visit.",
      evidence: ["Salary slip or income certificate", "Latest electricity bill", "Home-visit report"],
      meritBands: [],
      renewal: rule(50, 85, "Family circumstances are checked again every session."),
      seatsPerClass: null,
      needsTest: false,
      active: true,
    },
    {
      id: "sc-hafiz",
      name: "Hafiz-e-Quran scholarship",
      nameUrdu: "حافظِ قرآن اسکالرشپ",
      kind: "HAFIZ",
      basis: "PERCENT",
      value: 50,
      feeHeads: ["TUITION"],
      criteria: "Has memorised the Holy Quran and passes the recitation and Tajweed check held by the Islamiat department.",
      evidence: ["Hifz certificate (sanad) from the madrasa", "Recitation check marks"],
      meritBands: [],
      renewal: rule(40, 85, "Recitation is checked again each session."),
      seatsPerClass: null,
      needsTest: false,
      active: true,
    },
    {
      id: "sc-sibling",
      name: "Sibling concession",
      nameUrdu: "بہن بھائی رعایت",
      kind: "SIBLING",
      basis: "PERCENT",
      value: 10,
      feeHeads: ["TUITION"],
      criteria: "Second and later children of the same family (matched by the father's CNIC) studying at any MTB campus.",
      evidence: ["Family record in the system (father's CNIC)"],
      meritBands: [],
      renewal: rule(null, null, "Continues while two or more children of the family are enrolled."),
      seatsPerClass: null,
      needsTest: false,
      active: true,
    },
    {
      id: "sc-staff",
      name: "Staff child concession",
      nameUrdu: "اسٹاف کے بچوں کی رعایت",
      kind: "STAFF_CHILD",
      basis: "PERCENT",
      value: 50,
      feeHeads: ["TUITION", "ANNUAL"],
      criteria: "Children of MTB teaching and support staff with at least one year's service.",
      evidence: ["Staff ID card of the parent", "Confirmation from HR"],
      meritBands: [],
      renewal: rule(null, null, "Continues while the parent works at MTB."),
      seatsPerClass: null,
      needsTest: false,
      active: true,
    },
    {
      id: "sc-orphan",
      name: "Orphan scholarship",
      nameUrdu: "یتیم طلبہ اسکالرشپ",
      kind: "ORPHAN",
      basis: "PERCENT",
      value: 100,
      feeHeads: ["TUITION", "ANNUAL"],
      criteria: "Students whose father has passed away.",
      evidence: ["Father's death certificate", "Guardian's CNIC"],
      meritBands: [],
      renewal: rule(null, 80, "Attendance is the only check."),
      seatsPerClass: null,
      needsTest: false,
      active: true,
    },
    {
      id: "sc-shuhada",
      name: "Shuhada child scholarship",
      nameUrdu: "شہدا کے بچوں کی اسکالرشپ",
      kind: "SHUHADA",
      basis: "PERCENT",
      value: 100,
      feeHeads: ["TUITION", "ANNUAL", "ADMISSION"],
      criteria: "Children of martyrs of the armed forces, police and rescue services.",
      evidence: ["Shaheed certificate from the department"],
      meritBands: [],
      renewal: rule(null, null, "Continues until the student leaves MTB."),
      seatsPerClass: null,
      needsTest: false,
      active: true,
    },
    {
      id: "sc-forces",
      name: "Armed forces concession",
      nameUrdu: "مسلح افواج رعایت",
      kind: "ARMED_FORCES",
      basis: "PERCENT",
      value: 20,
      feeHeads: ["TUITION"],
      criteria: "Children of serving armed forces personnel.",
      evidence: ["Service card of the parent"],
      meritBands: [],
      renewal: rule(null, null, "Continues while the parent is serving."),
      seatsPerClass: null,
      needsTest: false,
      active: true,
    },
    {
      id: "sc-govt",
      name: "Government servant child concession",
      nameUrdu: "سرکاری ملازمین کے بچوں کی رعایت",
      kind: "OTHER",
      basis: "PERCENT",
      value: 10,
      feeHeads: ["TUITION"],
      criteria: "Children of serving government employees (BPS 1–16).",
      evidence: ["Service card or salary slip of the parent"],
      meritBands: [],
      renewal: rule(null, 85, "Parent still in government service."),
      seatsPerClass: null,
      needsTest: false,
      active: true,
    },
    {
      id: "sc-kinship",
      name: "Kinship concession",
      nameUrdu: "قرابت داری رعایت",
      kind: "KINSHIP",
      basis: "FIXED",
      value: 1500,
      feeHeads: ["TUITION"],
      criteria: "Relatives recommended by the management committee.",
      evidence: ["Management committee approval"],
      meritBands: [],
      renewal: rule(null, 85, "Committee confirms each session."),
      seatsPerClass: null,
      needsTest: false,
      active: true,
    },
    {
      id: "sc-periphery",
      name: "Periphery student concession",
      nameUrdu: "مضافاتی طلبہ رعایت",
      kind: "PERIPHERY",
      basis: "FIXED",
      value: 1000,
      feeHeads: ["TUITION"],
      criteria: "Students who travel from villages more than 15 km from the campus.",
      evidence: ["Address proof (utility bill)"],
      meritBands: [],
      renewal: rule(null, 85, ""),
      seatsPerClass: null,
      needsTest: false,
      active: true,
    },
    {
      id: "sc-covid",
      name: "COVID-19 relief",
      nameUrdu: "کووڈ ریلیف",
      kind: "OTHER",
      basis: "PERCENT",
      value: 25,
      feeHeads: ["TUITION"],
      criteria: "One-off relief given in 2020–21. Switched off; kept so old records still read correctly.",
      evidence: [],
      meritBands: [],
      renewal: rule(null, null, ""),
      seatsPerClass: null,
      needsTest: false,
      active: false,
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------
// Houses
// ---------------------------------------------------------------------------------------------------------

export interface HouseRecord {
  id: string;
  campus: CampusCode;
  key: string;
  name: string;
  nameUrdu: string;
  motto: string;
  tone: ActivitiesHouseTone;
  houseMaster: string;
  assistantMaster: string | null;
  captainId: string | null;
  viceCaptainId: string | null;
  /** false = retired (kept for history). Missing = in use. */
  active?: boolean;
  /** Added in the demo (not one of the campus's original houses). */
  added?: boolean;
}

const HOUSE_SET: Array<[string, string, string, string, ActivitiesHouseTone]> = [
  ["iqbal", "Iqbal House", "اقبال ہاؤس", "Khudi: strength of self", 1],
  ["jinnah", "Jinnah House", "جناح ہاؤس", "Unity, faith, discipline", 2],
  ["liaquat", "Liaquat House", "لیاقت ہاؤس", "Service before self", 3],
  ["sirsyed", "Sir Syed House", "سر سید ہاؤس", "Knowledge is light", 4],
];

const MASTERS: Record<CampusCode, Array<[string, string]>> = {
  KC: [
    ["Ms Hina Javed", "Ms Rabia Nasir"],
    ["Mr Adeel Anwar", "Mr Fahad Iqbal"],
    ["Ms Sana Tariq", "Ms Saima Akram"],
    ["Mr Imran Shafiq", "Ms Nida Hussain"],
  ],
  SM: [
    ["Mr Tanveer Ahmed", "Ms Nadia Kanwal"],
    ["Mr Rizwan Ali", "Ms Asma Javed"],
    ["Ms Bushra Latif", "Mr Sohail Abbas"],
    ["Mr Qaiser Mehmood", "Ms Uzma Rafiq"],
  ],
  UC: [
    ["Ms Shazia Parveen", "Ms Mehnaz Akhtar"],
    ["Mr Arif Hussain", "Mr Javed Iqbal Bhatti"],
    ["Ms Rukhsana Kausar", "Ms Tahira Naz"],
    ["Mr Shoaib Arif Rana", "Mr Nadeem Sarwar"],
  ],
  MC: [
    ["Mr Naveed Anjum", "Ms Farzana Kausar"],
    ["Mr Ghulam Murtaza", "Ms Kiran Shahzad"],
    ["Ms Sajida Perveen", "Mr Zafar Iqbal"],
    ["Mr Liaqat Hayat", "Ms Ambreen Naz"],
  ],
  HC: [
    ["Ms Mehwish Rana", "Ms Sadaf Iqbal"],
    ["Ms Lubna Tariq", "Ms Hira Khalid"],
    ["Mr Kashif Mehmood", "Ms Samina Yasmeen"],
    ["Ms Aneela Shah", "Mr Waqar Ahmed Malik"],
  ],
};

/** Fixture students whose house is part of the story (Ayesha is in Iqbal House, Hamza in Jinnah House). */
export const FIXED_HOUSE: Record<string, string> = {
  "KC-14823": "h-KC-iqbal",
  "KC-15102": "h-KC-jinnah",
  "KC-14650": "h-KC-jinnah",
  "KC-14988": "h-KC-liaquat",
  "KC-14911": "h-KC-sirsyed",
  "KC-14377": "h-KC-liaquat",
  "KC-15230": "h-KC-sirsyed",
  "KC-13981": "h-KC-iqbal",
  "KC-14108": "h-KC-jinnah",
};

export function initialHouses(): HouseRecord[] {
  const campuses: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];
  return campuses.flatMap((campus) =>
    HOUSE_SET.map(([key, name, nameUrdu, motto, tone], i): HouseRecord => {
      const isFatima = campus === "HC" && key === "jinnah";
      const [master, assistant] = MASTERS[campus][i]!;
      let captainId: string | null = senior(campus, i * 2).grNo;
      let viceCaptainId: string | null = senior(campus, i * 2 + 1).grNo;
      if (campus === "KC" && key === "iqbal") captainId = "KC-13981"; // Sara Nadeem, 10-A
      if (campus === "KC" && key === "jinnah") captainId = "KC-14108"; // Shahzaib Anwar, 9-B
      if (campus === "SM" && key === "sirsyed") viceCaptainId = null;
      return {
        id: `h-${campus}-${key}`,
        campus,
        key,
        name: isFatima ? "Fatima Jinnah House" : name,
        nameUrdu: isFatima ? "فاطمہ جناح ہاؤس" : nameUrdu,
        motto: isFatima ? "Courage and grace" : motto,
        tone,
        houseMaster: master,
        assistantMaster: assistant,
        captainId,
        viceCaptainId,
      };
    }),
  );
}

/** Deterministic starting house for a student: fixture choices, captains, then an even spread by G.R. number. */
export function startingHouse(campus: CampusCode, grNo: string, houses: HouseRecord[]): { houseId: string | null; since: IsoDate } {
  const own = houses.filter((x) => x.campus === campus);
  const lead = own.find((x) => x.captainId === grNo || x.viceCaptainId === grNo);
  const seed = hash32(`${grNo}:house`);
  const year = 2020 + (seed % 7);
  const since: IsoDate = `${year}-04-${String(6 + (seed % 5)).padStart(2, "0")}`;
  if (FIXED_HOUSE[grNo]) return { houseId: FIXED_HOUSE[grNo]!, since: grNo === "KC-14823" ? "2020-04-06" : grNo === "KC-15102" ? "2023-04-03" : since };
  if (lead) return { houseId: lead.id, since };
  // About one in forty students (mostly this session's new admissions) has not been put in a house yet.
  if (seed % 41 === 0) return { houseId: null, since };
  return { houseId: own[hash32(grNo) % own.length]?.id ?? null, since };
}

// ---------------------------------------------------------------------------------------------------------
// Points ledger (non-event entries; event results add their own lines)
// ---------------------------------------------------------------------------------------------------------

export interface PointsRecord {
  id: string;
  campus: CampusCode;
  session: number;
  houseId: string;
  date: IsoDate;
  points: number;
  category: ActivitiesPointsCategory;
  reason: string;
  eventId: string | null;
  by: string;
}

const KC_POINTS: Array<[IsoDate, string, number, ActivitiesPointsCategory, string, string]> = [
  ["2026-04-30", "iqbal", 25, "CONDUCT", "Cleanest classrooms: April", "Mrs Sadia Rehman"],
  ["2026-04-30", "sirsyed", 15, "CONDUCT", "Cleanest classrooms: April (runner-up)", "Mrs Sadia Rehman"],
  ["2026-05-14", "jinnah", 30, "OTHER", "Inter-house quiz", "Mr Adeel Anwar"],
  ["2026-05-14", "liaquat", 18, "OTHER", "Inter-house quiz (runner-up)", "Mr Adeel Anwar"],
  ["2026-05-14", "iqbal", 10, "OTHER", "Inter-house quiz (third)", "Mr Adeel Anwar"],
  ["2026-05-28", "liaquat", 20, "CONDUCT", "Best assembly presentation: May", "Mrs Sadia Rehman"],
  ["2026-08-31", "jinnah", 20, "CONDUCT", "Attendance cup: August (highest attendance)", "Mrs Sadia Rehman"],
  ["2026-09-18", "sirsyed", -10, "DISCIPLINE", "Uniform checks: 6 students without proper uniform", "Mr Imran Shafiq"],
  ["2026-09-30", "iqbal", 20, "CONDUCT", "Attendance cup: September", "Mrs Sadia Rehman"],
  ["2026-09-30", "liaquat", 15, "CONDUCT", "Cleanest classrooms: September", "Mrs Sadia Rehman"],
  ["2026-10-20", "iqbal", 40, "ACADEMIC", "First term: most A+ grades in Classes 6–8", "Mrs Sadia Rehman"],
  ["2026-10-20", "liaquat", 30, "ACADEMIC", "First term: highest pass rate", "Mrs Sadia Rehman"],
  ["2026-10-20", "jinnah", 20, "ACADEMIC", "First term: most improved house", "Mrs Sadia Rehman"],
  ["2026-10-28", "jinnah", -10, "DISCIPLINE", "Late arrivals at assembly (week of 26-Oct)", "Mr Adeel Anwar"],
  ["2026-11-02", "sirsyed", 20, "CONDUCT", "Tree plantation drive", "Ms Sana Tariq"],
];

export function initialPoints(): PointsRecord[] {
  const out: PointsRecord[] = KC_POINTS.map(([date, key, points, category, reason, by], i) => ({
    id: `pt-kc-${i + 1}`,
    campus: "KC",
    session: 2026,
    houseId: `h-KC-${key}`,
    date,
    points,
    category,
    reason,
    eventId: null,
    by,
  }));
  // Other campuses: a few lines each so standings are never empty.
  const other: CampusCode[] = ["SM", "UC", "MC", "HC"];
  other.forEach((campus, c) => {
    HOUSE_SET.forEach(([key], i) => {
      const base = 40 + ((hash32(`${campus}${key}`) % 9) * 7);
      out.push({ id: `pt-${campus}-${key}-1`, campus, session: 2026, houseId: `h-${campus}-${key}`, date: "2026-09-30", points: base, category: "CONDUCT", reason: "House activities: April to September", eventId: null, by: MASTERS[campus][0]![0] });
      if ((i + c) % 2 === 0) out.push({ id: `pt-${campus}-${key}-2`, campus, session: 2026, houseId: `h-${campus}-${key}`, date: "2026-10-22", points: 15 + i * 5, category: "ACADEMIC", reason: "First term results", eventId: null, by: MASTERS[campus][0]![0] });
    });
  });
  // Last session (read-only): Khalid Campus final totals.
  [
    ["iqbal", 388],
    ["jinnah", 402],
    ["liaquat", 356],
    ["sirsyed", 341],
  ].forEach(([key, pts]) =>
    out.push({ id: `pt-kc-2526-${key}`, campus: "KC", session: 2025, houseId: `h-KC-${key}`, date: "2026-03-20", points: pts as number, category: "OTHER", reason: "Session 2025–26: all events and conduct", eventId: null, by: "Mrs Sadia Rehman" }),
  );
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Events, participants and results
// ---------------------------------------------------------------------------------------------------------

export interface ParticipantRecord {
  id: string;
  studentId: string;
  name: string;
  father: string;
  classSection: string;
  hasProfile: boolean;
  houseId: string | null;
  item: string;
  role: ActivitiesRole;
  position: ActivitiesPosition | null;
}

export interface EventRecord {
  id: string;
  campus: CampusCode;
  session: number;
  title: string;
  titleUrdu: string;
  kind: ActivitiesEventKind;
  date: IsoDate;
  endDate: IsoDate | null;
  time: string | null;
  /** Timetable period (lecture number); missing on most events and on events saved before it existed. */
  period?: number | null;
  venue: string;
  inCharge: string[];
  forClasses: string;
  houseEvent: boolean;
  items: string[];
  description: string;
  status: ActivitiesEventStatus;
  cancelReason?: string;
  pointsRule: ActivitiesPointsRule;
  participants: ParticipantRecord[];
  history: ActivitiesHistoryItem[];
}

const RULE: ActivitiesPointsRule = { first: 10, second: 6, third: 3, participation: 1 };
const SPORTS_RULE: ActivitiesPointsRule = { first: 15, second: 10, third: 5, participation: 1 };

/** The fixture student or a generated classmate, as a participant. */
function who(campus: CampusCode, id: string | [string, number]): Omit<ParticipantRecord, "id" | "houseId" | "item" | "role" | "position"> {
  if (typeof id === "string") {
    const s = findStudent(id);
    return { studentId: id, name: s?.name ?? id, father: s?.father ?? "", classSection: s?.classSection ?? "", hasProfile: true };
  }
  const e = classmate(campus, id[0], id[1]);
  return { studentId: e.grNo, name: e.name, father: e.father, classSection: e.classSection, hasProfile: false };
}

type P = [string | [string, number], string, ActivitiesRole, ActivitiesPosition | null];

function people(campus: CampusCode, prefix: string, list: P[], houseOf: (campus: CampusCode, id: string) => string | null): ParticipantRecord[] {
  return list.map(([id, item, role, position], i) => {
    const w = who(campus, id);
    return { id: `${prefix}-${i + 1}`, ...w, houseId: houseOf(campus, w.studentId), item, role, position };
  });
}

interface EventSeed extends Omit<EventRecord, "participants" | "history" | "pointsRule"> {
  pointsRule?: ActivitiesPointsRule;
  people?: P[];
  createdAt: IsoDateTime;
  createdBy: string;
  resultsAt?: IsoDateTime;
}

const E = (s: EventSeed, houseOf: (campus: CampusCode, id: string) => string | null): EventRecord => {
  const { people: list, createdAt, createdBy, resultsAt, pointsRule, ...rest } = s;
  const participants = people(s.campus, s.id, list ?? [], houseOf);
  const history = [h(`${s.id}-h1`, createdAt, createdBy, "Event added to the calendar")];
  if (participants.length) history.push(h(`${s.id}-h2`, createdAt.replace(/T.*/, "T13:00:00+05:00"), createdBy, "Names taken", `${participants.length} participants`));
  if (resultsAt) history.push(h(`${s.id}-h3`, resultsAt, createdBy, "Results recorded", s.houseEvent ? "House points posted" : undefined));
  if (s.status === "CANCELLED" && s.cancelReason) history.push(h(`${s.id}-h4`, createdAt, "Mrs Sadia Rehman", "Event cancelled", s.cancelReason));
  return { ...rest, pointsRule: pointsRule ?? RULE, participants, history };
};

export function initialEvents(houseOf: (campus: CampusCode, id: string) => string | null): EventRecord[] {
  const kc = (cs: string, n: number): [string, number] => [cs, n];
  const seeds: EventSeed[] = [
    {
      id: "ev-kc-indep",
      campus: "KC",
      session: 2026,
      title: "Independence Day celebrations",
      titleUrdu: "جشنِ آزادی",
      kind: "NATIONAL_DAY",
      date: "2026-08-13",
      endDate: null,
      time: "09:00",
      venue: "Assembly hall",
      inCharge: ["Ms Hina Javed", "Mr Adeel Anwar"],
      forClasses: "Prep to Class 10",
      houseEvent: true,
      items: ["National song (group)", "Tableau", "Speech"],
      description: "Flag hoisting, national songs by each house, a tableau and speeches. Held a day early because 14 August is a holiday.",
      status: "DONE",
      createdAt: "2026-08-03T10:00:00+05:00",
      createdBy: "Ms Hina Javed",
      resultsAt: "2026-08-13T13:30:00+05:00",
      people: [
        [kc("8-A", 0), "National song (group)", "CAPTAIN", 1],
        [kc("8-B", 1), "National song (group)", "CAPTAIN", 2],
        [kc("9-A", 2), "National song (group)", "CAPTAIN", 3],
        [kc("6-B", 3), "National song (group)", "CAPTAIN", null],
        ["KC-14911", "Tableau", "PARTICIPANT", 1],
        [kc("5-A", 1), "Tableau", "PARTICIPANT", 2],
        [kc("6-A", 4), "Tableau", "PARTICIPANT", 3],
        [kc("10-A", 1), "Speech", "PARTICIPANT", 1],
        ["KC-14108", "Speech", "PARTICIPANT", 2],
        [kc("9-B", 3), "Speech", "PARTICIPANT", 3],
        [kc("8-C", 2), "Speech", "PARTICIPANT", null],
        [kc("7-A", 5), "Speech", "VOLUNTEER", null],
      ],
    },
    {
      id: "ev-kc-defence",
      campus: "KC",
      session: 2026,
      title: "Defence Day speech competition",
      titleUrdu: "یومِ دفاع تقریری مقابلہ",
      kind: "DEBATE",
      date: "2026-09-04",
      endDate: null,
      time: "10:00",
      venue: "Assembly hall",
      inCharge: ["Mr Adeel Anwar"],
      forClasses: "Classes 6–10",
      houseEvent: true,
      items: ["Urdu speech", "English speech"],
      description: "Speeches on the sacrifices of the armed forces in 1965. Held on the Friday before Defence Day.",
      status: "DONE",
      createdAt: "2026-08-24T09:30:00+05:00",
      createdBy: "Mr Adeel Anwar",
      resultsAt: "2026-09-04T12:30:00+05:00",
      people: [
        ["KC-14650", "Urdu speech", "PARTICIPANT", 1],
        [kc("9-A", 4), "Urdu speech", "PARTICIPANT", 2],
        [kc("8-B", 5), "Urdu speech", "PARTICIPANT", 3],
        [kc("6-A", 2), "Urdu speech", "PARTICIPANT", null],
        [kc("10-B", 2), "English speech", "PARTICIPANT", 1],
        ["KC-13981", "English speech", "PARTICIPANT", 2],
        [kc("7-C", 3), "English speech", "PARTICIPANT", 3],
        [kc("8-A", 6), "English speech", "PARTICIPANT", null],
      ],
    },
    {
      id: "ev-kc-debate",
      campus: "KC",
      session: 2026,
      title: "Inter-house debate 2026",
      titleUrdu: "بین الہاؤس مباحثہ",
      kind: "DEBATE",
      date: "2026-10-01",
      endDate: null,
      time: "09:30",
      venue: "Assembly hall",
      inCharge: ["Ms Hina Javed", "Ms Sana Tariq"],
      forClasses: "Classes 6–10",
      houseEvent: true,
      items: ["English debate", "Urdu debate"],
      description: "Two speakers per house in each language. Motion: “Technology has made us closer.”",
      status: "DONE",
      createdAt: "2026-09-14T11:00:00+05:00",
      createdBy: "Ms Hina Javed",
      resultsAt: "2026-10-01T13:15:00+05:00",
      people: [
        ["KC-14823", "English debate", "PARTICIPANT", 1],
        [kc("9-B", 1), "English debate", "PARTICIPANT", 2],
        [kc("8-C", 4), "English debate", "PARTICIPANT", 3],
        [kc("10-A", 3), "English debate", "PARTICIPANT", null],
        [kc("8-A", 2), "English debate", "PARTICIPANT", null],
        [kc("7-C", 6), "English debate", "PARTICIPANT", null],
        [kc("9-A", 6), "English debate", "PARTICIPANT", null],
        [kc("6-B", 2), "English debate", "PARTICIPANT", null],
        [kc("10-B", 4), "Urdu debate", "PARTICIPANT", 1],
        ["KC-14650", "Urdu debate", "PARTICIPANT", 2],
        [kc("8-B", 3), "Urdu debate", "PARTICIPANT", 3],
        [kc("9-A", 7), "Urdu debate", "PARTICIPANT", null],
        [kc("7-A", 2), "Urdu debate", "PARTICIPANT", null],
        [kc("6-A", 6), "Urdu debate", "PARTICIPANT", null],
        [kc("8-C", 7), "Urdu debate", "PARTICIPANT", null],
        [kc("10-A", 5), "Urdu debate", "PARTICIPANT", null],
      ],
    },
    {
      id: "ev-kc-friendly",
      campus: "KC",
      session: 2026,
      title: "Inter-school football friendly",
      titleUrdu: "بین المدارس فٹ بال میچ",
      kind: "SPORTS",
      date: "2026-10-10",
      endDate: null,
      time: "15:00",
      venue: "Main ground",
      inCharge: ["Mr Imran Shafiq"],
      forClasses: "Classes 8–10 (boys)",
      houseEvent: false,
      items: ["Football (U-16)"],
      description: "Friendly match with a neighbouring school.",
      status: "CANCELLED",
      cancelReason: "Rain: the ground was waterlogged. To be rescheduled after the sports day.",
      createdAt: "2026-09-29T10:00:00+05:00",
      createdBy: "Mr Imran Shafiq",
    },
    {
      id: "ev-kc-spell",
      campus: "KC",
      session: 2026,
      title: "Spelling bee (Classes 3–7)",
      titleUrdu: "ہجے کا مقابلہ",
      kind: "COMPETITION",
      date: "2026-10-22",
      endDate: null,
      time: "10:30",
      venue: "Library",
      inCharge: ["Ms Sana Tariq"],
      forClasses: "Classes 3–7",
      houseEvent: true,
      items: ["Junior (Classes 3–4)", "Senior (Classes 5–7)"],
      description: "Two rounds: written, then oral finals for the top eight in each group.",
      status: "DONE",
      createdAt: "2026-10-06T09:00:00+05:00",
      createdBy: "Ms Sana Tariq",
      resultsAt: "2026-10-22T13:00:00+05:00",
      people: [
        [kc("4-A", 1), "Junior (Classes 3–4)", "PARTICIPANT", 1],
        [kc("3-A", 2), "Junior (Classes 3–4)", "PARTICIPANT", 2],
        ["KC-15102", "Junior (Classes 3–4)", "PARTICIPANT", 3],
        [kc("4-B", 0), "Junior (Classes 3–4)", "PARTICIPANT", null],
        [kc("3-A", 4), "Junior (Classes 3–4)", "PARTICIPANT", null],
        [kc("4-B", 3), "Junior (Classes 3–4)", "PARTICIPANT", null],
        ["KC-14988", "Senior (Classes 5–7)", "PARTICIPANT", 1],
        ["KC-14823", "Senior (Classes 5–7)", "PARTICIPANT", 2],
        [kc("6-B", 5), "Senior (Classes 5–7)", "PARTICIPANT", 3],
        [kc("5-A", 3), "Senior (Classes 5–7)", "PARTICIPANT", null],
        ["KC-15230", "Senior (Classes 5–7)", "PARTICIPANT", null],
        [kc("7-A", 7), "Senior (Classes 5–7)", "PARTICIPANT", null],
      ],
    },
    {
      id: "ev-kc-iqbal",
      campus: "KC",
      session: 2026,
      title: "Iqbal Day: Kalam-e-Iqbal and speeches",
      titleUrdu: "یومِ اقبال: کلامِ اقبال",
      kind: "COMPETITION",
      date: "2026-11-06",
      endDate: null,
      time: "09:30",
      venue: "Assembly hall",
      inCharge: ["Ms Hina Javed"],
      forClasses: "Classes 5–10",
      houseEvent: true,
      items: ["Kalam-e-Iqbal recitation", "Speech on Allama Iqbal"],
      description: "Held on the Friday before Iqbal Day (Monday 9 November is a holiday).",
      status: "OPEN",
      createdAt: "2026-10-26T10:00:00+05:00",
      createdBy: "Ms Hina Javed",
      people: [
        ["KC-14823", "Kalam-e-Iqbal recitation", "PARTICIPANT", null],
        [kc("6-A", 1), "Kalam-e-Iqbal recitation", "PARTICIPANT", null],
        [kc("8-B", 2), "Kalam-e-Iqbal recitation", "PARTICIPANT", null],
        [kc("9-B", 2), "Kalam-e-Iqbal recitation", "PARTICIPANT", null],
        [kc("5-A", 2), "Kalam-e-Iqbal recitation", "PARTICIPANT", null],
        ["KC-14650", "Speech on Allama Iqbal", "PARTICIPANT", null],
        [kc("10-A", 4), "Speech on Allama Iqbal", "PARTICIPANT", null],
        [kc("8-C", 5), "Speech on Allama Iqbal", "PARTICIPANT", null],
        [kc("7-C", 1), "Speech on Allama Iqbal", "PARTICIPANT", null],
      ],
    },
    {
      id: "ev-kc-science",
      campus: "KC",
      session: 2026,
      title: "Science fair 2026",
      titleUrdu: "سائنس میلہ",
      kind: "SCIENCE_FAIR",
      date: "2026-11-19",
      endDate: null,
      time: "09:00",
      venue: "Science laboratory",
      inCharge: ["Ms Sana Tariq", "Mr Fahad Iqbal"],
      forClasses: "Classes 5–10",
      houseEvent: true,
      items: ["Junior projects (Classes 5–7)", "Senior projects (Classes 8–10)"],
      description: "Working models and posters. Parents are invited from 11:00.",
      status: "OPEN",
      createdAt: "2026-10-19T09:00:00+05:00",
      createdBy: "Ms Sana Tariq",
      people: [
        ["KC-14988", "Junior projects (Classes 5–7)", "PARTICIPANT", null],
        ["KC-14823", "Junior projects (Classes 5–7)", "PARTICIPANT", null],
        [kc("6-B", 1), "Junior projects (Classes 5–7)", "PARTICIPANT", null],
        [kc("5-A", 5), "Junior projects (Classes 5–7)", "PARTICIPANT", null],
        [kc("7-C", 4), "Junior projects (Classes 5–7)", "PARTICIPANT", null],
        ["KC-14377", "Senior projects (Classes 8–10)", "PARTICIPANT", null],
        [kc("9-A", 1), "Senior projects (Classes 8–10)", "PARTICIPANT", null],
        [kc("10-B", 1), "Senior projects (Classes 8–10)", "PARTICIPANT", null],
        [kc("8-A", 4), "Senior projects (Classes 8–10)", "PARTICIPANT", null],
        [kc("9-B", 5), "Senior projects (Classes 8–10)", "VOLUNTEER", null],
      ],
    },
    {
      id: "ev-kc-sports",
      campus: "KC",
      session: 2026,
      title: "Annual sports day 2026",
      titleUrdu: "سالانہ کھیلوں کا دن",
      kind: "SPORTS",
      date: "2026-11-27",
      endDate: null,
      time: "08:30",
      venue: "Main ground",
      inCharge: ["Mr Imran Shafiq", "Mr Adeel Anwar"],
      forClasses: "Prep to Class 10",
      houseEvent: true,
      items: ["100 m race (boys)", "100 m race (girls)", "200 m race", "Relay 4×100 m", "Sack race (juniors)", "Tug of war"],
      description: "Registers are taken in the morning before the events start. Parents are welcome; prize giving at 12:30.",
      status: "OPEN",
      pointsRule: SPORTS_RULE,
      createdAt: "2026-10-12T09:00:00+05:00",
      createdBy: "Mr Imran Shafiq",
      people: [
        [kc("9-A", 3), "100 m race (boys)", "PARTICIPANT", null],
        [kc("10-A", 6), "100 m race (boys)", "PARTICIPANT", null],
        [kc("8-C", 1), "100 m race (boys)", "PARTICIPANT", null],
        [kc("9-B", 4), "100 m race (boys)", "PARTICIPANT", null],
        ["KC-14911", "100 m race (girls)", "PARTICIPANT", null],
        [kc("8-A", 1), "100 m race (girls)", "PARTICIPANT", null],
        [kc("10-B", 3), "100 m race (girls)", "PARTICIPANT", null],
        [kc("6-B", 4), "100 m race (girls)", "PARTICIPANT", null],
        ["KC-14650", "200 m race", "PARTICIPANT", null],
        [kc("9-A", 5), "200 m race", "PARTICIPANT", null],
        [kc("10-A", 7), "200 m race", "PARTICIPANT", null],
        ["KC-14377", "Relay 4×100 m", "CAPTAIN", null],
        [kc("8-C", 3), "Relay 4×100 m", "PLAYER", null],
        [kc("8-B", 6), "Relay 4×100 m", "CAPTAIN", null],
        [kc("9-B", 6), "Relay 4×100 m", "CAPTAIN", null],
        [kc("10-B", 5), "Relay 4×100 m", "CAPTAIN", null],
        ["KC-15102", "Sack race (juniors)", "PARTICIPANT", null],
        [kc("4-B", 1), "Sack race (juniors)", "PARTICIPANT", null],
        [kc("3-A", 1), "Sack race (juniors)", "PARTICIPANT", null],
        [kc("2-B", 2), "Sack race (juniors)", "PARTICIPANT", null],
        [kc("10-A", 2), "Tug of war", "CAPTAIN", null],
        [kc("10-B", 6), "Tug of war", "CAPTAIN", null],
        [kc("9-A", 8), "Tug of war", "CAPTAIN", null],
        [kc("9-B", 7), "Tug of war", "CAPTAIN", null],
        [kc("7-A", 3), "200 m race", "VOLUNTEER", null],
      ],
    },
    {
      id: "ev-kc-quaid",
      campus: "KC",
      session: 2026,
      title: "Quaid Day",
      titleUrdu: "یومِ قائد",
      kind: "NATIONAL_DAY",
      date: "2026-12-18",
      endDate: null,
      time: "09:30",
      venue: "Assembly hall",
      inCharge: ["Mr Adeel Anwar"],
      forClasses: "Prep to Class 10",
      houseEvent: true,
      items: ["Speech", "Tableau", "Quiz on the Quaid's life"],
      description: "Held on the last day before winter vacation (25 December is a holiday).",
      status: "PLANNED",
      createdAt: "2026-11-02T09:00:00+05:00",
      createdBy: "Mr Adeel Anwar",
    },
    {
      id: "ev-kc-naat",
      campus: "KC",
      session: 2026,
      title: "Naat and Qirat competition",
      titleUrdu: "نعت و قرأت مقابلہ",
      kind: "RELIGIOUS",
      date: "2027-01-14",
      endDate: null,
      time: "10:00",
      venue: "Assembly hall",
      inCharge: ["Ms Rabia Nasir"],
      forClasses: "Classes 3–10",
      houseEvent: true,
      items: ["Naat", "Qirat"],
      description: "",
      status: "PLANNED",
      createdAt: "2026-11-02T09:10:00+05:00",
      createdBy: "Ms Hina Javed",
    },
    {
      id: "ev-kc-pakday",
      campus: "KC",
      session: 2026,
      title: "Pakistan Day assembly",
      titleUrdu: "یومِ پاکستان",
      kind: "NATIONAL_DAY",
      date: "2027-03-22",
      endDate: null,
      time: "08:15",
      venue: "Assembly hall",
      inCharge: ["Ms Hina Javed"],
      forClasses: "Prep to Class 10",
      houseEvent: false,
      items: ["Speech"],
      description: "",
      status: "PLANNED",
      createdAt: "2026-11-02T09:20:00+05:00",
      createdBy: "Ms Hina Javed",
    },
    {
      id: "ev-kc-prize",
      campus: "KC",
      session: 2026,
      title: "Annual prize distribution",
      titleUrdu: "تقسیمِ انعامات",
      kind: "CEREMONY",
      date: "2027-03-26",
      endDate: null,
      time: "10:00",
      venue: "Assembly hall",
      inCharge: ["Mrs Sadia Rehman"],
      forClasses: "All classes",
      houseEvent: false,
      items: ["Position holders", "House trophy"],
      description: "Prizes for annual-result position holders and the house trophy.",
      status: "PLANNED",
      createdAt: "2026-11-02T09:30:00+05:00",
      createdBy: "Mrs Sadia Rehman",
    },
    // ---- Last session (read-only) ----
    {
      id: "ev-kc-sports-2526",
      campus: "KC",
      session: 2025,
      title: "Annual sports day 2025",
      titleUrdu: "سالانہ کھیلوں کا دن",
      kind: "SPORTS",
      date: "2025-11-28",
      endDate: null,
      time: "08:30",
      venue: "Main ground",
      inCharge: ["Mr Imran Shafiq"],
      forClasses: "Prep to Class 10",
      houseEvent: true,
      items: ["100 m race (girls)", "Relay 4×100 m", "Sack race (juniors)"],
      description: "",
      status: "DONE",
      pointsRule: SPORTS_RULE,
      createdAt: "2025-11-03T09:00:00+05:00",
      createdBy: "Mr Imran Shafiq",
      resultsAt: "2025-11-28T13:00:00+05:00",
      people: [
        ["KC-14911", "100 m race (girls)", "PARTICIPANT", 1],
        ["KC-14823", "100 m race (girls)", "PARTICIPANT", 3],
        [kc("7-C", 2), "100 m race (girls)", "PARTICIPANT", 2],
        ["KC-14377", "Relay 4×100 m", "CAPTAIN", 1],
        [kc("9-A", 2), "Relay 4×100 m", "CAPTAIN", 2],
        ["KC-15102", "Sack race (juniors)", "PARTICIPANT", 2],
        [kc("3-A", 3), "Sack race (juniors)", "PARTICIPANT", 1],
      ],
    },
    {
      id: "ev-kc-science-2526",
      campus: "KC",
      session: 2025,
      title: "Science fair 2025",
      titleUrdu: "سائنس میلہ",
      kind: "SCIENCE_FAIR",
      date: "2025-11-20",
      endDate: null,
      time: "09:00",
      venue: "Science laboratory",
      inCharge: ["Ms Sana Tariq"],
      forClasses: "Classes 5–10",
      houseEvent: true,
      items: ["Junior projects (Classes 5–7)"],
      description: "",
      status: "DONE",
      createdAt: "2025-10-27T09:00:00+05:00",
      createdBy: "Ms Sana Tariq",
      resultsAt: "2025-11-20T13:00:00+05:00",
      people: [
        ["KC-14988", "Junior projects (Classes 5–7)", "PARTICIPANT", 1],
        ["KC-14823", "Junior projects (Classes 5–7)", "PARTICIPANT", null],
        [kc("6-A", 3), "Junior projects (Classes 5–7)", "PARTICIPANT", 2],
      ],
    },
    // ---- Other campuses ----
    {
      id: "ev-hc-debate",
      campus: "HC",
      session: 2026,
      title: "Inter-house debate",
      titleUrdu: "بین الہاؤس مباحثہ",
      kind: "DEBATE",
      date: "2026-10-08",
      endDate: null,
      time: "10:00",
      venue: "Auditorium",
      inCharge: ["Ms Mehwish Rana"],
      forClasses: "Classes 6–10",
      houseEvent: true,
      items: ["English debate"],
      description: "",
      status: "DONE",
      createdAt: "2026-09-21T10:00:00+05:00",
      createdBy: "Ms Mehwish Rana",
      resultsAt: "2026-10-08T13:00:00+05:00",
      people: [
        [["5-A", 0], "English debate", "PARTICIPANT", 1],
        [["5-A", 1], "English debate", "PARTICIPANT", 2],
        [["5-A", 2], "English debate", "PARTICIPANT", 3],
        [["5-A", 3], "English debate", "PARTICIPANT", null],
      ],
    },
    {
      id: "ev-hc-annual",
      campus: "HC",
      session: 2026,
      title: "Campus annual day",
      titleUrdu: "کیمپس کا سالانہ دن",
      kind: "CEREMONY",
      date: "2026-12-18",
      endDate: null,
      time: "10:00",
      venue: "Auditorium",
      inCharge: ["Ms Lubna Tariq"],
      forClasses: "All classes",
      houseEvent: false,
      items: ["Performances"],
      description: "No classes on the day.",
      status: "PLANNED",
      createdAt: "2026-10-15T10:00:00+05:00",
      createdBy: "Ms Lubna Tariq",
    },
    {
      id: "ev-uc-science",
      campus: "UC",
      session: 2026,
      title: "Science fair",
      titleUrdu: "سائنس میلہ",
      kind: "SCIENCE_FAIR",
      date: "2026-11-12",
      endDate: null,
      time: "09:00",
      venue: "Science laboratory",
      inCharge: ["Ms Shazia Parveen"],
      forClasses: "Classes 6–10",
      houseEvent: true,
      items: ["Projects"],
      description: "",
      status: "OPEN",
      createdAt: "2026-10-20T10:00:00+05:00",
      createdBy: "Ms Shazia Parveen",
      people: [
        ["UC-08831", "Projects", "PARTICIPANT", null],
        [["9-A", 1], "Projects", "PARTICIPANT", null],
      ],
    },
    {
      id: "ev-sm-sports",
      campus: "SM",
      session: 2026,
      title: "Sports day",
      titleUrdu: "کھیلوں کا دن",
      kind: "SPORTS",
      date: "2026-12-04",
      endDate: null,
      time: "08:30",
      venue: "Main ground",
      inCharge: ["Mr Tanveer Ahmed"],
      forClasses: "All classes",
      houseEvent: true,
      items: ["100 m race", "Tug of war"],
      description: "",
      status: "PLANNED",
      createdAt: "2026-10-28T10:00:00+05:00",
      createdBy: "Mr Tanveer Ahmed",
    },
  ];
  return seeds.map((s) => E(s, houseOf));
}

// ---------------------------------------------------------------------------------------------------------
// Scholarship tests (dedicated tests keep their own candidates; exam-based tests read the exam's results)
// ---------------------------------------------------------------------------------------------------------

export interface CandidateRecord {
  id: string;
  /** G.R. number for a student; absent for an applicant. */
  studentId: string | null;
  name: string;
  father: string;
  classSection: string;
  previousSchool: string | null;
  mobile: string | null;
  hasProfile: boolean;
  marks: Record<string, ActivitiesMark>;
}

export interface TestRecord {
  id: string;
  testNo: string;
  title: string;
  campus: CampusCode;
  session: number;
  source: ActivitiesTestSource;
  examId: string | null;
  classLabel: string;
  schemeId: string;
  date: IsoDate | null;
  venue: string | null;
  papers: ActivitiesTestPaper[];
  seats: number | null;
  passPercent: number;
  status: ActivitiesTestStatus;
  candidates: CandidateRecord[];
  history: ActivitiesHistoryItem[];
}

const APPLICANTS: Array<[string, string, string, string]> = [
  ["Muhammad Ahmad Raza", "Raza Hussain", "Government High School No. 2, Sadiqabad", "0301-5550411"],
  ["Hafsa Bibi", "Ghulam Rasool", "Al-Noor Public School, Sadiqabad", "0302-5550422"],
  ["Abdul Wasay", "Muhammad Aslam", "City Grammar School, Sadiqabad", "0333-5550433"],
  ["Mahnoor Fatima", "Zulfiqar Ahmed", "Government Girls High School, Sadiqabad", "0345-5550444"],
  ["Usama Tariq", "Tariq Mehmood", "Sunrise Model School, Sadiqabad", "0300-5550455"],
];

const cand = (e: RosterEntry & { classSection: string }, marks: Record<string, ActivitiesMark>): CandidateRecord => ({
  id: e.grNo,
  studentId: e.grNo,
  name: e.name,
  father: e.father,
  classSection: e.classSection,
  previousSchool: null,
  mobile: null,
  hasProfile: e.hasProfile,
  marks,
});

export function initialTests(): TestRecord[] {
  const nineMarks = (papers: ActivitiesTestPaper[]) => Object.fromEntries(papers.map((p) => [p.id, null])) as Record<string, ActivitiesMark>;
  const c9Papers: ActivitiesTestPaper[] = [
    { id: "eng", name: "English", maxMarks: 50 },
    { id: "mat", name: "Mathematics", maxMarks: 50 },
    { id: "sci", name: "General science", maxMarks: 50 },
  ];
  const hafizPapers: ActivitiesTestPaper[] = [
    { id: "nazra", name: "Recitation (Nazra)", maxMarks: 50 },
    { id: "tajweed", name: "Tajweed", maxMarks: 30 },
    { id: "hifz", name: "Memorisation check", maxMarks: 20 },
  ];
  const hafizMarks: Array<Record<string, ActivitiesMark>> = [
    { nazra: 46, tajweed: 27, hifz: 19 },
    { nazra: 41, tajweed: 24, hifz: 17 },
    { nazra: 38, tajweed: 19, hifz: 15 },
    { nazra: 29, tajweed: 14, hifz: 11 },
    { nazra: null, tajweed: null, hifz: null },
    { nazra: 44, tajweed: null, hifz: null },
  ];
  const hafizPeople = [classmate("KC", "8-A", 3), classmate("KC", "6-B", 6), "KC-14650", classmate("KC", "9-B", 8), classmate("KC", "5-A", 6), classmate("KC", "7-C", 8)] as const;
  const bilal = findStudent("KC-14650");
  const hafizCandidates: CandidateRecord[] = hafizPeople.map((p, i) =>
    typeof p === "string"
      ? { id: p, studentId: p, name: bilal?.name ?? p, father: bilal?.father ?? "", classSection: bilal?.classSection ?? "7-B", previousSchool: null, mobile: null, hasProfile: true, marks: hafizMarks[i]! }
      : cand(p, hafizMarks[i]!),
  );
  const nineStudents = [classmate("KC", "9-A", 0), classmate("KC", "9-A", 4), classmate("KC", "9-A", 9), classmate("KC", "9-B", 0), classmate("KC", "9-B", 3), classmate("KC", "9-B", 9), classmate("KC", "9-A", 12), classmate("KC", "9-B", 12), classmate("KC", "9-A", 15)];
  const nineCandidates: CandidateRecord[] = [
    ...nineStudents.map((e) => cand(e, nineMarks(c9Papers))),
    ...APPLICANTS.map(([name, father, school, mobile], i): CandidateRecord => ({
      id: `APP-KC-2627-${String(31 + i).padStart(4, "0")}`,
      studentId: null,
      name,
      father,
      classSection: "Class 9 applicant",
      previousSchool: school,
      mobile,
      hasProfile: false,
      marks: nineMarks(c9Papers),
    })),
  ];
  return [
    {
      id: "st-kc-c7",
      testNo: "ST-KC-2627-01",
      title: "Talent scholarship · Class 7",
      campus: "KC",
      session: 2026,
      source: "EXAM",
      examId: "ex-ft-2627",
      classLabel: "Class 7",
      schemeId: "sc-merit",
      date: null,
      venue: null,
      papers: [],
      seats: 3,
      passPercent: 80,
      status: "AWARDED",
      candidates: [],
      history: [
        h("st1-h1", "2026-10-26T10:00:00+05:00", "Kamran Yousaf", "Merit list made from First Term 2026–27", "Declared result · 3 seats · pass mark 80%"),
        h("st1-h2", "2026-11-02T11:20:00+05:00", "Kamran Yousaf", "Awards proposed", "3 students sent for the principal's approval"),
      ],
    },
    {
      id: "st-kc-c4",
      testNo: "ST-KC-2627-02",
      title: "Talent scholarship · Class 4",
      campus: "KC",
      session: 2026,
      source: "EXAM",
      examId: "ex-ft-2627-c4",
      classLabel: "Class 4",
      schemeId: "sc-merit",
      date: null,
      venue: null,
      papers: [],
      seats: 3,
      passPercent: 75,
      status: "RESULT",
      candidates: [],
      history: [h("st2-h1", "2026-10-27T09:40:00+05:00", "Kamran Yousaf", "Merit list made from First Term 2026–27", "Declared result · 3 seats · pass mark 75%")],
    },
    {
      id: "st-kc-hafiz",
      testNo: "ST-KC-2627-03",
      title: "Hafiz-e-Quran recitation check 2026",
      campus: "KC",
      session: 2026,
      source: "DEDICATED",
      examId: null,
      classLabel: "Classes 5–9 (Hafiz students)",
      schemeId: "sc-hafiz",
      date: "2026-10-29",
      venue: "Library",
      papers: hafizPapers,
      seats: null,
      passPercent: 60,
      status: "MARKING",
      candidates: hafizCandidates,
      history: [
        h("st3-h1", "2026-10-12T09:00:00+05:00", "Kamran Yousaf", "Test set up", "3 papers · 100 marks · pass mark 60%"),
        h("st3-h2", "2026-10-26T15:00:00+05:00", "Kamran Yousaf", "Registration closed", "6 candidates"),
        h("st3-h3", "2026-10-30T12:10:00+05:00", "Ms Rabia Nasir", "Marks saved", "4 of 6 candidates complete"),
      ],
    },
    {
      id: "st-kc-c9",
      testNo: "ST-KC-2627-04",
      title: "Talent scholarship test 2026 · Class 9",
      campus: "KC",
      session: 2026,
      source: "DEDICATED",
      examId: null,
      classLabel: "Class 9 (students and applicants)",
      schemeId: "sc-merit",
      date: "2026-11-14",
      venue: "Assembly hall",
      papers: c9Papers,
      seats: 5,
      passPercent: 70,
      status: "REGISTRATION",
      candidates: nineCandidates,
      history: [h("st4-h1", "2026-10-28T10:30:00+05:00", "Kamran Yousaf", "Test set up", "3 papers · 150 marks · 5 seats")],
    },
    {
      id: "st-uc-c9",
      testNo: "ST-UC-2627-01",
      title: "Talent scholarship · Class 9",
      campus: "UC",
      session: 2026,
      source: "EXAM",
      examId: "ex-ft-2627-uc9",
      classLabel: "Class 9",
      schemeId: "sc-merit",
      date: null,
      venue: null,
      papers: [],
      seats: 2,
      passPercent: 80,
      status: "RESULT",
      candidates: [],
      history: [h("st5-h1", "2026-10-28T12:00:00+05:00", "Kamran Yousaf", "Merit list made from First Term 2026–27", "Declared result · 2 seats")],
    },
    {
      id: "st-kc-c6-2526",
      testNo: "ST-KC-2526-01",
      title: "Talent scholarship · Class 6",
      campus: "KC",
      session: 2025,
      source: "EXAM",
      examId: "ex-ft-2526-c6",
      classLabel: "Class 6",
      schemeId: "sc-merit",
      date: null,
      venue: null,
      papers: [],
      seats: 3,
      passPercent: 80,
      status: "AWARDED",
      candidates: [],
      history: [h("st6-h1", "2025-11-04T10:00:00+05:00", "Kamran Yousaf", "Awards proposed", "3 students")],
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------------------------------------

export interface AwardRecord {
  id: string;
  awardNo: string;
  campus: CampusCode;
  session: number;
  studentId: string;
  studentName: string;
  father: string;
  classSection: string;
  isApplicant: boolean;
  hasProfile: boolean;
  schemeId: string;
  value: number;
  feeHeads: ActivitiesFeeHead[];
  /** A different % per head (PERCENT schemes). */
  values?: ActivitiesHeadValues;
  application?: ActivitiesAwardApplication;
  /** Applicants: the school they come from. */
  previousSchool?: string | null;
  gender?: "F" | "M";
  listRound?: number;
  testId?: string;
  rank?: number;
  percent?: number;
  reason: string;
  evidence: string;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate;
  status: ActivitiesAwardStatus;
  proposedBy: string;
  proposedAt: IsoDateTime;
  decidedBy?: string;
  decidedAt?: IsoDateTime;
  decisionNote?: string;
  endedOn?: IsoDate;
  endReason?: string;
  renewal?: { decision: ActivitiesRenewalDecision; newValue?: number; decidedBy: string; decidedAt: IsoDateTime; note?: string };
  history: ActivitiesHistoryItem[];
}

export interface RankedPerson {
  id: string;
  name: string;
  father: string;
  classSection: string;
  percent: number;
  rank: number;
  hasProfile: boolean;
}

type Seed = [
  campus: CampusCode,
  who: string | [string, number],
  schemeId: string,
  value: number,
  feeHeads: ActivitiesFeeHead[],
  reason: string,
  evidence: string,
  from: IsoDate,
  status: ActivitiesAwardStatus,
  proposedBy: string,
  proposedAt: IsoDateTime,
  decidedBy?: string,
  decidedAt?: IsoDateTime,
];

const SESSION_END: Record<number, IsoDate> = { 2026: "2027-03-31", 2025: "2026-03-31" };

/**
 * Awards for both sessions. `topOf(examId, n)` returns an exam's merit order, so the talent awards go to the
 * students the merit list really shows (Areeba, Bilal and Ayesha top Class 7).
 */
export function initialAwards(topOf: (examId: string, n: number) => RankedPerson[]): AwardRecord[] {
  const out: AwardRecord[] = [];
  const seq: Record<string, number> = {};
  const nextNo = (campus: CampusCode, session: number) => {
    const key = `${campus}${session}`;
    seq[key] = (seq[key] ?? 0) + 1;
    const code = `${String(session % 100).padStart(2, "0")}${String((session + 1) % 100).padStart(2, "0")}`;
    return `SCH-${campus}-${code}-${String(seq[key]).padStart(4, "0")}`;
  };
  const push = (session: number, campus: CampusCode, p: { id: string; name: string; father: string; classSection: string; hasProfile: boolean }, rest: Omit<AwardRecord, "id" | "awardNo" | "campus" | "session" | "studentId" | "studentName" | "father" | "classSection" | "isApplicant" | "hasProfile" | "effectiveTo" | "history"> & { history?: ActivitiesHistoryItem[] }) => {
    const awardNo = nextNo(campus, session);
    const history = rest.history ?? [
      h(`${awardNo}-1`, rest.proposedAt, rest.proposedBy, "Proposed", rest.reason),
      ...(rest.decidedBy && rest.decidedAt ? [h(`${awardNo}-2`, rest.decidedAt, rest.decidedBy, rest.status === "REJECTED" ? "Rejected" : "Approved", rest.decisionNote)] : []),
    ];
    out.push({
      ...rest,
      id: `aw-${awardNo.toLowerCase()}`,
      awardNo,
      campus,
      session,
      studentId: p.id,
      studentName: p.name,
      father: p.father,
      classSection: p.classSection,
      isApplicant: false,
      hasProfile: p.hasProfile,
      effectiveTo: SESSION_END[session]!,
      history,
    });
  };

  const person = (campus: CampusCode, w: string | [string, number]) => {
    if (typeof w === "string") {
      const f = findStudent(w);
      return { id: w, name: f?.name ?? w, father: f?.father ?? "", classSection: f?.classSection ?? "", hasProfile: true };
    }
    const e = classmate(campus, w[0], w[1]);
    return { id: e.grNo, name: e.name, father: e.father, classSection: e.classSection, hasProfile: false };
  };

  // ---- 2025–26: talent awards from First Term 2025–26 (Class 6), renewed into 2026–27 ----
  const last = topOf("ex-ft-2526-c6", 3);
  const bandValue = (pct: number) => (pct >= 90 ? 50 : pct >= 85 ? 25 : 15);
  last.forEach((r) => {
    push(2025, "KC", r, {
      schemeId: "sc-merit",
      value: bandValue(r.percent),
      feeHeads: ["TUITION"],
      testId: "st-kc-c6-2526",
      rank: r.rank,
      percent: r.percent,
      reason: `Rank ${r.rank} in the Class 6 talent merit list (First Term 2025–26, ${r.percent.toFixed(1)}%).`,
      evidence: "Merit list ST-KC-2526-01",
      effectiveFrom: "2025-12-01",
      status: "APPROVED",
      proposedBy: "Kamran Yousaf",
      proposedAt: "2025-11-04T10:00:00+05:00",
      decidedBy: "Mrs Sadia Rehman",
      decidedAt: "2025-11-06T12:30:00+05:00",
      renewal: { decision: "RENEW", decidedBy: "Mrs Sadia Rehman", decidedAt: "2026-03-28T11:00:00+05:00", note: "Annual result above 80%." },
    });
  });
  // The same students continue in 2026–27 (now in Class 7) until the renewal review.
  const lastIds = new Set(last.map((r) => r.id));
  const now7 = topOf("ex-ft-2627", 200).filter((r) => lastIds.has(r.id));
  now7.forEach((r) => {
    const before = last.find((x) => x.id === r.id)!;
    push(2026, "KC", { ...r }, {
      schemeId: "sc-merit",
      value: bandValue(before.percent),
      feeHeads: ["TUITION"],
      reason: `Renewed from 2025–26: rank ${before.rank} in the Class 6 talent merit list.`,
      evidence: "Annual result 2025–26 and renewal review",
      effectiveFrom: "2026-04-01",
      status: "APPROVED",
      proposedBy: "Kamran Yousaf",
      proposedAt: "2026-03-28T11:00:00+05:00",
      decidedBy: "Mrs Sadia Rehman",
      decidedAt: "2026-03-30T10:15:00+05:00",
      decisionNote: "Renewed for 2026–27.",
    });
  });

  // ---- 2026–27: Class 7 talent awards proposed from this term's merit list (waiting for the principal) ----
  topOf("ex-ft-2627", 3).forEach((r) => {
    if (lastIds.has(r.id)) return;
    push(2026, "KC", r, {
      schemeId: "sc-merit",
      value: bandValue(r.percent),
      feeHeads: ["TUITION"],
      testId: "st-kc-c7",
      rank: r.rank,
      percent: r.percent,
      reason: `Rank ${r.rank} in the Class 7 talent merit list (First Term 2026–27, ${r.percent.toFixed(1)}%).`,
      evidence: "Merit list ST-KC-2627-01",
      effectiveFrom: "2026-12-01",
      status: "PENDING",
      proposedBy: "Kamran Yousaf",
      proposedAt: "2026-11-02T11:20:00+05:00",
    });
  });

  const seeds: Seed[] = [
    ["KC", "KC-15102", "sc-sibling", 10, ["TUITION"], "Younger brother of Ayesha Khan (KC-14823) and Mariam Khan (UC-08831). Father's CNIC matches.", "Family record", "2026-12-01", "APPROVED", "Kamran Yousaf", "2026-10-30T09:40:00+05:00", "Mrs Sadia Rehman", "2026-11-02T12:05:00+05:00"],
    ["UC", "UC-08831", "sc-sibling", 10, ["TUITION"], "Third child of the family; two siblings at Khalid Campus.", "Family record", "2026-12-01", "APPROVED", "Kamran Yousaf", "2026-10-30T09:45:00+05:00", "Kamran Yousaf", "2026-11-02T12:10:00+05:00"],
    ["KC", ["8-A", 3], "sc-need", 50, ["TUITION", "ANNUAL"], "Father is a daily-wage worker; family of seven. Home visit on 12-Apr-2026.", "Income certificate, electricity bill, home-visit report", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-13T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-15T11:00:00+05:00"],
    ["KC", ["6-B", 2], "sc-need", 40, ["TUITION"], "Father's shop closed after the floods; income now below Rs 40,000 a month.", "Affidavit, electricity bill, home-visit report", "2026-05-01", "APPROVED", "Kamran Yousaf", "2026-04-22T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-24T09:30:00+05:00"],
    ["KC", ["9-B", 2], "sc-need", 30, ["TUITION"], "Mother is the only earner (school cook).", "Salary slip, electricity bill", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-08T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-09T13:00:00+05:00"],
    ["KC", ["5-A", 4], "sc-need", 50, ["TUITION", "ANNUAL"], "Father disabled after an accident; family receives Bait-ul-Maal support.", "Bait-ul-Maal card, medical certificate", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-07T10:00:00+05:00"],
    ["KC", ["3-A", 5], "sc-need", 50, ["TUITION"], "Widowed mother working as a seamstress.", "Income affidavit, home-visit report", "2026-08-01", "APPROVED", "Kamran Yousaf", "2026-07-30T10:00:00+05:00", "Mrs Sadia Rehman", "2026-08-03T10:00:00+05:00"],
    ["KC", ["8-C", 6], "sc-hafiz", 50, ["TUITION"], "Completed Hifz at a madrasa in Sadiqabad in 2025.", "Sanad seen; recitation check 2025: 88 / 100", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-07T10:30:00+05:00"],
    ["KC", ["10-A", 4], "sc-hafiz", 50, ["TUITION"], "Hafiz since 2022; leads the Quran circle at morning assembly.", "Sanad seen; recitation check 2025: 91 / 100", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-07T10:30:00+05:00"],
    ["KC", ["4-B", 2], "sc-sibling", 10, ["TUITION"], "Second child; elder sister in Class 8-A.", "Family record", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-03T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-03T12:00:00+05:00"],
    ["KC", ["2-B", 1], "sc-sibling", 10, ["TUITION"], "Third child; brothers in Classes 6 and 9.", "Family record", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-03T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-03T12:00:00+05:00"],
    ["KC", ["6-A", 5], "sc-sibling", 10, ["TUITION"], "Second child; elder brother in Class 9-B.", "Family record", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-03T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-03T12:00:00+05:00"],
    ["KC", ["Prep-A", 3], "sc-sibling", 10, ["TUITION"], "Fourth child of the family at Khalid Campus.", "Family record", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-03T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-03T12:00:00+05:00"],
    ["KC", ["5-A", 7], "sc-staff", 50, ["TUITION", "ANNUAL"], "Mother: Ms Sana Tariq, teacher (Class 7-C), 6 years' service.", "Staff ID, HR confirmation", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-02T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-02T12:00:00+05:00"],
    ["KC", ["3-A", 7], "sc-staff", 50, ["TUITION", "ANNUAL"], "Father: Usman Ali, cashier, 4 years' service.", "Staff ID, HR confirmation", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-02T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-02T12:00:00+05:00"],
    ["KC", ["9-A", 10], "sc-staff", 50, ["TUITION", "ANNUAL"], "Father: Mr Adeel Anwar, teacher (Class 7-A), 9 years' service.", "Staff ID, HR confirmation", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-02T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-02T12:00:00+05:00"],
    ["KC", ["7-C", 9], "sc-orphan", 100, ["TUITION", "ANNUAL"], "Father passed away in January 2026. Uncle is the guardian.", "Death certificate, guardian's CNIC", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-06T12:00:00+05:00"],
    ["KC", ["4-A", 6], "sc-orphan", 100, ["TUITION", "ANNUAL"], "Father passed away in 2024. Mother is the guardian.", "Death certificate, mother's CNIC", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-06T12:00:00+05:00"],
    ["KC", ["8-B", 7], "sc-shuhada", 100, ["TUITION", "ANNUAL"], "Father, a police constable, was martyred on duty in 2023.", "Shaheed certificate from the district police", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-06T12:00:00+05:00"],
    ["KC", ["9-A", 13], "sc-forces", 20, ["TUITION"], "Father serves in the Pakistan Army (posted in Bahawalpur).", "Service card", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-06T12:00:00+05:00"],
    ["KC", ["6-A", 8], "sc-kinship", 1500, ["TUITION"], "Recommended by the management committee (meeting of 28-Mar-2026).", "Committee minutes", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-06T12:00:00+05:00"],
    ["KC", ["5-A", 9], "sc-periphery", 1000, ["TUITION"], "Travels 22 km daily from a nearby village by school van.", "Electricity bill showing the village address", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-06T12:00:00+05:00"],
    ["KC", ["8-C", 9], "sc-periphery", 1000, ["TUITION"], "Travels 18 km daily.", "Electricity bill", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Mrs Sadia Rehman", "2026-04-06T12:00:00+05:00"],
    // Waiting: one proposed by the principal herself (another approver must approve it), one by the admin.
    ["KC", ["6-B", 7], "sc-need", 40, ["TUITION"], "Father lost his job at the sugar mill in September; four children at school.", "Termination letter, electricity bill", "2026-12-01", "PENDING", "Mrs Sadia Rehman", "2026-11-03T14:20:00+05:00"],
    ["KC", ["5-A", 6], "sc-hafiz", 50, ["TUITION"], "Completed Hifz in August 2026. Passed the recitation check with 92 / 100.", "Sanad seen; recitation check ST-KC-2627-03", "2026-12-01", "PENDING", "Kamran Yousaf", "2026-11-03T10:05:00+05:00"],
    // Decided the other way
    ["KC", ["7-A", 6], "sc-need", 50, ["TUITION", "ANNUAL"], "Father self-employed; asked for full relief.", "Income affidavit", "2026-10-01", "REJECTED", "Kamran Yousaf", "2026-09-22T10:00:00+05:00", "Mrs Sadia Rehman", "2026-09-25T11:30:00+05:00"],
    // Other campuses
    ["HC", ["5-A", 2], "sc-need", 50, ["TUITION"], "Single-parent family.", "Income certificate", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Kamran Yousaf", "2026-04-08T10:00:00+05:00"],
    ["HC", ["5-A", 4], "sc-staff", 50, ["TUITION", "ANNUAL"], "Mother: Ms Lubna Tariq, teacher.", "Staff ID", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Kamran Yousaf", "2026-04-08T10:00:00+05:00"],
    ["UC", ["9-A", 2], "sc-hafiz", 50, ["TUITION"], "Hafiz since 2021.", "Sanad seen", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Kamran Yousaf", "2026-04-08T10:00:00+05:00"],
    ["SM", ["6-A", 1], "sc-orphan", 100, ["TUITION", "ANNUAL"], "Father passed away in 2025.", "Death certificate", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Kamran Yousaf", "2026-04-08T10:00:00+05:00"],
    ["MC", ["3-A", 1], "sc-periphery", 1000, ["TUITION"], "Travels 16 km daily.", "Electricity bill", "2026-04-01", "APPROVED", "Kamran Yousaf", "2026-04-06T10:00:00+05:00", "Kamran Yousaf", "2026-04-08T10:00:00+05:00"],
    // Last session
    ["KC", ["9-A", 10], "sc-staff", 50, ["TUITION", "ANNUAL"], "Father: Mr Adeel Anwar, teacher.", "Staff ID", "2025-04-01", "APPROVED", "Kamran Yousaf", "2025-04-02T10:00:00+05:00", "Mrs Sadia Rehman", "2025-04-02T12:00:00+05:00"],
    ["KC", ["8-A", 3], "sc-need", 50, ["TUITION", "ANNUAL"], "Father is a daily-wage worker.", "Income certificate, home-visit report", "2025-04-01", "APPROVED", "Kamran Yousaf", "2025-04-06T10:00:00+05:00", "Mrs Sadia Rehman", "2025-04-07T10:00:00+05:00"],
  ];
  for (const [campus, w, schemeId, value, feeHeads, reason, evidence, from, status, proposedBy, proposedAt, decidedBy, decidedAt] of seeds) {
    const session = from < "2026-04-01" ? 2025 : 2026;
    const p = person(campus, w);
    push(session, campus, p, {
      schemeId,
      value,
      feeHeads,
      reason,
      evidence,
      effectiveFrom: from,
      status,
      proposedBy,
      proposedAt,
      ...(decidedBy ? { decidedBy } : {}),
      ...(decidedAt ? { decidedAt } : {}),
      ...(status === "REJECTED" ? { decisionNote: "The home visit found a family business with steady income. Offer 25% if the family asks again." } : {}),
      ...(session === 2025 ? { renewal: { decision: "RENEW" as const, decidedBy: "Mrs Sadia Rehman", decidedAt: "2026-03-28T11:00:00+05:00" } } : {}),
    });
  }
  // An award ended part-way through the session.
  const ended = classmate("KC", "10-B", 8);
  push(2026, "KC", { id: ended.grNo, name: ended.name, father: ended.father, classSection: ended.classSection, hasProfile: false }, {
    schemeId: "sc-need",
    value: 30,
    feeHeads: ["TUITION"],
    reason: "Father's salary delayed for six months.",
    evidence: "Employer's letter",
    effectiveFrom: "2026-04-01",
    status: "ENDED",
    proposedBy: "Kamran Yousaf",
    proposedAt: "2026-04-06T10:00:00+05:00",
    decidedBy: "Mrs Sadia Rehman",
    decidedAt: "2026-04-07T10:00:00+05:00",
    endedOn: "2026-08-31",
    endReason: "Father's salary restored; the family asked to end the relief.",
    history: [
      h("end-1", "2026-04-06T10:00:00+05:00", "Kamran Yousaf", "Proposed", "Father's salary delayed for six months."),
      h("end-2", "2026-04-07T10:00:00+05:00", "Mrs Sadia Rehman", "Approved"),
      h("end-3", "2026-08-28T12:00:00+05:00", "Mrs Sadia Rehman", "Ended", "From 31-Aug-2026. Father's salary restored; the family asked to end the relief."),
    ],
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Certificates issued (serial numbers per campus per session)
// ---------------------------------------------------------------------------------------------------------

export interface CertificateRecord {
  id: string;
  certNo: string;
  campus: CampusCode;
  session: number;
  type: ActivitiesCertType;
  studentId: string;
  studentName: string;
  father: string;
  classSection: string;
  houseName: string | null;
  eventId: string | null;
  eventTitle: string;
  eventDate: IsoDate | null;
  item: string | null;
  role: ActivitiesRole | null;
  position: ActivitiesPosition | null;
  wording: string;
  issuedOn: IsoDate;
  issuedBy: string;
  prints: number;
}

// ---------------------------------------------------------------------------------------------------------
// Catalogue (the old Sports Info, Activity Info and Place Info screens) and manual co-curricular records
// ---------------------------------------------------------------------------------------------------------

export function initialCatalogue(): Array<Omit<ActivitiesCatalogItem, "uses">> {
  const items: Array<[string, ActivitiesCatalogItem["kind"], boolean?]> = [
    ["Football", "SPORT"],
    ["Cricket", "SPORT"],
    ["Hockey", "SPORT"],
    ["Badminton (singles)", "SPORT"],
    ["Badminton (doubles)", "SPORT"],
    ["Table tennis", "SPORT"],
    ["100 m race", "SPORT"],
    ["200 m race", "SPORT"],
    ["400 m race", "SPORT"],
    ["Relay 4×100 m", "SPORT"],
    ["Sack race", "SPORT"],
    ["Long jump", "SPORT"],
    ["Tug of war", "SPORT"],
    ["Drill", "SPORT"],
    ["English debate", "COMPETITION"],
    ["Urdu debate", "COMPETITION"],
    ["Speech", "COMPETITION"],
    ["Spelling bee", "COMPETITION"],
    ["Drawing", "COMPETITION"],
    ["Kalam-e-Iqbal recitation", "COMPETITION"],
    ["Naat", "COMPETITION"],
    ["Qirat", "COMPETITION"],
    ["Science project", "COMPETITION"],
    ["Quiz", "COMPETITION"],
    ["Science club", "CLUB"],
    ["Literary society and school magazine", "CLUB"],
    ["Scouts and girl guides", "CLUB"],
    ["Dramatics club", "CLUB"],
    ["Library visit supervision", "DUTY"],
    ["Discipline duty", "DUTY"],
    ["Parking area duty", "DUTY", false],
  ];
  return items.map(([name, kind, active], i) => ({ id: `ac-${i + 1}`, name, kind, active: active ?? true }));
}

export interface VenueRecord {
  id: string;
  campus: CampusCode;
  name: string;
  /** Short title; missing on places saved before it existed. */
  shortName?: string;
  active: boolean;
}

/** Short titles of the seeded places (legacy Place Info "Short Title"). */
const VENUE_SHORT: Record<string, string> = {
  "Main ground": "Ground",
  "Assembly hall": "Hall",
  Library: "Library",
  "Science laboratory": "Sci lab",
  "Computer laboratory": "Comp lab",
  "Parking area": "Parking",
  "Carpentry workshop": "Workshop",
  Auditorium: "Auditorium",
};

export function initialVenues(): VenueRecord[] {
  const kc: Array<[string, boolean]> = [
    ["Main ground", true],
    ["Assembly hall", true],
    ["Library", true],
    ["Science laboratory", true],
    ["Computer laboratory", true],
    ["Parking area", true],
    ["Carpentry workshop", false],
  ];
  const out: VenueRecord[] = kc.map(([name, active], i) => ({ id: `vn-kc-${i + 1}`, campus: "KC", name, shortName: VENUE_SHORT[name] ?? "", active }));
  (["SM", "UC", "MC", "HC"] as CampusCode[]).forEach((campus) =>
    ["Main ground", campus === "HC" ? "Auditorium" : "Assembly hall", "Science laboratory", "Library"].forEach((name, i) => out.push({ id: `vn-${campus.toLowerCase()}-${i + 1}`, campus, name, shortName: VENUE_SHORT[name] ?? "", active: true })),
  );
  return out;
}

export interface ManualRecord {
  id: string;
  campus: CampusCode;
  session: number;
  studentId: string;
  title: string;
  activityId: string | null;
  kindLabel: string;
  date: IsoDate;
  role: ActivitiesRole;
  position: ActivitiesPosition | null;
  achievement: string;
  by: string;
}

export function initialManualRecords(): ManualRecord[] {
  return [
    { id: "mr-1", campus: "KC", session: 2026, studentId: "KC-14823", title: "Literary society and school magazine", activityId: "ac-26", kindLabel: "Club or society", date: "2026-04-20", role: "PARTICIPANT", position: null, achievement: "Member of the editorial team; wrote the lead story in the September issue.", by: "Ms Hina Javed" },
    { id: "mr-2", campus: "KC", session: 2026, studentId: "KC-14377", title: "Inter-school cricket tournament, Sadiqabad (Under-15)", activityId: "ac-2", kindLabel: "Sports", date: "2026-09-19", role: "PLAYER", position: null, achievement: "Played as wicket-keeper; the school team reached the semi-final.", by: "Mr Imran Shafiq" },
    { id: "mr-3", campus: "KC", session: 2026, studentId: "KC-14650", title: "Inter-school declamation contest, Rahim Yar Khan", activityId: "ac-17", kindLabel: "Competition", date: "2026-08-27", role: "PARTICIPANT", position: 2, achievement: "Second place in Urdu declamation among 14 schools.", by: "Mr Adeel Anwar" },
    { id: "mr-4", campus: "KC", session: 2026, studentId: "KC-15102", title: "Scouts and girl guides", activityId: "ac-27", kindLabel: "Club or society", date: "2026-05-04", role: "PARTICIPANT", position: null, achievement: "Cub scout; earned the first-aid badge.", by: "Mr Imran Shafiq" },
    { id: "mr-5", campus: "KC", session: 2026, studentId: "KC-14988", title: "Science club", activityId: "ac-25", kindLabel: "Club or society", date: "2026-04-15", role: "ORGANISER", position: null, achievement: "Club secretary; runs the Friday experiments session.", by: "Ms Sana Tariq" },
    { id: "mr-6", campus: "KC", session: 2025, studentId: "KC-14823", title: "Drawing competition (Classes 5–7)", activityId: "ac-19", kindLabel: "Competition", date: "2026-02-12", role: "PARTICIPANT", position: 3, achievement: "Third place: “My city”.", by: "Ms Saima Akram" },
  ];
}
