import { describe, expect, it } from "vitest";
import {
  amountInWords,
  calculateLateFine,
  describeDue,
  formatCancellationNo,
  formatCnic,
  formatCount,
  formatDate,
  formatDateTime,
  formatGrNo,
  formatLakh,
  formatMobile,
  formatPercent,
  formatReceiptNo,
  formatRs,
  formatSession,
  formatTime,
  isValidCnic,
  looksLikeCnic,
  maskCnic,
  mobileToE164,
  normalizeCnic,
  pakistanToday,
  parseDateInput,
  parseRs,
  sumRs,
  summariseAttendance,
} from "./index";

const TODAY = "2026-11-04";

describe("money", () => {
  it("formats whole rupees the way the brief specifies", () => {
    expect(formatRs(12500)).toBe("Rs 12,500");
    expect(formatRs(4825000)).toBe("Rs 4,825,000");
    expect(formatRs(0)).toBe("Rs 0");
    expect(formatRs(-1500)).toBe("−Rs 1,500");
    expect(formatRs(-1500, { sign: "never" })).toBe("Rs 1,500");
    expect(formatRs(500, { sign: "always" })).toBe("+Rs 500");
  });

  it("refuses non-integer money", () => {
    expect(() => formatRs(12.5)).toThrow(RangeError);
    expect(() => sumRs([1, 2.5])).toThrow(RangeError);
  });

  it("parses what a cashier types", () => {
    expect(parseRs("12,250")).toBe(12250);
    expect(parseRs("Rs 12250")).toBe(12250);
    expect(parseRs(" 12 250 ")).toBe(12250);
    expect(parseRs("12.5")).toBeNull();
    expect(parseRs("")).toBeNull();
    expect(parseRs("abc")).toBeNull();
  });

  it("formats counts, percents and the lakh variant", () => {
    expect(formatCount(1286)).toBe("1,286");
    expect(formatPercent(92.4)).toBe("92.4%");
    expect(formatLakh(4825000)).toBe("Rs 48.25 lakh");
    expect(formatLakh(2140000)).toBe("Rs 21.4 lakh");
    expect(formatLakh(6800000)).toBe("Rs 68 lakh");
  });
});

