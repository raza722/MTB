import { accountsCashBankKind, accountsVoucherSide, type AccountsManualType, type AccountsVoucher, type AccountsVoucherInput, type CampusCode } from "@mtb/api";
import type { IsoDate, Rupees } from "@mtb/domain";
import { z } from "zod";
import { TODAY } from "./shared";

export interface DraftLine {
  key: string;
  accountCode: string | null;
  description: string;
  debit: Rupees | null;
  credit: Rupees | null;
}

export interface Draft {
  id: string | null;
  type: AccountsManualType;
  campus: CampusCode | null;
  date: IsoDate | null;
  narration: string;
  lines: DraftLine[];
  /** Cash and bank vouchers: the cash or bank account paid from / received into. */
  cashBankAccount: string | null;
  party: string;
  reference: string;
  chequeNo: string;
  chequeDate: IsoDate | null;
}

/** Values a page can hand to a new voucher (from the bank reconciliation, for example). */
export interface Prefill {
  date?: IsoDate;
  narration?: string;
  amount?: number;
  /** The cash or bank account. */
  account?: string;
  /** The other side's account. */
  contra?: string;
  party?: string;
  reference?: string;
  /** Journal vouchers for a bank item: true when money came into the bank (bank debited). */
  inflow?: boolean;
}

let n = 0;
export const newLine = (): DraftLine => ({ key: `new-${Date.now()}-${n++}`, accountCode: null, description: "", debit: null, credit: null });

export const isCashBank = (t: AccountsManualType) => accountsVoucherSide(t) !== null;

export function emptyDraft(type: AccountsManualType, campus: CampusCode | null, p: Prefill = {}): Draft {
  const side = accountsVoucherSide(type);
  const amount = p.amount ?? null;
  let lines: DraftLine[];
  if (side) {
    lines = [{ ...newLine(), accountCode: p.contra ?? null, description: "", debit: side === "PAYMENT" ? amount : null, credit: side === "RECEIPT" ? amount : null }];
  } else if (p.account && amount) {
    // A bank item booked by journal voucher: money in debits the bank; money out credits it.
    lines = p.inflow
      ? [
          { ...newLine(), accountCode: p.account, debit: amount, credit: null, description: p.reference ?? "" },
          { ...newLine(), accountCode: p.contra ?? null, credit: amount, debit: null },
        ]
      : [
          { ...newLine(), accountCode: p.contra ?? null, debit: amount, credit: null },
          { ...newLine(), accountCode: p.account, credit: amount, debit: null, description: p.reference ?? "" },
        ];
  } else {
    lines = [newLine(), newLine()];
  }
  return {
    id: null,
    type,
    campus,
    date: p.date ?? TODAY,
    narration: p.narration ?? "",
    lines,
    cashBankAccount: side ? (p.account ?? (accountsCashBankKind(type) === "CASH" ? "1101" : null)) : null,
    party: p.party ?? "",
    reference: p.reference ?? "",
    chequeNo: p.reference && accountsCashBankKind(type) === "BANK" ? p.reference : "",
    chequeDate: accountsCashBankKind(type) === "BANK" ? (p.date ?? TODAY) : null,
  };
}

export function draftFrom(v: AccountsVoucher): Draft {
  const type = (["JV", "CP", "CR", "BP", "BR"].includes(v.type) ? v.type : "JV") as AccountsManualType;
  const lines = v.lines.filter((l) => !(isCashBank(type) && l.contra));
  return {
    id: v.id,
    type,
    campus: v.campus,
    date: v.date,
    narration: v.narration,
    lines: lines.map((l) => ({ key: l.id, accountCode: l.accountCode, description: l.description, debit: l.debit || null, credit: l.credit || null })),
    cashBankAccount: v.cashBankAccount ?? null,
    party: v.party ?? "",
    reference: v.reference ?? "",
    chequeNo: v.cheque?.number ?? "",
    chequeDate: v.cheque?.date ?? null,
  };
}

/** A line the user has touched at all. Untouched blank lines are ignored when saving and posting. */
export const isUsed = (l: DraftLine) => Boolean(l.accountCode || l.debit || l.credit || l.description.trim());

/** The amount on a cash or bank voucher line (debit on payments, credit on receipts). */
export const amountOf = (type: AccountsManualType, l: DraftLine) => (accountsVoucherSide(type) === "RECEIPT" ? (l.credit ?? 0) : (l.debit ?? 0));

export function totalsOf(d: Draft) {
  if (isCashBank(d.type)) {
    const total = d.lines.reduce((a, l) => a + amountOf(d.type, l), 0);
    return { debit: total, credit: total, diff: 0, balanced: total > 0, total };
  }
  const debit = d.lines.reduce((a, l) => a + (l.debit ?? 0), 0);
  const credit = d.lines.reduce((a, l) => a + (l.credit ?? 0), 0);
  return { debit, credit, diff: debit - credit, balanced: debit === credit && debit > 0, total: debit };
}

