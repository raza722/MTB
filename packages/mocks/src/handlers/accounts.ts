import {
  ACCOUNTS_ALL_BANKS,
  accountsCashBankKind,
  accountsVoucherSide,
  can,
  type AccountsAccount,
  type AccountsAccountUpdate,
  type AccountsBalanceSheet,
  type AccountsBankAccount,
  type AccountsBankRec,
  type AccountsBookLine,
  type AccountsFeeBatch,
  type AccountsFeeBatchDetail,
  type AccountsFeeMonth,
  type AccountsIncomeExpenditure,
  type AccountsJournalLine,
  type AccountsLedger,
  type AccountsLedgerLine,
  type AccountsNewAccountInput,
  type AccountsOverview,
  type AccountsPeriod,
  type AccountsPeriodCheck,
  type AccountsPostingRule,
  type AccountsStatementGroup,
  type AccountsStatementLine,
  type AccountsStatusFilter,
  type AccountsTrialBalance,
  type AccountsTrialRow,
  type AccountsVoucher,
  type AccountsVoucherInput,
  type AccountsVoucherList,
  type AccountsVoucherRow,
  type AccountsVoucherType,
  type CampusCode,
  type CampusScope,
  type SessionUser,
} from "@mtb/api";
import { formatDate, formatRs, type IsoDate, type IsoDateTime } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { CURRENT_SESSION, DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import {
  ACC_CAMPUSES,
  addDaysIso,
  cashShare,
  DEFAULT_POSTING_RULES,
  FEE_ARREARS,
  FEE_LATE_ENTRIES,
  feeOfficeDay,
  generatedBooks,
  headSplit,
  initialChart,
  initialPeriods,
  initialSignOffs,
  initialVouchers,
  MAIN_BANK,
  MATCHED_UP_TO,
  monthEndIso,
  monthLong,
  sessionEnd,
  sessionMonths,
  sessionOfDate,
  sessionStart,
  STATEMENT_EXTRAS,
  STATEMENT_TO,
  voucherNoOf,
  weekdayOf,
  type AccountRecord,
  type PeriodRecord,
} from "../fixtures/accounts";
import { campusName } from "../fixtures/campuses";
import { dayFigure, figuresFor } from "../fixtures/fee-setup";
import { ctxFrom, fail, HttpResponse, latency, requirePermission, requireUser } from "../util";
import { feeHeadsForPosting, headCodeOf as feeHeadCodeOf } from "./fee-setup-model";
import { feesStore } from "./fees-state";

// accounts mock handlers and stores — owned by the accounts feature. Every figure is worked out from vouchers:
// the generated books (fixtures) plus what people do in the demo (this store).

interface AccountsState {
  chart: AccountRecord[];
  /** The demo's own vouchers: drafts, approvals, postings, reversals, fee supplements and receipt cancellations. */
  vouchers: AccountsVoucher[];
  /** "KC:2026:JV" → last number used. */
  seq: Record<string, number>;
  /** Idempotency-Key → voucher id. */
  idem: Record<string, string>;
  /** Generated vouchers reversed in the demo. */
  reversedGenerated: Record<string, NonNullable<AccountsVoucher["reversal"]>>;
  /** Fee head → account code. */
  postingRules: Record<string, string>;
  /** Bank statement line id → book line key (or null when unmatched by hand). Overrides the starting matches. */
  bankMatch: Record<string, string | null>;
  signOffs: Record<string, { by: string; at: IsoDateTime }>;
  periods: Record<string, PeriodRecord>;
  /** Receipt number → the cancellation voucher posted for it. */
  feeCancelPosted: Record<string, string>;
}

function initialState(): AccountsState {
  const seq: Record<string, number> = {};
  for (const c of ACC_CAMPUSES) {
    for (const s of [2025, 2026]) {
      for (const [t, n] of Object.entries(generatedBooks(c, s).seq)) seq[`${c}:${s}:${t}`] = n ?? 0;
    }
  }
  return {
    chart: initialChart(),
    vouchers: initialVouchers(),
    seq,
    idem: {},
    reversedGenerated: {},
    postingRules: Object.fromEntries(DEFAULT_POSTING_RULES.map((r) => [r.head, r.accountCode])),
    bankMatch: {},
    signOffs: initialSignOffs(),
    periods: initialPeriods(),
    feeCancelPosted: {},
  };
}

// v3: the chart gained a sub-group level (54 Office running), so a tab still holding the v2 chart starts afresh.
const store = createStore<AccountsState>("accounts-v3", initialState);

const TODAY = DEMO_TODAY;
const MANUAL: AccountsVoucherType[] = ["JV", "CP", "CR", "BP", "BR"];
const SYSTEM_USER = "Fee office (automatic)";

/* ================================================================== Vouchers: generated + demo */

const genCache = new Map<number, { list: AccountsVoucher[]; byId: Map<string, AccountsVoucher> }>();
function generated(session: number) {
  const hit = genCache.get(session);
  if (hit) return hit;
  const list = session === 2025 || session === 2026 ? ACC_CAMPUSES.flatMap((c) => generatedBooks(c, session).vouchers) : [];
  const out = { list, byId: new Map(list.map((v) => [v.id, v])) };
  genCache.set(session, out);
  return out;
}

const withReversal = (v: AccountsVoucher): AccountsVoucher => {
  const r = store.get().reversedGenerated[v.id];
  return r ? { ...v, status: "REVERSED", reversal: r } : v;
};

function allVouchers(session: number): AccountsVoucher[] {
  const st = store.get();
  const rev = st.reversedGenerated;
  const gen = generated(session).list;
  const g = Object.keys(rev).length ? gen.map((v) => (rev[v.id] ? withReversal(v) : v)) : gen;
  return [...g, ...st.vouchers.filter((v) => v.session === session)];
}

function findVoucher(id: string): AccountsVoucher | undefined {
  const own = store.get().vouchers.find((v) => v.id === id);
  if (own) return own;
  for (const s of [2026, 2025]) {
    const g = generated(s).byId.get(id);
    if (g) return withReversal(g);
  }
  return undefined;
}

const inLedger = (v: AccountsVoucher) => v.status === "POSTED" || v.status === "REVERSED";
const inScope = (campus: CampusCode, scope: CampusScope) => scope === "ALL" || campus === scope;

interface Posting {
  date: IsoDate;
  campus: CampusCode;
  code: string;
  debit: number;
  credit: number;
  v: AccountsVoucher;
  line: AccountsJournalLine;
}

/** Every posted line of a session at a campus scope (opening balances included). */
function postings(session: number, scope: CampusScope): Posting[] {
  const out: Posting[] = [];
  for (const v of allVouchers(session)) {
    if (!inLedger(v) || !inScope(v.campus, scope)) continue;
    for (const line of v.lines) out.push({ date: v.date, campus: v.campus, code: line.accountCode, debit: line.debit, credit: line.credit, v, line });
  }
  return out;
}

function netOf(ps: Posting[], pred: (p: Posting) => boolean = () => true): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of ps) if (pred(p)) m.set(p.code, (m.get(p.code) ?? 0) + p.debit - p.credit);
  return m;
}

/** The last day the books cover for a session: today for the current one, the session's last day otherwise. */
const asOfFor = (session: number): IsoDate => (session === CURRENT_SESSION ? TODAY : sessionEnd(session));

/* ================================================================== Chart */

const chartMap = () => new Map(store.get().chart.map((a) => [a.code, a]));
const visible = (a: AccountRecord, scope: CampusScope) => !a.campus || scope === "ALL" || a.campus === scope;

let usedCache: Set<string> | null = null;
function usedCodes(): Set<string> {
  if (!usedCache) {
    usedCache = new Set<string>();
    for (const s of [2025, 2026]) for (const v of generated(s).list) for (const l of v.lines) usedCache.add(l.accountCode);
  }
  const out = new Set(usedCache);
  for (const v of store.get().vouchers) for (const l of v.lines) out.add(l.accountCode);
  return out;
}

function groupNet(code: string, chart: AccountRecord[], net: Map<string, number>, scope: CampusScope): number {
  const acc = chart.find((a) => a.code === code);
  if (!acc) return 0;
  if (acc.postable) return net.get(code) ?? 0;
  return chart.filter((a) => a.parentCode === code && visible(a, scope)).reduce((s, c) => s + groupNet(c.code, chart, net, scope), 0);
}

function toAccount(a: AccountRecord, chart: AccountRecord[], net: Map<string, number>, scope: CampusScope, used: Set<string>): AccountsAccount {
  return {
    code: a.code,
    name: a.name,
    accountClass: a.accountClass,
    parentCode: a.parentCode,
    postable: a.postable,
    normalSide: a.normalSide,
    ...(a.campus ? { campus: a.campus } : {}),
    kind: a.kind,
    ...(a.control ? { control: a.control } : {}),
    ...(a.bank ? { bank: a.bank } : {}),
    active: a.active,
    used: a.postable ? used.has(a.code) : chart.some((c) => c.parentCode === a.code),
    netDebit: groupNet(a.code, chart, net, scope),
    ...(a.note ? { note: a.note } : {}),
  };
}

function chartFor(scope: CampusScope, session: number): AccountsAccount[] {
  const chart = store.get().chart;
  const asOf = asOfFor(session);
  const net = netOf(postings(session, scope), (p) => p.date <= asOf);
  const used = usedCodes();
  return chart.filter((a) => visible(a, scope)).map((a) => toAccount(a, chart, net, scope, used));
}

/* ================================================================== Fee office → ledger */

function syncFeeCancellations() {
  const st = store.get();
  const receipts = Object.values(feesStore.get().receipts).filter((r) => r.status === "CANCELLED" && r.cancellation?.decidedAt && !st.feeCancelPosted[r.receiptNo]);
  if (receipts.length === 0) return;
  const rules = st.postingRules;
  const created: AccountsVoucher[] = [];
  const seq = { ...st.seq };
  const posted = { ...st.feeCancelPosted };
  for (const r of receipts) {
    const cn = r.cancellation!;
    const date = cn.decidedAt!.slice(0, 10);
    const session = sessionOfDate(date);
    const key = `${r.campus}:${session}:FEE_CANCEL`;
    const n = (seq[key] ?? 0) + 1;
    seq[key] = n;
    const voucherNo = voucherNoOf(r.campus, "FEE_CANCEL", session, n);
    const debit = new Map<string, number>();
    for (const l of r.lines) {
      const fee = Math.max(0, l.applied - l.lateFine);
      const acc = rules[headCodeOf(l.head)] ?? "4101";
      debit.set(acc, (debit.get(acc) ?? 0) + fee);
      if (l.lateFine > 0) debit.set(rules.LATE_FINE ?? "4105", (debit.get(rules.LATE_FINE ?? "4105") ?? 0) + Math.min(l.lateFine, l.applied));
    }
    const total = [...debit.values()].reduce((a, b) => a + b, 0);
    const payAcc = r.payment.method === "CASH" ? "1101" : MAIN_BANK[r.campus];
    const lines: AccountsJournalLine[] = [
      ...[...debit.entries()].filter(([, v]) => v > 0).map(([acc, v], i) => ({ id: `l${i + 1}`, accountCode: acc, description: `Receipt ${r.receiptNo} reversed`, debit: v, credit: 0 })),
    ];
    lines.push({ id: `l${lines.length + 1}`, accountCode: payAcc, description: r.payment.method === "CASH" ? "Cash returned or kept aside" : "Bank receipt reversed", debit: 0, credit: total });
    const at = cn.decidedAt!;
    created.push({
      id: `fc-${r.receiptNo}`,
      type: "FEE_CANCEL",
      voucherNo,
      campus: r.campus,
      campusName: campusName(r.campus),
      session,
      date,
      narration: `Receipt ${r.receiptNo} cancelled (${cn.cnNo}): ${r.studentName}, ${r.classSection}`,
      lines,
      status: "POSTED",
      totalDebit: total,
      totalCredit: total,
      createdBy: SYSTEM_USER,
      updatedAt: at,
      postedBy: SYSTEM_USER,
      postedAt: at,
      system: true,
      source: { kind: "RECEIPT_CANCELLATION", receiptNo: r.receiptNo, cnNo: cn.cnNo ?? "", studentName: r.studentName },
      history: [{ action: "POSTED", by: SYSTEM_USER, at, note: `Cancellation approved by ${cn.decidedBy ?? "the principal"}.` }],
    });
    posted[r.receiptNo] = `fc-${r.receiptNo}`;
  }
  store.set((s) => ({ ...s, seq, feeCancelPosted: posted, vouchers: [...created, ...s.vouchers] }));
}

/** "Tuition fee – Nov 2026" → "TUITION". */
function headCodeOf(head: string): string {
  const h = head.toLowerCase();
  // Heads the fee office added (gym, re-admission …) post to their own rule.
  const own = feeHeadCodeOf(head);
  if (postingHeads().some((r) => r.head === own) && !DEFAULT_POSTING_RULES.some((r) => r.head === own)) return own;
  if (h.startsWith("annual")) return "ANNUAL";
  if (h.startsWith("exam")) return "EXAM";
  if (h.startsWith("admission")) return "ADMISSION";
  if (h.startsWith("transport")) return "TRANSPORT";
  if (h.startsWith("board")) return "BOARD";
  if (h.includes("fine")) return "FINE_OTHER";
  return "TUITION";
}

/** Posting rules: the built-in heads, then any head the fee office added (with its default income account). */
function postingHeads(): Array<{ head: string; title: string; category: "FEE" | "FINE" | "APPLICATION"; accountCode: string; note?: string }> {
  const core = DEFAULT_POSTING_RULES.map((r) => r.head);
  return [...DEFAULT_POSTING_RULES, ...feeHeadsForPosting([...core, "FINE_EXAM"]).map((h) => ({ ...h, note: "Added in Fees → Structure → Fee heads." }))];
}

