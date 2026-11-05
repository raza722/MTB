import type { CampusCode, Cancellation, Charge, FeeStatusCode, PaymentMethod, Receipt, ReceiptLine } from "@mtb/api";
import { amountInWords, calculateLateFine, DEFAULT_LATE_FINE_POLICY, formatReceiptNo, type IsoDate, type IsoDateTime } from "@mtb/domain";
import { DEMO_TODAY } from "../clock";
import { createStore } from "../db";
import { campusOf, tuitionFor } from "../fixtures/campuses";
import { findStudent, type StudentRecord } from "../fixtures/students";

export const POLICY = DEFAULT_LATE_FINE_POLICY;

export interface FeesState {
  /** Materialised charges per student (generated on first use for students without fixtures). */
  charges: Record<string, Charge[]>;
  receipts: Record<string, Receipt>;
  /** Last receipt sequence used per campus in session 2026–27. */
  seq: Partial<Record<CampusCode, number>>;
  cnSeq: Partial<Record<CampusCode, number>>;
  /** Idempotency-Key → document number. */
  idem: Record<string, string>;
  /** Posted in this demo today, on top of the dashboard's base figures. */
  postedToday: Partial<Record<CampusCode, { amount: number; receipts: number }>>;
}

const charge = (grNo: string, id: string, session: number, head: string, amount: number, dueDate: IsoDate, settled: boolean): Charge => ({
  id: `${grNo}:${id}`,
  grNo,
  session,
  head,
  kind: "FEE",
  amount,
  dueDate,
  status: settled ? "SETTLED" : "OPEN",
  settledAmount: settled ? amount : 0,
});

/** Builds a posted receipt for fixtures (late fines computed at the posting date). */
function fixtureReceipt(s: StudentRecord, receiptNo: string, session: number, postedAt: IsoDateTime, charges: Charge[], payment: PaymentMethod & { change?: number }, cashier = "Usman Ali"): Receipt {
  const day = postedAt.slice(0, 10);
  const lines: ReceiptLine[] = charges.map((c) => {
    const lf = calculateLateFine(c.dueDate, day, POLICY);
    return { chargeId: c.id, head: c.head, dueDate: c.dueDate, amount: c.amount, daysOverdue: lf.daysOverdue, lateFine: lf.fine, lineTotal: c.amount + lf.fine, applied: c.amount + lf.fine };
  });
  const total = lines.reduce((a, l) => a + l.lineTotal, 0);
  const campus = campusOf(s.campus);
  return {
    receiptNo,
    campus: s.campus,
    campusName: campus.name,
    campusAddress: campus.address,
    session,
    grNo: s.grNo,
    studentName: s.name,
    ...(s.nameUr ? { studentNameUr: s.nameUr } : {}),
    relation: s.relation,
    father: s.father,
    classSection: s.classSection,
    cashier,
    postedAt,
    lines,
    total,
    amountInWords: amountInWords(total),
    payment,
    status: "POSTED",
    printCount: 1,
  };
}

