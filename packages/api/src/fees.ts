import type { IsoDate, IsoDateTime, LateFinePolicy, Rupees } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ctxKey, type CampusCode, type Ctx } from "./context";
import type { StudentSummary } from "./students";

export interface Charge {
  id: string;
  grNo: string;
  session: number;
  /** "Tuition fee – Oct 2026" */
  head: string;
  kind: "FEE" | "LATE_FINE";
  amount: Rupees;
  dueDate: IsoDate;
  status: "OPEN" | "SETTLED" | "CANCELLED";
  /** Paid so far (partial-payment variant). */
  settledAmount: Rupees;
  /** One-off charge added by the office: head code ("READMISSION") and the reason given. */
  headCode?: string;
  note?: string;
  addedBy?: string;
  addedAt?: IsoDateTime;
  /** A request to cancel this unpaid charge; the principal decides. */
  cancelRequest?: ChargeCancelRequest;
}

export interface ChargeCancelRequest {
  id: string;
  reason: string;
  requestedBy: string;
  requestedAt: IsoDateTime;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decidedBy?: string;
  decidedAt?: IsoDateTime;
}

/** Put a one-off charge of any fee head on one student's ledger. */
export interface AddChargeRequest {
  /** Fee head code ("READMISSION", "SUBJECT_CHANGE" …). */
  head: string;
  /** Whole rupees, the total before any split. */
  amount: Rupees;
  /** Due date of the first (or only) part. */
  dueDate: IsoDate;
  /** Why it is charged; shown on the ledger. */
  note: string;
  /** Split into this many monthly parts (whole rupees; the last part takes the remainder). */
  installments?: number;
}

/** Splits a total into n whole-rupee parts; the last part takes the remainder so they add up exactly. */
export function splitRupees(total: Rupees, n: number): Rupees[] {
  const parts = Math.max(1, Math.floor(n));
  const each = Math.floor(total / parts);
  return Array.from({ length: parts }, (_, i) => (i === parts - 1 ? total - each * (parts - 1) : each));
}

export interface CounterData {
  student: StudentSummary;
  /** Open charges, oldest first, including ones not yet due. */
  charges: Charge[];
  /** Server's rule; the browser uses it only for the live preview. */
  policy: LateFinePolicy;
  today: IsoDate;
  /** Set when the student is no longer enrolled (left, struck off, expelled, passed out): collect outstanding dues only. */
  left?: { on: IsoDate; reason: string; status?: "LEFT" | "STRUCK_OFF" | "EXPELLED" | "PASSED_OUT" };
}

export type PaymentMethod =
  | { method: "CASH"; received: Rupees }
  | { method: "BANK"; bank: string; slipNo: string; depositDate: IsoDate }
  | { method: "CHEQUE"; chequeNo: string; bank: string; chequeDate: IsoDate }
  | { method: "ONLINE"; transactionId: string };

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod["method"], string> = {
  CASH: "Cash",
  BANK: "Bank deposit",
  CHEQUE: "Cheque",
  ONLINE: "Online transfer / Raast",
};

export interface PostReceiptRequest {
  grNo: string;
  campus: CampusCode;
  session: number;
  chargeIds: string[];
  /** Partial-payment variant only ("not yet decided"). Omit to pay the selected charges in full. */
  amount?: Rupees;
  payment: PaymentMethod;
  /** Who paid at the counter (defaults to the guardian). */
  paidBy?: string;
  /** Remarks printed on the receipt. */
  note?: string;
}

export interface ReceiptLine {
  chargeId: string;
  head: string;
  dueDate: IsoDate;
  amount: Rupees;
  daysOverdue: number;
  lateFine: Rupees;
  lineTotal: Rupees;
  /** What this receipt paid towards the line (equals lineTotal unless partially paid). */
  applied: Rupees;
}

export type CancelReason = "WRONG_STUDENT" | "WRONG_AMOUNT" | "DUPLICATE_PAYMENT" | "CHEQUE_BOUNCED" | "OTHER";

export const CANCEL_REASON_LABEL: Record<CancelReason, string> = {
  WRONG_STUDENT: "Wrong student",
  WRONG_AMOUNT: "Wrong amount",
  DUPLICATE_PAYMENT: "Duplicate payment",
  CHEQUE_BOUNCED: "Cheque bounced",
  OTHER: "Other",
};

export interface Cancellation {
  cnNo: string;
  receiptNo: string;
  reason: CancelReason;
  note: string;
  requestedBy: string;
  requestedAt: IsoDateTime;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decidedBy?: string;
  decidedAt?: IsoDateTime;
}

