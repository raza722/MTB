// accounts API — owned by the accounts feature: chart of accounts, vouchers (JV, cash and bank), ledgers, trial balance,
// statements, fee-collection posting, bank reconciliation and period close.
// One shared chart with campus as a dimension (modernization doc 30, section d): every voucher belongs to one campus and
// must balance. Posted vouchers never change; a correction is a reversing voucher. Money is whole rupees.
import type { IsoDate, IsoDateTime, Rupees } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type CampusScope, type Ctx } from "./context";

/* ================================================================== Chart of accounts */

export type AccountsClass = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

export const ACCOUNTS_CLASS_LABEL: Record<AccountsClass, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Equity",
  INCOME: "Income",
  EXPENSE: "Expenses",
};

/** Cash and bank accounts are the ones cash and bank vouchers pay from or receive into. */
export type AccountsKind = "CASH" | "BANK" | "OTHER";

/** Control accounts are fed by another part of the system; cash and bank vouchers can't post to them. */
export type AccountsControl = "FEE_OFFICE" | "PAYROLL";

export const ACCOUNTS_CONTROL_LABEL: Record<AccountsControl, string> = {
  FEE_OFFICE: "Fee office",
  PAYROLL: "Payroll",
};

export interface AccountsBankInfo {
  bankName: string;
  branch: string;
  /** Only the last four digits are ever shown: "•••• 4417". */
  accountNoMasked: string;
}

export interface AccountsAccount {
  /** Hierarchical code: class "4", group "41", account "4105". */
  code: string;
  name: string;
  accountClass: AccountsClass;
  parentCode: string | null;
  /** Only accounts without sub-accounts take postings. */
  postable: boolean;
  normalSide: "DEBIT" | "CREDIT";
  /** Set only for accounts that belong to one campus (a bank account). */
  campus?: CampusCode;
  kind: AccountsKind;
  control?: AccountsControl;
  bank?: AccountsBankInfo;
  active: boolean;
  /** Something has been posted to it: its code and campus can no longer change. */
  used: boolean;
  /**
   * Net debit at the requested campus scope (debits minus credits), whole rupees, as at today (or the session's last
   * day for a past session). Positive = Dr, negative = Cr. Groups are the sum of their children. Calculated, never typed.
   */
  netDebit: Rupees;
  /** One line shown under the name, e.g. why a migration account exists. */
  note?: string;
}

export interface AccountsNewAccountInput {
  parentCode: string;
  code: string;
  name: string;
  /**
   * Under a group: true (the default) makes an account that takes postings, false a sub-group. Under a class it is
   * always a group. A group that already has accounts under it can't also get a sub-group.
   */
  postable?: boolean;
  /** The side its balance normally sits on. Defaults to the parent's; the other side makes a contra account. */
  normalSide?: "DEBIT" | "CREDIT";
  /** Omit for an account used by all campuses. */
  campus?: CampusCode;
  kind?: AccountsKind;
  bank?: AccountsBankInfo;
  note?: string;
}

export interface AccountsAccountUpdate {
  name?: string;
  note?: string;
  /** null = all campuses. Only for accounts nothing has been posted to. */
  campus?: CampusCode | null;
  active?: boolean;
  bank?: AccountsBankInfo;
}

/* ================================================================== Vouchers */

export type AccountsVoucherType = "JV" | "CP" | "CR" | "BP" | "BR" | "FEE" | "FEE_CANCEL" | "OPENING";
/** Vouchers people enter by hand. The others are posted by the system. */
export type AccountsManualType = "JV" | "CP" | "CR" | "BP" | "BR";

export const ACCOUNTS_MANUAL_TYPES: AccountsManualType[] = ["JV", "CP", "CR", "BP", "BR"];

