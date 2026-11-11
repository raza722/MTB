// Library, warehouse (with the book shop) and transport fixtures — owned by the operations module.
// Fictional data only. Book titles are real published works (bibliographic data, not personal data).
// Khalid Campus carries the full story; the other campuses get smaller, generated sets.
import type {
  CampusCode,
  LibraryCondition,
  LibraryCopyStatus,
  LibraryFineStatus,
  LibraryLanguage,
  OperationsPersonType,
  TransportDirection,
  TransportVehicleType,
  WarehouseCountStatus,
  WarehouseMovementType,
} from "@mtb/api";
import type { IsoDate, IsoDateTime } from "@mtb/domain";
import { STUDENTS } from "./students";

export const OPS_CAMPUSES: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];

/* ================================================================================================ Helpers */

/** Deterministic 0..1 from a string, so fixtures are the same in every tab. */
export function rnd(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h += h << 13;
  h ^= h >>> 7;
  h += h << 3;
  h ^= h >>> 17;
  h += h << 5;
  return ((h >>> 0) % 100000) / 100000;
}
const between = (key: string, lo: number, hi: number) => lo + Math.floor(rnd(key) * (hi - lo + 1));

export const addDays = (d: IsoDate, n: number): IsoDate => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
export const at = (d: IsoDate, time = "10:30"): IsoDateTime => `${d}T${time}:00+05:00`;
/** Sundays are off; documents in fixtures fall on working days. */
const workday = (d: IsoDate): IsoDate => (new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? addDays(d, 1) : d);
const pad = (n: number, w: number) => String(n).padStart(w, "0");

/* ================================================================================================ People */

export interface OpsStaffRec {
  id: string;
  campus: CampusCode;
  name: string;
  detail: string;
  mobile: string;
}

/** Staff who borrow books, ask for stock or ride a van. Numbers match the HR fixtures where HR has them. */
export const OPS_STAFF: OpsStaffRec[] = [
  { id: "KC-S-0009", campus: "KC", name: "Mrs Sadia Rehman", detail: "Principal", mobile: "0302-5550178" },
  { id: "KC-S-0012", campus: "KC", name: "Ms Rehana Kausar", detail: "Vice principal", mobile: "0300-5550412" },
  { id: "KC-T-0021", campus: "KC", name: "Ms Samina Yasmeen", detail: "Head teacher", mobile: "0300-5550419" },
  { id: "KC-T-0142", campus: "KC", name: "Ms Hina Javed", detail: "Teacher, class 7-B", mobile: "0305-5550166" },
  { id: "KC-T-0118", campus: "KC", name: "Mr Adeel Anwar", detail: "Teacher, class 7-A", mobile: "0300-5550427" },
  { id: "KC-T-0151", campus: "KC", name: "Ms Sana Tariq", detail: "Teacher, class 7-C", mobile: "0300-5550433" },
  { id: "KC-T-0071", campus: "KC", name: "Qari Abdul Hameed", detail: "Qari", mobile: "0300-5550438" },
  { id: "KC-S-0144", campus: "KC", name: "Ms Bushra Latif", detail: "Librarian", mobile: "0300-5550441" },
  { id: "KC-S-0203", campus: "KC", name: "Mr Shahid Hussain", detail: "Lab assistant", mobile: "0300-5550446" },
  { id: "KC-S-0195", campus: "KC", name: "Mr Naveed Akhtar", detail: "Store keeper", mobile: "0300-5550451" },
  { id: "KC-S-0188", campus: "KC", name: "Farah Naz", detail: "Office staff", mobile: "0306-5550121" },
  { id: "KC-S-0217", campus: "KC", name: "Usman Ali", detail: "Cashier", mobile: "0301-5550142" },
  { id: "SM-S-0003", campus: "SM", name: "Mr Faisal Mehmood", detail: "Principal", mobile: "0300-5550463" },
  { id: "SM-S-0021", campus: "SM", name: "Mr Asif Raza", detail: "Cashier", mobile: "0300-5550467" },
  { id: "UC-S-0002", campus: "UC", name: "Mrs Nasreen Akhtar", detail: "Principal", mobile: "0300-5550472" },
  { id: "UC-T-0014", campus: "UC", name: "Ms Kiran Shahzad", detail: "Teacher, class 9-A", mobile: "0300-5550476" },
  { id: "MC-T-0006", campus: "MC", name: "Mr Abdul Waheed", detail: "Head teacher", mobile: "0300-5550481" },
  { id: "HC-S-0040", campus: "HC", name: "Ms Mehwish Anjum", detail: "Librarian", mobile: "0300-5550485" },
  { id: "HC-T-0033", campus: "HC", name: "Mr Zubair Hassan", detail: "Teacher, class 8-A", mobile: "0300-5550489" },
];

/** Who does the work at each campus in the fixtures. */
export const LIBRARIAN: Record<CampusCode, string> = { KC: "Ms Bushra Latif", SM: "Mr Asif Raza", UC: "Ms Kiran Shahzad", MC: "Mr Abdul Waheed", HC: "Ms Mehwish Anjum" };
export const STORE_KEEPER: Record<CampusCode, string> = { KC: "Mr Naveed Akhtar", SM: "Mr Asif Raza", UC: "Mrs Nasreen Akhtar", MC: "Mr Abdul Waheed", HC: "Mr Zubair Hassan" };

const activeStudents = (campus: CampusCode) => STUDENTS.filter((s) => s.campus === campus && s.status === "ACTIVE");

/* ================================================================================================ Library */

export interface LibCategoryRec {
  id: string;
  name: string;
  nameUr: string;
  active: boolean;
}

export const LIB_CATEGORIES: LibCategoryRec[] = [
  { id: "lc-ref", name: "Reference and dictionaries", nameUr: "حوالہ جاتی کتب", active: true },
  { id: "lc-isl", name: "Islamic studies", nameUr: "اسلامیات", active: true },
  { id: "lc-urdu", name: "Urdu literature", nameUr: "اردو ادب", active: true },
  { id: "lc-eng", name: "English literature", nameUr: "انگریزی ادب", active: true },
  { id: "lc-sci", name: "Science and mathematics", nameUr: "سائنس اور ریاضی", active: true },
  { id: "lc-child", name: "Children's stories", nameUr: "بچوں کی کہانیاں", active: true },
  { id: "lc-hist", name: "History and general knowledge", nameUr: "تاریخ اور معلومات عامہ", active: true },
  { id: "lc-comp", name: "Computer science", nameUr: "کمپیوٹر سائنس", active: true },
];

/** A library room at a campus; cabinets belong to one. */
export interface LibLibraryRec {
  id: string;
  campus: CampusCode;
  name: string;
  seatingCapacity: number;
  active: boolean;
  rowVer?: number;
}

export interface LibCabinetRec {
  id: string;
  campus: CampusCode;
  libraryId: string;
  code: string;
  title: string;
  capacity: number;
  shelves: Array<{ id: string; label: string }>;
  active: boolean;
  rowVer?: number;
}

export interface LibTitleRec {
  id: string;
  campus: CampusCode;
  title: string;
  titleUr: string;
  authors: string[];
  publisher: string;
  categoryId: string;
  language: LibraryLanguage;
  edition: string;
  volume: number | null;
  publisherCountry: string;
  year: number | null;
  isbn: string;
  pages: number | null;
  addedOn: IsoDate;
  rowVer?: number;
}

export interface LibCopyRec {
  id: string;
  campus: CampusCode;
  titleId: string;
  accessionNo: string;
  shelfId: string | null;
  status: LibraryCopyStatus;
  condition: LibraryCondition;
  cost: number;
  acquiredOn: IsoDate;
  /** When it went on its current shelf. */
  placedOn: IsoDate | null;
  /** Lost, damaged or withdrawn: when, who recorded it and who approved it. */
  writtenOff: { on: IsoDate; by: string; approvedBy: string; reason: string } | null;
  note: string;
}

export interface LibLoanRec {
  id: string;
  campus: CampusCode;
  copyId: string;
  borrowerType: OperationsPersonType;
  borrowerId: string;
  issuedOn: IsoDate;
  dueOn: IsoDate;
  returnedOn: IsoDate | null;
  fine: number;
  fineStatus: LibraryFineStatus;
  fineNote: string;
  issuedBy: string;
  returnedBy: string | null;
  reminders: number;
  lastReminderAt: IsoDateTime | null;
  lost: boolean;
}

