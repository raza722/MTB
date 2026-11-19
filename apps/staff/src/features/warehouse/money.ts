import { amountInWords as wordsOfWholeRs, formatLakh as lakhOfWholeRs, formatRs as formatWholeRs, type SignDisplay } from "@mtb/domain";

/**
 * Warehouse amounts can carry paise: old purchase bills (Rs 83.33 a piece), weighted average costs and
 * the totals built from them. The screens show whole rupees, so every warehouse amount is rounded here
 * before the shared formatter (which refuses anything but whole rupees) sees it.
 */
export const formatRs = (amount: number, options?: { sign?: SignDisplay }): string => formatWholeRs(Math.round(amount), options);

/** "Rupees … Only" for a warehouse total, rounded the same way. */
export const amountInWords = (amount: number): string => wordsOfWholeRs(Math.round(amount));

/** "Rs 12.6 lakh" for a warehouse total, rounded the same way. */
export const formatLakh = (amount: number): string => lakhOfWholeRs(Math.round(amount));