export const ACCOUNTS_VOUCHER_TYPE_LABEL: Record<AccountsVoucherType, string> = {
  JV: "Journal voucher",
  CP: "Cash payment",
  CR: "Cash receipt",
  BP: "Bank payment",
  BR: "Bank receipt",
  FEE: "Fee collection",
  FEE_CANCEL: "Receipt cancellation",
  OPENING: "Opening balances",
};

/** Two-letter code printed in the voucher number: KC-BP-2627-000031. */
export const ACCOUNTS_VOUCHER_CODE: Record<AccountsVoucherType, string> = { JV: "JV", CP: "CP", CR: "CR", BP: "BP", BR: "BR", FEE: "FB", FEE_CANCEL: "FC", OPENING: "OB" };

/**
 * DRAFT → (cash and bank vouchers) SUBMITTED → APPROVED → POSTED → REVERSED.
 * A journal voucher is posted straight from DRAFT by the accountant. A rejected voucher goes back to DRAFT with the reason.
 */
export type AccountsVoucherStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "POSTED" | "REVERSED";

export const ACCOUNTS_STATUS_LABEL: Record<AccountsVoucherStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Waiting for approval",
  APPROVED: "Approved",
  POSTED: "Posted",
  REVERSED: "Reversed",
};

export interface AccountsJournalLine {
  id: string;
  accountCode: string;
  /** Filled in by the server for display. */
  accountName?: string;
  description: string;
  debit: Rupees;
  credit: Rupees;
  /** The cash or bank line of a cash/bank voucher, added by the server from the voucher's header. */
  contra?: boolean;
}

export interface AccountsCheque {
  /** Cheque number, transfer reference or deposit slip number. */
  number: string;
  date: IsoDate;
}

export type AccountsVoucherAction = "CREATED" | "EDITED" | "SUBMITTED" | "APPROVED" | "REJECTED" | "POSTED" | "REVERSED";

export interface AccountsVoucherEvent {
  action: AccountsVoucherAction;
  by: string;
  at: IsoDateTime;
  note?: string;
}

export type AccountsVoucherSource =
  | { kind: "FEE_BATCH"; date: IsoDate; receipts: number; supplement?: boolean }
  | { kind: "RECEIPT_CANCELLATION"; receiptNo: string; cnNo: string; studentName: string }
  | { kind: "OPENING" };

export interface AccountsVoucher {
  id: string;
  type: AccountsVoucherType;
  /** Issued on posting, gap-free per campus, type and session: "KC-JV-2627-000214". Null until posted. */
  voucherNo: string | null;
  campus: CampusCode;
  campusName: string;
  session: number;
  date: IsoDate;
  narration: string;
  lines: AccountsJournalLine[];
  status: AccountsVoucherStatus;
  totalDebit: Rupees;
  totalCredit: Rupees;
  /** Cash and bank vouchers: the cash or bank account paid from or received into. */
  cashBankAccount?: string;
  /** "Paid to" on payments, "Received from" on receipts. */
  party?: string;
  /** Bill, invoice or the old manual voucher number. */
  reference?: string;
  /** Bank vouchers: cheque, transfer or deposit slip. */
  cheque?: AccountsCheque;
  createdBy: string;
  updatedAt: IsoDateTime;
  submittedBy?: string;
  submittedAt?: IsoDateTime;
  approvedBy?: string;
  approvedAt?: IsoDateTime;
  postedBy?: string;
  postedAt?: IsoDateTime;
  /** Set while a rejected voucher waits to be corrected. */
  rejection?: { by: string; at: IsoDateTime; reason: string };
  /** On a reversed voucher: the voucher that reversed it. */
  reversal?: { voucherId: string; voucherNo: string; reason: string; by: string; at: IsoDateTime };
  /** On a reversing voucher: the voucher it reverses. */
  reverses?: { voucherId: string; voucherNo: string };
  /** Posted by the system (fee office, opening balances): read-only. */
  system: boolean;
  source?: AccountsVoucherSource;
  history: AccountsVoucherEvent[];
}

