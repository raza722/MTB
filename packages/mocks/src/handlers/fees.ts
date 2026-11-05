import { can, splitRupees, type AddChargeRequest, type CancelReason, type Charge, type ChargeCancellationApproval, type CounterData, type Ledger, type LedgerEntry, type PostReceiptRequest, type Receipt, type ReceiptLine } from "@mtb/api";
import { amountInWords, calculateLateFine, formatCancellationNo, formatDate, formatReceiptNo, formatSession, type IsoDate } from "@mtb/domain";
import { http } from "msw";
import { CURRENT_SESSION, DEMO_TODAY, demoNow } from "../clock";
import { demoControls } from "../demo";
import { campusOf } from "../fixtures/campuses";
import { findStudent } from "../fixtures/students";
import { fail, HttpResponse, latency, requirePermission, requireUser } from "../util";
import { feeHeadByCode, openVoucherWith, receiptNotesFor } from "./fee-setup";
import { chargesOf, feesStore, financeOf, POLICY, receiptsOf } from "./fees-state";
import { statusNoteOf, toSummary } from "./student-records-model";

/** A receipt as the client sees it: with the campus's receipt notes for the print. */
const withNotes = (r: Receipt): Receipt => ({ ...r, policyNotes: receiptNotesFor(r.campus) });

const SESSION_END = `${CURRENT_SESSION + 1}-03-31`;

/** "2026-11-10" + 1 month → "2026-12-10" (the day is kept, capped at the month's end). */
function addMonths(d: IsoDate, n: number): IsoDate {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}

/** Every charge with a cancellation waiting for the principal, as dashboard approvals. */
export function chargeCancellationApprovals(): ChargeCancellationApproval[] {
  const out: ChargeCancellationApproval[] = [];
  for (const list of Object.values(feesStore.get().charges)) {
    for (const c of list) {
      if (c.cancelRequest?.status !== "PENDING") continue;
      const s = findStudent(c.grNo);
      if (!s) continue;
      out.push({
        id: `cc:${c.id}`,
        kind: "CHARGE_CANCELLATION",
        campus: s.campus,
        campusName: s.campusName,
        requestedBy: c.cancelRequest.requestedBy,
        requestedAt: c.cancelRequest.requestedAt,
        student: { name: s.name, grNo: s.grNo, classSection: s.classSection },
        status: "PENDING",
        chargeId: c.id,
        head: c.head,
        amount: c.amount,
        dueDate: c.dueDate,
        reason: c.cancelRequest.reason,
      });
    }
  }
  return out;
}

/** Used by approvals: the principal's decision on cancelling an unpaid charge. Returns false when nothing was pending. */
export function decideChargeCancellation(chargeId: string, approve: boolean, decidedBy: string): boolean {
  const grNo = chargeId.split(":")[0] ?? "";
  const c = feesStore.get().charges[grNo]?.find((x) => x.id === chargeId);
  if (!c || c.cancelRequest?.status !== "PENDING") return false;
  // Paid since the request: the charge stands.
  const paid = c.status !== "OPEN" || c.settledAmount > 0;
  const decidedAt = demoNow();
  const cancelRequest = { ...c.cancelRequest, status: approve && !paid ? ("APPROVED" as const) : ("REJECTED" as const), decidedBy, decidedAt };
  feesStore.set((st) => ({
    ...st,
    charges: { ...st.charges, [grNo]: (st.charges[grNo] ?? []).map((x) => (x.id === chargeId ? { ...x, cancelRequest, ...(approve && !paid ? { status: "CANCELLED" as const } : {}) } : x)) },
  }));
  financeOf(grNo);
  return true;
}