function initial(): FeesState {
  const ayesha = findStudent("KC-14823")!;
  const hamza = findStudent("KC-15102")!;
  const fatima = findStudent("KC-14911")!;
  const areeba = findStudent("KC-14988")!;

  const a = (id: string, session: number, head: string, amount: number, due: IsoDate, settled: boolean) => charge(ayesha.grNo, id, session, head, amount, due, settled);
  const ayeshaCharges = [
    a("2025-ann", 2025, "Annual charges 2025–26", 3000, "2025-09-15", true),
    a("2025-mar", 2025, "Tuition fee – Mar 2026", 8000, "2026-03-10", true),
    a("ann", 2026, "Annual charges 2026–27", 3000, "2026-09-15", false),
    a("aug", 2026, "Tuition fee – Aug 2026", 8500, "2026-08-10", true),
    a("sep", 2026, "Tuition fee – Sep 2026", 8500, "2026-09-10", true),
    a("oct", 2026, "Tuition fee – Oct 2026", 8500, "2026-10-10", false),
    a("nov", 2026, "Tuition fee – Nov 2026", 8500, "2026-11-10", false),
  ];
  const find = (id: string) => ayeshaCharges.find((c) => c.id.endsWith(`:${id}`))!;

  const h = (id: string, head: string, amount: number, due: IsoDate) => charge(hamza.grNo, id, 2026, head, amount, due, true);
  const hamzaCharges = [
    h("ann", "Annual charges 2026–27", 3000, "2026-09-15"),
    h("aug", "Tuition fee – Aug 2026", 7000, "2026-08-10"),
    h("sep", "Tuition fee – Sep 2026", 7000, "2026-09-10"),
    h("oct", "Tuition fee – Oct 2026", 7000, "2026-10-10"),
    h("nov", "Tuition fee – Nov 2026", 7000, "2026-11-10"),
  ];

  const fatimaNov = charge(fatima.grNo, "nov", 2026, "Tuition fee – Nov 2026", 8500, "2026-11-10", true);
  const areebaNov = charge(areeba.grNo, "nov", 2026, "Tuition fee – Nov 2026", 8500, "2026-11-10", true);

  const receipts: Receipt[] = [
    fixtureReceipt(ayesha, "KC-2526-003310", 2025, "2025-09-12T11:20:00+05:00", [find("2025-ann")], { method: "CASH", received: 3000, change: 0 }),
    fixtureReceipt(ayesha, "KC-2526-011874", 2025, "2026-03-09T09:45:00+05:00", [find("2025-mar")], { method: "CASH", received: 8000, change: 0 }),
    fixtureReceipt(ayesha, "KC-2627-001902", 2026, "2026-08-08T10:12:00+05:00", [find("aug")], { method: "CASH", received: 9000, change: 500 }),
    fixtureReceipt(ayesha, "KC-2627-002877", 2026, "2026-09-12T12:31:00+05:00", [find("sep")], { method: "BANK", bank: "Meezan Bank", slipNo: "MZ-77120", depositDate: "2026-09-12" }),
    fixtureReceipt(hamza, "KC-2627-001903", 2026, "2026-08-08T10:15:00+05:00", hamzaCharges.slice(0, 2), { method: "CASH", received: 10000, change: 0 }),
    fixtureReceipt(hamza, "KC-2627-002640", 2026, "2026-09-08T11:02:00+05:00", hamzaCharges.slice(2, 3), { method: "CASH", received: 7000, change: 0 }),
    fixtureReceipt(hamza, "KC-2627-003511", 2026, "2026-10-08T09:40:00+05:00", hamzaCharges.slice(3, 5), { method: "CASH", received: 14000, change: 0 }),
    fixtureReceipt(fatima, "KC-2627-004790", 2026, "2026-11-03T10:05:00+05:00", [fatimaNov], { method: "CASH", received: 8500, change: 0 }),
    fixtureReceipt(areeba, "KC-2627-004806", 2026, "2026-11-04T08:51:00+05:00", [areebaNov], { method: "CASH", received: 10000, change: 1500 }),
  ];

  // Two cancellations already waiting for the principal (dashboard: "2 receipt cancellations").
  const pending: Array<[string, Cancellation]> = [
    [
      "KC-2627-004790",
      { cnNo: "KC-CN-2627-000035", receiptNo: "KC-2627-004790", reason: "DUPLICATE_PAYMENT", note: "Father also paid November at Meezan Bank; slip seen on 03-Nov.", requestedBy: "Usman Ali", requestedAt: "2026-11-03T15:20:00+05:00", status: "PENDING" },
    ],
    [
      "KC-2627-004806",
      { cnNo: "KC-CN-2627-000036", receiptNo: "KC-2627-004806", reason: "WRONG_AMOUNT", note: "Sibling concession of Rs 850 was not applied before posting.", requestedBy: "Usman Ali", requestedAt: "2026-11-04T09:12:00+05:00", status: "PENDING" },
    ],
  ];
  for (const [no, cn] of pending) {
    const r = receipts.find((x) => x.receiptNo === no)!;
    r.status = "CANCEL_PENDING";
    r.cancellation = cn;
  }

  return {
    charges: {
      [ayesha.grNo]: ayeshaCharges,
      [hamza.grNo]: hamzaCharges,
      [fatima.grNo]: [charge(fatima.grNo, "ann", 2026, "Annual charges 2026–27", 3000, "2026-09-15", true), fatimaNov],
      [areeba.grNo]: [charge(areeba.grNo, "ann", 2026, "Annual charges 2026–27", 3000, "2026-09-15", true), areebaNov],
    },
    receipts: Object.fromEntries(receipts.map((r) => [r.receiptNo, r])),
    seq: { KC: 4820, SM: 1310, UC: 2204, MC: 980, HC: 3127 },
    cnSeq: { KC: 36, SM: 4, UC: 7, MC: 2, HC: 9 },
    idem: {},
    postedToday: {},
  };
}