/** The original name; every voucher type uses the same shape. */
export type AccountsJournal = AccountsVoucher;

export interface AccountsVoucherInput {
  type: AccountsManualType;
  campus: CampusCode;
  session: number;
  date: IsoDate;
  narration: string;
  /**
   * Journal vouchers: every line. Cash and bank vouchers: the other side only (debits on a payment, credits on a
   * receipt); the server adds the cash or bank line.
   */
  lines: Array<Omit<AccountsJournalLine, "id" | "accountName" | "contra">>;
  cashBankAccount?: string;
  party?: string;
  reference?: string;
  cheque?: AccountsCheque;
}

export type AccountsJournalInput = AccountsVoucherInput;

/** One row of the voucher list (no lines). */
export interface AccountsVoucherRow {
  id: string;
  type: AccountsVoucherType;
  voucherNo: string | null;
  campus: CampusCode;
  campusName: string;
  date: IsoDate;
  narration: string;
  party?: string;
  amount: Rupees;
  totalDebit: Rupees;
  totalCredit: Rupees;
  status: AccountsVoucherStatus;
  system: boolean;
  lineCount: number;
  createdBy: string;
  postedBy?: string;
  rejected: boolean;
}

export type AccountsStatusFilter = AccountsVoucherStatus | "ALL";
export type AccountsTypeFilter = AccountsVoucherType | "ALL" | "MANUAL" | "SYSTEM";

export interface AccountsVoucherFilters {
  type?: AccountsTypeFilter;
  status?: AccountsStatusFilter;
  from?: IsoDate;
  to?: IsoDate;
  /** Voucher number, narration, party, cheque or an amount. */
  q?: string;
  /** Vouchers with a line on this account. */
  account?: string;
  page?: number;
  pageSize?: number;
}

export interface AccountsPaged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AccountsVoucherList extends AccountsPaged<AccountsVoucherRow> {
  /** Counts per status for the current filters other than status. */
  counts: Record<AccountsStatusFilter, number>;
}

/* ================================================================== Ledger, trial balance, statements */

export interface AccountsLedgerLine {
  key: string;
  date: IsoDate;
  voucherId: string;
  voucherNo: string;
  type: AccountsVoucherType;
  campus: CampusCode;
  narration: string;
  description: string;
  /** The voucher's bill, invoice or old manual number (fee batches: the batch's day). */
  reference?: string;
  /** Bank vouchers: the cheque, transfer or deposit slip number. */
  cheque?: string;
  /** Set on a combined book (all banks): the account the line was posted to. */
  accountCode?: string;
  accountName?: string;
  debit: Rupees;
  credit: Rupees;
  /** Running net debit after this line. */
  balance: Rupees;
}

/** Ask for this instead of an account code to get every bank account in one book. */
export const ACCOUNTS_ALL_BANKS = "BANK";

export interface AccountsLedger {
  /** For the combined bank book: a stand-in with code "BANK" and the sum of the bank balances. */
  account: AccountsAccount;
  /** Combined bank book only: the bank accounts it covers. */
  accounts?: Array<{ code: string; name: string }>;
  from: IsoDate;
  to: IsoDate;
  /** Net debit before `from` (session opening plus earlier movements). */
  opening: Rupees;
  lines: AccountsLedgerLine[];
  totalDebit: Rupees;
  totalCredit: Rupees;
  closing: Rupees;
  /** Closing balance at the end of each day with movement, for the chart. */
  trend: Array<{ date: IsoDate; balance: Rupees }>;
}

export interface AccountsTrialRow {
  code: string;
  name: string;
  accountClass: AccountsClass;
  parentCode: string | null;
  postable: boolean;
  /** 0 = class, 1 = group, 2 = sub-group or account under a group, and so on. */
  depth: number;
  /** Net debit before `from` (the session opening plus anything posted between the session start and `from`). */
  opening: Rupees;
  /** Movement from `from` to `asOf`. */
  debit: Rupees;
  credit: Rupees;
  /** Net debit at `asOf`. */
  closing: Rupees;
  note?: string;
}