function validatePayment(body: PostReceiptRequest, total: number): Response | null {
  const p = body.payment;
  if (p.method === "CASH" && !(p.received >= total)) return fail(422, "VALIDATION", "Amount received is less than the total.", { field: "received" });
  if (p.method === "BANK") {
    if (!p.bank?.trim()) return fail(422, "VALIDATION", "Choose the bank.", { field: "bank" });
    if (!p.slipNo?.trim()) return fail(422, "VALIDATION", "Enter the slip number printed on the deposit slip.", { field: "slipNo" });
    if (!p.depositDate) return fail(422, "VALIDATION", "Enter the deposit date.", { field: "depositDate" });
  }
  if (p.method === "CHEQUE") {
    if (!p.chequeNo?.trim()) return fail(422, "VALIDATION", "Enter the cheque number printed on the cheque.", { field: "chequeNo" });
    if (!p.bank?.trim()) return fail(422, "VALIDATION", "Choose the bank.", { field: "bank" });
    if (!p.chequeDate) return fail(422, "VALIDATION", "Enter the cheque date.", { field: "chequeDate" });
  }
  if (p.method === "ONLINE" && !p.transactionId?.trim()) return fail(422, "VALIDATION", "Enter the transaction ID.", { field: "transactionId" });
  return null;
}

function buildLedger(grNo: string, session: number | "ALL"): Ledger {
  const charges = chargesOf(grNo).filter((c) => session === "ALL" || c.session === session);
  const chargeIds = new Set(charges.map((c) => c.id));
  const receipts = receiptsOf(grNo).filter((r) => r.lines.some((l) => chargeIds.has(l.chargeId)));
  const raw: Array<Omit<LedgerEntry, "balance">> = [];

  for (const c of charges) {
    const live = receipts.filter((r) => r.status !== "CANCELLED" && r.lines.some((l) => l.chargeId === c.id)).sort((a, b) => a.postedAt.localeCompare(b.postedAt));
    const coveredBy = live.flatMap((r) => r.lines.filter((l) => l.chargeId === c.id).map((l) => ({ receiptNo: r.receiptNo, amount: Math.max(0, l.applied - l.lateFine) })));
    const paid = c.status === "SETTLED" ? c.amount : c.settledAmount;
    const settled = c.status === "SETTLED" || paid >= c.amount ? "PAID" : paid > 0 ? "PART_PAID" : "PAYABLE";
    const last = live.at(-1);
    const cancelled = c.status === "CANCELLED";
    raw.push({
      id: `c:${c.id}`,
      date: c.dueDate,
      docType: "CHARGE",
      description: c.note ? `${c.head} · charge added · ${c.note}` : `${c.head} · due`,
      charge: c.amount,
      payment: 0,
      chargeId: c.id,
      coveredBy,
      dueDate: c.dueDate,
      ...(cancelled ? { cancelled: true } : { settled, due: Math.max(0, c.amount - paid) }),
      ...(last && !cancelled ? { paidOn: last.postedAt.slice(0, 10) } : {}),
      ...(c.addedBy ? { oneOff: true } : {}),
      ...(c.cancelRequest?.status === "PENDING" ? { cancelPending: true } : {}),
    });
    if (cancelled && c.cancelRequest?.status === "APPROVED") {
      raw.push({
        id: `xc:${c.id}`,
        // Listed right after the charge it cancels (a charge due later is cancelled before its due date).
        date: [(c.cancelRequest.decidedAt ?? c.cancelRequest.requestedAt).slice(0, 10), c.dueDate].sort()[1]!,
        docType: "CANCELLATION",
        description: `Charge cancelled · ${c.head} · ${c.cancelRequest.reason} (approved by ${c.cancelRequest.decidedBy ?? "the principal"})`,
        charge: 0,
        payment: 0,
        chargeId: c.id,
      });
    }
  }
  for (const r of receipts) {
    const day = r.postedAt.slice(0, 10);
    const cancelled = r.status === "CANCELLED";
    for (const l of r.lines.filter((x) => x.lateFine > 0)) {
      raw.push({ id: `f:${r.receiptNo}:${l.chargeId}`, date: day, docType: "LATE_FINE", docNo: r.receiptNo, description: `Late fine on ${l.head} · ${l.daysOverdue} days × Rs 10`, charge: l.lateFine, payment: 0, chargeId: l.chargeId, cancelled });
    }
    raw.push({
      id: `r:${r.receiptNo}`,
      date: day,
      docType: "RECEIPT",
      docNo: r.receiptNo,
      receiptNo: r.receiptNo,
      description: `Receipt · ${r.payment.method === "CASH" ? "Cash" : r.payment.method === "BANK" ? "Bank deposit" : r.payment.method === "CHEQUE" ? "Cheque" : "Online transfer"}`,
      charge: 0,
      payment: r.total,
      allocations: r.lines.map((l) => ({ chargeId: l.chargeId, head: l.head, amount: l.applied })),
      cancelled,
    });
    if (r.cancellation && r.status === "CANCELLED") {
      raw.push({
        id: `x:${r.cancellation.cnNo}`,
        date: (r.cancellation.decidedAt ?? r.cancellation.requestedAt).slice(0, 10),
        docType: "CANCELLATION",
        docNo: r.cancellation.cnNo,
        receiptNo: r.receiptNo,
        description: `Receipt ${r.receiptNo} cancelled · charges reopened`,
        charge: 0,
        payment: 0,
      });
    }
  }
  const order = { CHARGE: 0, LATE_FINE: 1, RECEIPT: 2, CANCELLATION: 3 } as const;
  raw.sort((x, y) => x.date.localeCompare(y.date) || order[x.docType] - order[y.docType]);
  let balance = 0;
  const entries: LedgerEntry[] = raw.map((e) => {
    if (!e.cancelled) balance += e.charge - e.payment;
    return { ...e, balance };
  });
  const arrears = charges.filter((c) => c.status === "OPEN" && c.dueDate < DEMO_TODAY).reduce((a, c) => a + c.amount - c.settledAmount, 0);
  return { grNo, session: session === "ALL" ? 0 : session, entries, balance, arrears };
}

