import type { CounterPaymentMethod } from "@mtb/api";
import type { IsoDate } from "@mtb/domain";
import { z } from "zod";

/** What the cashier has typed so far, for every method (only the chosen method's fields are used). */
export interface PaymentDraft {
  method: CounterPaymentMethod["method"];
  received: number | null;
  bank: string;
  slipNo: string;
  depositDate: IsoDate | null;
  chequeNo: string;
  chequeBank: string;
  chequeDate: IsoDate | null;
  transactionId: string;
}

export const EMPTY_PAYMENT: PaymentDraft = {
  method: "CASH",
  received: null,
  bank: "",
  slipNo: "",
  depositDate: null,
  chequeNo: "",
  chequeBank: "",
  chequeDate: null,
  transactionId: "",
};

export const BANKS = ["Meezan Bank", "HBL", "UBL", "Bank Alfalah", "Allied Bank", "National Bank of Pakistan", "MCB Bank"];

const text = (message: string) => z.string().trim().min(1, { error: message });
const date = (message: string) => z.string({ error: message }).min(1, { error: message });

/** Payment method as a discriminated union: only the chosen method's fields are validated, all of them required. */
export function paymentSchema(total: number) {
  return z.discriminatedUnion("method", [
    z.object({
      method: z.literal("CASH"),
      received: z.number({ error: "Enter the amount received." }).int().min(total, { error: "Amount received is less than the total." }),
    }),
    z.object({ method: z.literal("BANK"), bank: text("Choose the bank."), slipNo: text("Enter the slip number printed on the deposit slip."), depositDate: date("Enter the deposit date.") }),
    z.object({ method: z.literal("CHEQUE"), chequeNo: text("Enter the cheque number printed on the cheque."), bank: text("Choose the bank."), chequeDate: date("Enter the cheque date.") }),
    z.object({ method: z.literal("ONLINE"), transactionId: text("Enter the transaction ID.") }),
  ]);
}

/** Validates the draft for its method. Returns the API payload, or field errors in plain words. */
export function validatePayment(draft: PaymentDraft, total: number): { ok: true; payment: CounterPaymentMethod } | { ok: false; errors: Partial<Record<string, string>> } {
  const candidate =
    draft.method === "CASH"
      ? { method: "CASH", received: draft.received ?? undefined }
      : draft.method === "BANK"
        ? { method: "BANK", bank: draft.bank, slipNo: draft.slipNo, depositDate: draft.depositDate ?? undefined }
        : draft.method === "CHEQUE"
          ? { method: "CHEQUE", chequeNo: draft.chequeNo, bank: draft.chequeBank, chequeDate: draft.chequeDate ?? undefined }
          : { method: "ONLINE", transactionId: draft.transactionId };
  const parsed = paymentSchema(total).safeParse(candidate);
  if (parsed.success) return { ok: true, payment: parsed.data as CounterPaymentMethod };
  const errors: Partial<Record<string, string>> = {};
  for (const issue of parsed.error.issues) {
    let key = String(issue.path[0] ?? "method");
    if (draft.method === "CHEQUE" && key === "bank") key = "chequeBank";
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}