describe("dates", () => {
  it("formats calendar dates without a time-zone shift", () => {
    expect(formatDate("2026-11-04")).toBe("04-Nov-2026");
    expect(formatDate("2026-09-15")).toBe("15-Sep-2026");
  });

  it("shows moments in Pakistan time", () => {
    // 05:39 UTC is 10:39 AM in Pakistan (UTC+5)
    expect(formatTime("2026-11-04T05:39:00Z")).toBe("10:39 AM");
    expect(formatDateTime("2026-11-04T10:39:00+05:00")).toBe("04-Nov-2026, 10:39 AM");
    // late evening UTC rolls over to the next Pakistani day
    expect(formatDate("2026-11-04T20:30:00Z")).toBe("05-Nov-2026");
  });

  it("knows today's date in Pakistan", () => {
    expect(pakistanToday(new Date("2026-11-04T18:59:00Z"))).toBe("2026-11-04");
    // 19:00 UTC is midnight in Pakistan
    expect(pakistanToday(new Date("2026-11-04T19:00:00Z"))).toBe("2026-11-05");
    expect(pakistanToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("formats the academic session with an en dash", () => {
    expect(formatSession(2026)).toBe("2026–27");
    expect(formatSession(2099)).toBe("2099–00");
  });

  it("parses typed dates, day first", () => {
    expect(parseDateInput("04-Nov-2026")).toBe("2026-11-04");
    expect(parseDateInput("4 nov 2026")).toBe("2026-11-04");
    expect(parseDateInput("04/11/2026")).toBe("2026-11-04");
    expect(parseDateInput("4-11-2026")).toBe("2026-11-04");
    expect(parseDateInput("2026-11-04")).toBe("2026-11-04");
    expect(parseDateInput("31-Feb-2026")).toBeNull();
    expect(parseDateInput("tomorrow")).toBeNull();
  });
});

describe("late fine (Ayesha's charges on 04-Nov-2026)", () => {
  it("annual charges due 15-Sep-2026: 50 days, Rs 500", () => {
    const f = calculateLateFine("2026-09-15", TODAY);
    expect(f.daysOverdue).toBe(50);
    expect(f.fine).toBe(500);
    expect(f.explanation).toBe("50 days × Rs 10");
  });

  it("October tuition due 10-Oct-2026: 25 days, Rs 250", () => {
    const f = calculateLateFine("2026-10-10", TODAY);
    expect(f.daysOverdue).toBe(25);
    expect(f.fine).toBe(250);
  });

  it("November tuition due 10-Nov-2026: due in 6 days, no fine", () => {
    const f = calculateLateFine("2026-11-10", TODAY);
    expect(f.fine).toBe(0);
    expect(f.dueInDays).toBe(6);
    expect(describeDue(f)).toBe("Due in 6 days");
  });

  it("the fine starts the day after the due date", () => {
    expect(calculateLateFine(TODAY, TODAY).fine).toBe(0);
    expect(describeDue(calculateLateFine(TODAY, TODAY))).toBe("Due today");
    expect(calculateLateFine("2026-11-03", TODAY).fine).toBe(10);
  });

  it("supports the open-decision variants: grace days and a cap", () => {
    expect(calculateLateFine("2026-09-15", TODAY, { ratePerDay: 10, graceDays: 5, maxFine: null }).fine).toBe(450);
    const capped = calculateLateFine("2026-09-15", TODAY, { ratePerDay: 10, graceDays: 0, maxFine: 300 });
    expect(capped.fine).toBe(300);
    expect(capped.capped).toBe(true);
    expect(capped.explanation).toBe("50 days × Rs 10 (capped at Rs 300)");
  });

  it("selected charges total Rs 12,250", () => {
    const total = sumRs([3000, calculateLateFine("2026-09-15", TODAY).fine, 8500, calculateLateFine("2026-10-10", TODAY).fine]);
    expect(total).toBe(12250);
    expect(formatRs(total)).toBe("Rs 12,250");
  });
});

describe("amount in words", () => {
  it("matches the receipt in the brief", () => {
    expect(amountInWords(12250)).toBe("Rupees Twelve Thousand Two Hundred Fifty Only");
  });

  it("handles edges", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(8500)).toBe("Rupees Eight Thousand Five Hundred Only");
    expect(amountInWords(100000)).toBe("Rupees One Hundred Thousand Only");
    expect(amountInWords(4825000)).toBe("Rupees Four Million Eight Hundred Twenty Five Thousand Only");
  });

  it("has a lakh/crore variant", () => {
    expect(amountInWords(4825000, { system: "southAsian" })).toBe("Rupees Forty Eight Lakh Twenty Five Thousand Only");
    expect(amountInWords(21400000, { system: "southAsian" })).toBe("Rupees Two Crore Fourteen Lakh Only");
  });
});

describe("CNIC and mobile", () => {
  it("masks and validates CNIC", () => {
    expect(maskCnic("36302")).toBe("36302");
    expect(maskCnic("3630245678")).toBe("36302-45678");
    expect(maskCnic("3630245678901")).toBe("36302-4567890-1");
    expect(formatCnic("3630245678901")).toBe("36302-4567890-1");
    expect(normalizeCnic("36302-4567890-1")).toBe("3630245678901");
    expect(isValidCnic("36302-4567890-1")).toBe(true);
    expect(isValidCnic("36302-456789")).toBe(false);
    expect(looksLikeCnic("3630245678901")).toBe(true);
    expect(looksLikeCnic("36302-4567890-1")).toBe(true);
    expect(looksLikeCnic("Ayesha")).toBe(false);
  });

  it("formats Pakistani mobiles", () => {
    expect(formatMobile("03001234567")).toBe("0300-1234567");
    expect(formatMobile("+92 300 1234567")).toBe("0300-1234567");
    expect(mobileToE164("0300-1234567")).toBe("+923001234567");
    expect(mobileToE164("12345")).toBeNull();
  });
});

describe("document numbers", () => {
  it("formats G.R., receipt and cancellation numbers", () => {
    expect(formatGrNo("KC", 14823)).toBe("KC-14823");
    expect(formatReceiptNo("KC", 2026, 4821)).toBe("KC-2627-004821");
    expect(formatCancellationNo("KC", 2026, 37)).toBe("KC-CN-2627-000037");
  });
});

describe("attendance summary", () => {
  it("counts present and late as attended, excludes holidays", () => {
    const s = summariseAttendance(["P", "P", "LT", "A", "L", "H", "P"]);
    expect(s.schoolDays).toBe(6);
    expect(s.percent).toBe(66.7);
    expect(summariseAttendance(["H"]).percent).toBeNull();
  });
});