export const feesHandlers = [
  http.get("/api/fees/students/:grNo/charges", async ({ params }) => {
    await latency();
    const s = findStudent(String(params.grNo));
    if (!s) return fail(404, "NOT_FOUND", "No student with this G.R. number.");
    const user = requirePermission("fees.view", s.campus);
    if (user instanceof Response) return user;
    const charges = chargesOf(s.grNo)
      .filter((c) => c.status === "OPEN")
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    // Left, struck off, expelled or passed out: the counter collects outstanding dues only.
    const note = s.status !== "ACTIVE" ? statusNoteOf(s) : undefined;
    const data: CounterData = {
      student: toSummary(s),
      charges,
      policy: POLICY,
      today: DEMO_TODAY,
      ...(note && s.status !== "ACTIVE" ? { left: { on: note.on, reason: note.reason, status: s.status } } : {}),
    };
    return HttpResponse.json(data);
  }),

  http.post("/api/fees/receipts", async ({ request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
    const body = (await request.json()) as PostReceiptRequest;
    const user = requirePermission("fees.collect", body.campus);
    if (user instanceof Response) return user;

    // Same key again (double-click, retry after a timeout): return the receipt already posted.
    const done = feesStore.get().idem[key];
    if (done) return HttpResponse.json(feesStore.get().receipts[done]);

    if (demoControls.get().failNextReceiptPost) {
      demoControls.set((c) => ({ ...c, failNextReceiptPost: false }));
      await latency();
      return HttpResponse.error();
    }
    if (body.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "2025–26 is closed. Switch to 2026–27 to collect fees.");

    const s = findStudent(body.grNo);
    if (!s || s.campus !== body.campus) return fail(404, "NOT_FOUND", "No student with this G.R. number at this campus.");
    const all = chargesOf(s.grNo);
    const selected = body.chargeIds.map((id) => all.find((c) => c.id === id)).filter((c): c is Charge => Boolean(c));
    if (selected.length === 0 || selected.length !== body.chargeIds.length) return fail(422, "VALIDATION", "Select at least one charge to pay.");
    if (selected.some((c) => c.status !== "OPEN")) return fail(409, "ALREADY_PAID", "One of these charges was paid on another counter. Reload the student.");
    selected.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const lines: ReceiptLine[] = selected.map((c) => {
      const lf = calculateLateFine(c.dueDate, DEMO_TODAY, POLICY);
      const outstanding = c.amount - c.settledAmount;
      return { chargeId: c.id, head: c.head, dueDate: c.dueDate, amount: outstanding, daysOverdue: lf.daysOverdue, lateFine: lf.fine, lineTotal: outstanding + lf.fine, applied: outstanding + lf.fine };
    });
    const full = lines.reduce((a, l) => a + l.lineTotal, 0);
    let total = full;
    if (body.amount !== undefined) {
      if (!Number.isSafeInteger(body.amount) || body.amount <= 0) return fail(422, "VALIDATION", "Enter the amount being paid.", { field: "amount" });
      if (body.amount > full) return fail(422, "VALIDATION", "The amount is more than the selected charges.", { field: "amount" });
      // Partial-payment variant: oldest line first; each line's late fine is paid before its fee.
      let left = body.amount;
      for (const l of lines) {
        l.applied = Math.min(left, l.lineTotal);
        left -= l.applied;
      }
      total = body.amount;
    }
    const invalid = validatePayment(body, total);
    if (invalid) return invalid;
    const paidBy = body.paidBy?.trim() ?? "";
    const note = body.note?.trim() ?? "";
    if (paidBy.length > 60) return fail(422, "VALIDATION", "Keep the payer's name to 60 characters.", { field: "paidBy" });
    if (note.length > 160) return fail(422, "VALIDATION", "Keep the remarks to one line (160 characters).", { field: "note" });

    const campus = campusOf(s.campus);
    const seq = (feesStore.get().seq[s.campus] ?? 0) + 1;
    const receiptNo = formatReceiptNo(campus.docPrefix, CURRENT_SESSION, seq);
    const receipt: Receipt = {
      receiptNo,
      campus: s.campus,
      campusName: campus.name,
      campusAddress: campus.address,
      session: CURRENT_SESSION,
      grNo: s.grNo,
      studentName: s.name,
      ...(s.nameUr ? { studentNameUr: s.nameUr } : {}),
      relation: s.relation,
      father: s.father,
      classSection: s.classSection,
      cashier: user.name,
      postedAt: demoNow(),
      lines: lines.filter((l) => l.applied > 0),
      total,
      amountInWords: amountInWords(total),
      payment: body.payment.method === "CASH" ? { ...body.payment, change: body.payment.received - total } : body.payment,
      status: "POSTED",
      printCount: 0,
      ...(paidBy && paidBy.toLowerCase() !== s.guardian.name.toLowerCase() ? { paidBy } : {}),
      ...(note ? { note } : {}),
    };
    feesStore.set((st) => ({
      ...st,
      seq: { ...st.seq, [s.campus]: seq },
      idem: { ...st.idem, [key]: receiptNo },
      receipts: { ...st.receipts, [receiptNo]: receipt },
      charges: {
        ...st.charges,
        [s.grNo]: (st.charges[s.grNo] ?? []).map((c) => {
          const l = receipt.lines.find((x) => x.chargeId === c.id);
          if (!l) return c;
          const settledAmount = Math.min(c.amount, c.settledAmount + Math.max(0, l.applied - l.lateFine));
          return { ...c, settledAmount, status: settledAmount >= c.amount ? "SETTLED" : "OPEN" };
        }),
      },
      postedToday: { ...st.postedToday, [s.campus]: { amount: (st.postedToday[s.campus]?.amount ?? 0) + total, receipts: (st.postedToday[s.campus]?.receipts ?? 0) + 1 } },
    }));
    return HttpResponse.json(withNotes(receipt), { status: 201 });
  }),

  http.get("/api/fees/receipts/:receiptNo", async ({ params }) => {
    await latency();
    const r = feesStore.get().receipts[String(params.receiptNo).toUpperCase()];
    if (!r) return fail(404, "NOT_FOUND", "No receipt with this number.");
    const user = requirePermission("fees.view", r.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(withNotes(r));
  }),

  /* ---------------- One-off charges on one student's ledger */
  http.post("/api/fees/students/:grNo/charges", async ({ params, request }) => {
    await latency();
    const s = findStudent(String(params.grNo));
    if (!s) return fail(404, "NOT_FOUND", "No student with this G.R. number.");
    const user = requireUser();
    if (user instanceof Response) return user;
    if (!can(user, "fees.setup", s.campus) && !can(user, "fees.collect", s.campus)) return fail(403, "FORBIDDEN", "Your role can't add charges at this campus.");
    const key = request.headers.get("Idempotency-Key");
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
    const done = feesStore.get().idem[key];
    if (done) return HttpResponse.json({ charges: chargesOf(s.grNo).filter((c) => c.id.startsWith(done)) });
    if (["LEFT", "EXPELLED", "PASSED_OUT"].includes(s.status)) return fail(409, "NOT_ENROLLED", `${s.name} is not enrolled, so new charges can't be added. Collect any dues at the counter.`);
    const body = (await request.json().catch(() => ({}))) as Partial<AddChargeRequest>;
    const h = feeHeadByCode(body.head ?? "");
    if (!h || h.category !== "FEE" || h.linked) return fail(422, "VALIDATION", "Choose the fee head.", { field: "head" });
    if (!h.active) return fail(422, "VALIDATION", `${h.title} is switched off. Choose another head.`, { field: "head" });
    if (h.classes?.length && !h.classes.includes(s.classSection.split("-")[0] ?? "")) return fail(422, "VALIDATION", `${h.title} is only for ${h.classes.map((c) => (c === "Prep" ? "Prep" : `Class ${c}`)).join(", ")}.`, { field: "head" });
    const amount = Number(body.amount);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 500000) return fail(422, "VALIDATION", "Enter the amount in whole rupees, up to Rs 500,000.", { field: "amount" });
    const due = body.dueDate ?? "";
    if (!due || due < DEMO_TODAY) return fail(422, "VALIDATION", "The due date can't be in the past.", { field: "dueDate" });
    const parts = body.installments ?? 1;
    if (!Number.isInteger(parts) || parts < 1 || parts > 12) return fail(422, "VALIDATION", "Split into 1 to 12 parts.", { field: "installments" });
    if (parts > amount) return fail(422, "VALIDATION", "Each part must be at least Rs 1.", { field: "installments" });
    if (addMonths(due, parts - 1) > SESSION_END) return fail(422, "VALIDATION", `The last part would fall after the session ends (${formatDate(SESSION_END)}). Choose fewer parts or an earlier date.`, { field: parts > 1 ? "installments" : "dueDate" });
    const note = (body.note ?? "").trim();
    if (note.length < 5) return fail(422, "VALIDATION", "Say why it is charged, in a few words; it shows on the ledger.", { field: "note" });
    if (note.length > 120) return fail(422, "VALIDATION", "Keep the reason to 120 characters.", { field: "note" });
    chargesOf(s.grNo);
    const at = demoNow();
    const prefix = `${s.grNo}:x${Date.now().toString(36)}`;
    const split = splitRupees(amount, parts);
    const added: Charge[] = split.map((part, i) => ({
      id: `${prefix}-${i + 1}`,
      grNo: s.grNo,
      session: CURRENT_SESSION,
      head: parts > 1 ? `${h.title} (part ${i + 1} of ${parts})` : h.title,
      headCode: h.code,
      kind: "FEE",
      amount: part,
      dueDate: addMonths(due, i),
      status: "OPEN",
      settledAmount: 0,
      note,
      addedBy: user.name,
      addedAt: at,
    }));
    feesStore.set((st) => ({ ...st, idem: { ...st.idem, [key]: prefix }, charges: { ...st.charges, [s.grNo]: [...(st.charges[s.grNo] ?? []), ...added] } }));
    financeOf(s.grNo);
    return HttpResponse.json({ charges: added }, { status: 201 });
  }),

  http.post("/api/fees/charges/:id/cancel", async ({ params, request }) => {
    await latency();
    const id = decodeURIComponent(String(params.id));
    const grNo = id.split(":")[0] ?? "";
    const s = findStudent(grNo);
    const c = s ? chargesOf(s.grNo).find((x) => x.id === id) : undefined;
    if (!s || !c) return fail(404, "NOT_FOUND", "This charge is no longer on record.");
    const user = requireUser();
    if (user instanceof Response) return user;
    if (!can(user, "fees.setup", s.campus) && !can(user, "fees.collect", s.campus) && !can(user, "fees.cancel.request", s.campus)) return fail(403, "FORBIDDEN", "Your role can't cancel charges at this campus.");
    if (c.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", `${formatSession(c.session)} is closed and read-only.`);
    const key = request.headers.get("Idempotency-Key");
    if (key && feesStore.get().idem[key] && c.cancelRequest) return HttpResponse.json(c);
    if (c.status === "CANCELLED") return fail(409, "ALREADY_CANCELLED", "This charge is already cancelled.");
    if (c.cancelRequest?.status === "PENDING") return fail(409, "PENDING", "A cancellation for this charge is already waiting for the principal.");
    const allocated = receiptsOf(s.grNo).some((r) => r.status !== "CANCELLED" && r.lines.some((l) => l.chargeId === c.id));
    if (c.status !== "OPEN" || c.settledAmount > 0 || allocated) return fail(409, "PAID", `Money has been received against ${c.head}, so it can't be cancelled. Cancel the receipt first if it was posted by mistake.`);
    const onVoucher = openVoucherWith(s.grNo, c.id);
    if (onVoucher) return fail(409, "ON_VOUCHER", `${c.head} is on bank voucher ${onVoucher}. Cancel the voucher first, then the charge.`);
    const { reason } = (await request.json().catch(() => ({}))) as { reason?: string };
    if ((reason ?? "").trim().length < 5) return fail(422, "VALIDATION", "Say why the charge should be cancelled; the principal reads this.", { field: "reason" });
    const cancelRequest = { id: `cc-${Date.now().toString(36)}`, reason: reason!.trim(), requestedBy: user.name, requestedAt: demoNow(), status: "PENDING" as const };
    feesStore.set((st) => ({
      ...st,
      ...(key ? { idem: { ...st.idem, [key]: c.id } } : {}),
      charges: { ...st.charges, [s.grNo]: (st.charges[s.grNo] ?? []).map((x) => (x.id === c.id ? { ...x, cancelRequest } : x)) },
    }));
    return HttpResponse.json({ ...c, cancelRequest }, { status: 201 });
  }),

  http.post("/api/fees/receipts/:receiptNo/print", async ({ params }) => {
    await latency();
    const no = String(params.receiptNo);
    const r = feesStore.get().receipts[no];
    if (!r) return fail(404, "NOT_FOUND", "No receipt with this number.");
    feesStore.set((st) => ({ ...st, receipts: { ...st.receipts, [no]: { ...r, printCount: r.printCount + 1 } } }));
    return HttpResponse.json({ printCount: r.printCount + 1 });
  }),

  http.post("/api/fees/receipts/:receiptNo/sms", async ({ params }) => {
    await latency();
    const r = feesStore.get().receipts[String(params.receiptNo)];
    if (!r) return fail(404, "NOT_FOUND", "No receipt with this number.");
    const s = findStudent(r.grNo);
    return HttpResponse.json({ status: "QUEUED", to: s?.guardian.mobile ?? "" });
  }),

  http.post("/api/fees/receipts/:receiptNo/cancel", async ({ params, request }) => {
    await latency();
    const no = String(params.receiptNo);
    const key = request.headers.get("Idempotency-Key") ?? "";
    const r = feesStore.get().receipts[no];
    if (!r) return fail(404, "NOT_FOUND", "No receipt with this number.");
    const user = requirePermission("fees.cancel.request", r.campus);
    if (user instanceof Response) return user;
    const done = key && feesStore.get().idem[key];
    if (done && r.cancellation) return HttpResponse.json(r.cancellation);
    if (r.status !== "POSTED") return fail(409, "NOT_CANCELLABLE", r.status === "CANCELLED" ? "This receipt is already cancelled." : "A cancellation is already waiting for approval.");
    const { reason, note } = (await request.json()) as { reason: CancelReason; note: string };
    if (!note?.trim()) return fail(422, "VALIDATION", "Add a note saying what went wrong.", { field: "note" });
    const seq = (feesStore.get().cnSeq[r.campus] ?? 0) + 1;
    const cancellation = {
      cnNo: formatCancellationNo(campusOf(r.campus).docPrefix, r.session, seq),
      receiptNo: no,
      reason,
      note: note.trim(),
      requestedBy: user.name,
      requestedAt: demoNow(),
      status: "PENDING" as const,
    };
    feesStore.set((st) => ({
      ...st,
      cnSeq: { ...st.cnSeq, [r.campus]: seq },
      ...(key ? { idem: { ...st.idem, [key]: cancellation.cnNo } } : {}),
      receipts: { ...st.receipts, [no]: { ...r, status: "CANCEL_PENDING", cancellation } },
    }));
    return HttpResponse.json(cancellation, { status: 201 });
  }),

  http.get("/api/fees/students/:grNo/ledger", async ({ params, request }) => {
    await latency();
    const s = findStudent(String(params.grNo));
    if (!s) return fail(404, "NOT_FOUND", "No student with this G.R. number.");
    // The read-only fee card (fees.card) opens the ledger and nothing else in Fees.
    const viewer = requireUser();
    if (viewer instanceof Response) return viewer;
    const user = can(viewer, "fees.card", s.campus) ? viewer : requirePermission("fees.view", s.campus);
    if (user instanceof Response) return user;
    const sp = new URL(request.url).searchParams.get("session") ?? String(CURRENT_SESSION);
    return HttpResponse.json(buildLedger(s.grNo, sp === "ALL" ? "ALL" : Number(sp)));
  }),
];

/** Used by approvals: apply a principal's decision on a cancellation. */
export function decideCancellation(receiptNo: string, approve: boolean, decidedBy: string) {
  const r = feesStore.get().receipts[receiptNo];
  if (!r?.cancellation) return;
  const decidedAt = demoNow();
  const cancellation = { ...r.cancellation, status: approve ? ("APPROVED" as const) : ("REJECTED" as const), decidedBy, decidedAt };
  feesStore.set((st) => {
    const charges = st.charges[r.grNo] ?? [];
    return {
      ...st,
      receipts: { ...st.receipts, [receiptNo]: { ...r, status: approve ? "CANCELLED" : "POSTED", cancellation } },
      charges: approve
        ? {
            ...st.charges,
            [r.grNo]: charges.map((c) => {
              const l = r.lines.find((x) => x.chargeId === c.id);
              if (!l) return c;
              const settledAmount = Math.max(0, c.settledAmount - Math.max(0, l.applied - l.lateFine));
              return { ...c, settledAmount, status: "OPEN" };
            }),
          }
        : st.charges,
    };
  });
  financeOf(r.grNo);
}