/** Fee office figure for a day: base figures for past days; today includes receipts posted in this demo. */
function feeOfficeFor(campus: CampusCode, date: IsoDate): { amount: number; receipts: number } {
  if (date > TODAY || weekdayOf(date) === 0) return { amount: 0, receipts: 0 };
  if (date === TODAY) return dayFigure(campus, date, figuresFor(campus, feesStore.get().postedToday[campus]));
  if (date < "2025-04-01") return { amount: 0, receipts: 0 };
  return feeOfficeDay(campus, date);
}

/** FEE vouchers by campus and date (generated + posted in the demo). */
function feeLedgerIndex(): Map<string, AccountsVoucher[]> {
  const m = new Map<string, AccountsVoucher[]>();
  for (const s of [2025, 2026]) {
    for (const v of allVouchers(s)) {
      if (v.type !== "FEE" || v.source?.kind !== "FEE_BATCH") continue;
      const k = `${v.campus}:${v.source.date}`;
      m.set(k, [...(m.get(k) ?? []), v]);
    }
  }
  return m;
}

function cancellationsFor(campus: CampusCode, date: IsoDate) {
  const list = Object.values(feesStore.get().receipts).filter((r) => r.campus === campus && r.postedAt.slice(0, 10) === date && (r.status === "CANCEL_PENDING" || r.status === "CANCELLED"));
  const pending = list.filter((r) => r.status === "CANCEL_PENDING");
  const approved = list.filter((r) => r.status === "CANCELLED");
  return {
    summary: { pending: pending.length, pendingAmount: pending.reduce((a, r) => a + r.total, 0), approved: approved.length, approvedAmount: approved.reduce((a, r) => a + r.total, 0) },
    list: list.map((r) => {
      const vid = store.get().feeCancelPosted[r.receiptNo];
      const v = vid ? store.get().vouchers.find((x) => x.id === vid) : undefined;
      return { receiptNo: r.receiptNo, cnNo: r.cancellation?.cnNo ?? "", studentName: r.studentName, amount: r.total, status: r.status === "CANCELLED" ? ("APPROVED" as const) : ("PENDING" as const), ...(v?.voucherNo ? { voucherNo: v.voucherNo } : {}) };
    }),
  };
}

function feeBatch(campus: CampusCode, date: IsoDate, index: Map<string, AccountsVoucher[]>): AccountsFeeBatch | null {
  const fig = feeOfficeFor(campus, date);
  const vs = index.get(`${campus}:${date}`) ?? [];
  if (fig.amount === 0 && vs.length === 0) return null;
  const ledgerTotal = vs.reduce((a, v) => a + v.totalDebit, 0);
  const difference = fig.amount - ledgerTotal;
  const cash = vs.reduce((a, v) => a + v.lines.filter((l) => l.accountCode === "1101").reduce((x, l) => x + l.debit, 0), 0);
  const last = [...vs].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))[0];
  const late = FEE_LATE_ENTRIES.find((e) => e.campus === campus && e.date === date);
  const c = cancellationsFor(campus, date);
  return {
    key: `${campus}:${date}`,
    campus,
    campusName: campusName(campus),
    date,
    receipts: fig.receipts,
    feeOfficeTotal: fig.amount,
    ledgerTotal,
    difference,
    status: vs.length === 0 ? "OPEN" : difference !== 0 ? "DIFFERENCE" : "POSTED",
    vouchers: vs.map((v) => ({ id: v.id, voucherNo: v.voucherNo ?? "", amount: v.totalDebit, supplement: v.source?.kind === "FEE_BATCH" && Boolean(v.source.supplement) })),
    ...(last?.postedAt ? { postedAt: last.postedAt } : {}),
    ...(last?.postedBy ? { postedBy: last.postedBy } : {}),
    cash,
    bank: ledgerTotal - cash,
    cancellations: c.summary,
    ...(difference !== 0 && late && !vs.some((v) => v.source?.kind === "FEE_BATCH" && v.source.supplement) ? { note: late.note } : {}),
  };
}

const HEAD_TITLE = new Map(DEFAULT_POSTING_RULES.map((r) => [r.head, r.title]));

function feeBatchDetail(campus: CampusCode, date: IsoDate): AccountsFeeBatchDetail | null {
  const b = feeBatch(campus, date, feeLedgerIndex());
  if (!b) return null;
  const chart = chartMap();
  const rules = store.get().postingRules;
  const heads = headSplit(campus, date, b.feeOfficeTotal).map(([h, amount]) => {
    const acc = rules[h] ?? "4101";
    return { head: h, title: HEAD_TITLE.get(h) ?? h, accountCode: acc, accountName: chart.get(acc)?.name ?? acc, amount };
  });
  const cash = cashShare(campus, date, b.feeOfficeTotal);
  const bankAll = b.feeOfficeTotal - cash;
  const online = Math.round((bankAll * 0.27) / 50) * 50;
  const cheque = Math.round((bankAll * 0.07) / 50) * 50;
  const bank = MAIN_BANK[campus];
  const bankName = chart.get(bank)?.name ?? bank;
  const c = cancellationsFor(campus, date);
  return {
    ...b,
    heads,
    methods: [
      { method: "CASH", label: "Cash", amount: cash, accountCode: "1101", accountName: "Cash in hand" },
      { method: "BANK", label: "Bank challans", amount: bankAll - online - cheque, accountCode: bank, accountName: bankName },
      { method: "ONLINE", label: "Online / Raast", amount: online, accountCode: bank, accountName: bankName },
      { method: "CHEQUE", label: "Cheques", amount: cheque, accountCode: bank, accountName: bankName },
    ],
    cancellationList: c.list,
  };
}

/* ================================================================== Periods */

const monthOf = (d: IsoDate) => d.slice(0, 7);
const prevMonthOf = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
const nextMonthOf = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 7);

function periodStatus(campus: CampusCode, month: string): "OPEN" | "CLOSED" | "FUTURE" {
  const rec = store.get().periods[`${campus}:${month}`];
  if (rec?.status === "CLOSED") return "CLOSED";
  return `${month}-01` > TODAY ? "FUTURE" : "OPEN";
}

function closedFail(campus: CampusCode, date: IsoDate): Response | null {
  if (periodStatus(campus, monthOf(date)) === "CLOSED") {
    return fail(409, "PERIOD_CLOSED", `${monthLong(monthOf(date))} is closed for ${campusName(campus)}. Date the voucher in an open month, or ask the admin to reopen ${monthLong(monthOf(date))}.`, { field: "date" });
  }
  return null;
}

/* ================================================================== Bank statements */

interface BankLine {
  key: string;
  voucherId: string;
  voucherNo: string;
  date: IsoDate;
  description: string;
  debit: number;
  credit: number;
}

const isWorkday = (d: IsoDate) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5;
function addWorkdays(d: IsoDate, n: number): IsoDate {
  let x = d;
  let left = n;
  while (left > 0) {
    x = addDaysIso(x, 1);
    if (isWorkday(x)) left--;
  }
  return x;
}