export interface Receipt {
  receiptNo: string;
  campus: CampusCode;
  campusName: string;
  campusAddress: string;
  session: number;
  grNo: string;
  studentName: string;
  studentNameUr?: string;
  relation: "s/o" | "d/o";
  father: string;
  classSection: string;
  cashier: string;
  postedAt: IsoDateTime;
  lines: ReceiptLine[];
  total: Rupees;
  amountInWords: string;
  payment: PaymentMethod & { change?: Rupees };
  status: "POSTED" | "CANCEL_PENDING" | "CANCELLED";
  cancellation?: Cancellation;
  /** 0 until the original is printed; later prints are marked DUPLICATE. */
  printCount: number;
  /** Who paid at the counter, when it was not the guardian on record. */
  paidBy?: string;
  /** Remarks typed by the cashier. */
  note?: string;
  /** The campus's receipt notes from Setup → Campus settings (fee not refundable …), printed at the foot. */
  policyNotes?: string[];
}

export type LedgerDocType = "CHARGE" | "LATE_FINE" | "RECEIPT" | "CANCELLATION";

export interface LedgerEntry {
  id: string;
  date: IsoDate;
  docType: LedgerDocType;
  docNo?: string;
  description: string;
  charge: Rupees;
  payment: Rupees;
  /** Running balance after this entry. Calculated, never typed. */
  balance: Rupees;
  chargeId?: string;
  receiptNo?: string;
  /** Receipts: the charges this receipt paid. */
  allocations?: Array<{ chargeId: string; head: string; amount: Rupees }>;
  /** Charges: the receipts that covered it. */
  coveredBy?: Array<{ receiptNo: string; amount: Rupees }>;
  cancelled?: boolean;
  /** Charges: paid, part paid or still payable (from the receipts that covered it). */
  settled?: "PAID" | "PART_PAID" | "PAYABLE";
  /** Charges: the day the last receipt covering it was posted. */
  paidOn?: IsoDate;
  /** Charges: still to pay on it. */
  due?: Rupees;
  /** Charges: due date (the entry's date is the due date too). */
  dueDate?: IsoDate;
  /** Charges: added by hand at the office (a one-off charge), so it can be cancelled with approval. */
  oneOff?: boolean;
  /** Charges: a cancellation waiting for the principal. */
  cancelPending?: boolean;
}

export interface Ledger {
  grNo: string;
  session: number;
  entries: LedgerEntry[];
  balance: Rupees;
  /** Overdue part of the balance. */
  arrears: Rupees;
}

export const feesApi = {
  counter: (ctx: Ctx, grNo: string) => apiFetch<CounterData>(`/fees/students/${encodeURIComponent(grNo)}/charges`, { query: { session: ctx.session } }),
  postReceipt: (body: PostReceiptRequest, idempotencyKey: string) => apiFetch<Receipt>("/fees/receipts", { method: "POST", body, idempotencyKey }),
  receipt: (receiptNo: string) => apiFetch<Receipt>(`/fees/receipts/${encodeURIComponent(receiptNo)}`),
  markPrinted: (receiptNo: string) => apiFetch<{ printCount: number }>(`/fees/receipts/${encodeURIComponent(receiptNo)}/print`, { method: "POST" }),
  smsReceipt: (receiptNo: string) => apiFetch<{ status: "QUEUED"; to: string }>(`/fees/receipts/${encodeURIComponent(receiptNo)}/sms`, { method: "POST" }),
  requestCancellation: (receiptNo: string, body: { reason: CancelReason; note: string }, idempotencyKey: string) =>
    apiFetch<Cancellation>(`/fees/receipts/${encodeURIComponent(receiptNo)}/cancel`, { method: "POST", body, idempotencyKey }),
  ledger: (grNo: string, session: number | "ALL") => apiFetch<Ledger>(`/fees/students/${encodeURIComponent(grNo)}/ledger`, { query: { session } }),
  /** One-off charge (or a split into parts) on one student's ledger. */
  addCharge: (grNo: string, body: AddChargeRequest, idempotencyKey: string) =>
    apiFetch<{ charges: Charge[] }>(`/fees/students/${encodeURIComponent(grNo)}/charges`, { method: "POST", body, idempotencyKey }),
  /** Ask to cancel an unpaid charge; the principal approves it like a receipt cancellation. */
  cancelCharge: (chargeId: string, body: { reason: string }, idempotencyKey: string) =>
    apiFetch<Charge>(`/fees/charges/${encodeURIComponent(chargeId)}/cancel`, { method: "POST", body, idempotencyKey }),
};

export const feesQueries = {
  counter: (ctx: Ctx, grNo: string) => queryOptions({ queryKey: ["fees", ...ctxKey(ctx), "counter", grNo], queryFn: () => feesApi.counter(ctx, grNo), enabled: grNo !== "" }),
  receipt: (receiptNo: string) => queryOptions({ queryKey: ["fees", "receipt", receiptNo], queryFn: () => feesApi.receipt(receiptNo) }),
  ledger: (grNo: string, session: number | "ALL") => queryOptions({ queryKey: ["fees", "ledger", grNo, session], queryFn: () => feesApi.ledger(grNo, session) }),
};