export interface LibPolicyRec {
  campus: CampusCode;
  borrowerType: OperationsPersonType;
  loanDays: number;
  graceDays: number;
  ratePerDay: number;
  maxLoans: number;
  capAtCost: boolean;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export interface LibCountRec {
  id: string;
  campus: CampusCode;
  name: string;
  cabinetIds: string[];
  status: "OPEN" | "CLOSED";
  startedOn: IsoDate;
  startedBy: string;
  closedOn: IsoDate | null;
  closedBy: string | null;
  scans: Array<{ accessionNo: string; shelfId: string; at: IsoDateTime }>;
  /** Frozen rows of a closed count (the records have been corrected since). */
  closedRows: Array<{ accessionNo: string; copyId: string | null; title: string; recordedShelf: string; scannedShelf: string; result: string; action: string }> | null;
  applied: string[];
}

export interface LibActivityRec {
  id: string;
  campus: CampusCode;
  at: IsoDateTime;
  kind: "ISSUE" | "RETURN" | "LOST" | "ADDED" | "COUNT" | "REMINDER";
  text: string;
  by: string;
}

/** Libraries at each campus: [key, name, seats]. Khalid Campus runs a central library and a junior library. */
const LIBRARY_PLAN: Record<CampusCode, Array<[string, string, number]>> = {
  KC: [
    ["central", "Central library", 50],
    ["junior", "Junior library", 30],
  ],
  HC: [
    ["central", "Main library", 40],
    ["girls", "Girls' section library", 24],
  ],
  UC: [["central", "Main library", 30]],
  SM: [["central", "Main library", 24]],
  MC: [["central", "Main library", 20]],
};
/** Cabinets kept in the second library of a campus (children's books). */
const SECOND_LIBRARY_CABINETS = ["C-06"];

/** Where each publisher is based (bibliographic data). */
export const PUBLISHER_COUNTRY: Record<string, string> = {
  "Oxford University Press": "United Kingdom",
  Ferozsons: "Pakistan",
  "Dar-ul-Musannifeen": "India",
  Darussalam: "Saudi Arabia",
  "Idara Tarjuman-ul-Quran": "Pakistan",
  "Sang-e-Meel Publications": "Pakistan",
  "Penguin Classics": "United Kingdom",
  Scribner: "United States",
  "Bantam Books": "United States",
  DK: "United Kingdom",
  "Random House": "United States",
  "Houghton Mifflin Harcourt": "United States",
  "Punjab Textbook Board": "Pakistan",
  "No Starch Press": "United States",
  "Puffin Books": "United Kingdom",
  HarperCollins: "United States",
  "Research Society of Pakistan": "Pakistan",
  "Caravan Book House": "Pakistan",
  "Guinness World Records": "United Kingdom",
};

/** Works in several volumes: title → volume number. */
const VOLUMES: Record<string, number> = { "Tafheem-ul-Quran (Volume 1)": 1, "Seerat-un-Nabi": 1, "Riyad-us-Saliheen": 1 };

/** Cabinet codes and what they hold, for report filters. */
export const LIB_CABINET_CODES = (): Array<[code: string, title: string]> => CABINET_PLAN.map(([code, title]) => [code, title]);

/** Cabinet code → [title, category, shelf count]. */
const CABINET_PLAN: Array<[string, string, string, number]> = [
  ["C-01", "Reference and dictionaries", "lc-ref", 3],
  ["C-02", "Islamic studies", "lc-isl", 3],
  ["C-03", "Urdu literature", "lc-urdu", 4],
  ["C-04", "English literature", "lc-eng", 4],
  ["C-05", "Science, mathematics and computers", "lc-sci", 3],
  ["C-06", "Children's corner", "lc-child", 3],
  ["C-07", "History and general knowledge", "lc-hist", 3],
];

type TitleSeed = [title: string, titleUr: string, authors: string[], publisher: string, cat: string, lang: LibraryLanguage, year: number, pages: number, cost: number, isbn?: string];

const TITLES: TitleSeed[] = [
  ["Oxford Advanced Learner's Dictionary", "", ["A. S. Hornby"], "Oxford University Press", "lc-ref", "EN", 2020, 1952, 6200, "9780194798488"],
  ["Oxford English-Urdu Dictionary", "", ["S. M. Salim-ud-Din Quraishi"], "Oxford University Press", "lc-ref", "EN", 2013, 1176, 3800],
  ["Feroz-ul-Lughat", "فیروز اللغات", ["Maulvi Feroz-ud-Din"], "Ferozsons", "lc-ref", "UR", 2015, 1520, 2600],
  ["Oxford School Atlas for Pakistan", "", ["Oxford University Press"], "Oxford University Press", "lc-ref", "EN", 2022, 120, 1450],
  ["Seerat-un-Nabi", "سیرت النبی ﷺ", ["Allama Shibli Nomani", "Syed Sulaiman Nadvi"], "Dar-ul-Musannifeen", "lc-isl", "UR", 2012, 2400, 4800],
  ["Qasas-ul-Anbiya", "قصص الانبیاء", ["Ibn Kathir"], "Darussalam", "lc-isl", "UR", 2016, 640, 1200],
  ["Tafheem-ul-Quran (Volume 1)", "تفہیم القرآن (جلد اول)", ["Syed Abul A'la Maududi"], "Idara Tarjuman-ul-Quran", "lc-isl", "UR", 2018, 620, 1500],
  ["The Sealed Nectar", "", ["Safiur Rahman Mubarakpuri"], "Darussalam", "lc-isl", "EN", 2019, 600, 1800],
  ["Riyad-us-Saliheen", "", ["Imam an-Nawawi"], "Darussalam", "lc-isl", "EN", 2017, 1100, 2400],
  ["Stories of the Prophets", "", ["Ibn Kathir"], "Darussalam", "lc-isl", "EN", 2015, 480, 1100],
  ["Bang-e-Dra", "بانگِ درا", ["Allama Muhammad Iqbal"], "Sang-e-Meel Publications", "lc-urdu", "UR", 2014, 320, 750],
  ["Bal-e-Jibril", "بالِ جبریل", ["Allama Muhammad Iqbal"], "Sang-e-Meel Publications", "lc-urdu", "UR", 2014, 240, 650],
  ["Mirat-ul-Uroos", "مراۃ العروس", ["Deputy Nazir Ahmad"], "Sang-e-Meel Publications", "lc-urdu", "UR", 2011, 280, 600],
  ["Umrao Jaan Ada", "امراؤ جان ادا", ["Mirza Hadi Ruswa"], "Sang-e-Meel Publications", "lc-urdu", "UR", 2013, 300, 700],
  ["Aag Ka Darya", "آگ کا دریا", ["Qurratulain Hyder"], "Sang-e-Meel Publications", "lc-urdu", "UR", 2016, 780, 1400],
  ["Raja Gidh", "راجہ گدھ", ["Bano Qudsia"], "Sang-e-Meel Publications", "lc-urdu", "UR", 2017, 470, 1100],
  ["Shahab Nama", "شہاب نامہ", ["Qudrat Ullah Shahab"], "Sang-e-Meel Publications", "lc-urdu", "UR", 2015, 1240, 1600],
  ["Udas Naslein", "اداس نسلیں", ["Abdullah Hussain"], "Sang-e-Meel Publications", "lc-urdu", "UR", 2012, 560, 1200],
  ["Khuda Ki Basti", "خدا کی بستی", ["Shaukat Siddiqui"], "Sang-e-Meel Publications", "lc-urdu", "UR", 2014, 520, 950],
  ["Zavia", "زاویہ", ["Ashfaq Ahmed"], "Sang-e-Meel Publications", "lc-urdu", "UR", 2018, 330, 900],
  ["Ibn-e-Batuta Ke Taaqub Mein", "ابنِ بطوطہ کے تعاقب میں", ["Ibn-e-Insha"], "Sang-e-Meel Publications", "lc-urdu", "UR", 2016, 220, 650],
  ["Treasure Island", "", ["Robert Louis Stevenson"], "Penguin Classics", "lc-eng", "EN", 2016, 304, 650],
  ["Oliver Twist", "", ["Charles Dickens"], "Penguin Classics", "lc-eng", "EN", 2015, 554, 750],
  ["A Tale of Two Cities", "", ["Charles Dickens"], "Penguin Classics", "lc-eng", "EN", 2014, 489, 750],
  ["Animal Farm", "", ["George Orwell"], "Penguin Classics", "lc-eng", "EN", 2018, 112, 450],
  ["Gulliver's Travels", "", ["Jonathan Swift"], "Penguin Classics", "lc-eng", "EN", 2013, 336, 600],
  ["The Old Man and the Sea", "", ["Ernest Hemingway"], "Scribner", "lc-eng", "EN", 2017, 128, 550],
  ["Robinson Crusoe", "", ["Daniel Defoe"], "Penguin Classics", "lc-eng", "EN", 2012, 320, 600],
  ["Little Women", "", ["Louisa May Alcott"], "Penguin Classics", "lc-eng", "EN", 2019, 528, 800],
  ["Pride and Prejudice", "", ["Jane Austen"], "Penguin Classics", "lc-eng", "EN", 2016, 480, 700],
  ["A Brief History of Time", "", ["Stephen Hawking"], "Bantam Books", "lc-sci", "EN", 2017, 212, 1300],
  ["The Way Things Work Now", "", ["David Macaulay"], "DK", "lc-sci", "EN", 2016, 400, 3200],
  ["Cosmos", "", ["Carl Sagan"], "Random House", "lc-sci", "EN", 2013, 396, 1500],
  ["The Joy of x", "", ["Steven Strogatz"], "Houghton Mifflin Harcourt", "lc-sci", "EN", 2013, 316, 1200],
  ["Mathematics for Class 9", "", ["Punjab Textbook Board"], "Punjab Textbook Board", "lc-sci", "EN", 2025, 280, 380],
  ["Python Crash Course", "", ["Eric Matthes"], "No Starch Press", "lc-sci", "EN", 2023, 552, 2900],
  ["Computer Science for Class 9", "", ["Punjab Textbook Board"], "Punjab Textbook Board", "lc-sci", "EN", 2025, 190, 320],
  ["The Jungle Book", "", ["Rudyard Kipling"], "Penguin Classics", "lc-child", "EN", 2018, 240, 550],
  ["Alice's Adventures in Wonderland", "", ["Lewis Carroll"], "Penguin Classics", "lc-child", "EN", 2015, 192, 500],
  ["Heidi", "", ["Johanna Spyri"], "Puffin Books", "lc-child", "EN", 2017, 320, 550],
  ["Black Beauty", "", ["Anna Sewell"], "Puffin Books", "lc-child", "EN", 2016, 272, 500],
  ["The Secret Garden", "", ["Frances Hodgson Burnett"], "Puffin Books", "lc-child", "EN", 2019, 304, 550],
  ["Charlotte's Web", "", ["E. B. White"], "HarperCollins", "lc-child", "EN", 2014, 192, 700],
  ["Around the World in Eighty Days", "", ["Jules Verne"], "Puffin Books", "lc-child", "EN", 2015, 256, 500],
  ["Chacha Chhakkan", "چچا چھکن", ["Imtiaz Ali Taj"], "Sang-e-Meel Publications", "lc-child", "UR", 2015, 140, 400],
  ["Jinnah of Pakistan", "", ["Stanley Wolpert"], "Oxford University Press", "lc-hist", "EN", 2005, 420, 1600],
  ["Pakistan: A Modern History", "", ["Ian Talbot"], "Oxford University Press", "lc-hist", "EN", 2012, 504, 1800],
  ["The Emergence of Pakistan", "", ["Chaudhri Muhammad Ali"], "Research Society of Pakistan", "lc-hist", "EN", 2008, 418, 1200],
  ["Pakistan Affairs", "", ["M. Ikram Rabbani"], "Caravan Book House", "lc-hist", "EN", 2021, 460, 900],
  ["Guinness World Records 2026", "", ["Guinness World Records"], "Guinness World Records", "lc-hist", "EN", 2025, 256, 4500],
  ["Heer Waris Shah", "ہیر وارث شاہ", ["Waris Shah"], "Sang-e-Meel Publications", "lc-urdu", "PA", 2012, 380, 850],
];

/** How many titles of the list each campus has (Khalid Campus has them all). */
const CAMPUS_TITLES: Record<CampusCode, number> = { KC: TITLES.length, HC: 22, UC: 14, SM: 9, MC: 7 };
const ACCESSION_START: Record<CampusCode, number> = { KC: 14051, HC: 2201, UC: 1101, SM: 601, MC: 301 };

export interface LibraryFixtures {
  libraries: LibLibraryRec[];
  cabinets: LibCabinetRec[];
  categories: LibCategoryRec[];
  titles: LibTitleRec[];
  copies: LibCopyRec[];
  loans: LibLoanRec[];
  policies: LibPolicyRec[];
  counts: LibCountRec[];
  activity: LibActivityRec[];
  /** Next accession number per campus. */
  nextAccession: Partial<Record<CampusCode, number>>;
}

export function initialLibrary(): LibraryFixtures {
  const libraries: LibLibraryRec[] = [];
  const cabinets: LibCabinetRec[] = [];
  const titles: LibTitleRec[] = [];
  const copies: LibCopyRec[] = [];
  const loans: LibLoanRec[] = [];
  const policies: LibPolicyRec[] = [];
  const nextAccession: Partial<Record<CampusCode, number>> = {};

  for (const campus of OPS_CAMPUSES) {
    const libs = LIBRARY_PLAN[campus].map(([key, name, seats]): LibLibraryRec => ({ id: `${campus}-lib-${key}`, campus, name, seatingCapacity: seats, active: true }));
    libraries.push(...libs);
    const plan = campus === "KC" ? CABINET_PLAN : CABINET_PLAN.filter((_, i) => i < (campus === "HC" ? 6 : 4));
    for (const [code, title, , shelves] of plan) {
      const id = `${campus}-cab-${code}`;
      cabinets.push({
        id,
        campus,
        libraryId: (SECOND_LIBRARY_CABINETS.includes(code) && libs[1] ? libs[1] : libs[0]!).id,
        code,
        title,
        capacity: shelves * 60,
        shelves: Array.from({ length: shelves }, (_, i) => ({ id: `${id}-s${i + 1}`, label: `Shelf ${i + 1}` })),
        active: true,
      });
    }
    const shelfFor = (cat: string, key: string): string | null => {
      const planRow = plan.find((p) => p[2] === cat) ?? plan[plan.length - 1];
      if (!planRow) return null;
      const cab = cabinets.find((c) => c.campus === campus && c.code === planRow[0])!;
      return cab.shelves[Math.floor(rnd(key) * cab.shelves.length)]!.id;
    };

    let acc = ACCESSION_START[campus];
    const seeds = TITLES.filter((_, i) => campus === "KC" || rnd(`${campus}|pick|${i}`) < CAMPUS_TITLES[campus] / TITLES.length).slice(0, CAMPUS_TITLES[campus]);
    seeds.forEach(([title, titleUr, authors, publisher, cat, lang, year, pages, cost, isbn], i) => {
      const tid = `${campus}-t${pad(i + 1, 3)}`;
      const addedOn = i < 40 ? "2026-04-01" : addDays("2026-07-20", i);
      titles.push({ id: tid, campus, title, titleUr, authors, publisher, categoryId: cat, language: lang, edition: rnd(`${tid}|ed`) < 0.3 ? "2nd edition" : "", volume: VOLUMES[title] ?? null, publisherCountry: PUBLISHER_COUNTRY[publisher] ?? "", year, isbn: isbn ?? "", pages, addedOn });
      const n = campus === "KC" ? (cat === "lc-ref" ? 2 : cat === "lc-child" || cat === "lc-eng" ? between(`${tid}|n`, 2, 4) : between(`${tid}|n`, 1, 3)) : between(`${tid}|n`, 1, 2);
      for (let c = 0; c < n; c++) {
        const cid = `${tid}-c${c + 1}`;
        const worn = rnd(`${cid}|cond`);
        const acquiredOn = addedOn === "2026-04-01" ? `20${between(`${cid}|y`, 18, 25)}-0${between(`${cid}|m`, 1, 9)}-1${between(`${cid}|d`, 0, 8)}` : addedOn;
        const shelfId = shelfFor(cat, cid);
        copies.push({
          id: cid,
          campus,
          titleId: tid,
          accessionNo: `${campus}-L-${pad(acc++, 5)}`,
          shelfId,
          status: "AVAILABLE",
          condition: worn < 0.15 ? "WORN" : worn < 0.45 ? "NEW" : "GOOD",
          cost,
          acquiredOn,
          placedOn: shelfId ? acquiredOn : null,
          writtenOff: null,
          note: "",
        });
      }
    });
    nextAccession[campus] = acc;

    policies.push(
      { campus, borrowerType: "STUDENT", loanDays: 14, graceDays: 0, ratePerDay: 5, maxLoans: 2, capAtCost: true, updatedAt: at("2026-04-01", "09:00"), updatedBy: LIBRARIAN[campus] },
      { campus, borrowerType: "STAFF", loanDays: 30, graceDays: 0, ratePerDay: 0, maxLoans: 5, capAtCost: true, updatedAt: at("2026-04-01", "09:00"), updatedBy: LIBRARIAN[campus] },
    );
  }

  // ---- Loans (Khalid Campus story) ----
  const copyOf = (campus: CampusCode, title: string, nth = 0): LibCopyRec | undefined => {
    const t = titles.find((x) => x.campus === campus && x.title === title);
    return t ? copies.filter((c) => c.titleId === t.id)[nth] : undefined;
  };
  let ln = 0;
  const loan = (campus: CampusCode, title: string, type: OperationsPersonType, who: string, issuedOn: IsoDate, days: number, returnedOn: IsoDate | null, extra: Partial<LibLoanRec> = {}, nth = 0) => {
    const copy = copyOf(campus, title, nth);
    if (!copy) return;
    const rec: LibLoanRec = {
      id: `${campus}-ln${pad(++ln, 4)}`,
      campus,
      copyId: copy.id,
      borrowerType: type,
      borrowerId: who,
      issuedOn,
      dueOn: addDays(issuedOn, days),
      returnedOn,
      fine: 0,
      fineStatus: "NONE",
      fineNote: "",
      issuedBy: LIBRARIAN[campus],
      returnedBy: returnedOn ? LIBRARIAN[campus] : null,
      reminders: 0,
      lastReminderAt: null,
      lost: false,
      ...extra,
    };
    if (returnedOn && returnedOn > rec.dueOn && type === "STUDENT" && rec.fineStatus === "NONE" && !extra.fine) {
      const late = Math.round((Date.parse(returnedOn) - Date.parse(rec.dueOn)) / 86_400_000);
      rec.fine = Math.min(late * 5, copy.cost);
      rec.fineStatus = late > 6 ? "ADDED_TO_FEES" : "PAID";
    }
    if (!returnedOn) copy.status = "ON_LOAN";
    loans.push(rec);
  };

  // Last session (2025–26), all returned — the past session's register.
  loan("KC", "Black Beauty", "STUDENT", "KC-14823", "2026-01-12", 14, "2026-01-24");
  loan("KC", "Heidi", "STUDENT", "KC-14823", "2026-02-09", 14, "2026-02-27");
  loan("KC", "Chacha Chhakkan", "STUDENT", "KC-15102", "2026-02-16", 14, "2026-02-26");
  loan("KC", "Animal Farm", "STUDENT", "KC-14377", "2026-03-02", 14, "2026-03-25", { fine: 45, fineStatus: "WAIVED", fineNote: "Student was ill for a week (note from home seen)." });
  loan("KC", "Shahab Nama", "STAFF", "KC-T-0118", "2026-01-05", 30, "2026-02-03");
  loan("KC", "Python Crash Course", "STAFF", "KC-T-0151", "2026-03-04", 30, "2026-03-30");

  // This session, returned.
  loan("KC", "The Jungle Book", "STUDENT", "KC-14823", "2026-08-17", 14, "2026-08-28");
  loan("KC", "Alice's Adventures in Wonderland", "STUDENT", "KC-14823", "2026-09-07", 14, "2026-09-29");
  loan("KC", "Gulliver's Travels", "STUDENT", "KC-14650", "2026-08-24", 14, "2026-09-05");
  loan("KC", "Robinson Crusoe", "STUDENT", "KC-14911", "2026-09-14", 14, "2026-09-26");
  loan("KC", "Mirat-ul-Uroos", "STUDENT", "KC-14988", "2026-09-21", 14, "2026-10-02");
  loan("KC", "The Secret Garden", "STUDENT", "KC-15230", "2026-08-31", 14, "2026-09-18");
  loan("KC", "Stories of the Prophets", "STUDENT", "KC-15102", "2026-09-28", 14, "2026-10-09");
  loan("KC", "Jinnah of Pakistan", "STAFF", "KC-T-0142", "2026-08-10", 30, "2026-09-08");
  loan("KC", "Zavia", "STAFF", "KC-S-0009", "2026-09-01", 30, "2026-09-24");
  loan("KC", "Cosmos", "STAFF", "KC-S-0203", "2026-09-15", 30, "2026-10-12");

  // Generated students: a steady flow of returns over the last ten weeks.
  const kcStudents = activeStudents("KC").filter((s) => !["KC-14823", "KC-15102", "KC-14650", "KC-14911", "KC-14988", "KC-15230", "KC-14377"].includes(s.grNo));
  const flowTitles = TITLES.filter((t) => ["lc-child", "lc-eng", "lc-urdu", "lc-isl"].includes(t[4])).map((t) => t[0]);
  for (let i = 0; i < 26; i++) {
    const s = kcStudents[i % kcStudents.length];
    if (!s) break;
    const issued = workday(addDays("2026-08-24", i * 3 - (i % 4)));
    const kept = between(`kc-flow|${i}`, 6, 19);
    const returned = workday(addDays(issued, kept));
    if (returned >= "2026-11-04") continue;
    loan("KC", flowTitles[(i * 7) % flowTitles.length]!, "STUDENT", s.grNo, issued, 14, returned, {}, i % 2);
  }

  // Open loans today (04-Nov-2026).
  loan("KC", "Treasure Island", "STUDENT", "KC-14823", "2026-10-15", 14, null, { reminders: 1, lastReminderAt: at("2026-11-01", "09:10") }); // overdue 6 days
  loan("KC", "Bang-e-Dra", "STUDENT", "KC-14650", "2026-10-21", 14, null); // due today
  loan("KC", "Oliver Twist", "STUDENT", "KC-14377", "2026-09-28", 14, null, { reminders: 2, lastReminderAt: at("2026-10-26", "09:05") }); // overdue 23 days
  loan("KC", "Little Women", "STUDENT", "KC-14911", "2026-10-28", 14, null);
  loan("KC", "Qasas-ul-Anbiya", "STUDENT", "KC-15230", "2026-10-10", 14, null); // overdue 11 days
  loan("KC", "Heidi", "STUDENT", "KC-14988", "2026-11-02", 14, null);
  loan("KC", "The Jungle Book", "STUDENT", "KC-15102", "2026-10-26", 14, null, {}, 1);
  loan("KC", "Animal Farm", "STUDENT", "KC-14502", "2026-06-02", 14, null, { reminders: 3, lastReminderAt: at("2026-07-20", "09:00") }); // left the school with the book
  loan("KC", "Shahab Nama", "STAFF", "KC-T-0142", "2026-10-01", 30, null); // staff, 4 days late, no fine
  loan("KC", "A Brief History of Time", "STAFF", "KC-T-0118", "2026-10-20", 30, null);
  loan("KC", "Raja Gidh", "STAFF", "KC-S-0009", "2026-10-29", 30, null);
  const openFlow = kcStudents.slice(30, 36);
  openFlow.forEach((s, i) => {
    const issued = workday(addDays("2026-10-12", i * 4));
    loan("KC", ["Charlotte's Web", "Black Beauty", "Around the World in Eighty Days", "The Secret Garden", "Chacha Chhakkan", "Robinson Crusoe"][i]!, "STUDENT", s.grNo, issued, 14, null, {}, i % 2);
  });

  // Other campuses: a few loans each.
  for (const campus of ["HC", "UC", "SM", "MC"] as CampusCode[]) {
    const studs = activeStudents(campus);
    const campusTitles = titles.filter((t) => t.campus === campus);
    studs.slice(0, 4).forEach((s, i) => {
      const t = campusTitles[i % Math.max(1, campusTitles.length)];
      if (!t) return;
      const issued = workday(addDays("2026-10-05", i * 6));
      loan(campus, t.title, "STUDENT", s.grNo, issued, 14, i % 2 === 0 ? workday(addDays(issued, 12)) : null);
    });
  }

  // One copy damaged, one lost and paid for, one missing from the September count.
  const damaged = copyOf("KC", "Gulliver's Travels");
  if (damaged) Object.assign(damaged, { status: "DAMAGED" as const, condition: "DAMAGED" as const, note: "Spine broken and pages loose; sent for binding.", writtenOff: { on: "2026-10-06", by: LIBRARIAN.KC, approvedBy: "Ms Rehana Kausar", reason: "Spine broken and pages loose; sent for binding." } });
  const lostCopy = copyOf("KC", "Oxford School Atlas for Pakistan", 1);
  if (lostCopy) {
    lostCopy.status = "LOST";
    lostCopy.note = "Lost by borrower; replacement cost added to fee account on 15-Sep-2026.";
    lostCopy.writtenOff = { on: "2026-09-15", by: LIBRARIAN.KC, approvedBy: "Mrs Sadia Rehman", reason: "Lost by the borrower; replacement cost added to the fee account." };
    loans.push({ id: `KC-ln${pad(++ln, 4)}`, campus: "KC", copyId: lostCopy.id, borrowerType: "STUDENT", borrowerId: "KC-15230", issuedOn: "2026-08-20", dueOn: "2026-09-03", returnedOn: "2026-09-15", fine: lostCopy.cost, fineStatus: "ADDED_TO_FEES", fineNote: "Replacement cost of a lost copy.", issuedBy: LIBRARIAN.KC, returnedBy: LIBRARIAN.KC, reminders: 1, lastReminderAt: at("2026-09-08", "09:00"), lost: true });
  }
  const missing = copies.find((c) => c.campus === "KC" && c.shelfId?.startsWith("KC-cab-C-01") && c.status === "AVAILABLE" && c.accessionNo.endsWith("2"));
  if (missing) Object.assign(missing, { status: "MISSING" as const, note: "Not found in the reference count on 21-Sep-2026." });

  // ---- Stock counts ----
  const cabCopies = (cabId: string) => copies.filter((c) => c.shelfId?.startsWith(`${cabId}-`));
  const refCab = "KC-cab-C-01";
  const childCab = "KC-cab-C-06";
  const refScans = cabCopies(refCab)
    .filter((c) => c.id !== missing?.id && c.status !== "LOST")
    .map((c, i) => ({ accessionNo: c.accessionNo, shelfId: c.shelfId!, at: at("2026-09-21", `10:${pad(10 + i, 2)}`) }));
  const childOpen = cabCopies(childCab).filter((c) => c.status === "AVAILABLE");
  // Today's count: about two thirds scanned; one copy found on a different shelf than recorded.
  const childScans = childOpen.slice(0, Math.ceil(childOpen.length * 0.65)).map((c, i) => {
    const wrong = i === 2;
    const shelf = wrong ? (c.shelfId === `${childCab}-s1` ? `${childCab}-s2` : `${childCab}-s1`) : c.shelfId!;
    return { accessionNo: c.accessionNo, shelfId: shelf, at: at("2026-11-03", `11:${pad(5 + i * 2, 2)}`) };
  });
  const counts: LibCountRec[] = [
    {
      id: "KC-lcount-1",
      campus: "KC",
      name: "Reference cabinet, September check",
      cabinetIds: [refCab],
      status: "CLOSED",
      startedOn: "2026-09-21",
      startedBy: LIBRARIAN.KC,
      closedOn: "2026-09-21",
      closedBy: LIBRARIAN.KC,
      scans: refScans,
      closedRows: [
        ...refScans.map((sc) => {
          const c = copies.find((x) => x.accessionNo === sc.accessionNo)!;
          const t = titles.find((x) => x.id === c.titleId)!;
          const shelf = cabinets.flatMap((cb) => cb.shelves.map((sh) => ({ ...sh, code: cb.code }))).find((sh) => sh.id === sc.shelfId);
          const label = shelf ? `${shelf.code} · ${shelf.label}` : "";
          return { accessionNo: sc.accessionNo, copyId: c.id, title: t.title, recordedShelf: label, scannedShelf: label, result: "FOUND", action: "No change" };
        }),
        ...(missing ? [{ accessionNo: missing.accessionNo, copyId: missing.id, title: titles.find((x) => x.id === missing.titleId)!.title, recordedShelf: "C-01", scannedShelf: "", result: "MISSING", action: "Marked as missing" }] : []),
      ],
      applied: missing ? [`1 copy not found (${missing.accessionNo}) marked as missing.`, `${refScans.length} copies confirmed on their shelves.`] : [`${refScans.length} copies confirmed on their shelves.`],
    },
    { id: "KC-lcount-2", campus: "KC", name: "Children's corner, November check", cabinetIds: [childCab], status: "OPEN", startedOn: "2026-11-03", startedBy: LIBRARIAN.KC, closedOn: null, closedBy: null, scans: childScans, closedRows: null, applied: [] },
  ];

  const activity: LibActivityRec[] = [
    { id: "la-1", campus: "KC", at: at("2026-11-04", "08:52"), kind: "REMINDER", text: "Overdue reminder sent to 2 families", by: LIBRARIAN.KC },
    { id: "la-2", campus: "KC", at: at("2026-11-03", "11:40"), kind: "COUNT", text: "Stock count started: Children's corner", by: LIBRARIAN.KC },
    { id: "la-3", campus: "KC", at: at("2026-11-02", "12:15"), kind: "ISSUE", text: "Heidi issued to Areeba Siddiqui (7-B)", by: LIBRARIAN.KC },
    { id: "la-4", campus: "KC", at: at("2026-10-29", "10:05"), kind: "ISSUE", text: "Raja Gidh issued to Mrs Sadia Rehman", by: LIBRARIAN.KC },
    { id: "la-5", campus: "KC", at: at("2026-10-28", "09:40"), kind: "ISSUE", text: "Little Women issued to Fatima Noor (7-A)", by: LIBRARIAN.KC },
  ];

  return { libraries, cabinets, categories: LIB_CATEGORIES.map((c) => ({ ...c })), titles, copies, loans, policies, counts, activity, nextAccession };
}

/* ================================================================================================ Warehouse */

export interface WhCategoryRec {
  id: string;
  name: string;
  forSale: boolean;
  active: boolean;
}

export const WH_CATEGORIES: WhCategoryRec[] = [
  { id: "wc-office", name: "Office stationery", forSale: false, active: true },
  { id: "wc-class", name: "Classroom supplies", forSale: false, active: true },
  { id: "wc-clean", name: "Cleaning and hygiene", forSale: false, active: true },
  { id: "wc-elec", name: "Electrical", forSale: false, active: true },
  { id: "wc-it", name: "IT and printing", forSale: false, active: true },
  { id: "wc-furn", name: "Furniture and fixtures", forSale: false, active: true },
  { id: "wc-sport", name: "Sports", forSale: false, active: true },
  { id: "wc-lab", name: "Science lab", forSale: false, active: true },
  { id: "wc-books", name: "Text books (shop)", forSale: true, active: true },
  { id: "wc-uniform", name: "Uniform (shop)", forSale: true, active: true },
  { id: "wc-stat", name: "Student stationery (shop)", forSale: true, active: true },
];

export interface WhItemRec {
  id: string;
  campus: CampusCode;
  code: string;
  group: string;
  name: string;
  categoryId: string;
  unit: string;
  consumable: boolean;
  reorderLevel: number;
  salePrice: number | null;
  active: boolean;
}

export interface WhSupplierRec {
  id: string;
  campus: CampusCode;
  name: string;
  contact: string;
  /** Landline. */
  phone: string;
  mobile: string;
  email: string;
  address: string;
  ntn: string;
  supplies: string;
  active: boolean;
  rowVer?: number;
}

export interface WhRoomRec {
  name: string;
  /** Unique across the campus. */
  roomNo: string;
  floor: number | null;
  active: boolean;
}

export interface WhDeptRec {
  id: string;
  campus: CampusCode;
  name: string;
  rooms: WhRoomRec[];
  active: boolean;
  rowVer?: number;
}

export interface WhMoveRec {
  id: string;
  campus: CampusCode;
  itemId: string;
  date: IsoDate;
  at: IsoDateTime;
  type: WarehouseMovementType;
  docId: string;
  docNo: string;
  qtyIn: number;
  qtyOut: number;
  unitCost: number;
  party: string;
  /** Room or class that received or returned it (issues and returns). */
  room: string;
  note: string;
  by: string;
}

export interface WhGrnRec {
  id: string;
  no: string;
  campus: CampusCode;
  supplierId: string;
  supplierInvoiceNo: string;
  date: IsoDate;
  lines: Array<{ itemId: string; qty: number; unitPrice: number; discountPct: number }>;
  freight: number;
  /** Sales tax on the bill (kept apart from the item cost, like freight). */
  tax: number;
  status: "POSTED" | "REVERSED";
  receivedBy: string;
  postedAt: IsoDateTime;
  note: string;
  reversal: { by: string; at: IsoDateTime; reason: string } | null;
}

export interface WhRequestRec {
  id: string;
  no: string;
  campus: CampusCode;
  departmentId: string;
  room: string;
  requestedBy: string;
  requestedOn: IsoDate;
  lines: Array<{ itemId: string; qty: number }>;
  cancelled: boolean;
  note: string;
  cancelReason: string;
}

export interface WhIssueRec {
  id: string;
  no: string;
  campus: CampusCode;
  date: IsoDate;
  departmentId: string;
  room: string;
  receivedBy: string;
  requestId: string | null;
  lines: Array<{ id: string; itemId: string; qty: number; unitCost: number; remarks: string }>;
  issuedBy: string;
  postedAt: IsoDateTime;
}

export interface WhReturnRec {
  id: string;
  no: string;
  campus: CampusCode;
  date: IsoDate;
  issueId: string;
  lines: Array<{ issueLineId: string; qty: number }>;
  reason: string;
  receivedBy: string;
  postedAt: IsoDateTime;
}

export interface WhCountRec {
  id: string;
  no: string;
  campus: CampusCode;
  name: string;
  categoryId: string | null;
  status: WarehouseCountStatus;
  startedOn: IsoDate;
  startedBy: string;
  submittedBy: string | null;
  submittedAt: IsoDateTime | null;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  decisionNote: string;
  lines: Array<{ itemId: string; systemQty: number; countedQty: number | null; reason: string; unitCost: number }>;
}

export interface WhSaleRec {
  id: string;
  receiptNo: string;
  campus: CampusCode;
  at: IsoDateTime;
  grNo: string;
  lines: Array<{ itemId: string; qty: number; price: number }>;
  payment: "CASH" | "FEE_ACCOUNT";
  received: number | null;
  soldBy: string;
  status: "POSTED" | "CANCELLED";
  cancelReason: string;
  feeChargeId: string | null;
}

export interface WhBookSetRec {
  id: string;
  campus: CampusCode;
  classShort: string;
  lines: Array<{ itemId: string; qty: number }>;
}

export interface WarehouseFixtures {
  categories: WhCategoryRec[];
  items: WhItemRec[];
  suppliers: WhSupplierRec[];
  departments: WhDeptRec[];
  moves: WhMoveRec[];
  grns: WhGrnRec[];
  requests: WhRequestRec[];
  issues: WhIssueRec[];
  returns: WhReturnRec[];
  counts: WhCountRec[];
  sales: WhSaleRec[];
  bookSets: WhBookSetRec[];
  seq: Record<string, number>;
}

/** [group, name, category, unit, consumable, reorder, unit cost, opening qty, monthly use, supplier key, sale price] */
type ItemSeed = [string, string, string, string, boolean, number, number, number, number, string, number | null];

const STORE_ITEMS: ItemSeed[] = [
  ["Paper", "A4 paper 80 gsm", "wc-office", "Ream", true, 20, 1450, 60, 22, "stat", null],
  ["Paper", "Legal paper 80 gsm", "wc-office", "Ream", true, 6, 1750, 15, 4, "stat", null],
  ["Register", "Register 200 pages", "wc-office", "Piece", true, 25, 260, 80, 18, "stat", null],
  ["Register", "Register 400 pages", "wc-office", "Piece", true, 15, 480, 40, 9, "stat", null],
  ["Pen", "Ball pen blue (box of 10)", "wc-office", "Box", true, 10, 380, 30, 8, "stat", null],
  ["File", "File cover (dozen)", "wc-office", "Dozen", true, 8, 540, 20, 5, "stat", null],
  ["Envelope", "Envelope A4 (packet of 50)", "wc-office", "Packet", true, 5, 650, 12, 3, "stat", null],
  ["Stapler", "Staple pins No. 10 (box)", "wc-office", "Box", true, 20, 45, 60, 12, "stat", null],
  ["Marker", "Whiteboard marker black", "wc-class", "Piece", true, 40, 95, 150, 55, "stat", null],
  ["Marker", "Whiteboard marker blue", "wc-class", "Piece", true, 40, 95, 150, 45, "stat", null],
  ["Marker", "Whiteboard marker red", "wc-class", "Piece", true, 20, 95, 80, 18, "stat", null],
  ["Duster", "Whiteboard duster", "wc-class", "Piece", true, 15, 180, 40, 8, "stat", null],
  ["Chalk", "Chalk box white", "wc-class", "Box", true, 10, 120, 30, 6, "stat", null],
  ["Chart", "Chart paper (packet of 25)", "wc-class", "Packet", true, 4, 850, 10, 2, "stat", null],
  ["Phenyl", "Phenyl 1 litre", "wc-clean", "Bottle", true, 20, 240, 60, 20, "clean", null],
  ["Cleaner", "Toilet cleaner 500 ml", "wc-clean", "Bottle", true, 15, 320, 40, 12, "clean", null],
  ["Soap", "Hand wash 500 ml", "wc-clean", "Bottle", true, 20, 290, 50, 16, "clean", null],
  ["Broom", "Broom (soft)", "wc-clean", "Piece", true, 10, 350, 25, 5, "clean", null],
  ["Bags", "Garbage bags large (packet)", "wc-clean", "Packet", true, 10, 420, 30, 8, "clean", null],
  ["Tissue", "Tissue roll", "wc-clean", "Roll", true, 30, 110, 100, 30, "clean", null],
  ["Light", "LED tube light 20 W", "wc-elec", "Piece", true, 10, 650, 30, 4, "elec", null],
  ["Light", "LED bulb 12 W", "wc-elec", "Piece", true, 15, 320, 40, 6, "elec", null],
  ["Fan", "Ceiling fan capacitor", "wc-elec", "Piece", true, 6, 280, 15, 2, "elec", null],
  ["Cable", "PVC cable 7/29 (coil)", "wc-elec", "Roll", true, 2, 9500, 4, 1, "elec", null],
  ["Toner", "Printer toner 85A", "wc-it", "Piece", true, 2, 3800, 6, 1, "it", null],
  ["Toner", "Photocopier toner", "wc-it", "Piece", true, 2, 6500, 5, 1, "it", null],
  ["USB", "USB flash drive 32 GB", "wc-it", "Piece", true, 3, 1300, 8, 1, "it", null],
  ["Mouse", "USB mouse", "wc-it", "Piece", false, 4, 650, 12, 1, "it", null],
  ["Chair", "Student chair (plastic)", "wc-furn", "Piece", false, 10, 2600, 40, 3, "furn", null],
  ["Desk", "Student desk (double)", "wc-furn", "Piece", false, 4, 8500, 12, 1, "furn", null],
  ["Board", "Whiteboard 4 × 6 ft", "wc-furn", "Piece", false, 1, 9500, 4, 0, "furn", null],
  ["Football", "Football size 5", "wc-sport", "Piece", false, 3, 2400, 8, 1, "sport", null],
  ["Cricket", "Cricket bat (tape ball)", "wc-sport", "Piece", false, 3, 1800, 6, 1, "sport", null],
  ["Cricket", "Tape ball (dozen)", "wc-sport", "Dozen", true, 2, 900, 6, 1, "sport", null],
  ["Glassware", "Test tubes (dozen)", "wc-lab", "Dozen", true, 4, 650, 10, 1, "lab", null],
  ["Glassware", "Beaker 250 ml", "wc-lab", "Piece", true, 10, 380, 24, 3, "lab", null],
  ["Burner", "Spirit lamp", "wc-lab", "Piece", false, 4, 450, 10, 1, "lab", null],
];

const SHOP_CLASSES: Record<CampusCode, string[]> = { KC: ["4", "6", "7", "8"], HC: ["7", "8"], UC: ["9"], SM: ["5"], MC: ["5"] };
const BOOK_SUBJECTS: Array<[string, number]> = [
  ["English Reader", 520],
  ["Urdu", 420],
  ["Mathematics", 480],
  ["General Science", 460],
  ["Islamiat", 300],
  ["Social Studies", 380],
];
const SHOP_OTHER: ItemSeed[] = [
  ["Uniform", "Shirt white (size 28–32)", "wc-uniform", "Piece", true, 15, 650, 60, 6, "uniform", 900],
  ["Uniform", "Shirt white (size 34–38)", "wc-uniform", "Piece", true, 15, 720, 50, 5, "uniform", 1000],
  ["Uniform", "Trouser grey (size 24–28)", "wc-uniform", "Piece", true, 10, 780, 40, 4, "uniform", 1100],
  ["Uniform", "Kameez shalwar (girls, medium)", "wc-uniform", "Set", true, 10, 1350, 40, 4, "uniform", 1800],
  ["Uniform", "Sweater navy (size 30–34)", "wc-uniform", "Piece", true, 15, 1100, 30, 5, "uniform", 1500],
  ["Uniform", "School tie", "wc-uniform", "Piece", true, 20, 150, 80, 6, "uniform", 250],
  ["Uniform", "School badge", "wc-uniform", "Piece", true, 20, 60, 100, 6, "uniform", 100],
  ["Copy", "Exercise copy 80 pages (single line)", "wc-stat", "Piece", true, 100, 55, 600, 80, "stat", 80],
  ["Copy", "Exercise copy 80 pages (four line)", "wc-stat", "Piece", true, 60, 55, 300, 40, "stat", 80],
  ["Box", "Geometry box", "wc-stat", "Piece", true, 20, 240, 60, 6, "stat", 350],
  ["Diary", "School diary 2026–27", "wc-stat", "Piece", true, 30, 120, 200, 12, "stat", 200],
];

const SUPPLIERS: Record<CampusCode, Array<[key: string, name: string, contact: string, supplies: string]>> = {
  KC: [
    ["stat", "Al-Madina Stationers", "Haji Abdul Majeed", "Stationery, registers, markers, copies"],
    ["clean", "Rehman Traders", "Abdul Rehman", "Cleaning and hygiene"],
    ["elec", "Sadiq Electric Store", "Muhammad Sadiq", "Lights, fans, cable"],
    ["it", "City Computers", "Bilal Ahmed", "Toner, printers, IT accessories"],
    ["furn", "Shah Furniture Works", "Sajid Shah", "Desks, chairs, boards"],
    ["sport", "Sports Corner", "Ahsan Iqbal", "Sports goods"],
    ["lab", "Scientific Supply House", "Kashif Mehmood", "Lab glassware and chemicals"],
    ["books", "Punjab Book Depot", "Rana Tahir", "Text books"],
    ["uniform", "Ittehad Uniform House", "Shafiq Ahmed", "School uniform"],
  ],
  HC: [
    ["stat", "Urdu Bazaar Stationers", "Mian Arshad", "Stationery"],
    ["clean", "Lahore Cleaning Supplies", "Tariq Butt", "Cleaning"],
    ["books", "Lahore Book Depot", "Nadeem Khalid", "Text books"],
    ["uniform", "Garden Town Uniforms", "Asim Raza", "Uniform"],
  ],
  UC: [
    ["stat", "Ubaid Stationers", "Qaiser Abbas", "Stationery, cleaning"],
    ["books", "Iqbal Book Centre", "Muhammad Iqbal", "Text books, uniform"],
  ],
  SM: [
    ["stat", "Mill Road Stationers", "Riaz Hussain", "Stationery, cleaning"],
    ["books", "Al-Noor Book Store", "Noor Ahmed", "Text books, uniform"],
  ],
  MC: [
    ["stat", "Majeed Traders", "Ghulam Murtaza", "Stationery, cleaning, books"],
  ],
};

/** [department, rooms, floor the rooms are on]. */
const DEPARTMENTS: Array<[string, string[], number]> = [
  ["Administration", ["Principal's office", "Admin office", "Fee office", "Staff room"], 0],
  ["Pre-primary", ["Prep-A", "Prep-B"], 0],
  ["Primary", ["Class 1-A", "Class 2-B", "Class 3-A", "Class 4-A", "Class 4-B", "Class 5-A"], 0],
  ["Middle", ["Class 6-A", "Class 6-B", "Class 7-A", "Class 7-B", "Class 7-C", "Class 8-A", "Class 8-C"], 1],
  ["Secondary (Matric)", ["Class 9-A", "Class 9-B", "Class 10-A"], 2],
  ["Science and computer labs", ["Physics lab", "Chemistry lab", "Biology lab", "Computer lab"], 1],
  ["Library", ["Library"], 1],
  ["Sports", ["Sports room", "Ground"], 0],
  ["Support services", ["Washrooms", "Canteen", "Gate"], 0],
];
/** Department and room names, for report filters. */
export const WH_DEPARTMENT_NAMES = DEPARTMENTS.map(([name]) => name);
export const WH_ROOM_NAMES = DEPARTMENTS.flatMap(([, rooms]) => rooms);
/** Item families ("Register", "Marker"), for report filters. */
export const WH_ITEM_GROUPS = (): string[] => [...new Set([...STORE_ITEMS, ...SHOP_OTHER].map(([group]) => group).concat("Text book"))].sort();
/** Supplier names at every campus, for report filters. */
export const WH_SUPPLIER_NAMES = (): string[] => [...new Set(Object.values(SUPPLIERS).flatMap((list) => list.map(([, name]) => name)))].sort();
const SCALE: Record<CampusCode, number> = { KC: 1, HC: 0.6, UC: 0.4, SM: 0.35, MC: 0.25 };
const CITY: Record<CampusCode, string> = { KC: "Sadiqabad", HC: "Lahore", UC: "", SM: "", MC: "" };
const MONTH_STARTS: IsoDate[] = ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"];

export function initialWarehouse(): WarehouseFixtures {
  const items: WhItemRec[] = [];
  const suppliers: WhSupplierRec[] = [];
  const departments: WhDeptRec[] = [];
  const moves: WhMoveRec[] = [];
  const grns: WhGrnRec[] = [];
  const requests: WhRequestRec[] = [];
  const issues: WhIssueRec[] = [];
  const returns: WhReturnRec[] = [];
  const counts: WhCountRec[] = [];
  const sales: WhSaleRec[] = [];
  const bookSets: WhBookSetRec[] = [];
  const seq: Record<string, number> = {};
  const next = (key: string) => (seq[key] = (seq[key] ?? 0) + 1);

  for (const campus of OPS_CAMPUSES) {
    const scale = SCALE[campus];
    const keeper = STORE_KEEPER[campus];
    // Suppliers
    SUPPLIERS[campus].forEach(([key, name, contact, supplies], i) =>
      suppliers.push({
        id: `${campus}-sup-${key}`,
        campus,
        name,
        contact,
        phone: rnd(`${campus}${key}ll`) < 0.7 ? `${campus === "HC" ? "042" : "068"}-555${pad(between(`${campus}${key}ll2`, 1000, 9999), 4)}` : "",
        mobile: `0300-55${pad(60 + i, 2)}${pad(between(`${campus}${key}ph`, 100, 999), 3)}`,
        email: rnd(`${campus}${key}em`) < 0.55 ? `orders.${key}@example.com` : "",
        address: CITY[campus] ? `Main Bazaar, ${CITY[campus]}` : "Main Bazaar",
        ntn: rnd(`${campus}${key}ntn`) < 0.6 ? `${between(`${campus}${key}n1`, 1000000, 9999999)}-${between(`${campus}${key}n2`, 1, 9)}` : "",
        supplies,
        active: true,
      }),
    );
    const supplierFor = (key: string) => suppliers.find((s) => s.campus === campus && s.id === `${campus}-sup-${key}`) ?? suppliers.find((s) => s.campus === campus)!;

    // Departments
    // Room numbers run per floor across the campus: 1, 2 … on the ground floor, 101, 102 … upstairs.
    const perFloor = new Map<number, number>();
    DEPARTMENTS.filter((_, i) => campus === "KC" || i !== 4 || campus === "UC").forEach(([name, rooms, floor], i) =>
      departments.push({
        id: `${campus}-dep-${i + 1}`,
        campus,
        name,
        rooms: (campus === "KC" ? rooms : rooms.slice(0, Math.max(1, Math.ceil(rooms.length * 0.6)))).map((room) => {
          const n = (perFloor.get(floor) ?? 0) + 1;
          perFloor.set(floor, n);
          return { name: room, roomNo: String(floor * 100 + n), floor, active: true };
        }),
        active: true,
      }),
    );
    const campusDepts = departments.filter((d) => d.campus === campus);

    // Items
    const seeds: ItemSeed[] = [
      ...STORE_ITEMS.filter((_, i) => campus === "KC" || rnd(`${campus}|item|${i}`) < 0.65),
      ...SHOP_CLASSES[campus].flatMap((cls) => BOOK_SUBJECTS.map(([subject, price]): ItemSeed => ["Text book", `${subject}, Class ${cls}`, "wc-books", "Piece", true, 10, Math.round(price * 0.8), Math.round(70 * scale) + 10, 2, "books", price])),
      ...SHOP_OTHER.filter((_, i) => campus === "KC" || i % 2 === 0),
    ];
    const prefixOf: Record<string, string> = { "wc-office": "OF", "wc-class": "CL", "wc-clean": "CN", "wc-elec": "EL", "wc-it": "IT", "wc-furn": "FN", "wc-sport": "SP", "wc-lab": "LB", "wc-books": "BK", "wc-uniform": "UN", "wc-stat": "SS" };
    const codeSeq: Record<string, number> = {};
    const specs = new Map<string, { seed: ItemSeed; cost: number }>();
    for (const seed of seeds) {
      const [group, name, cat, unit, consumable, reorder, cost, , , , salePrice] = seed;
      const p = prefixOf[cat]!;
      codeSeq[p] = (codeSeq[p] ?? 0) + 1;
      const id = `${campus}-it-${p}${pad(codeSeq[p], 3)}`;
      items.push({ id, campus, code: `${p}-${pad(codeSeq[p], 3)}`, group, name, categoryId: cat, unit, consumable, reorderLevel: Math.max(1, Math.round(reorder * Math.max(scale, 0.4))), salePrice, active: true });
      specs.set(id, { seed, cost });
    }

    // ---- Simulated history, in date order ----
    const bal = new Map<string, number>();
    const avg = new Map<string, number>();
    const move = (m: Omit<WhMoveRec, "id" | "campus">) => {
      const b = bal.get(m.itemId) ?? 0;
      if (m.qtyIn > 0) {
        const a = avg.get(m.itemId) ?? m.unitCost;
        avg.set(m.itemId, Math.round((b * a + m.qtyIn * m.unitCost) / Math.max(1, b + m.qtyIn)));
      }
      bal.set(m.itemId, b + m.qtyIn - m.qtyOut);
      moves.push({ id: `${campus}-mv${pad(moves.length + 1, 5)}`, campus, ...m });
    };
    const campusItems = items.filter((it) => it.campus === campus);

    // Opening balance from the physical count at cut-over.
    for (const it of campusItems) {
      const { seed, cost } = specs.get(it.id)!;
      const qty = Math.max(it.consumable ? 2 : 1, Math.round(seed[7] * scale));
      avg.set(it.id, cost);
      move({ itemId: it.id, date: "2026-04-01", at: at("2026-04-01", "08:30"), type: "OPENING", docId: "", docNo: `${campus}-OB-2627`, qtyIn: qty, qtyOut: 0, unitCost: cost, party: "Physical count at go-live", room: "", note: "Opening balance from the physical count on 01-Apr-2026", by: keeper });
    }

    const roomsOf = (dep: WhDeptRec) => dep.rooms.map((r) => r.name);
    const deptFor = (it: WhItemRec, key: string): WhDeptRec => {
      const byCat: Record<string, string> = { "wc-lab": "Science and computer labs", "wc-sport": "Sports", "wc-clean": "Support services", "wc-it": "Administration", "wc-office": "Administration" };
      const want = byCat[it.categoryId];
      const d = want ? campusDepts.find((x) => x.name === want) : undefined;
      if (d) return d;
      const teaching = campusDepts.filter((x) => ["Primary", "Middle", "Secondary (Matric)", "Pre-primary"].includes(x.name));
      return teaching[Math.floor(rnd(key) * teaching.length)] ?? campusDepts[0]!;
    };

    for (let mi = 0; mi < MONTH_STARTS.length; mi++) {
      const m0 = MONTH_STARTS[mi]!;
      const monthEnd = mi === MONTH_STARTS.length - 1 ? "2026-11-03" : addDays(MONTH_STARTS[mi + 1]!, -1);
      if (m0 === "2026-07-01" && campus !== "KC") continue; // summer break at small campuses

      // Goods received: each supplier restocks what runs low, once a month.
      const supplierKeys = [...new Set(campusItems.map((it) => specs.get(it.id)!.seed[9]))];
      for (const sk of supplierKeys) {
        const sup = supplierFor(sk);
        const lines = campusItems
          .filter((it) => specs.get(it.id)!.seed[9] === sk && it.categoryId !== "wc-books")
          .filter((it) => (bal.get(it.id) ?? 0) < it.reorderLevel * 2 && specs.get(it.id)!.seed[8] > 0)
          .map((it) => {
            const { seed, cost } = specs.get(it.id)!;
            const qty = Math.max(1, Math.round(seed[8] * scale * 2.5));
            const price = Math.round(cost * (1 + mi * 0.01));
            return { itemId: it.id, qty, unitPrice: price, discountPct: sk === "stat" && qty >= 20 ? 5 : 0 };
          });
        if (lines.length === 0 || (m0 === "2026-11-01" && campus !== "KC")) continue;
        if (m0 === "2026-11-01" && !["clean"].includes(sk)) continue;
        const date = workday(addDays(m0, between(`${campus}${sk}${mi}d`, 2, 12)));
        if (date > monthEnd) continue;
        const n = next(`${campus}-GRN`);
        const g: WhGrnRec = {
          id: `${campus}-grn-${n}`,
          no: `${campus}-GRN-2627-${pad(n, 4)}`,
          campus,
          supplierId: sup.id,
          supplierInvoiceNo: `${sup.name.split(" ")[0]!.slice(0, 3).toUpperCase()}-${between(`${campus}${sk}${mi}inv`, 1100, 9800)}`,
          date,
          lines,
          freight: rnd(`${campus}${sk}${mi}fr`) < 0.3 ? 500 : 0,
          // Registered suppliers of equipment add sales tax to the bill.
          tax: ["it", "elec", "furn"].includes(sk) ? Math.round(lines.reduce((a, l) => a + Math.round(l.qty * l.unitPrice * (1 - l.discountPct / 100)), 0) * 0.17) : 0,
          status: "POSTED",
          receivedBy: keeper,
          postedAt: at(date, "11:20"),
          note: "",
          reversal: null,
        };
        grns.push(g);
        for (const l of lines) move({ itemId: l.itemId, date, at: g.postedAt, type: "RECEIPT", docId: g.id, docNo: g.no, qtyIn: l.qty, qtyOut: 0, unitCost: Math.round(l.unitPrice * (1 - l.discountPct / 100)), party: sup.name, room: "", note: `Invoice ${g.supplierInvoiceNo}`, by: keeper });
      }

      // Issues to departments through the month.
      const issueDays = m0 === "2026-11-01" ? (campus === "KC" ? ["2026-11-02"] : []) : (campus === "KC" ? [8, 22] : [15]).map((d) => workday(addDays(m0, d - 1)));
      issueDays.forEach((day, di) => {
        const usable = campusItems.filter((it) => !["wc-books", "wc-uniform", "wc-stat"].includes(it.categoryId) && specs.get(it.id)!.seed[8] > 0);
        const groups = new Map<string, WhItemRec[]>();
        for (const it of usable) {
          if (rnd(`${campus}${it.id}${mi}${di}`) > (campus === "KC" ? 0.5 : 0.4)) continue;
          const dep = deptFor(it, `${campus}${it.id}${mi}${di}dep`);
          groups.set(dep.id, [...(groups.get(dep.id) ?? []), it]);
        }
        for (const [depId, list] of groups) {
          const dep = campusDepts.find((d) => d.id === depId)!;
          const room = roomsOf(dep)[Math.floor(rnd(`${depId}${mi}${di}room`) * roomsOf(dep).length)]!;
          const lines = list
            .map((it, li) => {
              const want = Math.max(1, Math.round(((specs.get(it.id)!.seed[8] * scale) / issueDays.length) * (0.6 + rnd(`${it.id}${mi}${di}q`) * 0.8)));
              const qty = Math.min(want, bal.get(it.id) ?? 0);
              return { id: `L${li + 1}`, itemId: it.id, qty, unitCost: avg.get(it.id) ?? 0, remarks: "" };
            })
            .filter((l) => l.qty > 0);
          if (lines.length === 0) continue;
          const n = next(`${campus}-ISS`);
          const iss: WhIssueRec = {
            id: `${campus}-iss-${n}`,
            no: `${campus}-ISS-2627-${pad(n, 4)}`,
            campus,
            date: day,
            departmentId: dep.id,
            room,
            receivedBy: dep.name === "Science and computer labs" && campus === "KC" ? "Mr Shahid Hussain" : dep.name === "Middle" && campus === "KC" ? "Ms Hina Javed" : `${dep.name} in-charge`,
            requestId: null,
            lines,
            issuedBy: keeper,
            postedAt: at(day, "09:45"),
          };
          issues.push(iss);
          for (const l of lines) {
            move({ itemId: l.itemId, date: day, at: iss.postedAt, type: "ISSUE", docId: iss.id, docNo: iss.no, qtyIn: 0, qtyOut: l.qty, unitCost: l.unitCost, party: `${dep.name} · ${room}`, room, note: "", by: keeper });
          }
        }
      });

      // Book shop: the session-start rush in April, then a trickle.
      const shopItems = campusItems.filter((it) => it.salePrice !== null);
      const studs = activeStudents(campus);
      const salesThisMonth = m0 === "2026-04-01" ? Math.round(studs.length * 0.6) : m0 === "2026-11-01" ? 0 : Math.max(1, Math.round(studs.length * 0.05));
      for (let si = 0; si < salesThisMonth; si++) {
        const s = studs[(si * 5 + mi) % studs.length];
        if (!s) break;
        const cls = s.classSection.split("-")[0]!;
        const books = shopItems.filter((it) => it.categoryId === "wc-books" && it.name.endsWith(`Class ${cls}`));
        const pick = m0 === "2026-04-01" && books.length ? books : shopItems.filter((it) => it.categoryId !== "wc-books").filter((_, k) => rnd(`${s.grNo}${mi}${k}`) < 0.25).slice(0, 3);
        const lines = pick.map((it) => ({ itemId: it.id, qty: it.categoryId === "wc-stat" && it.name.startsWith("Exercise") ? 6 : 1, price: it.salePrice! })).filter((l) => (bal.get(l.itemId) ?? 0) >= l.qty);
        if (lines.length === 0) continue;
        const day = workday(addDays(m0, m0 === "2026-04-01" ? (si % 12) + 1 : between(`${s.grNo}${mi}sd`, 3, 25)));
        const n = next(`${campus}-BS`);
        const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
        const sale: WhSaleRec = {
          id: `${campus}-sale-${n}`,
          receiptNo: `${campus}-BS-2627-${pad(n, 6)}`,
          campus,
          at: at(day, `${pad(9 + (si % 5), 2)}:${pad((si * 7) % 60, 2)}`),
          grNo: s.grNo,
          lines,
          payment: "CASH",
          received: Math.ceil(total / 500) * 500,
          soldBy: keeper,
          status: "POSTED",
          cancelReason: "",
          feeChargeId: null,
        };
        sales.push(sale);
        for (const l of lines) move({ itemId: l.itemId, date: day, at: sale.at, type: "SALE", docId: sale.id, docNo: sale.receiptNo, qtyIn: 0, qtyOut: l.qty, unitCost: avg.get(l.itemId) ?? 0, party: `${s.name} (${s.classSection})`, room: "", note: "", by: keeper });
      }
    }

    // A return of unused stock from a classroom.
    const retIssue = issues.find((x) => x.campus === campus && x.date >= "2026-10-01" && x.lines.some((l) => l.qty >= 3));
    if (retIssue) {
      const line = retIssue.lines.find((l) => l.qty >= 3)!;
      const n = next(`${campus}-RET`);
      const date = workday(addDays(retIssue.date, 6));
      const r: WhReturnRec = { id: `${campus}-ret-${n}`, no: `${campus}-RET-2627-${pad(n, 4)}`, campus, date, issueId: retIssue.id, lines: [{ issueLineId: line.id, qty: 2 }], reason: "Not needed after the test week.", receivedBy: keeper, postedAt: at(date, "12:10") };
      returns.push(r);
      const dep = campusDepts.find((d) => d.id === retIssue.departmentId)!;
      move({ itemId: line.itemId, date, at: r.postedAt, type: "RETURN", docId: r.id, docNo: r.no, qtyIn: 2, qtyOut: 0, unitCost: line.unitCost, party: `${dep.name} · ${retIssue.room}`, room: retIssue.room, note: r.reason, by: keeper });
    }

    if (campus === "KC") {
      // End-state story for the demo: black markers out, A4 paper and toner low.
      const targets: Array<[string, number]> = [
        ["Whiteboard marker black", 0],
        ["A4 paper 80 gsm", 8],
        ["Printer toner 85A", 1],
        ["Hand wash 500 ml", 6],
      ];
      const admin = campusDepts.find((d) => d.name === "Administration")!;
      const middle = campusDepts.find((d) => d.name === "Middle")!;
      for (const [name, target] of targets) {
        const it = campusItems.find((x) => x.name === name)!;
        const b = bal.get(it.id) ?? 0;
        if (b <= target) continue;
        const dep = name.startsWith("Whiteboard") ? middle : admin;
        const n = next("KC-ISS");
        const iss: WhIssueRec = {
          id: `KC-iss-${n}`,
          no: `KC-ISS-2627-${pad(n, 4)}`,
          campus,
          date: "2026-11-03",
          departmentId: dep.id,
          room: name.startsWith("Whiteboard") ? "Class 7-B" : "Admin office",
          receivedBy: name.startsWith("Whiteboard") ? "Ms Hina Javed" : "Farah Naz",
          requestId: null,
          lines: [{ id: "L1", itemId: it.id, qty: b - target, unitCost: avg.get(it.id) ?? 0, remarks: name.startsWith("A4") ? "Monthly test papers" : "" }],
          issuedBy: keeper,
          postedAt: at("2026-11-03", "10:15"),
        };
        issues.push(iss);
        move({ itemId: it.id, date: "2026-11-03", at: iss.postedAt, type: "ISSUE", docId: iss.id, docNo: iss.no, qtyIn: 0, qtyOut: b - target, unitCost: iss.lines[0]!.unitCost, party: `${dep.name} · ${iss.room}`, room: iss.room, note: "", by: keeper });
      }

      // Requests from departments.
      const item = (name: string) => campusItems.find((x) => x.name === name)!.id;
      const dep = (name: string) => campusDepts.find((d) => d.name === name)!.id;
      const req = (departmentId: string, room: string, requestedBy: string, requestedOn: IsoDate, lines: Array<[string, number]>, note = "", cancelReason = "") => {
        const n = next("KC-REQ");
        requests.push({ id: `KC-req-${n}`, no: `KC-REQ-2627-${pad(n, 4)}`, campus, departmentId, room, requestedBy, requestedOn, lines: lines.map(([nm, qty]) => ({ itemId: item(nm), qty })), cancelled: cancelReason !== "", note, cancelReason });
        return `KC-req-${n}`;
      };
      const fulfilled = req(dep("Middle"), "Class 7-A", "Mr Adeel Anwar", "2026-10-20", [["Whiteboard duster", 2], ["Chalk box white", 2]], "Monthly classroom supplies");
      // Link a matching issue so the request reads "Issued".
      {
        const n = next("KC-ISS");
        const lines = [
          { id: "L1", itemId: item("Whiteboard duster"), qty: 2, unitCost: avg.get(item("Whiteboard duster")) ?? 0, remarks: "" },
          { id: "L2", itemId: item("Chalk box white"), qty: 2, unitCost: avg.get(item("Chalk box white")) ?? 0, remarks: "" },
        ];
        const iss: WhIssueRec = { id: `KC-iss-${n}`, no: `KC-ISS-2627-${pad(n, 4)}`, campus, date: "2026-10-21", departmentId: dep("Middle"), room: "Class 7-A", receivedBy: "Mr Adeel Anwar", requestId: fulfilled, lines, issuedBy: keeper, postedAt: at("2026-10-21", "09:10") };
        issues.push(iss);
        for (const l of lines) move({ itemId: l.itemId, date: iss.date, at: iss.postedAt, type: "ISSUE", docId: iss.id, docNo: iss.no, qtyIn: 0, qtyOut: l.qty, unitCost: l.unitCost, party: "Middle · Class 7-A", room: "Class 7-A", note: "", by: keeper });
      }
      req(dep("Middle"), "Class 7-B", "Ms Hina Javed", "2026-11-03", [["Whiteboard marker black", 6], ["Whiteboard marker blue", 4], ["Whiteboard duster", 1]], "Markers have run dry before the monthly test.");
      req(dep("Science and computer labs"), "Chemistry lab", "Mr Shahid Hussain", "2026-11-02", [["Beaker 250 ml", 6], ["Test tubes (dozen)", 2]], "Practical exams start 16-Nov.");
      req(dep("Administration"), "Admin office", "Farah Naz", "2026-11-04", [["A4 paper 80 gsm", 10], ["File cover (dozen)", 2]]);
      req(dep("Sports"), "Sports room", "Sports in-charge", "2026-09-10", [["Football size 5", 4]], "", "Bought by the sports fund instead.");

      // Stock counts: one approved last month, one waiting for approval.
      const countLines = (cat: string, diffs: Record<string, number>, reasons: Record<string, string>) =>
        campusItems
          .filter((it) => it.categoryId === cat)
          .map((it) => {
            const sys = bal.get(it.id) ?? 0;
            const d = diffs[it.name] ?? 0;
            return { itemId: it.id, systemQty: sys, countedQty: Math.max(0, sys + d), reason: reasons[it.name] ?? "", unitCost: avg.get(it.id) ?? 0 };
          });
      const cleanLines = countLines("wc-clean", { "Tissue roll": -4, "Broom (soft)": 1 }, { "Tissue roll": "Damp carton thrown away", "Broom (soft)": "One found in the canteen store" });
      counts.push({
        id: "KC-wcount-1",
        no: "KC-CNT-2627-01",
        campus,
        name: "Cleaning store, October count",
        categoryId: "wc-clean",
        status: "APPROVED",
        startedOn: "2026-10-27",
        startedBy: "Farah Naz",
        submittedBy: "Farah Naz",
        submittedAt: at("2026-10-27", "13:30"),
        decidedBy: "Mrs Sadia Rehman",
        decidedAt: at("2026-10-28", "09:20"),
        decisionNote: "Approved. Keep tissue cartons off the floor.",
        lines: cleanLines,
      });
      for (const l of cleanLines) {
        const d = (l.countedQty ?? l.systemQty) - l.systemQty;
        if (d === 0) continue;
        move({ itemId: l.itemId, date: "2026-10-28", at: at("2026-10-28", "09:20"), type: "ADJUSTMENT", docId: "KC-wcount-1", docNo: "KC-CNT-2627-01", qtyIn: Math.max(0, d), qtyOut: Math.max(0, -d), unitCost: l.unitCost, party: "Stock count", room: "", note: l.reason, by: "Mrs Sadia Rehman" });
      }
      const classLines = countLines("wc-class", { "Whiteboard marker blue": -3, "Whiteboard duster": 1, "Chalk box white": -1 }, { "Whiteboard marker blue": "Dried out, thrown away", "Whiteboard duster": "Returned by 6-B without a return note", "Chalk box white": "Box broken in the store" });
      counts.push({
        id: "KC-wcount-2",
        no: "KC-CNT-2627-02",
        campus,
        name: "Classroom supplies, November count",
        categoryId: "wc-class",
        status: "SUBMITTED",
        startedOn: "2026-11-03",
        startedBy: "Farah Naz",
        submittedBy: "Farah Naz",
        submittedAt: at("2026-11-03", "14:05"),
        decidedBy: null,
        decidedAt: null,
        decisionNote: "",
        lines: classLines,
      });

      // Book sets per class (the legacy "FG recipe"): one click adds a class's books.
      for (const cls of SHOP_CLASSES.KC) {
        bookSets.push({ id: `KC-set-${cls}`, campus, classShort: cls, lines: campusItems.filter((it) => it.categoryId === "wc-books" && it.name.endsWith(`Class ${cls}`)).map((it) => ({ itemId: it.id, qty: 1 })) });
      }

      // Two sales today at the shop.
      const today = [["KC-14911", ["School tie", "Geometry box"]], ["KC-14650", ["Exercise copy 80 pages (single line)"]]] as const;
      today.forEach(([grNo, names], i) => {
        const lines = names.map((nm) => {
          const it = campusItems.find((x) => x.name === nm)!;
          return { itemId: it.id, qty: nm.startsWith("Exercise") ? 6 : 1, price: it.salePrice! };
        });
        const n = next("KC-BS");
        const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
        const sale: WhSaleRec = { id: `KC-sale-${n}`, receiptNo: `KC-BS-2627-${pad(n, 6)}`, campus, at: at("2026-11-04", i === 0 ? "08:41" : "09:05"), grNo, lines, payment: "CASH", received: Math.ceil(total / 100) * 100, soldBy: keeper, status: "POSTED", cancelReason: "", feeChargeId: null };
        sales.push(sale);
        const st = STUDENTS.find((x) => x.grNo === grNo)!;
        for (const l of lines) move({ itemId: l.itemId, date: "2026-11-04", at: sale.at, type: "SALE", docId: sale.id, docNo: sale.receiptNo, qtyIn: 0, qtyOut: l.qty, unitCost: avg.get(l.itemId) ?? 0, party: `${st.name} (${st.classSection})`, room: "", note: "", by: keeper });
      });
    } else {
      for (const cls of SHOP_CLASSES[campus]) {
        bookSets.push({ id: `${campus}-set-${cls}`, campus, classShort: cls, lines: campusItems.filter((it) => it.categoryId === "wc-books" && it.name.endsWith(`Class ${cls}`)).map((it) => ({ itemId: it.id, qty: 1 })) });
      }
    }
  }

  return { categories: WH_CATEGORIES.map((c) => ({ ...c })), items, suppliers, departments, moves, grns, requests, issues, returns, counts, sales, bookSets, seq };
}

/* ================================================================================================ Transport */

// Transport is real since module 11c; these fictional records feed only the report centre's transport reports
// (handlers/transport-model.ts) until module 13.

export interface TrnVehicleRec {
  id: string;
  campus: CampusCode;
  regNo: string;
  type: TransportVehicleType;
  make: string;
  model: string;
  year: number;
  capacity: number;
  ownership: "OWNED" | "CONTRACTED";
  contractor: string;
  driverName: string;
  driverMobile: string;
  licenceNo: string;
  licenceExpiry: IsoDate;
  conductorName: string;
  fitnessExpiry: IsoDate;
  insuranceExpiry: IsoDate;
  permitExpiry: IsoDate;
  odometer: number;
  active: boolean;
}

export interface TrnRouteRec {
  id: string;
  campus: CampusCode;
  code: string;
  name: string;
  vehicleId: string | null;
  fare: number;
  stops: Array<{ id: string; name: string; pickupTime: string; dropTime: string; fare: number | null }>;
  active: boolean;
}

export interface TrnRiderRec {
  id: string;
  campus: CampusCode;
  type: OperationsPersonType;
  personId: string;
  routeId: string;
  stopId: string;
  direction: TransportDirection;
  fromDate: IsoDate;
  toDate: IsoDate | null;
  endReason: string;
  /** Fee charges this assignment created in Fees (demo session only). */
  feeChargeIds: string[];
}

export interface TrnTripRec {
  id: string;
  campus: CampusCode;
  date: IsoDate;
  vehicleId: string;
  routeId: string | null;
  direction: "PICKUP" | "DROP" | "OTHER";
  purpose: string;
  driverName: string;
  departAt: string;
  arriveAt: string;
  startKm: number;
  endKm: number;
  ridersPresent: number;
  note: string;
}

export interface TrnFuelRec {
  id: string;
  campus: CampusCode;
  date: IsoDate;
  vehicleId: string;
  litres: number;
  amount: number;
  odometer: number;
  station: string;
  slipNo: string;
  enteredBy: string;
}

export interface TransportFixtures {
  vehicles: TrnVehicleRec[];
  routes: TrnRouteRec[];
  riders: TrnRiderRec[];
  trips: TrnTripRec[];
  fuel: TrnFuelRec[];
}

type RouteSeed = [code: string, name: string, fare: number, type: TransportVehicleType, make: string, model: string, capacity: number, stops: string[]];

const KC_ROUTES: RouteSeed[] = [
  ["R-01", "Model Town – Satellite Town", 2500, "HIACE", "Toyota", "Hiace", 15, ["Model Town Chowk", "Satellite Town Park", "Officers Colony", "Ghallah Mandi Gate"]],
  ["R-02", "Gulshan-e-Iqbal – Railway Road", 2500, "HIACE", "Toyota", "Hiace", 15, ["Gulshan-e-Iqbal Block B", "Railway Road Crossing", "Civil Hospital", "Tehsil Chowk"]],
  ["R-03", "Ahmadpur Lamma Road", 3500, "COASTER", "Toyota", "Coaster", 29, ["Ahmadpur Lamma Chowk", "Chak 155/P", "Chak 141/P", "Bypass Petrol Pump", "Sadiqabad City Gate"]],
  ["R-04", "Muslim Town – Grain Market", 2500, "VAN", "Suzuki", "Bolan", 9, ["Muslim Town Masjid", "Grain Market", "Faisal Colony"]],
  ["R-05", "Bhong Road", 4000, "COASTER", "Toyota", "Coaster", 29, ["Bhong Mor", "Chak 178/P", "Jamal Din Wali Road", "Canal Rest House"]],
  ["R-06", "Kot Sabzal Road", 4000, "HIACE", "Toyota", "Hiace", 15, ["Kot Sabzal Stop", "Chak 191/P", "Sugar Mill Road Crossing"]],
  ["R-07", "Jamal Din Wali", 3500, "HIACE", "Toyota", "Hiace", 15, ["Jamal Din Wali Chowk", "Basti Haji Khan", "New Abadi"]],
  ["R-08", "Hospital Road – Iqbal Nagar", 3000, "VAN", "Suzuki", "APV", 12, ["Iqbal Nagar", "Hospital Road", "Shahi Road"]],
  ["R-09", "Machka – Kamalpur", 3000, "COASTER", "Hino", "Liesse", 22, ["Machka Stop", "Kamalpur Chowk", "Chak 168/P", "Bus Stand"]],
];

const OTHER_STOPS: Record<CampusCode, string[]> = {
  KC: [],
  HC: ["Johar Town", "Model Town Link Road", "Township", "Garden Town", "Faisal Town", "Wapda Town", "Green Town", "Thokar Niaz Baig", "Shadman", "Ichhra"],
  UC: ["Main Bazaar", "Railway Station", "Civil Hospital", "Grain Market", "Canal Colony", "Eid Gah Road"],
  SM: ["Mill Colony", "Main Bazaar", "Railway Crossing", "Canal Bridge", "Old Bus Stand"],
  MC: ["Village Chowk", "Canal Bridge", "Basic Health Unit", "Main Road Stop"],
};
const DRIVERS = ["Ghulam Rasool", "Muhammad Aslam", "Allah Ditta", "Riaz Ahmed", "Muhammad Ramzan", "Bashir Ahmed", "Nazir Hussain", "Shaukat Ali", "Manzoor Ahmed", "Abdul Sattar", "Mukhtar Ahmed", "Sabir Hussain", "Liaqat Ali", "Muhammad Yousaf", "Gulzar Ahmed", "Ijaz Hussain", "Rafiq Ahmed", "Khadim Hussain", "Muhammad Akram", "Iftikhar Ahmed", "Sher Muhammad", "Habib Ullah", "Zafar Iqbal", "Dilawar Khan", "Fazal Din", "Pervaiz Akhtar", "Ghulam Abbas", "Noor Muhammad"];
const ROUTE_COUNT: Record<CampusCode, number> = { KC: 9, SM: 4, UC: 5, MC: 3, HC: 7 };
const FARE_RANGE: Record<CampusCode, [number, number]> = { KC: [2500, 4000], SM: [2200, 3200], UC: [2400, 3600], MC: [2000, 3000], HC: [3500, 5500] };
const PLATE: Record<CampusCode, string> = { KC: "RYK", SM: "RYK", UC: "BWP", MC: "RYK", HC: "LEA" };

const time = (base: string, add: number) => {
  const [h, m] = base.split(":").map(Number) as [number, number];
  const t = h * 60 + m + add;
  return `${pad(Math.floor(t / 60), 2)}:${pad(t % 60, 2)}`;
};

export function initialTransport(): TransportFixtures {
  const vehicles: TrnVehicleRec[] = [];
  const routes: TrnRouteRec[] = [];
  const riders: TrnRiderRec[] = [];
  const trips: TrnTripRec[] = [];
  const fuel: TrnFuelRec[] = [];
  let driverIx = 0;

  for (const campus of OPS_CAMPUSES) {
    const seeds: RouteSeed[] =
      campus === "KC"
        ? KC_ROUTES
        : Array.from({ length: ROUTE_COUNT[campus] }, (_, i): RouteSeed => {
            const [lo, hi] = FARE_RANGE[campus];
            const fare = ROUTE_COUNT[campus] === 1 ? lo : Math.round((lo + ((hi - lo) * i) / (ROUTE_COUNT[campus] - 1)) / 100) * 100;
            const pool = OTHER_STOPS[campus];
            const stops = [pool[i % pool.length]!, pool[(i + 3) % pool.length]!, pool[(i + 5) % pool.length]!].filter((v, k, a) => a.indexOf(v) === k);
            const big = i % 3 === 0;
            return [`R-${pad(i + 1, 2)}`, `${stops[0]} – ${stops[stops.length - 1]}`, fare, big ? "COASTER" : "HIACE", "Toyota", big ? "Coaster" : "Hiace", big ? 29 : 15, stops];
          });
    seeds.forEach(([code, name, fare, type, make, model, capacity, stopNames], i) => {
      const vid = `${campus}-veh-${i + 1}`;
      const key = `${campus}${code}`;
      const driver = DRIVERS[driverIx++ % DRIVERS.length]!;
      const big = type === "COASTER" || type === "BUS";
      const fitness = campus === "KC" && code === "R-06" ? "2026-10-28" : campus === "HC" && code === "R-02" ? "2026-11-20" : addDays("2027-01-15", between(`${key}fit`, 0, 200));
      const insurance = campus === "KC" && code === "R-03" ? "2026-11-16" : addDays("2027-02-01", between(`${key}ins`, 0, 240));
      const licence = campus === "KC" && code === "R-08" ? "2026-11-29" : addDays("2027-06-01", between(`${key}lic`, 0, 700));
      vehicles.push({
        id: vid,
        campus,
        regNo: `${PLATE[campus]}-${between(`${key}plate`, 1100, 9899)}`,
        type,
        make,
        model,
        year: between(`${key}year`, 2012, 2022),
        capacity,
        ownership: rnd(`${key}own`) < 0.7 ? "OWNED" : "CONTRACTED",
        contractor: "",
        driverName: driver,
        driverMobile: `0301-55${pad(between(`${key}mob`, 10000, 99999), 5)}`,
        licenceNo: `LTV-${between(`${key}licno`, 100000, 999999)}`,
        licenceExpiry: licence,
        conductorName: big ? DRIVERS[(driverIx + 13) % DRIVERS.length]! : "",
        fitnessExpiry: fitness,
        insuranceExpiry: insurance,
        permitExpiry: addDays("2027-03-31", 0),
        odometer: between(`${key}odo`, 84000, 260000),
        active: true,
      });
      const v = vehicles[vehicles.length - 1]!;
      if (v.ownership === "CONTRACTED") v.contractor = campus === "HC" ? "Garden Town Transport Co." : "Al-Rehman Goods and Passenger Service";
      const start = `0${6 + (i % 2)}:${pad(15 + ((i * 5) % 30), 2)}`;
      routes.push({
        id: `${campus}-rt-${i + 1}`,
        campus,
        code,
        name,
        vehicleId: vid,
        fare,
        stops: stopNames.map((s, k) => ({ id: `${campus}-rt-${i + 1}-st${k + 1}`, name: s, pickupTime: time(start, k * 9), dropTime: time("13:40", (stopNames.length - k) * 9), fare: k === 0 && stopNames.length >= 4 ? fare + 500 : null })),
        active: true,
      });
    });
    // A spare vehicle waiting for a route at Khalid Campus.
    if (campus === "KC") {
      vehicles.push({ id: "KC-veh-spare", campus, regNo: "RYK-4410", type: "HIACE", make: "Toyota", model: "Hiace", year: 2014, capacity: 15, ownership: "OWNED", contractor: "", driverName: "Abdul Sattar", driverMobile: "0301-5571234", licenceNo: "LTV-450912", licenceExpiry: "2027-08-10", conductorName: "", fitnessExpiry: "2027-02-14", insuranceExpiry: "2027-01-20", permitExpiry: "2027-03-31", odometer: 241380, active: true });
    }

    // Riders: students of this campus (the brief's family is left off, so assigning them shows the fee link).
    const pool = activeStudents(campus).filter((s) => !["KC-14823", "KC-15102", "UC-08831"].includes(s.grNo));
    const campusRoutes = routes.filter((r) => r.campus === campus);
    const fillTo: Record<string, number> = { "KC-rt-4": 9 }; // R-04 Bolan is full (9 of 9)
    let pi = 0;
    for (const r of campusRoutes) {
      const v = vehicles.find((x) => x.id === r.vehicleId)!;
      const want = fillTo[r.id] ?? (campus === "KC" ? Math.round(v.capacity * (0.22 + rnd(`${r.id}fill`) * 0.18)) : 2);
      for (let k = 0; k < want && pi < pool.length; k++, pi++) {
        const s = pool[pi]!;
        const stop = r.stops[k % r.stops.length]!;
        riders.push({ id: `${campus}-rd-${riders.length + 1}`, campus, type: "STUDENT", personId: s.grNo, routeId: r.id, stopId: stop.id, direction: rnd(`${s.grNo}dir`) < 0.12 ? "PICKUP" : "BOTH", fromDate: "2026-04-01", toDate: null, endReason: "", feeChargeIds: [] });
      }
    }
    if (campus === "KC") {
      // Staff riders (salary deduction) and one student who stopped using the van.
      riders.push({ id: "KC-rd-staff-1", campus, type: "STAFF", personId: "KC-T-0151", routeId: "KC-rt-3", stopId: "KC-rt-3-st2", direction: "BOTH", fromDate: "2026-04-01", toDate: null, endReason: "", feeChargeIds: [] });
      riders.push({ id: "KC-rd-staff-2", campus, type: "STAFF", personId: "KC-S-0144", routeId: "KC-rt-1", stopId: "KC-rt-1-st1", direction: "BOTH", fromDate: "2026-08-01", toDate: null, endReason: "", feeChargeIds: [] });
      const ended = pool[pi];
      if (ended) riders.push({ id: "KC-rd-ended-1", campus, type: "STUDENT", personId: ended.grNo, routeId: "KC-rt-2", stopId: "KC-rt-2-st2", direction: "BOTH", fromDate: "2026-04-01", toDate: "2026-09-30", endReason: "Family now drops the child", feeChargeIds: [] });
    }

    // Trips: last three school days for every route, plus one special trip at Khalid Campus.
    const days: IsoDate[] = ["2026-11-02", "2026-11-03", "2026-11-04"];
    for (const r of campusRoutes) {
      const v = vehicles.find((x) => x.id === r.vehicleId)!;
      let km = v.odometer - 120;
      const count = riders.filter((x) => x.routeId === r.id && !x.toDate).length;
      for (const d of days) {
        for (const dir of ["PICKUP", "DROP"] as const) {
          if (d === "2026-11-04" && dir === "DROP") continue;
          const dist = between(`${r.id}${d}${dir}km`, 14, 34);
          const first = r.stops[0]!;
          trips.push({
            id: `${campus}-trip-${trips.length + 1}`,
            campus,
            date: d,
            vehicleId: v.id,
            routeId: r.id,
            direction: dir,
            purpose: dir === "PICKUP" ? "Morning pickup" : "Afternoon drop",
            driverName: v.driverName,
            departAt: dir === "PICKUP" ? time(first.pickupTime, -10) : "13:35",
            arriveAt: dir === "PICKUP" ? "07:50" : time(first.dropTime, 5),
            startKm: km,
            endKm: km + dist,
            ridersPresent: Math.max(0, count - between(`${r.id}${d}${dir}abs`, 0, 2)),
            note: "",
          });
          km += dist;
        }
      }
      v.odometer = km;
    }
    if (campus === "KC") {
      const coaster = vehicles.find((x) => x.id === "KC-veh-5")!;
      trips.push({ id: `KC-trip-${trips.length + 1}`, campus, date: "2026-10-28", vehicleId: coaster.id, routeId: null, direction: "OTHER", purpose: "Science fair visit, Rahim Yar Khan", driverName: coaster.driverName, departAt: "08:30", arriveAt: "15:10", startKm: coaster.odometer - 900, endKm: coaster.odometer - 790, ridersPresent: 27, note: "Class 8 and 9 students with Mr Shahid Hussain." });
    }

    // Fuel: about twice a month per vehicle since August.
    for (const v of vehicles.filter((x) => x.campus === campus)) {
      let odo = v.odometer - 3600;
      for (const d of ["2026-08-06", "2026-08-21", "2026-09-05", "2026-09-19", "2026-10-03", "2026-10-17", "2026-10-31"]) {
        const date = workday(addDays(d, between(`${v.id}${d}`, 0, 3)));
        const litres = Math.round((v.capacity >= 22 ? 70 : v.capacity >= 12 ? 45 : 30) * (0.85 + rnd(`${v.id}${d}l`) * 0.3));
        const rate = v.type === "VAN" ? 272 : 285;
        odo += between(`${v.id}${d}km`, 380, 560);
        fuel.push({ id: `${campus}-fuel-${fuel.length + 1}`, campus, date, vehicleId: v.id, litres, amount: litres * rate, odometer: odo, station: campus === "HC" ? "PSO, Johar Town" : "PSO, Bypass Road", slipNo: `${between(`${v.id}${d}slip`, 10000, 99999)}`, enteredBy: campus === "KC" ? "Farah Naz" : "Transport office" });
      }
    }
  }
  return { vehicles, routes, riders, trips, fuel };
}