export interface AccountsTrialBalance {
  /** Start of the movement columns: the session start unless a period was asked for. */
  from: IsoDate;
  asOf: IsoDate;
  sessionStart: IsoDate;
  campus: CampusScope;
  rows: AccountsTrialRow[];
  totals: { openingDebit: Rupees; openingCredit: Rupees; debit: Rupees; credit: Rupees; closingDebit: Rupees; closingCredit: Rupees };
  balanced: boolean;
  difference: Rupees;
  vouchers: number;
}

export interface AccountsStatementGroup {
  code: string;
  name: string;
  amount: Rupees;
  accounts: Array<{ code: string; name: string; amount: Rupees }>;
}

export interface AccountsIncomeExpenditure {
  from: IsoDate;
  to: IsoDate;
  income: AccountsStatementGroup[];
  expenses: AccountsStatementGroup[];
  totalIncome: Rupees;
  totalExpenses: Rupees;
  surplus: Rupees;
  months: Array<{ month: string; income: Rupees; expenses: Rupees }>;
  /** Only for "All campuses". */
  campuses?: Array<{ campus: CampusCode; campusName: string; income: Rupees; expenses: Rupees; surplus: Rupees }>;
}

export interface AccountsBalanceSheet {
  asOf: IsoDate;
  assets: AccountsStatementGroup[];
  liabilities: AccountsStatementGroup[];
  equity: AccountsStatementGroup[];
  /** Income less expenses from the session start to `asOf`, shown under equity. */
  surplusThisSession: Rupees;
  totalAssets: Rupees;
  totalLiabilities: Rupees;
  totalEquity: Rupees;
  balanced: boolean;
  /** Memo: unpaid fees in the fee office. The books are kept on a cash basis, so these are not an asset here. */
  feeArrears: Rupees;
}

/* ================================================================== Fee collection posting */

export type AccountsFeeBatchStatus = "POSTED" | "DIFFERENCE" | "OPEN";

export interface AccountsFeeBatch {
  key: string;
  campus: CampusCode;
  campusName: string;
  date: IsoDate;
  receipts: number;
  /** What the fee office's daily collection report says. */
  feeOfficeTotal: Rupees;
  /** What fee batches posted to the ledger for the day. */
  ledgerTotal: Rupees;
  /** feeOfficeTotal − ledgerTotal. */
  difference: Rupees;
  status: AccountsFeeBatchStatus;
  vouchers: Array<{ id: string; voucherNo: string; amount: Rupees; supplement: boolean }>;
  postedAt?: IsoDateTime;
  postedBy?: string;
  cash: Rupees;
  bank: Rupees;
  /** Receipt cancellations for receipts of this day. */
  cancellations: { pending: number; pendingAmount: Rupees; approved: number; approvedAmount: Rupees };
  note?: string;
}

export interface AccountsFeeBatchDetail extends AccountsFeeBatch {
  heads: Array<{ head: string; title: string; accountCode: string; accountName: string; amount: Rupees }>;
  methods: Array<{ method: "CASH" | "BANK" | "ONLINE" | "CHEQUE"; label: string; amount: Rupees; accountCode: string; accountName: string }>;
  cancellationList: Array<{ receiptNo: string; cnNo: string; studentName: string; amount: Rupees; status: "PENDING" | "APPROVED"; voucherNo?: string }>;
}

export interface AccountsFeeMonth {
  month: string;
  batches: AccountsFeeBatch[];
  totals: { feeOffice: Rupees; ledger: Rupees; difference: Rupees; days: number; posted: number; differences: number; open: number };
}

export interface AccountsPostingRule {
  head: string;
  title: string;
  category: "FEE" | "FINE" | "APPLICATION" | "PAYMENT";
  accountCode: string;
  accountName: string;
  note?: string;
}