export const feesStore = createStore<FeesState>("fees", initial);

const MONTHS: Array<[string, IsoDate]> = [
  ["Aug 2026", "2026-08-10"],
  ["Sep 2026", "2026-09-10"],
  ["Oct 2026", "2026-10-10"],
  ["Nov 2026", "2026-11-10"],
];

/** Charges for a student, generated (with matching receipts) the first time a student without fixtures is opened. */
export function chargesOf(grNo: string): Charge[] {
  const state = feesStore.get();
  const existing = state.charges[grNo];
  if (existing) return existing;
  const s = findStudent(grNo);
  if (!s) return [];

  const tuition = tuitionFor(s.classSection.split("-")[0] ?? "");
  let list: Charge[];
  const receipts: Receipt[] = [];
  if (s.status === "LEFT") {
    list = [charge(s.grNo, "2025-jun", 2025, "Tuition fee – Jun 2026", s.balance || tuition, "2026-06-10", false)];
  } else {
    const openFrom = s.feeStatus === "overdue" ? 2 : s.feeStatus === "unpaid" ? 3 : 4; // index of first unpaid month
    list = [charge(s.grNo, "ann", 2026, "Annual charges 2026–27", 3000, "2026-09-15", true), ...MONTHS.map(([m, due], i) => charge(s.grNo, m.slice(0, 3).toLowerCase(), 2026, `Tuition fee – ${m}`, tuition, due, i < openFrom))];
    // One receipt per paid month, posted two days before the due date, so the ledger shows where each payment went.
    // Numbers skip any already issued, so a generated receipt can never overwrite a fixture or posted one.
    let n = 1000 + (Number(s.grNo.replace(/\D/g, "")) % 900);
    const prefix = campusOf(s.campus).docPrefix;
    const taken = new Set(Object.keys(state.receipts));
    const nextFree = () => {
      do n += 7;
      while (taken.has(formatReceiptNo(prefix, 2026, n)));
      taken.add(formatReceiptNo(prefix, 2026, n));
      return n;
    };
    for (const c of list.filter((x) => x.status === "SETTLED")) {
      nextFree();
      // Two days before the due date, but never later than the demo's yesterday (a paid November is paid already).
      const day = new Date(`${c.dueDate}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() - 2);
      const iso = day.toISOString().slice(0, 10);
      const posted = `${iso < DEMO_TODAY ? iso : "2026-11-02"}T10:30:00+05:00`;
      receipts.push(fixtureReceipt(s, formatReceiptNo(prefix, 2026, n), 2026, posted, [c], { method: "CASH", received: c.amount, change: 0 }));
    }
  }
  feesStore.set((st) => ({
    ...st,
    charges: { ...st.charges, [grNo]: list },
    receipts: { ...st.receipts, ...Object.fromEntries(receipts.map((r) => [r.receiptNo, r])) },
  }));
  return list;
}

/** Balance and status, always calculated from the charges. */
export function financeOf(grNo: string): { balance: number; feeStatus: FeeStatusCode } {
  const list = chargesOf(grNo);
  const open = list.filter((c) => c.status === "OPEN");
  const balance = open.reduce((a, c) => a + c.amount - c.settledAmount, 0);
  const overdue = open.some((c) => c.dueDate < DEMO_TODAY);
  return { balance, feeStatus: balance === 0 ? "paid" : overdue ? "overdue" : "unpaid" };
}

export function receiptsOf(grNo: string): Receipt[] {
  chargesOf(grNo);
  return Object.values(feesStore.get().receipts).filter((r) => r.grNo === grNo);
}
