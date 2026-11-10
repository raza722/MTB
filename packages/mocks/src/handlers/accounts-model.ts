import {
  type AccountsIncomeExpenditure,
  type AccountsJournalLine,
  type AccountsStatementGroup,
  type AccountsTrialBalance,
  type AccountsTrialRow,
  type AccountsVoucher,
  type CampusCode,
  type CampusScope,
} from "@mtb/api";
import type { IsoDate } from "@mtb/domain";
import { CURRENT_SESSION, DEMO_TODAY } from "../clock";
import { createStore } from "../db";
import {
  ACC_CAMPUSES,
  DEFAULT_POSTING_RULES,
  generatedBooks,
  initialChart,
  initialVouchers,
  MAIN_BANK,
  monthEndIso,
  sessionEnd,
  sessionMonths,
  sessionOfDate,
  sessionStart,
  voucherNoOf,
  type AccountRecord,
} from "../fixtures/accounts";
import { campusName } from "../fixtures/campuses";
import { feeHeadsForPosting, headCodeOf as feeHeadCodeOf } from "./fee-setup-model";
import { feesStore } from "./fees-state";

// The fictional books the report centre (handlers/reports.ts, module 13) still reads. Accounts itself is real now
// (module 7): every /api/accounts/* request falls through to the backend, so nothing here has a route. The four
// accountsReport* exports keep the report centre's trial balance, cash book, bank book, income and spending by head
// and voucher register working on fictional data until module 13 reads the real gl views (07_accounts.md §2.3.7).

interface AccountsState {
  chart: AccountRecord[];
  /** The demo's own vouchers (fixtures) plus the receipt cancellations the fictional fee office approved. */
  vouchers: AccountsVoucher[];
  /** "KC:2026:FEE_CANCEL" → last number used. */
  seq: Record<string, number>;
  /** Fee head → account code. */
  postingRules: Record<string, string>;
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
    postingRules: Object.fromEntries(DEFAULT_POSTING_RULES.map((r) => [r.head, r.accountCode])),
    feeCancelPosted: {},
  };
}

// v4: the store lost the route-only state (sign-offs, matches, periods, idempotency) when Accounts became real.
const store = createStore<AccountsState>("accounts-v4", initialState);

const TODAY = DEMO_TODAY;
const SYSTEM_USER = "Fee office (automatic)";

/* ================================================================== Vouchers: generated + fixtures */

const genCache = new Map<number, AccountsVoucher[]>();
function generated(session: number): AccountsVoucher[] {
  const hit = genCache.get(session);
  if (hit) return hit;
  const list = session === 2025 || session === 2026 ? ACC_CAMPUSES.flatMap((c) => generatedBooks(c, session).vouchers) : [];
  genCache.set(session, list);
  return list;
}

function allVouchers(session: number): AccountsVoucher[] {
  return [...generated(session), ...store.get().vouchers.filter((v) => v.session === session)];
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

function netOf(ps: Posting[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of ps) m.set(p.code, (m.get(p.code) ?? 0) + p.debit - p.credit);
  return m;
}

/** The last day the books cover for a session: the demo's today for the current one, the session's last day otherwise. */
const asOfFor = (session: number): IsoDate => (session === CURRENT_SESSION ? TODAY : sessionEnd(session));
const monthOf = (d: IsoDate) => d.slice(0, 7);
const visible = (a: AccountRecord, scope: CampusScope) => !a.campus || scope === "ALL" || a.campus === scope;
const clampDate = (d: IsoDate, session: number) => (d < sessionStart(session) ? sessionStart(session) : d > asOfFor(session) ? asOfFor(session) : d);

/* ================================================================== Fictional fee office → ledger */

/** Receipt cancellations the fictional fee office approved, as FEE_CANCEL vouchers (once each). */
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
  if (postingHeads().includes(own) && !DEFAULT_POSTING_RULES.some((r) => r.head === own)) return own;
  if (h.startsWith("annual")) return "ANNUAL";
  if (h.startsWith("exam")) return "EXAM";
  if (h.startsWith("admission")) return "ADMISSION";
  if (h.startsWith("transport")) return "TRANSPORT";
  if (h.startsWith("board")) return "BOARD";
  if (h.includes("fine")) return "FINE_OTHER";
  return "TUITION";
}

/** Posting-rule heads: the built-in heads, then any head the fictional fee office added. */
function postingHeads(): string[] {
  const core = DEFAULT_POSTING_RULES.map((r) => r.head);
  return [...core, ...feeHeadsForPosting([...core, "FINE_EXAM"]).map((h) => h.head)];
}

/* ================================================================== Trial balance and statements */

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

/** The groups directly under a class ("4" → 41, 42). */
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

/* ================================================================== For the report centre (handlers/reports.ts) */

/** Report-centre dates kept inside the session; `clamped` says when they moved. */
function reportDates(session: number, from: IsoDate, to: IsoDate) {
  const lo = clampDate(from, session);
  const hi = clampDate(to, session);
  return { from: lo > hi ? hi : lo, to: hi, clamped: lo !== from || hi !== to };
}

/** The fictional trial balance (opening before `from`, movement to `asOf`). */
export function accountsReportTrialBalance(session: number, scope: CampusScope, from: IsoDate, asOf: IsoDate): AccountsTrialBalance & { clamped: boolean } {
  syncFeeCancellations();
  const d = reportDates(session, from, asOf);
  return { ...trialBalance(session, scope, d.from, d.to), clamped: d.clamped };
}

/** Fictional income and expenses per account for a period. */
export function accountsReportIncomeExpenditure(session: number, scope: CampusScope, from: IsoDate, to: IsoDate): AccountsIncomeExpenditure & { clamped: boolean } {
  syncFeeCancellations();
  const d = reportDates(session, from, to);
  return { ...incomeExpenditure(session, scope, d.from, d.to), clamped: d.clamped };
}

/** A fictional book over several accounts (cash in hand, a bank, every bank): opening, then each posted line with its running balance. */
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

/** Fictional vouchers dated in a period (drafts and those waiting included), oldest first, for the voucher register. */
export function accountsReportVouchers(session: number, scope: CampusScope, from: IsoDate, to: IsoDate): AccountsVoucher[] {
  syncFeeCancellations();
  return allVouchers(session)
    .filter((v) => v.type !== "OPENING" && inScope(v.campus, scope) && v.date >= from && v.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.voucherNo ?? "").localeCompare(b.voucherNo ?? ""));
}