/* ================================================================== Bank reconciliation */

export interface AccountsBankAccount {
  code: string;
  name: string;
  campus: CampusCode;
  campusName: string;
  bank: AccountsBankInfo;
  bookBalance: Rupees;
  /** Statement balance at the last imported statement line. */
  statementBalance: Rupees;
  statementTo: IsoDate;
  unmatched: number;
  /** Latest month signed off as reconciled, "2026-09". */
  lastSignedOff: string | null;
}

export interface AccountsStatementLine {
  id: string;
  date: IsoDate;
  description: string;
  reference: string;
  /** Money out of the bank (a cheque paid, a charge). */
  debit: Rupees;
  /** Money into the bank (a deposit, profit). */
  credit: Rupees;
  /** Key of the book line it is matched to. */
  matchedTo: string | null;
  /** Unmatched lines: the book line with the same amount closest in date. */
  suggested: string | null;
}

export interface AccountsBookLine {
  key: string;
  voucherId: string;
  voucherNo: string;
  date: IsoDate;
  description: string;
  /** Into the bank (Dr in the books). */
  debit: Rupees;
  /** Out of the bank (Cr in the books). */
  credit: Rupees;
  matchedTo: string | null;
  /** From an earlier month, still waiting to appear on the statement. */
  carried: boolean;
}

export interface AccountsBankRec {
  account: AccountsBankAccount;
  month: string;
  months: string[];
  statementTo: IsoDate;
  statementOpening: Rupees;
  statementClosing: Rupees;
  bookClosing: Rupees;
  statement: AccountsStatementLine[];
  book: AccountsBookLine[];
  summary: {
    /** In the books, not yet on the statement. */
    depositsInTransit: Rupees;
    chequesNotPresented: Rupees;
    /** On the statement, not yet in the books. */
    bankCreditsNotBooked: Rupees;
    bankDebitsNotBooked: Rupees;
    adjustedStatement: Rupees;
    difference: Rupees;
    unmatchedStatement: number;
    unmatchedBook: number;
    suggestions: number;
  };
  signedOff?: { by: string; at: IsoDateTime };
  canSignOff: boolean;
}

/* ================================================================== Periods */

export type AccountsPeriodStatus = "OPEN" | "CLOSED" | "FUTURE";

export interface AccountsPeriodCheck {
  key: "ENDED" | "EARLIER" | "FEES" | "VOUCHERS" | "BANK" | "BALANCED";
  label: string;
  ok: boolean;
  detail: string;
  /** Where to fix it: an accounts page path and its search. */
  link?: { to: string; search?: Record<string, string> };
}

export interface AccountsPeriod {
  campus: CampusCode;
  campusName: string;
  month: string;
  status: AccountsPeriodStatus;
  closedBy?: string;
  closedAt?: IsoDateTime;
  reopened?: { by: string; at: IsoDateTime; reason: string };
  checks: AccountsPeriodCheck[];
  canClose: boolean;
  /** Only the latest closed month can be reopened. */
  canReopen: boolean;
}

/* ================================================================== Overview */

export interface AccountsOverview {
  asOf: IsoDate;
  cashBank: {
    cash: Rupees;
    bank: Rupees;
    total: Rupees;
    accounts: Array<{ code: string; name: string; campus?: CampusCode; kind: AccountsKind; balance: Rupees; trend: Rupees[] }>;
    trend: Array<{ date: IsoDate; balance: Rupees }>;
  };
  month: { month: string; income: Rupees; expenses: Rupees; surplus: Rupees };
  sessionToDate: { income: Rupees; expenses: Rupees; surplus: Rupees };
  attention: {
    outOfBalance: Array<{ id: string; narration: string; difference: Rupees; campusName: string; type: AccountsVoucherType }>;
    drafts: number;
    waitingApproval: number;
    approved: number;
    rejected: number;
    feeDifferences: Array<{ campus: CampusCode; campusName: string; date: IsoDate; difference: Rupees }>;
    openFeeBatches: Array<{ campus: CampusCode; campusName: string; amount: Rupees; receipts: number }>;
    unmatchedBank: number;
    cashToDeposit: Rupees;
    periodsToClose: Array<{ campus: CampusCode; campusName: string; month: string }>;
  };
  recent: AccountsVoucherRow[];
}