/** Book lines on a bank account across both sessions (opening balances excluded). */
function bookLines(account: string): BankLine[] {
  const out: BankLine[] = [];
  for (const s of [2025, 2026]) {
    for (const v of allVouchers(s)) {
      if (!inLedger(v) || v.type === "OPENING") continue;
      for (const l of v.lines) {
        if (l.accountCode !== account) continue;
        out.push({ key: `${v.id}:${l.id}`, voucherId: v.id, voucherNo: v.voucherNo ?? "", date: v.date, description: v.narration, debit: l.debit, credit: l.credit });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

interface StmtLine {
  id: string;
  date: IsoDate;
  description: string;
  reference: string;
  debit: number;
  credit: number;
  /** The book line it mirrors (generated books only). */
  mirror: string | null;
}

const stmtCache = new Map<string, StmtLine[]>();
/** The bank's statement: what the bank did with the generated books' entries, plus its own items. */
function statementLines(account: string): StmtLine[] {
  const hit = stmtCache.get(account);
  if (hit) return hit;
  const out: StmtLine[] = [];
  for (const s of [2025, 2026]) {
    for (const v of generated(s).list) {
      if (v.type === "OPENING") continue;
      for (const l of v.lines) {
        if (l.accountCode !== account) continue;
        let date = v.date;
        let description = v.narration.toUpperCase();
        let reference = v.reference ?? v.voucherNo ?? "";
        if (v.type === "FEE") {
          if (weekdayOf(date) === 6) date = addDaysIso(date, 2);
          description = `FEE CREDITS: BANK CHALLANS AND ONLINE (${formatDate(v.date)})`;
          reference = `FEE-${v.date.replace(/-/g, "").slice(2)}`;
        } else if (v.type === "BP" && v.cheque && /^\d+$/.test(v.cheque.number)) {
          date = addWorkdays(v.date, 2);
          description = `CHEQUE ${v.cheque.number} PRESENTED: ${(v.party ?? "").toUpperCase()}`;
          reference = `CHQ-${v.cheque.number}`;
        } else if (v.type === "BP") {
          description = `FUNDS TRANSFER: ${(v.party ?? "").toUpperCase()}`;
          reference = v.cheque?.number ?? "TRANSFER";
        } else if (v.type === "JV" && v.narration.startsWith("Cash deposited")) {
          description = `CASH DEPOSIT ${v.reference ?? ""}`.trim();
        } else if (v.type === "JV" && v.narration.startsWith("Bank charges")) {
          description = "SERVICE CHARGES AND EXCISE DUTY";
          reference = `SVC-${v.date.slice(0, 7)}`;
        } else if (v.type === "BR") {
          description = v.narration.startsWith("Profit") ? `PROFIT CREDIT ${monthLong(v.date.slice(0, 7)).toUpperCase()}` : `CREDIT: ${(v.party ?? "").toUpperCase()}`;
          reference = v.cheque?.number ?? "CREDIT";
        }
        if (date > STATEMENT_TO) continue;
        out.push({ id: `st-${v.id}:${l.id}`, date, description, reference, debit: l.credit, credit: l.debit, mirror: `${v.id}:${l.id}` });
      }
    }
  }
  for (const x of STATEMENT_EXTRAS) if (x.account === account) out.push({ id: x.id, date: x.date, description: x.description, reference: x.reference, debit: x.debit, credit: x.credit, mirror: null });
  out.sort((a, b) => a.date.localeCompare(b.date) || b.credit - a.credit || a.id.localeCompare(b.id));
  stmtCache.set(account, out);
  return out;
}

/** Statement line id → matched book key, and the reverse, as they stand now. */
function matchesFor(account: string) {
  const overrides = store.get().bankMatch;
  const cutoff = MATCHED_UP_TO[account] ?? "2026-10-31";
  const st2book = new Map<string, string>();
  const book2st = new Map<string, string>();
  for (const s of statementLines(account)) {
    const o = overrides[s.id];
    const m = o !== undefined ? o : s.mirror && s.date <= cutoff ? s.mirror : null;
    if (m && !book2st.has(m)) {
      st2book.set(s.id, m);
      book2st.set(m, s.id);
    }
  }
  return { st2book, book2st };
}

function bookBalanceAt(account: string, date: IsoDate): number {
  const session = sessionOfDate(date);
  let n = 0;
  for (const v of allVouchers(session)) {
    if (!inLedger(v) || v.date > date) continue;
    for (const l of v.lines) if (l.accountCode === account) n += l.debit - l.credit;
  }
  return n;
}

/** The bank's own opening on 1-Apr-2025 equals the books (the old system was reconciled at migration). */
function statementOpening(account: string): number {
  const ob = generated(2025).list.filter((v) => v.type === "OPENING");
  let n = 0;
  for (const v of ob) for (const l of v.lines) if (l.accountCode === account) n += l.debit - l.credit;
  return n;
}

function bankAccountInfo(a: AccountRecord): AccountsBankAccount {
  const lines = statementLines(a.code);
  const { st2book } = matchesFor(a.code);
  const signed = Object.keys(store.get().signOffs).filter((k) => k.startsWith(`${a.code}:`)).map((k) => k.slice(a.code.length + 1)).sort();
  return {
    code: a.code,
    name: a.name,
    campus: a.campus!,
    campusName: campusName(a.campus!),
    bank: a.bank!,
    bookBalance: bookBalanceAt(a.code, TODAY),
    statementBalance: statementOpening(a.code) + lines.reduce((s, l) => s + l.credit - l.debit, 0),
    statementTo: STATEMENT_TO,
    unmatched: lines.filter((l) => l.date >= "2026-04-01" && !st2book.has(l.id)).length,
    lastSignedOff: signed.at(-1) ?? null,
  };
}

function bankRec(account: string, month: string): AccountsBankRec | Response {
  const a = chartMap().get(account);
  if (!a || a.kind !== "BANK" || !a.campus) return fail(404, "NOT_FOUND", "No bank account with this code.");
  const start = `${month}-01`;
  const end = monthEndIso(month);
  const stmtEnd = end < STATEMENT_TO ? end : STATEMENT_TO;
  const all = statementLines(account);
  const books = bookLines(account);
  const bookByKey = new Map(books.map((b) => [b.key, b]));
  const stById = new Map(all.map((s) => [s.id, s]));
  const { st2book, book2st } = matchesFor(account);

  // Pairs count only when both sides fall on or before the month end.
  const pairedBy = (bookKey: string) => {
    const sid = book2st.get(bookKey);
    const s = sid ? stById.get(sid) : undefined;
    return s && s.date <= end ? s : undefined;
  };
  const stPairedBy = (sid: string) => {
    const k = st2book.get(sid);
    const b = k ? bookByKey.get(k) : undefined;
    return b && b.date <= end ? b : undefined;
  };

  const unmatchedBooks = books.filter((b) => !book2st.has(b.key));
  const suggestionFor = (s: StmtLine): string | null => {
    if (st2book.has(s.id)) return null;
    if (s.mirror && !book2st.has(s.mirror) && bookByKey.has(s.mirror)) return s.mirror;
    let best: BankLine | undefined;
    let bestGap = Infinity;
    for (const b of unmatchedBooks) {
      if (b.debit !== s.credit || b.credit !== s.debit) continue;
      const gap = Math.abs(Date.parse(b.date) - Date.parse(s.date)) / 86400000;
      if (gap <= 10 && gap < bestGap) {
        best = b;
        bestGap = gap;
      }
    }
    return best?.key ?? null;
  };

  const statement: AccountsStatementLine[] = all
    .filter((s) => s.date >= start && s.date <= end)
    .map((s) => ({ id: s.id, date: s.date, description: s.description, reference: s.reference, debit: s.debit, credit: s.credit, matchedTo: st2book.get(s.id) ?? null, suggested: suggestionFor(s) }));

  // Book side: this month's lines, plus earlier lines still waiting to appear on the statement at the month start.
  const carriedIn = (b: BankLine) => {
    if (b.date >= start || b.date < addDaysIso(start, -62)) return false;
    const s = pairedBy(b.key);
    return !s || s.date >= start;
  };
  const book: AccountsBookLine[] = books
    .filter((b) => b.date <= end && (b.date >= start || carriedIn(b)))
    .map((b) => ({ key: b.key, voucherId: b.voucherId, voucherNo: b.voucherNo, date: b.date, description: b.description, debit: b.debit, credit: b.credit, matchedTo: book2st.get(b.key) ?? null, carried: b.date < start }));

  const stOpening = statementOpening(account) + all.filter((s) => s.date < start).reduce((x, s) => x + s.credit - s.debit, 0);
  const stClosing = stOpening + all.filter((s) => s.date >= start && s.date <= end).reduce((x, s) => x + s.credit - s.debit, 0);
  const bookClosing = bookBalanceAt(account, end > TODAY ? TODAY : end);

  let dit = 0;
  let cnp = 0;
  for (const b of books) {
    if (b.date > end || pairedBy(b.key)) continue;
    dit += b.debit;
    cnp += b.credit;
  }
  let bcnb = 0;
  let bdnb = 0;
  for (const s of all) {
    if (s.date > end || stPairedBy(s.id)) continue;
    bcnb += s.credit;
    bdnb += s.debit;
  }
  const adjusted = stClosing + dit - cnp - bcnb + bdnb;
  const signedOff = store.get().signOffs[`${account}:${month}`];
  const unmatchedStatement = statement.filter((s) => !s.matchedTo).length;
  const months: string[] = [];
  for (let m = "2025-04"; m <= monthOf(STATEMENT_TO); m = nextMonthOf(m)) months.push(m);
  return {
    account: bankAccountInfo(a),
    month,
    months,
    statementTo: stmtEnd,
    statementOpening: stOpening,
    statementClosing: stClosing,
    bookClosing,
    statement,
    book,
    summary: {
      depositsInTransit: dit,
      chequesNotPresented: cnp,
      bankCreditsNotBooked: bcnb,
      bankDebitsNotBooked: bdnb,
      adjustedStatement: adjusted,
      difference: bookClosing - adjusted,
      unmatchedStatement,
      unmatchedBook: book.filter((b) => !b.matchedTo).length,
      suggestions: statement.filter((s) => s.suggested).length,
    },
    ...(signedOff ? { signedOff } : {}),
    canSignOff: !signedOff && end <= STATEMENT_TO && unmatchedStatement === 0,
  };
}

/** True when every statement line of the month is matched. */
function bankMonthMatched(account: string, month: string): { ok: boolean; unmatched: number } {
  const start = `${month}-01`;
  const end = monthEndIso(month);
  const { st2book } = matchesFor(account);
  const n = statementLines(account).filter((s) => s.date >= start && s.date <= end && !st2book.has(s.id)).length;
  return { ok: n === 0, unmatched: n };
}

/* ================================================================== Period checks */

function periodFor(campus: CampusCode, month: string, index: Map<string, AccountsVoucher[]>, vouchers: AccountsVoucher[], user: SessionUser | undefined): AccountsPeriod {
  const rec = store.get().periods[`${campus}:${month}`];
  const status = periodStatus(campus, month);
  const end = monthEndIso(month);
  const base = { campus, campusName: campusName(campus), month, status, ...(rec?.closedBy ? { closedBy: rec.closedBy } : {}), ...(rec?.closedAt ? { closedAt: rec.closedAt } : {}), ...(rec?.reopened ? { reopened: rec.reopened } : {}) };
  const nextClosed = periodStatus(campus, nextMonthOf(month)) === "CLOSED";
  if (status !== "OPEN") {
    return { ...base, checks: [], canClose: false, canReopen: status === "CLOSED" && !nextClosed && Boolean(user && can(user, "settings.manage", campus)) };
  }
  const checks: AccountsPeriodCheck[] = [];
  const ended = end < TODAY;
  checks.push({ key: "ENDED", label: "The month has ended", ok: ended, detail: ended ? `Last day was ${formatDate(end)}.` : `${monthLong(month)} can be closed after ${formatDate(end)}.` });
  const prev = prevMonthOf(month);
  const prevOk = periodStatus(campus, prev) === "CLOSED";
  checks.push({ key: "EARLIER", label: `${monthLong(prev)} is closed`, ok: prevOk, detail: prevOk ? "Months are closed in order." : `Close ${monthLong(prev)} first.` });

  // Fee batches.
  const diffs: string[] = [];
  let open = 0;
  for (let d = `${month}-01`; d <= end && d <= TODAY; d = addDaysIso(d, 1)) {
    const b = feeBatch(campus, d, index);
    if (!b) continue;
    if (b.status === "OPEN") open++;
    else if (b.difference !== 0) diffs.push(`${formatDate(d)}: ${formatRs(Math.abs(b.difference))} ${b.difference > 0 ? "not yet posted" : "posted twice"}`);
  }
  checks.push({
    key: "FEES",
    label: "Fee collections posted and agreeing with the fee office",
    ok: diffs.length === 0 && open === 0,
    detail: diffs.length ? diffs.join("; ") : open ? `${open} day${open === 1 ? "" : "s"} still open at the counter.` : "Every day's fee office total equals the ledger.",
    link: { to: "/accounts/fee-posting", search: { month } },
  });

  // Vouchers not yet posted.
  const pending = vouchers.filter((v) => v.campus === campus && monthOf(v.date) === month && (v.status === "DRAFT" || v.status === "SUBMITTED" || v.status === "APPROVED"));
  const count = (s: AccountsVoucher["status"]) => pending.filter((v) => v.status === s).length;
  const parts = [
    count("DRAFT") ? `${count("DRAFT")} draft${count("DRAFT") === 1 ? "" : "s"}` : "",
    count("SUBMITTED") ? `${count("SUBMITTED")} waiting for approval` : "",
    count("APPROVED") ? `${count("APPROVED")} approved but not posted` : "",
  ].filter(Boolean);
  checks.push({
    key: "VOUCHERS",
    label: "No vouchers left unposted in the month",
    ok: pending.length === 0,
    detail: pending.length ? `${parts.join(", ")}. Post them, or discard drafts that aren't needed.` : "Every voucher dated in the month is posted.",
    link: { to: "/accounts/vouchers", search: { from: `${month}-01`, to: end, status: "ALL", type: "MANUAL" } },
  });

  // Bank statements.
  const banks = store.get().chart.filter((a) => a.kind === "BANK" && a.campus === campus && a.active);
  const bankIssues = banks.map((a) => ({ a, r: bankMonthMatched(a.code, month) })).filter((x) => !x.r.ok);
  const firstIssue = bankIssues[0];
  checks.push({
    key: "BANK",
    label: "Bank statements matched",
    ok: bankIssues.length === 0 && end <= STATEMENT_TO,
    detail: end > STATEMENT_TO ? "The bank statement for the whole month isn't in yet." : bankIssues.length ? bankIssues.map((x) => `${x.a.name}: ${x.r.unmatched} statement line${x.r.unmatched === 1 ? "" : "s"} not matched`).join("; ") : `${banks.length} bank account${banks.length === 1 ? "" : "s"} matched line by line.`,
    ...(firstIssue ? { link: { to: "/accounts/bank", search: { account: firstIssue.a.code, month } } } : {}),
  });
  const tb = postings(sessionOfDate(`${month}-01`), campus).filter((p) => p.date <= end);
  const dr = tb.reduce((a, p) => a + p.debit, 0);
  const cr = tb.reduce((a, p) => a + p.credit, 0);
  checks.push({ key: "BALANCED", label: "Trial balance balances", ok: dr === cr, detail: dr === cr ? `Debits equal credits at ${formatDate(end)}.` : `Out by ${formatRs(Math.abs(dr - cr))}.` });
  return { ...base, checks, canClose: checks.every((c) => c.ok), canReopen: false };
}

/* ================================================================== Voucher rules */

const totalsOf = (lines: Array<{ debit: number; credit: number }>) => ({ totalDebit: lines.reduce((a, l) => a + (l.debit || 0), 0), totalCredit: lines.reduce((a, l) => a + (l.credit || 0), 0) });
const newId = () => `vch-${Math.random().toString(36).slice(2, 10)}`;
const usedLine = (l: { accountCode: string; debit: number; credit: number; description: string }) => Boolean(l.accountCode || l.debit || l.credit || l.description.trim());

/** Checks that apply to drafts and posted vouchers alike. */
function basicChecks(body: AccountsVoucherInput): Response | null {
  if (!MANUAL.includes(body.type)) return fail(422, "VALIDATION", "Choose the kind of voucher.", { field: "type" });
  if (body.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "2025–26 is closed. Switch to 2026–27 to enter vouchers.");
  if (!body.campus || !ACC_CAMPUSES.includes(body.campus)) return fail(422, "VALIDATION", "Choose the campus this voucher belongs to.", { field: "campus" });
  if (!body.date) return fail(422, "VALIDATION", "Enter the voucher date.", { field: "date" });
  if (body.date < sessionStart(CURRENT_SESSION) || body.date > TODAY) return fail(422, "VALIDATION", "The date must be in session 2026–27 and not in the future.", { field: "date" });
  for (const l of body.lines) {
    if (!Number.isSafeInteger(l.debit || 0) || !Number.isSafeInteger(l.credit || 0) || (l.debit || 0) < 0 || (l.credit || 0) < 0) {
      return fail(422, "VALIDATION", "Amounts must be whole rupees.", { field: "lines" });
    }
  }
  return null;
}

/** Full checks before a voucher is sent for approval or posted. The server enforces them even if the screen didn't. */
function fullChecks(body: AccountsVoucherInput, chart: Map<string, AccountRecord>): Response | null {
  if (!body.narration.trim()) return fail(422, "VALIDATION", "Add a narration saying what this voucher is for.", { field: "narration" });
  const side = accountsVoucherSide(body.type);
  const used = body.lines.filter(usedLine);
  if (side) {
    const cb = body.cashBankAccount ? chart.get(body.cashBankAccount) : undefined;
    const kind = accountsCashBankKind(body.type);
    const word = side === "PAYMENT" ? "paid from" : "received into";
    if (!cb) return fail(422, "VALIDATION", `Choose the ${kind === "CASH" ? "cash" : "bank"} account the money is ${word}.`, { field: "cashBankAccount" });
    if (cb.kind !== kind) return fail(422, "VALIDATION", `${cb.name} isn't a ${kind === "CASH" ? "cash" : "bank"} account. Use a ${kind === "CASH" ? "cash" : "bank"} voucher for it.`, { field: "cashBankAccount" });
    if (cb.campus && cb.campus !== body.campus) return fail(422, "VALIDATION", `${cb.name} belongs to ${campusName(cb.campus)}, not ${campusName(body.campus)}.`, { field: "cashBankAccount" });
    if (!body.party?.trim()) return fail(422, "VALIDATION", side === "PAYMENT" ? "Enter who is being paid." : "Enter who the money is from.", { field: "party" });
    if (kind === "BANK" && !body.cheque?.number.trim()) {
      return fail(422, "VALIDATION", side === "PAYMENT" ? "Enter the cheque number, or the transfer reference." : "Enter the cheque, transfer or deposit slip number.", { field: "cheque" });
    }
    if (kind === "BANK" && !body.cheque?.date) return fail(422, "VALIDATION", "Enter the cheque or transfer date.", { field: "chequeDate" });
    if (used.length < 1) return fail(422, "VALIDATION", "Add at least one line saying what the money is for.", { field: "lines" });
  } else if (used.length < 2) {
    return fail(422, "VALIDATION", "A voucher needs at least two lines: one debit and one credit.", { field: "lines" });
  }
  for (const [i, l] of used.entries()) {
    const acc = chart.get(l.accountCode);
    const at = { field: "lines", details: { line: i } };
    if (!acc) return fail(422, "VALIDATION", `Line ${i + 1}: choose an account.`, at);
    if (!acc.postable) return fail(422, "VALIDATION", `Line ${i + 1}: ${acc.code} ${acc.name} is a group. Choose an account under it.`, at);
    if (!acc.active) return fail(422, "VALIDATION", `Line ${i + 1}: ${acc.code} ${acc.name} is no longer in use. Choose another account, or reactivate it in the chart of accounts.`, at);
    if (acc.campus && acc.campus !== body.campus) return fail(422, "VALIDATION", `Line ${i + 1}: ${acc.name} belongs to ${campusName(acc.campus)}, not ${campusName(body.campus)}.`, at);
    if (side && acc.control) {
      return fail(422, "VALIDATION", `Line ${i + 1}: ${acc.name} is filled by the ${acc.control === "FEE_OFFICE" ? "fee office" : "payroll"}. ${acc.control === "FEE_OFFICE" ? "Fee receipts are taken at the fee counter." : "Use a journal voucher for payroll corrections."}`, at);
    }
    if (side && acc.kind !== "OTHER" && acc.code === body.cashBankAccount) return fail(422, "VALIDATION", `Line ${i + 1}: the money can't go to and from the same account.`, at);
    const d = l.debit || 0;
    const c = l.credit || 0;
    if (side) {
      const amount = side === "PAYMENT" ? d : c;
      if (amount <= 0 || (side === "PAYMENT" ? c : d) > 0) return fail(422, "VALIDATION", `Line ${i + 1}: enter the amount.`, at);
    } else if ((d > 0 && c > 0) || (d === 0 && c === 0)) return fail(422, "VALIDATION", `Line ${i + 1}: enter either a debit or a credit.`, at);
  }
  if (!side) {
    const t = totalsOf(used);
    if (t.totalDebit !== t.totalCredit) {
      return fail(422, "OUT_OF_BALANCE", `Debits (${formatRs(t.totalDebit)}) must equal credits (${formatRs(t.totalCredit)}). Out of balance by ${formatRs(Math.abs(t.totalDebit - t.totalCredit))}.`, { field: "lines" });
    }
  }
  return closedFail(body.campus, body.date);
}

/** The stored shape: cash and bank vouchers get their cash or bank line from the header. */
function linesFrom(body: AccountsVoucherInput): AccountsJournalLine[] {
  const side = accountsVoucherSide(body.type);
  const used = body.lines.filter(usedLine);
  const lines: AccountsJournalLine[] = used.map((l, i) => ({ id: `l${i + 1}`, accountCode: l.accountCode, description: l.description.trim(), debit: l.debit || 0, credit: l.credit || 0 }));
  if (side && body.cashBankAccount) {
    const other = lines.reduce((a, l) => a + l.debit - l.credit, 0);
    lines.push({ id: `l${lines.length + 1}`, accountCode: body.cashBankAccount, description: body.party?.trim() ?? "", debit: other < 0 ? -other : 0, credit: other > 0 ? other : 0, contra: true });
  }
  return lines;
}

function build(body: AccountsVoucherInput, base: Partial<AccountsVoucher> & { id: string; createdBy: string; history: AccountsVoucher["history"] }): AccountsVoucher {
  const lines = linesFrom(body);
  const side = accountsVoucherSide(body.type);
  return {
    voucherNo: null,
    status: "DRAFT",
    system: false,
    ...base,
    type: body.type,
    campus: body.campus,
    campusName: campusName(body.campus),
    session: body.session,
    date: body.date,
    narration: body.narration.trim(),
    lines,
    ...totalsOf(lines),
    ...(side && body.cashBankAccount ? { cashBankAccount: body.cashBankAccount } : {}),
    ...(body.party?.trim() ? { party: body.party.trim() } : {}),
    ...(body.reference?.trim() ? { reference: body.reference.trim() } : {}),
    ...(side && body.cheque?.number.trim() ? { cheque: { number: body.cheque.number.trim(), date: body.cheque.date || body.date } } : {}),
    updatedAt: demoNow(),
  } as AccountsVoucher;
}

/** Account names on every line, for display. */
function decorate(v: AccountsVoucher): AccountsVoucher {
  const chart = chartMap();
  return { ...v, lines: v.lines.map((l) => ({ ...l, accountName: chart.get(l.accountCode)?.name ?? l.accountCode })) };
}

function nextNo(campus: CampusCode, session: number, type: AccountsVoucherType): { no: string; key: string; n: number } {
  const key = `${campus}:${session}:${type}`;
  const n = (store.get().seq[key] ?? 0) + 1;
  return { no: voucherNoOf(campus, type, session, n), key, n };
}

const saveVoucher = (v: AccountsVoucher) => store.set((s) => ({ ...s, vouchers: s.vouchers.some((x) => x.id === v.id) ? s.vouchers.map((x) => (x.id === v.id ? v : x)) : [v, ...s.vouchers] }));

function toRow(v: AccountsVoucher): AccountsVoucherRow {
  return {
    id: v.id,
    type: v.type,
    voucherNo: v.voucherNo,
    campus: v.campus,
    campusName: v.campusName,
    date: v.date,
    narration: v.narration,
    ...(v.party ? { party: v.party } : {}),
    amount: Math.max(v.totalDebit, v.totalCredit),
    totalDebit: v.totalDebit,
    totalCredit: v.totalCredit,
    status: v.status,
    system: v.system,
    lineCount: v.lines.length,
    createdBy: v.createdBy,
    ...(v.postedBy ? { postedBy: v.postedBy } : {}),
    rejected: Boolean(v.rejection),
  };
}

const STATUS_ORDER: Record<AccountsVoucher["status"], number> = { DRAFT: 0, SUBMITTED: 1, APPROVED: 2, POSTED: 3, REVERSED: 3 };

/* ================================================================== Reports */

/** Opening = session opening plus anything before `from`; movement = `from` to `asOf`; closing at `asOf`. */
function trialBalance(session: number, scope: CampusScope, from: IsoDate, asOf: IsoDate): AccountsTrialBalance {
  const chart = store.get().chart;
  const ps = postings(session, scope).filter((p) => p.date <= asOf);
  const open = new Map<string, number>();
  const dr = new Map<string, number>();
  const cr = new Map<string, number>();
  const vouchers = new Set<string>();
  for (const p of ps) {
    if (p.v.type === "OPENING" || p.date < from) open.set(p.code, (open.get(p.code) ?? 0) + p.debit - p.credit);
    else {
      dr.set(p.code, (dr.get(p.code) ?? 0) + p.debit);
      cr.set(p.code, (cr.get(p.code) ?? 0) + p.credit);
      vouchers.add(p.v.id);
    }
  }
  const sum = (code: string, m: Map<string, number>): number => {
    const a = chart.find((x) => x.code === code);
    if (!a) return 0;
    if (a.postable) return m.get(code) ?? 0;
    return chart.filter((c) => c.parentCode === code && visible(c, scope)).reduce((s, c) => s + sum(c.code, m), 0);
  };
  const rows: AccountsTrialRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of chart.filter((x) => x.parentCode === parent && visible(x, scope)).sort((x, y) => x.code.localeCompare(y.code))) {
      const o = sum(a.code, open);
      const d = sum(a.code, dr);
      const c = sum(a.code, cr);
      if (a.postable && o === 0 && d === 0 && c === 0) continue;
      rows.push({ code: a.code, name: a.name, accountClass: a.accountClass, parentCode: a.parentCode, postable: a.postable, depth, opening: o, debit: d, credit: c, closing: o + d - c, ...(a.note && a.code === "2901" ? { note: a.note } : {}) });
      if (!a.postable) walk(a.code, depth + 1);
    }
  };
  walk(null, 0);
  const leaves = rows.filter((r) => r.postable);
  const totals = {
    openingDebit: leaves.reduce((a, r) => a + Math.max(0, r.opening), 0),
    openingCredit: leaves.reduce((a, r) => a + Math.max(0, -r.opening), 0),
    debit: leaves.reduce((a, r) => a + r.debit, 0),
    credit: leaves.reduce((a, r) => a + r.credit, 0),
    closingDebit: leaves.reduce((a, r) => a + Math.max(0, r.closing), 0),
    closingCredit: leaves.reduce((a, r) => a + Math.max(0, -r.closing), 0),
  };
  return { from, asOf, sessionStart: sessionStart(session), campus: scope, rows, totals, balanced: totals.closingDebit === totals.closingCredit, difference: totals.closingDebit - totals.closingCredit, vouchers: vouchers.size };
}

/** True when `code` sits anywhere under `group` (through any sub-groups). */
function isUnder(code: string, group: string, chart: Map<string, AccountRecord>): boolean {
  let cur = chart.get(code)?.parentCode ?? null;
  while (cur) {
    if (cur === group) return true;
    cur = chart.get(cur)?.parentCode ?? null;
  }
  return false;
}

/** The groups directly under a class ("4" → 41, 42), so groups added in the chart show on the statements too. */
const groupsUnder = (cls: string) =>
  store
    .get()
    .chart.filter((a) => a.parentCode === cls && !a.postable)
    .map((a) => a.code)
    .sort();

/** One statement block per group, listing every account under it, sub-groups included. */
function groupsOf(prefixes: string[], net: Map<string, number>, sign: 1 | -1, scope: CampusScope): AccountsStatementGroup[] {
  const chart = store.get().chart;
  const byCode = new Map(chart.map((a) => [a.code, a]));
  return prefixes
    .map((g) => {
      const grp = byCode.get(g);
      const accounts = chart
        .filter((a) => a.postable && visible(a, scope) && isUnder(a.code, g, byCode))
        .map((a) => ({ code: a.code, name: a.name, amount: sign * (net.get(a.code) ?? 0) }))
        .filter((a) => a.amount !== 0);
      return { code: g, name: grp?.name ?? g, amount: accounts.reduce((s, a) => s + a.amount, 0), accounts };
    })
    .filter((g) => g.accounts.length > 0);
}

function incomeExpenditure(session: number, scope: CampusScope, from: IsoDate, to: IsoDate): AccountsIncomeExpenditure {
  const ps = postings(session, scope).filter((p) => p.v.type !== "OPENING" && p.date >= from && p.date <= to);
  const net = netOf(ps);
  const income = groupsOf(groupsUnder("4"), net, -1, scope);
  const expenses = groupsOf(groupsUnder("5"), net, 1, scope);
  const totalIncome = income.reduce((a, g) => a + g.amount, 0);
  const totalExpenses = expenses.reduce((a, g) => a + g.amount, 0);
  const months = sessionMonths(session)
    .filter((m) => `${m}-01` <= to && monthEndIso(m) >= from)
    .map((m) => {
      let inc = 0;
      let exp = 0;
      for (const p of ps) {
        if (monthOf(p.date) !== m) continue;
        if (p.code[0] === "4") inc += p.credit - p.debit;
        else if (p.code[0] === "5") exp += p.debit - p.credit;
      }
      return { month: m, income: inc, expenses: exp };
    });
  const out: AccountsIncomeExpenditure = { from, to, income, expenses, totalIncome, totalExpenses, surplus: totalIncome - totalExpenses, months };
  if (scope === "ALL") {
    out.campuses = ACC_CAMPUSES.map((c) => {
      let inc = 0;
      let exp = 0;
      for (const p of ps) {
        if (p.campus !== c) continue;
        if (p.code[0] === "4") inc += p.credit - p.debit;
        else if (p.code[0] === "5") exp += p.debit - p.credit;
      }
      return { campus: c, campusName: campusName(c), income: inc, expenses: exp, surplus: inc - exp };
    });
  }
  return out;
}

function balanceSheet(session: number, scope: CampusScope, asOf: IsoDate): AccountsBalanceSheet {
  const ps = postings(session, scope).filter((p) => p.date <= asOf);
  const net = netOf(ps);
  const assets = groupsOf(groupsUnder("1"), net, 1, scope);
  const liabilities = groupsOf(groupsUnder("2"), net, -1, scope);
  const equity = groupsOf(groupsUnder("3"), net, -1, scope);
  let surplus = 0;
  for (const [code, n] of net) if (code[0] === "4" || code[0] === "5") surplus -= n;
  const totalAssets = assets.reduce((a, g) => a + g.amount, 0);
  const totalLiabilities = liabilities.reduce((a, g) => a + g.amount, 0);
  const totalEquity = equity.reduce((a, g) => a + g.amount, 0) + surplus;
  return {
    asOf,
    assets,
    liabilities,
    equity,
    surplusThisSession: surplus,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanced: totalAssets === totalLiabilities + totalEquity,
    feeArrears: scope === "ALL" ? ACC_CAMPUSES.reduce((a, c) => a + FEE_ARREARS[c], 0) : FEE_ARREARS[scope],
  };
}

/** "2026–27" */
const formatSessionLabel = (session: number) => `${session}–${String((session + 1) % 100).padStart(2, "0")}`;

/* ================================================================== For the report centre (handlers/reports.ts) */

/** Report-centre dates kept inside the session, as the Accounts pages keep them; `clamped` says when they moved. */
function reportDates(session: number, from: IsoDate, to: IsoDate) {
  const lo = clampDate(from, session);
  const hi = clampDate(to, session);
  return { from: lo > hi ? hi : lo, to: hi, clamped: lo !== from || hi !== to };
}

/** The trial balance exactly as Accounts › Trial balance works it out (opening before `from`, movement to `asOf`). */
export function accountsReportTrialBalance(session: number, scope: CampusScope, from: IsoDate, asOf: IsoDate): AccountsTrialBalance & { clamped: boolean } {
  syncFeeCancellations();
  const d = reportDates(session, from, asOf);
  return { ...trialBalance(session, scope, d.from, d.to), clamped: d.clamped };
}

/** Income and expenses per account for a period (Accounts › Statements reads the same postings). */
export function accountsReportIncomeExpenditure(session: number, scope: CampusScope, from: IsoDate, to: IsoDate): AccountsIncomeExpenditure & { clamped: boolean } {
  syncFeeCancellations();
  const d = reportDates(session, from, to);
  return { ...incomeExpenditure(session, scope, d.from, d.to), clamped: d.clamped };
}

/** A book over several accounts (cash in hand, a bank, every bank): opening, then each posted line with its running balance. */
export function accountsReportBook(session: number, scope: CampusScope, pick: (a: { code: string; kind: string }) => boolean, from: IsoDate, to: IsoDate) {
  syncFeeCancellations();
  const d = reportDates(session, from, to);
  const accounts = store.get().chart.filter((a) => a.postable && visible(a, scope) && pick(a));
  const codes = new Set(accounts.map((a) => a.code));
  const ps = postings(session, scope).filter((p) => codes.has(p.code));
  const opening = ps.filter((p) => p.v.type === "OPENING" || p.date < d.from).reduce((a, p) => a + p.debit - p.credit, 0);
  let run = opening;
  const lines = ps
    .filter((p) => p.v.type !== "OPENING" && p.date >= d.from && p.date <= d.to)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.v.postedAt ?? "").localeCompare(b.v.postedAt ?? "") || (a.v.voucherNo ?? "").localeCompare(b.v.voucherNo ?? ""))
    .map((p) => {
      run += p.debit - p.credit;
      return { date: p.date, campus: p.campus, voucherNo: p.v.voucherNo ?? "", account: p.code, narration: p.v.narration, description: p.line.description, debit: p.debit, credit: p.credit, balance: run };
    });
  return { ...d, accounts: accounts.map((a) => ({ code: a.code, name: a.name })), opening, lines, closing: run };
}