export function toInput(d: Draft, session: number): AccountsVoucherInput {
  const side = accountsVoucherSide(d.type);
  const bank = accountsCashBankKind(d.type) === "BANK";
  return {
    type: d.type,
    campus: d.campus as CampusCode,
    session,
    date: d.date as IsoDate,
    narration: d.narration.trim(),
    lines: d.lines.filter(isUsed).map((l) => ({
      accountCode: l.accountCode ?? "",
      description: l.description.trim(),
      debit: side === "RECEIPT" ? 0 : (l.debit ?? 0),
      credit: side === "PAYMENT" ? 0 : (l.credit ?? 0),
    })),
    ...(side && d.cashBankAccount ? { cashBankAccount: d.cashBankAccount } : {}),
    ...(d.party.trim() ? { party: d.party.trim() } : {}),
    ...(d.reference.trim() ? { reference: d.reference.trim() } : {}),
    ...(bank && d.chequeNo.trim() ? { cheque: { number: d.chequeNo.trim(), date: d.chequeDate ?? (d.date as IsoDate) } } : {}),
  };
}

export type HeaderField = "campus" | "date" | "narration" | "cashBankAccount" | "party" | "chequeNo" | "chequeDate";
export interface LineErrors {
  account?: string;
  amount?: string;
}

const header = (type: AccountsManualType) => {
  const side = accountsVoucherSide(type);
  const bank = accountsCashBankKind(type) === "BANK";
  return z
    .object({
      campus: z.string({ error: "Choose the campus this voucher belongs to." }).min(1, "Choose the campus this voucher belongs to."),
      date: z.string({ error: "Enter the voucher date." }).min(1, "Enter the voucher date."),
      narration: z.string().trim().min(1, 'Say what this voucher is for, e.g. "Utility bills for October 2026".'),
      cashBankAccount: z.string().nullable(),
      party: z.string(),
      chequeNo: z.string(),
      chequeDate: z.string().nullable(),
    })
    .superRefine((v, ctx) => {
      if (!side) return;
      if (!v.cashBankAccount) ctx.addIssue({ code: "custom", path: ["cashBankAccount"], message: side === "PAYMENT" ? `Choose the ${bank ? "bank" : "cash"} account the money is paid from.` : `Choose the ${bank ? "bank" : "cash"} account the money goes into.` });
      if (!v.party.trim()) ctx.addIssue({ code: "custom", path: ["party"], message: side === "PAYMENT" ? "Enter who is being paid." : "Enter who the money is from." });
      if (bank && !v.chequeNo.trim()) ctx.addIssue({ code: "custom", path: ["chequeNo"], message: side === "PAYMENT" ? "Enter the cheque number, or the transfer reference." : "Enter the cheque, transfer or deposit slip number." });
      if (bank && !v.chequeDate) ctx.addIssue({ code: "custom", path: ["chequeDate"], message: "Enter the cheque or transfer date." });
    });
};

/** Checks before posting or sending for approval. The server checks again. */
export function validateFinal(d: Draft): { header: Partial<Record<HeaderField, string>>; lines: Record<string, LineErrors>; count: number } {
  const out: Partial<Record<HeaderField, string>> = {};
  const parsed = header(d.type).safeParse({ campus: d.campus ?? "", date: d.date ?? "", narration: d.narration, cashBankAccount: d.cashBankAccount, party: d.party, chequeNo: d.chequeNo, chequeDate: d.chequeDate });
  if (!parsed.success) for (const i of parsed.error.issues) out[String(i.path[0]) as HeaderField] ??= i.message;
  const lines: Record<string, LineErrors> = {};
  const used = d.lines.filter(isUsed);
  const side = accountsVoucherSide(d.type);
  for (const l of used) {
    const e: LineErrors = {};
    if (!l.accountCode) e.account = "Choose an account.";
    if (side) {
      if (amountOf(d.type, l) <= 0) e.amount = "Enter the amount.";
      if (l.accountCode && l.accountCode === d.cashBankAccount) e.account = "Choose the account the money is for, not the cash or bank account.";
    } else {
      const dr = l.debit ?? 0;
      const cr = l.credit ?? 0;
      if ((dr > 0 && cr > 0) || (dr === 0 && cr === 0)) e.amount = "Enter a debit or a credit.";
    }
    if (e.account || e.amount) lines[l.key] = e;
  }
  if (used.length === 0 && d.lines[0]) lines[d.lines[0].key] = { account: "Choose an account.", amount: side ? "Enter the amount." : "Enter a debit or a credit." };
  return { header: out, lines, count: Object.keys(out).length + Object.keys(lines).length };
}

/**
 * Next free code under a parent, at any depth: a group under a class gets one more digit ("5" → "54"); a sub-group or
 * an account under a group gets two ("54" → "5403", "5401" → "540103"). Takes the number after the highest one used,
 * or the first gap once the last number is taken.
 */
export function suggestCode(parentCode: string, existing: string[]): string {
  const width = parentCode.length === 1 ? 1 : 2;
  const limit = width === 1 ? 9 : 99;
  const used = new Set(existing.filter((c) => c.startsWith(parentCode) && c.length === parentCode.length + width).map((c) => Number(c.slice(parentCode.length))));
  const max = used.size ? Math.max(...used) : 0;
  let next = max + 1;
  if (next > limit) {
    next = 1;
    while (next < limit && used.has(next)) next++;
  }
  return `${parentCode}${String(next).padStart(width, "0")}`;
}