/* ================================================================== Client */

const enc = encodeURIComponent;

export const accountsApi = {
  overview: (ctx: Ctx) => apiFetch<AccountsOverview>("/accounts/overview", { query: ctxQuery(ctx) }),

  chart: (ctx: Ctx) => apiFetch<AccountsAccount[]>("/accounts/chart", { query: ctxQuery(ctx) }),
  addAccount: (body: AccountsNewAccountInput) => apiFetch<AccountsAccount>("/accounts/chart", { method: "POST", body }),
  updateAccount: (code: string, body: AccountsAccountUpdate) => apiFetch<AccountsAccount>(`/accounts/chart/${enc(code)}`, { method: "PATCH", body }),

  vouchers: (ctx: Ctx, f: AccountsVoucherFilters) => apiFetch<AccountsVoucherList>("/accounts/vouchers", { query: { ...ctxQuery(ctx), ...f } }),
  voucher: (id: string) => apiFetch<AccountsVoucher>(`/accounts/vouchers/${enc(id)}`),
  /** Creates a draft, or updates one when `id` is given. Drafts may be out of balance. */
  saveDraft: (body: AccountsVoucherInput, id?: string) =>
    apiFetch<AccountsVoucher>(id ? `/accounts/vouchers/${enc(id)}` : "/accounts/vouchers", { method: id ? "PUT" : "POST", body }),
  discard: (id: string) => apiFetch<{ status: "ok" }>(`/accounts/vouchers/${enc(id)}`, { method: "DELETE" }),
  /** Cash and bank vouchers: saves the final version and sends it for approval. */
  submit: (id: string, body: AccountsVoucherInput) => apiFetch<AccountsVoucher>(`/accounts/vouchers/${enc(id)}/submit`, { method: "POST", body }),
  approve: (id: string, note?: string) => apiFetch<AccountsVoucher>(`/accounts/vouchers/${enc(id)}/approve`, { method: "POST", body: { note: note ?? "" } }),
  reject: (id: string, reason: string) => apiFetch<AccountsVoucher>(`/accounts/vouchers/${enc(id)}/reject`, { method: "POST", body: { reason } }),
  /**
   * Journal vouchers: saves the final lines and posts in one step (`body` required; id "new" posts without a draft).
   * Approved cash and bank vouchers: posts as approved (no body). The server rejects it unless debits equal credits.
   */
  post: (id: string, body: AccountsVoucherInput | undefined, idempotencyKey: string) =>
    apiFetch<AccountsVoucher>(`/accounts/vouchers/${enc(id)}/post`, { method: "POST", ...(body ? { body } : { body: {} }), idempotencyKey }),
  /** Posts a reversing journal voucher dated `date` and marks the original reversed. */
  reverse: (id: string, body: { reason: string; date: IsoDate }, idempotencyKey: string) =>
    apiFetch<AccountsVoucher>(`/accounts/vouchers/${enc(id)}/reverse`, { method: "POST", body, idempotencyKey }),

  ledger: (ctx: Ctx, q: { account: string; from?: IsoDate; to?: IsoDate }) => apiFetch<AccountsLedger>("/accounts/ledger", { query: { ...ctxQuery(ctx), ...q } }),
  /** Balances at `asOf`; the movement columns run from `from` (default: the session start). */
  trialBalance: (ctx: Ctx, q: { from?: IsoDate; asOf?: IsoDate } = {}) => apiFetch<AccountsTrialBalance>("/accounts/trial-balance", { query: { ...ctxQuery(ctx), ...q } }),
  incomeExpenditure: (ctx: Ctx, q: { from?: IsoDate; to?: IsoDate }) => apiFetch<AccountsIncomeExpenditure>("/accounts/income-expenditure", { query: { ...ctxQuery(ctx), ...q } }),
  balanceSheet: (ctx: Ctx, asOf?: IsoDate) => apiFetch<AccountsBalanceSheet>("/accounts/balance-sheet", { query: { ...ctxQuery(ctx), asOf } }),

  feeMonth: (ctx: Ctx, month: string) => apiFetch<AccountsFeeMonth>("/accounts/fee-batches", { query: { ...ctxQuery(ctx), month } }),
  feeBatch: (campus: CampusCode, date: IsoDate) => apiFetch<AccountsFeeBatchDetail>(`/accounts/fee-batches/${campus}/${date}`),
  /** Posts the day's batch now (closing the day early), or the difference when the fee office total changed after posting. */
  postFeeBatch: (campus: CampusCode, date: IsoDate, idempotencyKey: string) =>
    apiFetch<AccountsFeeBatchDetail>(`/accounts/fee-batches/${campus}/${date}/post`, { method: "POST", body: {}, idempotencyKey }),
  postingRules: () => apiFetch<AccountsPostingRule[]>("/accounts/posting-rules"),
  updatePostingRule: (head: string, accountCode: string) => apiFetch<AccountsPostingRule>(`/accounts/posting-rules/${enc(head)}`, { method: "PUT", body: { accountCode } }),

  bankAccounts: (ctx: Ctx) => apiFetch<AccountsBankAccount[]>("/accounts/bank-accounts", { query: ctxQuery(ctx) }),
  bankRec: (account: string, month: string) => apiFetch<AccountsBankRec>("/accounts/bank-rec", { query: { account, month } }),
  match: (body: { account: string; month: string; statementLineId: string; bookLineKey: string }) => apiFetch<AccountsBankRec>("/accounts/bank-rec/match", { method: "POST", body }),
  unmatch: (body: { account: string; month: string; statementLineId: string }) => apiFetch<AccountsBankRec>("/accounts/bank-rec/unmatch", { method: "POST", body }),
  autoMatch: (body: { account: string; month: string }) => apiFetch<AccountsBankRec & { matched: number }>("/accounts/bank-rec/auto-match", { method: "POST", body }),
  signOff: (body: { account: string; month: string }) => apiFetch<AccountsBankRec>("/accounts/bank-rec/sign-off", { method: "POST", body }),

  periods: (ctx: Ctx) => apiFetch<AccountsPeriod[]>("/accounts/periods", { query: ctxQuery(ctx) }),
  closePeriod: (body: { campus: CampusCode; month: string }) => apiFetch<AccountsPeriod>("/accounts/periods/close", { method: "POST", body }),
  reopenPeriod: (body: { campus: CampusCode; month: string; reason: string }) => apiFetch<AccountsPeriod>("/accounts/periods/reopen", { method: "POST", body }),
};