/** Vouchers dated in a period (drafts and those waiting included), oldest first, for the voucher register. */
export function accountsReportVouchers(session: number, scope: CampusScope, from: IsoDate, to: IsoDate): AccountsVoucher[] {
  syncFeeCancellations();
  return allVouchers(session)
    .filter((v) => v.type !== "OPENING" && inScope(v.campus, scope) && v.date >= from && v.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.voucherNo ?? "").localeCompare(b.voucherNo ?? ""));
}

/* ================================================================== Handlers */

/** The "Manual #" of a ledger line: the voucher's own reference, else what identifies a system voucher. */
function ledgerReference(v: AccountsVoucher): string | undefined {
  if (v.reference) return v.reference;
  // The fee batch's day, as the bank statement shows fee credits.
  if (v.source?.kind === "FEE_BATCH") return `FEE-${v.source.date.replace(/-/g, "").slice(2)}`;
  if (v.source?.kind === "RECEIPT_CANCELLATION") return v.source.receiptNo;
  return undefined;
}

const bad = (r: unknown): r is Response => r instanceof Response;
const parseDate = (v: string | null): IsoDate | undefined => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const clampDate = (d: IsoDate, session: number) => (d < sessionStart(session) ? sessionStart(session) : d > asOfFor(session) ? asOfFor(session) : d);

export const accountsHandlers: HttpHandler[] = [
  /* ---------------- Overview */
  http.get("/api/accounts/overview", async ({ request }) => {
    await latency();
    syncFeeCancellations();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("accounts.view", ctx.campus);
    if (bad(user)) return user;
    const asOf = asOfFor(ctx.session);
    const ps = postings(ctx.session, ctx.campus).filter((p) => p.date <= asOf);
    const chart = chartMap();
    const cashBankCodes = [...chart.values()].filter((a) => a.postable && (a.kind === "CASH" || a.kind === "BANK") && visible(a, ctx.campus)).map((a) => a.code);
    const net = netOf(ps);
    // Daily totals for the last 30 days.
    const days: IsoDate[] = [];
    for (let d = addDaysIso(asOf, -29); d <= asOf; d = addDaysIso(d, 1)) days.push(d);
    const perAccount = new Map<string, number[]>();
    const byCode = new Map<string, Posting[]>();
    for (const p of ps) if (cashBankCodes.includes(p.code)) byCode.set(p.code, [...(byCode.get(p.code) ?? []), p]);
    for (const code of cashBankCodes) {
      const mine = byCode.get(code) ?? [];
      const perDay = new Map<IsoDate, number>();
      let run = 0;
      for (const p of mine) {
        if (p.date < days[0]!) run += p.debit - p.credit;
        else perDay.set(p.date, (perDay.get(p.date) ?? 0) + p.debit - p.credit);
      }
      perAccount.set(
        code,
        days.map((d) => {
          run += perDay.get(d) ?? 0;
          return run;
        }),
      );
    }
    const trend = days.map((date, i) => ({ date, balance: [...perAccount.values()].reduce((a, s) => a + (s[i] ?? 0), 0) }));
    const cash = cashBankCodes.filter((c) => chart.get(c)?.kind === "CASH").reduce((a, c) => a + (net.get(c) ?? 0), 0);
    const bankTotal = cashBankCodes.filter((c) => chart.get(c)?.kind === "BANK").reduce((a, c) => a + (net.get(c) ?? 0), 0);

    const month = monthOf(asOf);
    const flows = (pred: (p: Posting) => boolean) => {
      let inc = 0;
      let exp = 0;
      for (const p of ps) {
        if (!pred(p) || p.v.type === "OPENING") continue;
        if (p.code[0] === "4") inc += p.credit - p.debit;
        else if (p.code[0] === "5") exp += p.debit - p.credit;
      }
      return { income: inc, expenses: exp, surplus: inc - exp };
    };

    const all = allVouchers(ctx.session).filter((v) => inScope(v.campus, ctx.campus));
    const index = feeLedgerIndex();
    const campuses = ctx.campus === "ALL" ? ACC_CAMPUSES : [ctx.campus];
    const feeDifferences: AccountsOverview["attention"]["feeDifferences"] = [];
    const openFeeBatches: AccountsOverview["attention"]["openFeeBatches"] = [];
    if (ctx.session === CURRENT_SESSION) {
      for (const c of campuses) {
        for (let d = "2026-10-01"; d <= TODAY; d = addDaysIso(d, 1)) {
          const b = feeBatch(c, d, index);
          if (!b) continue;
          if (b.status === "OPEN") openFeeBatches.push({ campus: c, campusName: campusName(c), amount: b.feeOfficeTotal, receipts: b.receipts });
          else if (b.difference !== 0) feeDifferences.push({ campus: c, campusName: campusName(c), date: d, difference: b.difference });
        }
      }
    }
    const banks = [...chart.values()].filter((a) => a.kind === "BANK" && a.campus && campuses.includes(a.campus));
    const unmatchedBank = banks.reduce((a, b) => a + bankAccountInfo(b).unmatched, 0);
    const periodsToClose: AccountsOverview["attention"]["periodsToClose"] = [];
    if (ctx.session === CURRENT_SESSION) {
      for (const c of campuses) {
        const m = sessionMonths(ctx.session).find((x) => periodStatus(c, x) === "OPEN" && monthEndIso(x) < TODAY);
        if (m) periodsToClose.push({ campus: c, campusName: campusName(c), month: m });
      }
    }
    const cashToDeposit = ctx.session === CURRENT_SESSION ? Math.max(0, cashBankCodes.filter((c) => c === "1101").reduce((a, c) => a + (net.get(c) ?? 0), 0) - campuses.length * 50000) : 0;
    const manual = all.filter((v) => !v.system);
    const recent = [...manual].sort((a, b) => (b.postedAt ?? b.updatedAt).localeCompare(a.postedAt ?? a.updatedAt)).slice(0, 6).map(toRow);

    const body: AccountsOverview = {
      asOf,
      cashBank: {
        cash,
        bank: bankTotal,
        total: cash + bankTotal,
        accounts: cashBankCodes.map((code) => {
          const a = chart.get(code)!;
          return { code, name: a.name, ...(a.campus ? { campus: a.campus } : {}), kind: a.kind, balance: net.get(code) ?? 0, trend: perAccount.get(code) ?? [] };
        }),
        trend,
      },
      month: { month, ...flows((p) => monthOf(p.date) === month) },
      sessionToDate: flows(() => true),
      attention: {
        outOfBalance: manual.filter((v) => v.status === "DRAFT" && v.totalDebit !== v.totalCredit).map((v) => ({ id: v.id, narration: v.narration, difference: v.totalDebit - v.totalCredit, campusName: v.campusName, type: v.type })),
        drafts: manual.filter((v) => v.status === "DRAFT").length,
        waitingApproval: manual.filter((v) => v.status === "SUBMITTED").length,
        approved: manual.filter((v) => v.status === "APPROVED").length,
        rejected: manual.filter((v) => v.status === "DRAFT" && v.rejection).length,
        feeDifferences,
        openFeeBatches,
        unmatchedBank,
        cashToDeposit,
        periodsToClose,
      },
      recent,
    };
    return HttpResponse.json(body);
  }),

  /* ---------------- Chart of accounts */
  http.get("/api/accounts/chart", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("accounts.view", ctx.campus);
    if (bad(user)) return user;
    return HttpResponse.json(chartFor(ctx.campus, ctx.session));
  }),

  http.post("/api/accounts/chart", async ({ request }) => {
    await latency();
    const body = (await request.json()) as AccountsNewAccountInput;
    const user = requirePermission("accounts.post", body.campus ?? "ALL");
    if (bad(user)) return user;
    const chart = store.get().chart;
    const parent = chart.find((a) => a.code === body.parentCode);
    if (!parent) return fail(422, "VALIDATION", "Choose the group this account belongs under.", { field: "parentCode" });
    if (parent.postable) return fail(422, "VALIDATION", `${parent.code} ${parent.name} takes postings, so it can't have sub-accounts. Choose a group.`, { field: "parentCode" });
    // Under a class: a group (one more digit). Under a group: an account, or a sub-group (two more digits either way).
    const underClass = parent.parentCode === null;
    const postable = underClass ? false : body.postable !== false;
    if (!postable && !underClass) {
      const leaf = chart.find((a) => a.parentCode === parent.code && a.postable);
      if (leaf) return fail(422, "VALIDATION", `${parent.code} ${parent.name} already has accounts under it (${leaf.code} ${leaf.name}), so it can't also have sub-groups. Add an account here, or the sub-group under another group.`, { field: "postable" });
    }
    const code = (body.code ?? "").trim();
    const want = parent.code.length + (underClass ? 1 : 2);
    if (want > 10) return fail(422, "VALIDATION", "The chart can't go any deeper here. Add the account under a higher group.", { field: "parentCode" });
    if (!/^\d+$/.test(code) || code.length !== want || !code.startsWith(parent.code)) {
      return fail(422, "VALIDATION", `The code must be ${want} digits and start with ${parent.code}.`, { field: "code" });
    }
    if (chart.some((a) => a.code === code)) return fail(422, "VALIDATION", `Code ${code} is already used. Try the suggested code.`, { field: "code" });
    const name = (body.name ?? "").trim();
    if (!name) return fail(422, "VALIDATION", "Enter the account name.", { field: "name" });
    if (chart.some((a) => a.parentCode === parent.code && a.name.toLowerCase() === name.toLowerCase())) {
      return fail(422, "VALIDATION", `${parent.name} already has an account called ${name}.`, { field: "name" });
    }
    const kind = postable ? (body.kind ?? "OTHER") : "OTHER";
    if (kind !== "OTHER" && parent.code !== "11" && !isUnder(parent.code, "11", new Map(chart.map((a) => [a.code, a])))) return fail(422, "VALIDATION", "Cash and bank accounts go under 11 Cash and bank.", { field: "kind" });
    const normalSide = body.normalSide === "DEBIT" || body.normalSide === "CREDIT" ? body.normalSide : parent.normalSide;
    if (kind === "BANK") {
      if (!body.campus) return fail(422, "VALIDATION", "A bank account belongs to one campus. Choose the campus.", { field: "campus" });
      if (!body.bank?.bankName.trim()) return fail(422, "VALIDATION", "Enter the bank's name.", { field: "bankName" });
      if (!/^\d{4}$/.test((body.bank.accountNoMasked ?? "").replace(/\D/g, "").slice(-4))) return fail(422, "VALIDATION", "Enter the last four digits of the account number.", { field: "accountNo" });
    }
    const record: AccountRecord = {
      code,
      name,
      accountClass: parent.accountClass,
      parentCode: parent.code,
      postable,
      normalSide,
      kind,
      ...(body.campus ? { campus: body.campus } : {}),
      ...(kind === "BANK" && body.bank ? { bank: { bankName: body.bank.bankName.trim(), branch: body.bank.branch.trim(), accountNoMasked: `•••• ${body.bank.accountNoMasked.replace(/\D/g, "").slice(-4)}` } } : {}),
      ...(body.note?.trim() ? { note: body.note.trim() } : {}),
      active: true,
    };
    store.set((s) => ({ ...s, chart: [...s.chart, record].sort((a, b) => a.code.localeCompare(b.code)) }));
    const all = store.get().chart;
    return HttpResponse.json(toAccount(record, all, new Map(), "ALL", usedCodes()), { status: 201 });
  }),

  http.patch("/api/accounts/chart/:code", async ({ params, request }) => {
    await latency();
    const code = String(params.code);
    const chart = store.get().chart;
    const acc = chart.find((a) => a.code === code);
    if (!acc) return fail(404, "NOT_FOUND", "No account with this code.");
    const user = requirePermission("accounts.post", acc.campus ?? "ALL");
    if (bad(user)) return user;
    const body = (await request.json()) as AccountsAccountUpdate;
    const next: AccountRecord = { ...acc };
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return fail(422, "VALIDATION", "Enter the account name.", { field: "name" });
      if (chart.some((a) => a.code !== code && a.parentCode === acc.parentCode && a.name.toLowerCase() === name.toLowerCase())) return fail(422, "VALIDATION", `Another account in this group is already called ${name}.`, { field: "name" });
      next.name = name;
    }
    if (body.note !== undefined) {
      if (body.note.trim()) next.note = body.note.trim();
      else delete next.note;
    }
    const used = usedCodes();
    if (body.campus !== undefined && (body.campus ?? undefined) !== acc.campus) {
      if (!acc.postable) return fail(422, "VALIDATION", "Groups are shared by every campus.", { field: "campus" });
      if (used.has(code)) return fail(422, "VALIDATION", "Vouchers already use this account, so its campus can't change. Add a new account instead.", { field: "campus" });
      if (acc.kind === "BANK" && body.campus === null) return fail(422, "VALIDATION", "A bank account belongs to one campus.", { field: "campus" });
      if (body.campus) next.campus = body.campus;
      else delete next.campus;
    }
    if (body.bank && acc.kind === "BANK") next.bank = { ...body.bank };
    if (body.active !== undefined && body.active !== acc.active) {
      if (!body.active) {
        if (acc.control) return fail(409, "IN_USE", `${acc.name} is filled by the ${acc.control === "FEE_OFFICE" ? "fee office" : "payroll"} and can't be switched off.`);
        if (Object.values(store.get().postingRules).includes(code)) return fail(409, "IN_USE", `Fee collections post to ${acc.name}. Change the posting rule first.`);
        if (!acc.postable) {
          const liveChild = chart.find((a) => a.parentCode === code && a.active);
          if (liveChild) return fail(409, "IN_USE", `Switch off the accounts under ${acc.name} first (${liveChild.code} ${liveChild.name} is still in use).`);
        } else {
          const all = netOf(postings(CURRENT_SESSION, "ALL"), (p) => p.date <= TODAY).get(code) ?? 0;
          if (all !== 0) return fail(409, "IN_USE", `${acc.name} still has a balance of ${formatRs(Math.abs(all))} ${all > 0 ? "Dr" : "Cr"}. Move the balance with a journal voucher first.`);
          const drafts = store.get().vouchers.filter((v) => v.status !== "POSTED" && v.status !== "REVERSED" && v.lines.some((l) => l.accountCode === code));
          if (drafts.length) return fail(409, "IN_USE", `${drafts.length} unposted voucher${drafts.length === 1 ? " uses" : "s use"} this account. Post or change ${drafts.length === 1 ? "it" : "them"} first.`);
        }
      } else if (acc.parentCode) {
        const parent = chart.find((a) => a.code === acc.parentCode);
        if (parent && !parent.active) return fail(409, "PARENT_INACTIVE", `Switch ${parent.name} back on first.`);
      }
      next.active = body.active;
    }
    store.set((s) => ({ ...s, chart: s.chart.map((a) => (a.code === code ? next : a)) }));
    const scope: CampusScope = next.campus ?? "ALL";
    const net = netOf(postings(CURRENT_SESSION, scope), (p) => p.date <= TODAY);
    return HttpResponse.json(toAccount(next, store.get().chart, net, scope, usedCodes()));
  }),

  /* ---------------- Vouchers */
  http.get("/api/accounts/vouchers", async ({ request }) => {
    await latency();
    syncFeeCancellations();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("accounts.view", ctx.campus);
    if (bad(user)) return user;
    const sp = url.searchParams;
    const type = sp.get("type") ?? "ALL";
    const status = (sp.get("status") ?? "ALL") as AccountsStatusFilter;
    const from = parseDate(sp.get("from"));
    const to = parseDate(sp.get("to"));
    const q = (sp.get("q") ?? "").trim().toLowerCase();
    const qDigits = q.replace(/[^\d]/g, "");
    const account = sp.get("account") ?? "";
    const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
    const pageSize = Math.min(500, Math.max(5, Number(sp.get("pageSize") ?? 25) || 25));
    const base = allVouchers(ctx.session).filter((v) => {
      if (!inScope(v.campus, ctx.campus)) return false;
      if (type === "MANUAL" && v.system) return false;
      if (type === "SYSTEM" && !v.system) return false;
      if (type !== "ALL" && type !== "MANUAL" && type !== "SYSTEM" && v.type !== type) return false;
      if (from && v.date < from) return false;
      if (to && v.date > to) return false;
      if (account && !v.lines.some((l) => l.accountCode === account)) return false;
      if (q) {
        const hay = `${v.voucherNo ?? ""} ${v.narration} ${v.party ?? ""} ${v.reference ?? ""} ${v.cheque?.number ?? ""}`.toLowerCase();
        const amountHit = qDigits.length >= 3 && (String(v.totalDebit) === qDigits || String(v.totalCredit) === qDigits);
        if (!hay.includes(q) && !amountHit) return false;
      }
      return true;
    });
    const counts: Record<AccountsStatusFilter, number> = { ALL: base.length, DRAFT: 0, SUBMITTED: 0, APPROVED: 0, POSTED: 0, REVERSED: 0 };
    for (const v of base) counts[v.status]++;
    const list = base
      .filter((v) => status === "ALL" || v.status === status)
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.date.localeCompare(a.date) || (b.voucherNo ?? "").localeCompare(a.voucherNo ?? "") || b.updatedAt.localeCompare(a.updatedAt));
    const body: AccountsVoucherList = { items: list.slice((page - 1) * pageSize, page * pageSize).map(toRow), total: list.length, page, pageSize, counts };
    return HttpResponse.json(body);
  }),

  http.get("/api/accounts/vouchers/:id", async ({ params }) => {
    await latency();
    syncFeeCancellations();
    const v = findVoucher(String(params.id));
    if (!v) return fail(404, "NOT_FOUND", "No voucher with this reference.");
    const user = requirePermission("accounts.view", v.campus);
    if (bad(user)) return user;
    return HttpResponse.json(decorate(v));
  }),

  http.post("/api/accounts/vouchers", async ({ request }) => {
    await latency();
    const body = (await request.json()) as AccountsVoucherInput;
    const user = requirePermission("accounts.post", body.campus ?? "ALL");
    if (bad(user)) return user;
    const b = basicChecks(body);
    if (b) return b;
    const at = demoNow();
    const v = build(body, { id: newId(), createdBy: user.name, history: [{ action: "CREATED", by: user.name, at }] });
    saveVoucher(v);
    return HttpResponse.json(decorate(v), { status: 201 });
  }),

  http.put("/api/accounts/vouchers/:id", async ({ params, request }) => {
    await latency();
    const existing = store.get().vouchers.find((x) => x.id === params.id);
    if (!existing) return fail(404, "NOT_FOUND", "No voucher with this reference.");
    if (existing.status !== "DRAFT") return fail(409, "NOT_EDITABLE", existing.status === "SUBMITTED" ? "This voucher is waiting for approval. Ask the approver to send it back if it needs changes." : "Posted and approved vouchers can't be changed.");
    const body = (await request.json()) as AccountsVoucherInput;
    const user = requirePermission("accounts.post", body.campus ?? existing.campus);
    if (bad(user)) return user;
    const b = basicChecks(body);
    if (b) return b;
    if (body.type !== existing.type) return fail(422, "VALIDATION", "The kind of voucher can't change after it is saved. Start a new voucher instead.", { field: "type" });
    const { id: _id, ...keep } = existing;
    const v = build(body, { ...keep, id: existing.id, history: [...existing.history, { action: "EDITED", by: user.name, at: demoNow() }] });
    saveVoucher(v);
    return HttpResponse.json(decorate(v));
  }),

  http.delete("/api/accounts/vouchers/:id", async ({ params }) => {
    await latency();
    const existing = store.get().vouchers.find((x) => x.id === params.id);
    if (!existing) return fail(404, "NOT_FOUND", "No voucher with this reference.");
    const user = requirePermission("accounts.post", existing.campus);
    if (bad(user)) return user;
    if (existing.status !== "DRAFT") return fail(409, "NOT_EDITABLE", "Only drafts can be discarded. Posted vouchers are corrected with a reversing voucher.");
    store.set((s) => ({ ...s, vouchers: s.vouchers.filter((v) => v.id !== existing.id) }));
    return HttpResponse.json({ status: "ok" });
  }),

  http.post("/api/accounts/vouchers/:id/submit", async ({ params, request }) => {
    await latency();
    const existing = store.get().vouchers.find((x) => x.id === params.id);
    if (!existing) return fail(404, "NOT_FOUND", "No voucher with this reference.");
    if (existing.status !== "DRAFT") return fail(409, "NOT_EDITABLE", "This voucher has already been sent for approval.");
    const body = (await request.json()) as AccountsVoucherInput;
    const user = requirePermission("accounts.post", body.campus ?? existing.campus);
    if (bad(user)) return user;
    if (body.type === "JV") return fail(422, "VALIDATION", "Journal vouchers are posted by the accountant without approval.");
    const b = basicChecks(body) ?? fullChecks(body, chartMap());
    if (b) return b;
    const at = demoNow();
    const { id: _id, rejection: _r, ...keep } = existing;
    const v = build(body, { ...keep, id: existing.id, status: "SUBMITTED", submittedBy: user.name, submittedAt: at, history: [...existing.history, { action: "SUBMITTED", by: user.name, at }] });
    saveVoucher(v);
    return HttpResponse.json(decorate(v));
  }),

  http.post("/api/accounts/vouchers/:id/approve", async ({ params, request }) => {
    await latency();
    const existing = store.get().vouchers.find((x) => x.id === params.id);
    if (!existing) return fail(404, "NOT_FOUND", "No voucher with this reference.");
    const user = requireUser();
    if (bad(user)) return user;
    if (!can(user, "approvals.decide", existing.campus) || !can(user, "accounts.view", existing.campus)) return fail(403, "FORBIDDEN", "Your role can't approve vouchers at this campus.");
    if (existing.status !== "SUBMITTED") return fail(409, "NOT_WAITING", "This voucher isn't waiting for approval any more.");
    if (existing.createdBy === user.name || existing.submittedBy === user.name) return fail(403, "OWN_VOUCHER", "You prepared this voucher, so someone else must approve it.");
    const { note } = (await request.json()) as { note?: string };
    const at = demoNow();
    const v: AccountsVoucher = { ...existing, status: "APPROVED", approvedBy: user.name, approvedAt: at, updatedAt: at, history: [...existing.history, { action: "APPROVED", by: user.name, at, ...(note?.trim() ? { note: note.trim() } : {}) }] };
    saveVoucher(v);
    return HttpResponse.json(decorate(v));
  }),

  http.post("/api/accounts/vouchers/:id/reject", async ({ params, request }) => {
    await latency();
    const existing = store.get().vouchers.find((x) => x.id === params.id);
    if (!existing) return fail(404, "NOT_FOUND", "No voucher with this reference.");
    const user = requireUser();
    if (bad(user)) return user;
    if (!can(user, "approvals.decide", existing.campus) || !can(user, "accounts.view", existing.campus)) return fail(403, "FORBIDDEN", "Your role can't approve vouchers at this campus.");
    if (existing.status !== "SUBMITTED" && existing.status !== "APPROVED") return fail(409, "NOT_WAITING", "Only vouchers waiting for approval, or approved but not posted, can be sent back.");
    const { reason } = (await request.json()) as { reason?: string };
    if (!reason || reason.trim().length < 5) return fail(422, "VALIDATION", "Say what needs to change, so the accountant can fix it.", { field: "reason" });
    const at = demoNow();
    const { approvedBy: _a, approvedAt: _b, ...rest } = existing;
    const v: AccountsVoucher = { ...rest, status: "DRAFT", rejection: { by: user.name, at, reason: reason.trim() }, updatedAt: at, history: [...existing.history, { action: "REJECTED", by: user.name, at, note: reason.trim() }] };
    saveVoucher(v);
    return HttpResponse.json(decorate(v));
  }),

  http.post("/api/accounts/vouchers/:id/post", async ({ params, request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
    const done = store.get().idem[key];
    if (done) {
      const already = findVoucher(done);
      if (already) return HttpResponse.json(decorate(already));
    }
    const id = String(params.id);
    const existing = id === "new" ? undefined : store.get().vouchers.find((x) => x.id === id);
    if (id !== "new" && !existing) return fail(404, "NOT_FOUND", "No voucher with this reference.");
    if (existing && existing.status === "POSTED") return fail(409, "ALREADY_POSTED", "This voucher is already posted.");
    const raw = (await request.json().catch(() => ({}))) as Partial<AccountsVoucherInput>;
    const at = demoNow();

    // Approved cash and bank vouchers are posted exactly as approved.
    if (existing && existing.type !== "JV") {
      const user = requirePermission("accounts.post", existing.campus);
      if (bad(user)) return user;
      if (existing.status !== "APPROVED") return fail(409, "NOT_APPROVED", existing.status === "SUBMITTED" ? "This voucher is still waiting for approval." : "Send this voucher for approval first.");
      if (existing.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "2025–26 is closed.");
      const closed = closedFail(existing.campus, existing.date);
      if (closed) return closed;
      const n = nextNo(existing.campus, existing.session, existing.type);
      const posted: AccountsVoucher = { ...existing, voucherNo: n.no, status: "POSTED", postedBy: user.name, postedAt: at, updatedAt: at, history: [...existing.history, { action: "POSTED", by: user.name, at }] };
      store.set((s) => ({ ...s, seq: { ...s.seq, [n.key]: n.n }, idem: { ...s.idem, [key]: posted.id }, vouchers: s.vouchers.map((x) => (x.id === posted.id ? posted : x)) }));
      return HttpResponse.json(decorate(posted), { status: 201 });
    }

    // Journal vouchers: save the final lines and post in one step.
    const body = { type: "JV", ...raw } as AccountsVoucherInput;
    const user = requirePermission("accounts.post", body.campus ?? "ALL");
    if (bad(user)) return user;
    if (body.type !== "JV") return fail(422, "VALIDATION", "Cash and bank vouchers are approved before they are posted. Send it for approval.");
    if (existing && existing.status !== "DRAFT") return fail(409, "ALREADY_POSTED", "This voucher is already posted.");
    const b = basicChecks(body) ?? fullChecks(body, chartMap());
    if (b) return b;
    const n = nextNo(body.campus, CURRENT_SESSION, "JV");
    const history = [...(existing?.history ?? [{ action: "CREATED" as const, by: user.name, at }]), { action: "POSTED" as const, by: user.name, at }];
    const posted = build(body, { id: existing?.id ?? newId(), createdBy: existing?.createdBy ?? user.name, voucherNo: n.no, status: "POSTED", postedBy: user.name, postedAt: at, history });
    store.set((s) => ({
      ...s,
      seq: { ...s.seq, [n.key]: n.n },
      idem: { ...s.idem, [key]: posted.id },
      vouchers: existing ? s.vouchers.map((x) => (x.id === posted.id ? posted : x)) : [posted, ...s.vouchers],
    }));
    return HttpResponse.json(decorate(posted), { status: 201 });
  }),

  http.post("/api/accounts/vouchers/:id/reverse", async ({ params, request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
    const done = store.get().idem[key];
    if (done) {
      const already = findVoucher(done);
      if (already) return HttpResponse.json(decorate(already));
    }
    const original = findVoucher(String(params.id));
    if (!original) return fail(404, "NOT_FOUND", "No voucher with this reference.");
    const user = requirePermission("accounts.post", original.campus);
    if (bad(user)) return user;
    if (original.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "2025–26 is closed. Corrections go in the current session.");
    if (original.status === "REVERSED") return fail(409, "ALREADY_REVERSED", `Already reversed by ${original.reversal?.voucherNo ?? "another voucher"}.`);
    if (original.status !== "POSTED") return fail(409, "NOT_POSTED", "Only posted vouchers are reversed. Change or discard a draft instead.");
    if (!MANUAL.includes(original.type)) return fail(409, "SYSTEM_VOUCHER", original.type === "FEE" ? "Fee batches follow the fee office. Cancel the receipt at the fee office instead." : "Vouchers posted by the system can't be reversed by hand.");
    if (original.reverses) return fail(409, "IS_REVERSAL", "This voucher is itself a reversal. Post a new voucher instead.");
    const { reason, date } = (await request.json()) as { reason?: string; date?: IsoDate };
    if (!reason || reason.trim().length < 5) return fail(422, "VALIDATION", "Say why the voucher is being reversed.", { field: "reason" });
    if (!date || date > TODAY || date < original.date || date < sessionStart(CURRENT_SESSION)) return fail(422, "VALIDATION", `Choose a date from ${formatDate(original.date)} to today.`, { field: "date" });
    const closed = closedFail(original.campus, date);
    if (closed) return closed;
    const at = demoNow();
    const n = nextNo(original.campus, CURRENT_SESSION, "JV");
    const lines = original.lines.map((l, i) => ({ id: `l${i + 1}`, accountCode: l.accountCode, description: l.description ? `Reversal: ${l.description}` : "Reversal", debit: l.credit, credit: l.debit }));
    const reversal: AccountsVoucher = {
      id: newId(),
      type: "JV",
      voucherNo: n.no,
      campus: original.campus,
      campusName: original.campusName,
      session: CURRENT_SESSION,
      date,
      narration: `Reversal of ${original.voucherNo}: ${reason.trim()}`,
      lines,
      status: "POSTED",
      ...totalsOf(lines),
      createdBy: user.name,
      updatedAt: at,
      postedBy: user.name,
      postedAt: at,
      system: false,
      reverses: { voucherId: original.id, voucherNo: original.voucherNo ?? "" },
      history: [
        { action: "CREATED", by: user.name, at },
        { action: "POSTED", by: user.name, at, note: reason.trim() },
      ],
    };
    const info = { voucherId: reversal.id, voucherNo: n.no, reason: reason.trim(), by: user.name, at };
    const isOwn = store.get().vouchers.some((v) => v.id === original.id);
    store.set((s) => ({
      ...s,
      seq: { ...s.seq, [n.key]: n.n },
      idem: { ...s.idem, [key]: reversal.id },
      vouchers: [reversal, ...(isOwn ? s.vouchers.map((v) => (v.id === original.id ? { ...v, status: "REVERSED" as const, reversal: info, history: [...v.history, { action: "REVERSED" as const, by: user.name, at, note: reason.trim() }] } : v)) : s.vouchers)],
      reversedGenerated: isOwn ? s.reversedGenerated : { ...s.reversedGenerated, [original.id]: info },
    }));
    return HttpResponse.json(decorate(reversal), { status: 201 });
  }),

  /* ---------------- Ledger and reports */
  http.get("/api/accounts/ledger", async ({ request }) => {
    await latency();
    syncFeeCancellations();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("accounts.view", ctx.campus);
    if (bad(user)) return user;
    const code = url.searchParams.get("account") ?? "";
    const chart = chartMap();
    // "BANK": every bank account the campus scope can see, in one book (the old Bank Ledger with Bank left blank).
    const allBanks = code === ACCOUNTS_ALL_BANKS;
    const banks = allBanks ? store.get().chart.filter((a) => a.postable && a.kind === "BANK" && visible(a, ctx.campus)) : [];
    const rec = allBanks ? undefined : chart.get(code);
    if (allBanks && banks.length === 0) return fail(404, "NOT_FOUND", "There are no bank accounts for this campus.");
    if (!allBanks && !rec) return fail(404, "NOT_FOUND", "No account with this code.");
    if (rec && !rec.postable) return fail(422, "VALIDATION", `${rec.code} ${rec.name} is a group. Choose an account under it.`, { field: "account" });
    const codes = new Set(allBanks ? banks.map((b) => b.code) : [code]);
    // From may go back into the previous session (when its books are here), as the old ledgers could.
    const start = sessionStart(ctx.session);
    const prevSession = ctx.session - 1;
    const asked = parseDate(url.searchParams.get("from")) ?? start;
    const spans = asked < start && generated(prevSession).list.length > 0;
    const from = spans ? (asked < sessionStart(prevSession) ? sessionStart(prevSession) : asked) : clampDate(asked, ctx.session);
    const to = clampDate(parseDate(url.searchParams.get("to")) ?? asOfFor(ctx.session), ctx.session);
    if (from > to) return fail(422, "VALIDATION", "The start date is after the end date.", { field: "from" });
    const ps = postings(ctx.session, ctx.campus).filter((p) => codes.has(p.code));
    const byTime = (a: Posting, b: Posting) => a.date.localeCompare(b.date) || (a.v.postedAt ?? "").localeCompare(b.v.postedAt ?? "") || (a.v.voucherNo ?? "").localeCompare(b.v.voucherNo ?? "");
    let opening: number;
    let rows: Posting[];
    /** Year-end lines where the new session's opening differs from the old session's closing (income and spending are closed to the accumulated fund). */
    const closes: Array<{ campus: CampusCode; amount: number }> = [];
    if (spans) {
      const prev = postings(prevSession, ctx.campus).filter((p) => codes.has(p.code));
      opening = prev.filter((p) => p.v.type === "OPENING" || p.date < from).reduce((a, p) => a + p.debit - p.credit, 0);
      const prevRows = prev.filter((p) => p.v.type !== "OPENING" && p.date >= from).sort(byTime);
      for (const c of new Set([...prev, ...ps].map((p) => p.campus))) {
        const closing = prev.filter((p) => p.campus === c).reduce((a, p) => a + p.debit - p.credit, 0);
        const reopened = ps.filter((p) => p.campus === c && p.v.type === "OPENING").reduce((a, p) => a + p.debit - p.credit, 0);
        if (reopened !== closing) closes.push({ campus: c, amount: reopened - closing });
      }
      rows = [...prevRows, ...ps.filter((p) => p.v.type !== "OPENING" && p.date <= to).sort(byTime)];
    } else {
      opening = ps.filter((p) => p.v.type === "OPENING" || p.date < from).reduce((a, p) => a + p.debit - p.credit, 0);
      rows = ps.filter((p) => p.v.type !== "OPENING" && p.date >= from && p.date <= to).sort(byTime);
    }
    let run = opening;
    const lines: AccountsLedgerLine[] = [];
    const closeLines = () => {
      for (const c of closes.splice(0)) {
        run += c.amount;
        lines.push({
          key: `close:${ctx.session}:${c.campus}`,
          date: start,
          voucherId: "",
          voucherNo: "",
          type: "OPENING",
          campus: c.campus,
          narration: `Year-end close into ${formatSessionLabel(ctx.session)}`,
          description: "Income and spending of the old session moved to the accumulated fund",
          debit: c.amount > 0 ? c.amount : 0,
          credit: c.amount < 0 ? -c.amount : 0,
          balance: run,
        });
      }
    };
    for (const p of rows) {
      if (spans && p.date >= start) closeLines();
      run += p.debit - p.credit;
      const reference = ledgerReference(p.v);
      lines.push({
        key: `${p.v.id}:${p.line.id}`,
        date: p.date,
        voucherId: p.v.id,
        voucherNo: p.v.voucherNo ?? "",
        type: p.v.type,
        campus: p.campus,
        narration: p.v.narration,
        description: p.line.description,
        ...(reference ? { reference } : {}),
        ...(p.v.cheque?.number ? { cheque: p.v.cheque.number } : {}),
        ...(allBanks ? { accountCode: p.code, accountName: chart.get(p.code)?.name ?? p.code } : {}),
        debit: p.debit,
        credit: p.credit,
        balance: run,
      });
    }
    if (spans) closeLines();
    const trend: AccountsLedger["trend"] = [];
    let bal = opening;
    trend.push({ date: from, balance: opening });
    for (const l of lines) {
      bal = l.balance;
      const last = trend[trend.length - 1];
      if (last && last.date === l.date) last.balance = bal;
      else trend.push({ date: l.date, balance: bal });
    }
    if (trend[trend.length - 1]?.date !== to) trend.push({ date: to, balance: bal });
    const scope = ctx.campus;
    const net = netOf(postings(ctx.session, scope), (p) => codes.has(p.code) && p.date <= to);
    const body: AccountsLedger = {
      account: rec
        ? toAccount(rec, store.get().chart, net, scope, usedCodes())
        : { code: ACCOUNTS_ALL_BANKS, name: "All bank accounts", accountClass: "ASSET", parentCode: "11", postable: true, normalSide: "DEBIT", kind: "BANK", active: true, used: true, netDebit: run },
      ...(allBanks ? { accounts: banks.map((b) => ({ code: b.code, name: b.name })) } : {}),
      from,
      to,
      opening,
      lines,
      totalDebit: lines.reduce((a, l) => a + l.debit, 0),
      totalCredit: lines.reduce((a, l) => a + l.credit, 0),
      closing: run,
      trend,
    };
    return HttpResponse.json(body);
  }),

  http.get("/api/accounts/trial-balance", async ({ request }) => {
    await latency();
    syncFeeCancellations();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("accounts.view", ctx.campus);
    if (bad(user)) return user;
    const asOf = clampDate(parseDate(url.searchParams.get("asOf")) ?? asOfFor(ctx.session), ctx.session);
    const from = clampDate(parseDate(url.searchParams.get("from")) ?? sessionStart(ctx.session), ctx.session);
    if (from > asOf) return fail(422, "VALIDATION", "The From date is after the To date.", { field: "from" });
    return HttpResponse.json(trialBalance(ctx.session, ctx.campus, from, asOf));
  }),

  http.get("/api/accounts/income-expenditure", async ({ request }) => {
    await latency();
    syncFeeCancellations();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("accounts.view", ctx.campus);
    if (bad(user)) return user;
    const from = clampDate(parseDate(url.searchParams.get("from")) ?? sessionStart(ctx.session), ctx.session);
    const to = clampDate(parseDate(url.searchParams.get("to")) ?? asOfFor(ctx.session), ctx.session);
    if (from > to) return fail(422, "VALIDATION", "The start date is after the end date.", { field: "from" });
    return HttpResponse.json(incomeExpenditure(ctx.session, ctx.campus, from, to));
  }),

  http.get("/api/accounts/balance-sheet", async ({ request }) => {
    await latency();
    syncFeeCancellations();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("accounts.view", ctx.campus);
    if (bad(user)) return user;
    const asOf = clampDate(parseDate(url.searchParams.get("asOf")) ?? asOfFor(ctx.session), ctx.session);
    return HttpResponse.json(balanceSheet(ctx.session, ctx.campus, asOf));
  }),

  /* ---------------- Fee collection posting */
  http.get("/api/accounts/fee-batches", async ({ request }) => {
    await latency();
    syncFeeCancellations();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("accounts.view", ctx.campus);
    if (bad(user)) return user;
    const month = url.searchParams.get("month") ?? monthOf(asOfFor(ctx.session));
    if (!/^\d{4}-\d{2}$/.test(month)) return fail(422, "VALIDATION", "Choose a month.", { field: "month" });
    const index = feeLedgerIndex();
    const campuses = ctx.campus === "ALL" ? ACC_CAMPUSES : [ctx.campus];
    const batches: AccountsFeeBatch[] = [];
    for (let d = `${month}-01`; d <= monthEndIso(month) && d <= TODAY; d = addDaysIso(d, 1)) {
      for (const c of campuses) {
        const b = feeBatch(c, d, index);
        if (b) batches.push(b);
      }
    }
    batches.sort((a, b) => b.date.localeCompare(a.date) || a.campus.localeCompare(b.campus));
    const body: AccountsFeeMonth = {
      month,
      batches,
      totals: {
        feeOffice: batches.reduce((a, b) => a + b.feeOfficeTotal, 0),
        ledger: batches.reduce((a, b) => a + b.ledgerTotal, 0),
        difference: batches.reduce((a, b) => a + b.difference, 0),
        days: new Set(batches.map((b) => b.date)).size,
        posted: batches.filter((b) => b.status === "POSTED").length,
        differences: batches.filter((b) => b.status === "DIFFERENCE").length,
        open: batches.filter((b) => b.status === "OPEN").length,
      },
    };
    return HttpResponse.json(body);
  }),

  http.get("/api/accounts/fee-batches/:campus/:date", async ({ params }) => {
    await latency();
    syncFeeCancellations();
    const campus = String(params.campus) as CampusCode;
    const date = String(params.date);
    if (!ACC_CAMPUSES.includes(campus)) return fail(404, "NOT_FOUND", "No such campus.");
    const user = requirePermission("accounts.view", campus);
    if (bad(user)) return user;
    const d = feeBatchDetail(campus, date);
    if (!d) return fail(404, "NOT_FOUND", `No fee collection at ${campusName(campus)} on ${formatDate(date)}.`);
    return HttpResponse.json(d);
  }),

  http.post("/api/accounts/fee-batches/:campus/:date/post", async ({ params, request }) => {
    await latency();
    syncFeeCancellations();
    const key = request.headers.get("Idempotency-Key");
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
    const campus = String(params.campus) as CampusCode;
    const date = String(params.date);
    if (!ACC_CAMPUSES.includes(campus)) return fail(404, "NOT_FOUND", "No such campus.");
    const user = requirePermission("accounts.post", campus);
    if (bad(user)) return user;
    if (store.get().idem[key]) {
      const d = feeBatchDetail(campus, date);
      if (d) return HttpResponse.json(d);
    }
    if (sessionOfDate(date) !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "2025–26 is closed.");
    const b = feeBatch(campus, date, feeLedgerIndex());
    if (!b) return fail(404, "NOT_FOUND", `No fee collection at ${campusName(campus)} on ${formatDate(date)}.`);
    if (b.difference <= 0) return fail(409, "NOTHING_TO_POST", b.difference === 0 ? "The ledger already agrees with the fee office for this day." : "The ledger is higher than the fee office. Check the fee office's report before correcting it.");
    const closed = closedFail(campus, date);
    if (closed) return closed;
    const rules = store.get().postingRules;
    const amount = b.difference;
    const supplement = b.vouchers.length > 0;
    const late = FEE_LATE_ENTRIES.find((e) => e.campus === campus && e.date === date && e.amount === amount);
    const bank = MAIN_BANK[campus];
    let lines: AccountsJournalLine[];
    if (late) {
      lines = [
        { id: "l1", accountCode: bank, description: "Bank challan entered after the day closed", debit: amount, credit: 0 },
        { id: "l2", accountCode: rules[late.head] ?? "4101", description: "Fee office daily total (late entry)", debit: 0, credit: amount },
      ];
    } else {
      const cashPart = cashShare(campus, date, amount);
      const credit = new Map<string, number>();
      for (const [h, v] of headSplit(campus, date, amount)) credit.set(rules[h] ?? "4101", (credit.get(rules[h] ?? "4101") ?? 0) + v);
      lines = [
        { id: "l1", accountCode: "1101", description: "Cash at the counter", debit: cashPart, credit: 0 },
        { id: "l2", accountCode: bank, description: "Bank challans, online payments and cheques", debit: amount - cashPart, credit: 0 },
        ...[...credit.entries()].filter(([, v]) => v > 0).map(([acc, v], i) => ({ id: `l${i + 3}`, accountCode: acc, description: "Fee office daily total", debit: 0, credit: v })),
      ].filter((l) => l.debit > 0 || l.credit > 0);
    }
    const at = demoNow();
    const n = nextNo(campus, CURRENT_SESSION, "FEE");
    const v: AccountsVoucher = {
      id: newId(),
      type: "FEE",
      voucherNo: n.no,
      campus,
      campusName: campusName(campus),
      session: CURRENT_SESSION,
      date,
      narration: supplement ? `Fee collection ${formatDate(date)}: difference posted (${formatRs(amount)})` : `Fee collection ${formatDate(date)}: ${b.receipts} receipts (day closed early by ${user.name})`,
      lines,
      status: "POSTED",
      ...totalsOf(lines),
      createdBy: user.name,
      updatedAt: at,
      postedBy: user.name,
      postedAt: at,
      system: true,
      source: { kind: "FEE_BATCH", date, receipts: supplement ? 0 : b.receipts, ...(supplement ? { supplement: true } : {}) },
      history: [{ action: "POSTED", by: user.name, at, ...(late ? { note: late.note } : {}) }],
    };
    store.set((s) => ({ ...s, seq: { ...s.seq, [n.key]: n.n }, idem: { ...s.idem, [key]: v.id }, vouchers: [v, ...s.vouchers] }));
    return HttpResponse.json(feeBatchDetail(campus, date), { status: 201 });
  }),

  http.get("/api/accounts/posting-rules", async () => {
    await latency();
    const user = requireUser();
    if (bad(user)) return user;
    if (!user.roles.some((g) => g.permissions.includes("accounts.view"))) return fail(403, "FORBIDDEN", "Your role can't see the accounts.");
    const chart = chartMap();
    const rules = store.get().postingRules;
    const out: AccountsPostingRule[] = postingHeads().map((r) => {
      const acc = rules[r.head] ?? r.accountCode;
      return { head: r.head, title: r.title, category: r.category, accountCode: acc, accountName: chart.get(acc)?.name ?? acc, ...(r.note ? { note: r.note } : {}) };
    });
    out.push({ head: "PAY_CASH", title: "Cash at the counter", category: "PAYMENT", accountCode: "1101", accountName: "Cash in hand", note: "Deposited in the campus bank the next weekday." });
    out.push({ head: "PAY_BANK", title: "Bank challans, online and cheques", category: "PAYMENT", accountCode: "", accountName: "The campus's own bank account", note: "Meezan Bank at Khalid Campus; each campus has its own." });
    return HttpResponse.json(out);
  }),

  http.put("/api/accounts/posting-rules/:head", async ({ params, request }) => {
    await latency();
    const head = String(params.head);
    const user = requirePermission("accounts.post", "ALL");
    if (bad(user)) return user;
    const rule = postingHeads().find((r) => r.head === head);
    if (!rule) return fail(404, "NOT_FOUND", "No posting rule for this fee head.");
    const { accountCode } = (await request.json()) as { accountCode?: string };
    const acc = accountCode ? chartMap().get(accountCode) : undefined;
    if (!acc) return fail(422, "VALIDATION", "Choose the account fee collections should post to.", { field: "accountCode" });
    if (!acc.postable || !acc.active) return fail(422, "VALIDATION", `${acc.code} ${acc.name} can't take postings. Choose an active account.`, { field: "accountCode" });
    if (acc.campus) return fail(422, "VALIDATION", "Fee heads post to an account every campus shares.", { field: "accountCode" });
    if (acc.accountClass !== "INCOME" && acc.accountClass !== "LIABILITY") return fail(422, "VALIDATION", "Fee heads post to an income account (or a liability for money held for others).", { field: "accountCode" });
    store.set((s) => ({ ...s, postingRules: { ...s.postingRules, [head]: acc.code } }));
    const out: AccountsPostingRule = { head, title: rule.title, category: rule.category, accountCode: acc.code, accountName: acc.name, ...(rule.note ? { note: rule.note } : {}) };
    return HttpResponse.json(out);
  }),

  /* ---------------- Bank reconciliation */
  http.get("/api/accounts/bank-accounts", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("accounts.view", ctx.campus);
    if (bad(user)) return user;
    const list = store.get().chart.filter((a) => a.kind === "BANK" && a.campus && a.active && (ctx.campus === "ALL" || a.campus === ctx.campus));
    return HttpResponse.json(list.map(bankAccountInfo));
  }),

  http.get("/api/accounts/bank-rec", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const account = url.searchParams.get("account") ?? "";
    const month = url.searchParams.get("month") ?? monthOf(TODAY);
    const a = chartMap().get(account);
    if (!a?.campus) return fail(404, "NOT_FOUND", "No bank account with this code.");
    const user = requirePermission("accounts.view", a.campus);
    if (bad(user)) return user;
    if (!/^\d{4}-\d{2}$/.test(month)) return fail(422, "VALIDATION", "Choose a month.", { field: "month" });
    return HttpResponse.json(bankRec(account, month));
  }),

  http.post("/api/accounts/bank-rec/match", async ({ request }) => {
    await latency();
    const body = (await request.json()) as { account: string; month: string; statementLineId: string; bookLineKey: string };
    const a = chartMap().get(body.account);
    if (!a?.campus) return fail(404, "NOT_FOUND", "No bank account with this code.");
    const user = requirePermission("accounts.post", a.campus);
    if (bad(user)) return user;
    if (store.get().signOffs[`${body.account}:${body.month}`]) return fail(409, "SIGNED_OFF", "This month is signed off as reconciled.");
    const s = statementLines(body.account).find((x) => x.id === body.statementLineId);
    const b = bookLines(body.account).find((x) => x.key === body.bookLineKey);
    if (!s || !b) return fail(404, "NOT_FOUND", "That line is no longer there. Refresh the page.");
    const { st2book, book2st } = matchesFor(body.account);
    if (st2book.has(s.id)) return fail(409, "ALREADY_MATCHED", "This statement line is already matched. Unmatch it first.");
    if (book2st.has(b.key)) return fail(409, "ALREADY_MATCHED", `${b.voucherNo} is already matched to another statement line.`);
    if (s.credit !== b.debit || s.debit !== b.credit) return fail(422, "AMOUNT_MISMATCH", `The amounts differ (${formatRs(s.credit || s.debit)} on the statement, ${formatRs(b.debit || b.credit)} in the books). Only equal amounts can be matched.`);
    store.set((st) => ({ ...st, bankMatch: { ...st.bankMatch, [s.id]: b.key } }));
    return HttpResponse.json(bankRec(body.account, body.month));
  }),

  http.post("/api/accounts/bank-rec/unmatch", async ({ request }) => {
    await latency();
    const body = (await request.json()) as { account: string; month: string; statementLineId: string };
    const a = chartMap().get(body.account);
    if (!a?.campus) return fail(404, "NOT_FOUND", "No bank account with this code.");
    const user = requirePermission("accounts.post", a.campus);
    if (bad(user)) return user;
    if (store.get().signOffs[`${body.account}:${body.month}`]) return fail(409, "SIGNED_OFF", "This month is signed off as reconciled.");
    store.set((st) => ({ ...st, bankMatch: { ...st.bankMatch, [body.statementLineId]: null } }));
    return HttpResponse.json(bankRec(body.account, body.month));
  }),

  http.post("/api/accounts/bank-rec/auto-match", async ({ request }) => {
    await latency();
    const body = (await request.json()) as { account: string; month: string };
    const a = chartMap().get(body.account);
    if (!a?.campus) return fail(404, "NOT_FOUND", "No bank account with this code.");
    const user = requirePermission("accounts.post", a.campus);
    if (bad(user)) return user;
    const rec = bankRec(body.account, body.month);
    if (bad(rec)) return rec;
    const taken = new Set<string>();
    const add: Record<string, string> = {};
    for (const s of rec.statement) {
      if (s.matchedTo || !s.suggested || taken.has(s.suggested)) continue;
      add[s.id] = s.suggested;
      taken.add(s.suggested);
    }
    store.set((st) => ({ ...st, bankMatch: { ...st.bankMatch, ...add } }));
    const next = bankRec(body.account, body.month);
    if (bad(next)) return next;
    return HttpResponse.json({ ...next, matched: Object.keys(add).length });
  }),

  http.post("/api/accounts/bank-rec/sign-off", async ({ request }) => {
    await latency();
    const body = (await request.json()) as { account: string; month: string };
    const a = chartMap().get(body.account);
    if (!a?.campus) return fail(404, "NOT_FOUND", "No bank account with this code.");
    const user = requirePermission("accounts.post", a.campus);
    if (bad(user)) return user;
    const rec = bankRec(body.account, body.month);
    if (bad(rec)) return rec;
    if (!rec.canSignOff) return fail(409, "NOT_READY", rec.signedOff ? "Already signed off." : "Match every statement line of the month first.");
    store.set((st) => ({ ...st, signOffs: { ...st.signOffs, [`${body.account}:${body.month}`]: { by: user.name, at: demoNow() } } }));
    return HttpResponse.json(bankRec(body.account, body.month));
  }),

  /* ---------------- Periods */
  http.get("/api/accounts/periods", async ({ request }) => {
    await latency();
    syncFeeCancellations();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("accounts.view", ctx.campus);
    if (bad(user)) return user;
    const index = feeLedgerIndex();
    const vouchers = allVouchers(ctx.session).filter((v) => !v.system);
    const campuses = ctx.campus === "ALL" ? ACC_CAMPUSES : [ctx.campus];
    const out = campuses.flatMap((c) => sessionMonths(ctx.session).map((m) => periodFor(c, m, index, vouchers, user)));
    return HttpResponse.json(out);
  }),

  http.post("/api/accounts/periods/close", async ({ request }) => {
    await latency();
    syncFeeCancellations();
    const body = (await request.json()) as { campus: CampusCode; month: string };
    const user = requirePermission("accounts.post", body.campus);
    if (bad(user)) return user;
    const session = sessionOfDate(`${body.month}-01`);
    if (session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "2025–26 is closed.");
    const p = periodFor(body.campus, body.month, feeLedgerIndex(), allVouchers(session).filter((v) => !v.system), user);
    if (p.status !== "OPEN") return fail(409, "NOT_OPEN", `${monthLong(body.month)} is ${p.status === "CLOSED" ? "already closed" : "still to come"}.`);
    const failing = p.checks.filter((c) => !c.ok);
    if (failing.length) return fail(409, "CHECKS_FAILED", `${monthLong(body.month)} can't be closed yet: ${failing.map((c) => c.label.toLowerCase()).join("; ")}.`, { details: { checks: failing.map((c) => c.key) } });
    const at = demoNow();
    store.set((s) => ({ ...s, periods: { ...s.periods, [`${body.campus}:${body.month}`]: { status: "CLOSED", closedBy: user.name, closedAt: at } } }));
    return HttpResponse.json(periodFor(body.campus, body.month, feeLedgerIndex(), allVouchers(session).filter((v) => !v.system), user));
  }),

  http.post("/api/accounts/periods/reopen", async ({ request }) => {
    await latency();
    const body = (await request.json()) as { campus: CampusCode; month: string; reason: string };
    const user = requirePermission("settings.manage", body.campus);
    if (bad(user)) return user;
    const session = sessionOfDate(`${body.month}-01`);
    if (session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "2025–26 stays closed.");
    if (periodStatus(body.campus, body.month) !== "CLOSED") return fail(409, "NOT_CLOSED", `${monthLong(body.month)} is not closed.`);
    if (periodStatus(body.campus, nextMonthOf(body.month)) === "CLOSED") return fail(409, "LATER_CLOSED", `Reopen ${monthLong(nextMonthOf(body.month))} first: months are reopened from the latest back.`);
    if (!body.reason || body.reason.trim().length < 10) return fail(422, "VALIDATION", "Say why the month is being reopened (at least a short sentence).", { field: "reason" });
    const at = demoNow();
    store.set((s) => ({ ...s, periods: { ...s.periods, [`${body.campus}:${body.month}`]: { status: "OPEN", reopened: { by: user.name, at, reason: body.reason.trim() } } } }));
    return HttpResponse.json(periodFor(body.campus, body.month, feeLedgerIndex(), allVouchers(session).filter((v) => !v.system), user));
  }),
];