export const accountsQueries = {
  overview: (ctx: Ctx) => queryOptions({ queryKey: ["accounts", ...ctxKey(ctx), "overview"], queryFn: () => accountsApi.overview(ctx) }),
  chart: (ctx: Ctx) => queryOptions({ queryKey: ["accounts", ...ctxKey(ctx), "chart"], queryFn: () => accountsApi.chart(ctx) }),
  vouchers: (ctx: Ctx, f: AccountsVoucherFilters) => queryOptions({ queryKey: ["accounts", ...ctxKey(ctx), "vouchers", f], queryFn: () => accountsApi.vouchers(ctx, f) }),
  /** Kept for the first build's pages: every voucher of the session, newest first. */
  journals: (ctx: Ctx) => queryOptions({ queryKey: ["accounts", ...ctxKey(ctx), "vouchers", { pageSize: 500 }], queryFn: () => accountsApi.vouchers(ctx, { pageSize: 500 }).then((r) => r.items) }),
  voucher: (id: string) => queryOptions({ queryKey: ["accounts", "voucher", id], queryFn: () => accountsApi.voucher(id), enabled: id !== "" && id !== "new" }),
  journal: (id: string) => queryOptions({ queryKey: ["accounts", "voucher", id], queryFn: () => accountsApi.voucher(id), enabled: id !== "" && id !== "new" }),
  ledger: (ctx: Ctx, q: { account: string; from?: IsoDate; to?: IsoDate }) =>
    queryOptions({ queryKey: ["accounts", ...ctxKey(ctx), "ledger", q], queryFn: () => accountsApi.ledger(ctx, q), enabled: q.account !== "" }),
  trialBalance: (ctx: Ctx, q: { from?: IsoDate; asOf?: IsoDate } = {}) =>
    queryOptions({ queryKey: ["accounts", ...ctxKey(ctx), "trial-balance", q.from ?? "", q.asOf ?? ""], queryFn: () => accountsApi.trialBalance(ctx, q) }),
  incomeExpenditure: (ctx: Ctx, q: { from?: IsoDate; to?: IsoDate }) =>
    queryOptions({ queryKey: ["accounts", ...ctxKey(ctx), "income-expenditure", q], queryFn: () => accountsApi.incomeExpenditure(ctx, q) }),
  balanceSheet: (ctx: Ctx, asOf?: IsoDate) => queryOptions({ queryKey: ["accounts", ...ctxKey(ctx), "balance-sheet", asOf ?? ""], queryFn: () => accountsApi.balanceSheet(ctx, asOf) }),
  feeMonth: (ctx: Ctx, month: string) => queryOptions({ queryKey: ["accounts", ...ctxKey(ctx), "fee-batches", month], queryFn: () => accountsApi.feeMonth(ctx, month) }),
  feeBatch: (campus: CampusCode, date: IsoDate) => queryOptions({ queryKey: ["accounts", "fee-batch", campus, date], queryFn: () => accountsApi.feeBatch(campus, date) }),
  postingRules: () => queryOptions({ queryKey: ["accounts", "posting-rules"], queryFn: () => accountsApi.postingRules() }),
  bankAccounts: (ctx: Ctx) => queryOptions({ queryKey: ["accounts", ...ctxKey(ctx), "bank-accounts"], queryFn: () => accountsApi.bankAccounts(ctx) }),
  bankRec: (account: string, month: string) =>
    queryOptions({ queryKey: ["accounts", "bank-rec", account, month], queryFn: () => accountsApi.bankRec(account, month), enabled: account !== "" && month !== "" }),
  periods: (ctx: Ctx) => queryOptions({ queryKey: ["accounts", ...ctxKey(ctx), "periods"], queryFn: () => accountsApi.periods(ctx) }),
};

/** "Rs 12,450,800 Dr" — balance with its side, as accountants read it. */
export function accountsSideOf(netDebit: Rupees): "Dr" | "Cr" | "" {
  return netDebit > 0 ? "Dr" : netDebit < 0 ? "Cr" : "";
}

/** Cash and bank voucher types: which side the cash or bank account is on. */
export function accountsVoucherSide(type: AccountsVoucherType): "PAYMENT" | "RECEIPT" | null {
  return type === "CP" || type === "BP" ? "PAYMENT" : type === "CR" || type === "BR" ? "RECEIPT" : null;
}

/** Cash payment and cash receipt use a cash account; bank payment and bank receipt a bank account. */
export function accountsCashBankKind(type: AccountsVoucherType): AccountsKind | null {
  return type === "CP" || type === "CR" ? "CASH" : type === "BP" || type === "BR" ? "BANK" : null;
}
