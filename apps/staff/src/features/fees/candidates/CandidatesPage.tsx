import { feeSetupApi, feeSetupQueries, newIdempotencyKey, type FeeCandidate, type FeeCandidatesData } from "@mtb/api";
import { amountInWords, formatCount, formatDate, formatRs, formatSession } from "@mtb/domain";
import { AmountInput, AnimatedNumber, Banner, Button, Checkbox, DataTable, DatePicker, EmptyState, Input, Radio, Select, SidePanel, StatCard, StatusBadge, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../../app/shell/campus";
import { Page, PageHeader, RequirePermission } from "../../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../../app/session";
import { errorField, errorText, FeesNav, LoadError, PaperSize, TODAY } from "../shared";

/** A5 slip handed to the candidate with the test roll slip: one line per head, total and paid. */
export function CandidateSlip({ c }: { c: FeeCandidate }) {
  return (
    <div data-theme="light" className="fees-slip" aria-label={`Candidate fee slip ${c.receiptNo ?? ""}`}>
      <div className="flex items-start justify-between gap-4 border-b border-border-strong pb-2">
        <div className="grid">
          <span className="text-title-2 text-brand-ink">MTB</span>
          <span className="font-medium">{c.campusName}</span>
        </div>
        <div className="grid justify-items-end text-right">
          <span className="text-title-3">Candidate fee slip</span>
          <span className="tabular-nums">{c.receiptNo}</span>
        </div>
      </div>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
        <dt className="text-ink-muted">Candidate</dt>
        <dd className="m-0 font-medium">{c.name}</dd>
        <dt className="text-ink-muted">Father</dt>
        <dd className="m-0">{c.father}</dd>
        <dt className="text-ink-muted">Application</dt>
        <dd className="m-0 tabular-nums">{c.applicationNo}</dd>
        <dt className="text-ink-muted">Class applied for</dt>
        <dd className="m-0">{c.classApplied}</dd>
        {c.testDate && (
          <>
            <dt className="text-ink-muted">Entrance test</dt>
            <dd className="m-0">{formatDate(c.testDate)}</dd>
          </>
        )}
        <dt className="text-ink-muted">Paid on</dt>
        <dd className="m-0">
          {c.paidOn ? formatDate(c.paidOn) : "—"}
          {c.paymentMethod === "BANK" ? ` · at the bank, challan ${c.bankChallanNo ?? ""}` : c.paymentMethod === "CASH" ? " · cash" : ""}
        </dd>
        {c.paidBy && (
          <>
            <dt className="text-ink-muted">Paid by</dt>
            <dd className="m-0">{c.paidBy}</dd>
          </>
        )}
      </dl>
      <table className="w-full border-collapse tabular-nums">
        <thead>
          <tr className="border-b border-border-strong text-left text-[11px] uppercase tracking-wide text-ink-muted">
            <th className="py-1 font-medium">Description</th>
            <th className="py-1 text-right font-medium">Fee</th>
            <th className="py-1 text-right font-medium">Paid</th>
          </tr>
        </thead>
        <tbody>
          {c.lines.map((l) => (
            <tr key={l.head} className="border-b border-border">
              <td className="py-1.5">{l.title}</td>
              <td className="py-1.5 text-right">{formatRs(l.amount)}</td>
              <td className="py-1.5 text-right">{formatRs(l.paid)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-2 text-right font-semibold">Total amount</td>
            <td className="pt-2 text-right font-semibold">{formatRs(c.amount)}</td>
            <td />
          </tr>
          <tr>
            <td className="text-right font-semibold">Paid amount</td>
            <td />
            <td className="text-right text-[15px] font-semibold">{formatRs(c.received)}</td>
          </tr>
        </tfoot>
      </table>
      <span className="text-small italic text-ink-muted">{amountInWords(c.received)}</span>
      {c.receivedBy && <span className="text-small text-ink-muted">Received by {c.receivedBy}</span>}
      <span className="text-small text-ink-muted">Note: fee once paid is not refundable. Bring this slip to the entrance test.</span>
    </div>
  );
}

/* ---------------------------------------------------------------- Receive candidate fees */

interface LineDraft {
  on: boolean;
  amount: number | null;
  paid: number | null;
}

function PayCandidatePanel({ c, heads, onClose, onPaid }: { c: FeeCandidate; heads: FeeCandidatesData["heads"]; onClose: () => void; onPaid: (c: FeeCandidate) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<Record<string, LineDraft>>(() =>
    Object.fromEntries(heads.map((h) => [h.code, h.code === "CANDIDATE" ? { on: true, amount: c.amount, paid: c.amount } : { on: false, amount: h.amount || null, paid: h.amount || null }])),
  );
  const [method, setMethod] = useState<"CASH" | "BANK">("CASH");
  const [challanNo, setChallanNo] = useState("");
  const [bankDate, setBankDate] = useState<string | null>(TODAY);
  const [paidBy, setPaidBy] = useState("");
  const [tried, setTried] = useState(false);
  const chosen = heads.filter((h) => lines[h.code]?.on);

  const schema = z
    .object({
      lines: z
        .array(
          z
            .object({
              head: z.string(),
              amount: z.number({ error: "Enter the fee." }).int().min(0).max(50000, "That is more than Rs 50,000. Check the figure."),
              paid: z.number({ error: "Enter what was paid." }).int().min(0),
            })
            .refine((l) => l.paid <= l.amount, { path: ["paid"], message: "Paid can't be more than the fee." }),
        )
        .min(1, "Choose at least one fee head."),
      method: z.enum(["CASH", "BANK"]),
      challanNo: z.string(),
      date: z.string(),
      paidBy: z.string().max(60, "Keep the name to 60 characters."),
    })
    .refine((v) => v.lines.reduce((a, l) => a + l.paid, 0) > 0, { path: ["lines"], message: "Enter the amount paid." })
    .refine((v) => v.method !== "BANK" || v.challanNo.trim().length > 0, { path: ["challanNo"], message: "Enter the bank challan number." })
    .refine((v) => v.method !== "BANK" || (v.date !== "" && v.date <= TODAY), { path: ["date"], message: "Enter the day it was paid at the bank (today or earlier)." });
  const body = {
    lines: chosen.map((h) => ({ head: h.code, amount: lines[h.code]?.amount ?? undefined, paid: lines[h.code]?.paid ?? undefined })),
    method,
    challanNo,
    date: bankDate ?? "",
    paidBy,
  };
  const parsed = schema.safeParse(body);
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errors[i.path.join(".")] ??= i.message;
  const total = chosen.reduce((a, h) => a + (lines[h.code]?.amount ?? 0), 0);
  const received = chosen.reduce((a, h) => a + (lines[h.code]?.paid ?? 0), 0);
  const key = useMemo(() => newIdempotencyKey(), [JSON.stringify(body)]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = useMutation({
    mutationFn: () =>
      feeSetupApi.payCandidate(
        c.id,
        {
          lines: chosen.map((h) => ({ head: h.code, amount: lines[h.code]?.amount ?? 0, paid: lines[h.code]?.paid ?? 0 })),
          payment: method === "BANK" ? { method: "BANK", challanNo: challanNo.trim(), date: bankDate! } : { method: "CASH" },
          ...(paidBy.trim() ? { paidBy: paidBy.trim() } : {}),
        },
        key,
      ),
    onSuccess: (r) => {
      toast({ title: `Candidate fee received · ${r.receiptNo}`, message: `${r.name} · ${formatRs(r.received)}${r.paymentMethod === "BANK" ? " at the bank" : " cash"}. The test slip can now be printed in Admissions.` });
      void queryClient.invalidateQueries({ queryKey: ["fees", "setup"] });
      void queryClient.invalidateQueries({ queryKey: ["admissions"] });
      onPaid(r);
    },
  });
  const set = (code: string, patch: Partial<LineDraft>) => setLines((p) => ({ ...p, [code]: { ...(p[code] ?? { on: false, amount: null, paid: null }), ...patch } }));
  const serverField = errorField(pay.error);

  return (
    <SidePanel
      open
      onClose={onClose}
      title={`Receive fees from ${c.name}`}
      description={`${c.applicationNo} · ${c.classApplied} · ${c.father}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={pay.isPending}
            loadingLabel="Posting…"
            onClick={() => {
              setTried(true);
              if (parsed.success) pay.mutate();
            }}
          >
            Post candidate receipt · {formatRs(received)}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-3">
          {heads.map((h, i) => {
            const l = lines[h.code] ?? { on: false, amount: null, paid: null };
            const idx = chosen.findIndex((x) => x.code === h.code);
            return (
              <div key={h.code} className="grid gap-2 rounded-md border border-border p-3">
                <Checkbox label={h.title} checked={l.on} disabled={h.code === "CANDIDATE"} onChange={(e) => set(h.code, { on: e.target.checked })} />
                {l.on && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <AmountInput label="Fee" value={l.amount} onValueChange={(v) => set(h.code, { amount: v, ...(l.paid === l.amount ? { paid: v } : {}) })} error={tried ? errors[`lines.${idx}.amount`] : undefined} />
                    <AmountInput label="Paid" value={l.paid} onValueChange={(v) => set(h.code, { paid: v })} error={tried ? errors[`lines.${idx}.paid`] : undefined} />
                  </div>
                )}
                {i === 0 && <span className="text-small text-ink-muted">The test fee for {c.classApplied} is always on the slip.</span>}
              </div>
            );
          })}
          {tried && errors.lines && <span className="text-small text-danger-ink">{errors.lines}</span>}
        </div>
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mtb-label mb-1">Payment</legend>
          <div className="flex flex-wrap gap-4">
            <Radio name="cand-method" label="Cash at the counter" checked={method === "CASH"} onChange={() => setMethod("CASH")} />
            <Radio name="cand-method" label="Bank challan" checked={method === "BANK"} onChange={() => setMethod("BANK")} />
          </div>
        </fieldset>
        {method === "BANK" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Bank challan no." required mono value={challanNo} onChange={(e) => setChallanNo(e.target.value)} error={tried ? (errors.challanNo ?? (serverField === "challanNo" ? errorText(pay.error) : undefined)) : undefined} />
            <DatePicker label="Paid at the bank on" required value={bankDate} onValueChange={setBankDate} today={TODAY} maxDate={TODAY} error={tried ? (errors.date ?? (serverField === "date" ? errorText(pay.error) : undefined)) : undefined} />
          </div>
        )}
        <Input label="Paid by" value={paidBy} onChange={(e) => setPaidBy(e.target.value)} placeholder={c.father} help="Leave empty when the father pays." maxLength={60} error={tried ? errors.paidBy : undefined} />
        <div className="flex items-baseline justify-between rounded-md border border-border px-4 py-3">
          <span className="grid">
            <span className="font-medium">Receiving</span>
            <span className="text-small text-ink-muted">Fee total {formatRs(total)}</span>
          </span>
          <span className="text-title-2 tabular-nums">{formatRs(received)}</span>
        </div>
        <p className="m-0 text-small text-ink-muted">The receipt number is given on posting and is never reused.</p>
        {pay.error && !["challanNo", "date"].includes(serverField ?? "") && <Banner tone="danger">{errorText(pay.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Page */

export function CandidatesPage() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canCollect = useCan("fees.collect");
  const q = useQuery(feeSetupQueries.candidates(ctx));
  const [status, setStatus] = useState<"" | FeeCandidate["status"]>("");
  const [cls, setCls] = useState("");
  const [cashier, setCashier] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [paying, setPaying] = useState<FeeCandidate | null>(null);
  const [slip, setSlip] = useState<FeeCandidate | null>(null);
  const [printing, setPrinting] = useState(false);
  const d = q.data;
  const heads = (d?.heads ?? []).filter((h) => h.code === "CANDIDATE" || (d?.rows ?? []).some((r) => r.lines.some((l) => l.head === h.code)));
  const classes = [...new Set((d?.rows ?? []).map((r) => r.classApplied))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const dateError = from && to && from > to ? "The first date must be on or before the second." : undefined;
  const dated = Boolean(from || to);
  const rows = (d?.rows ?? []).filter(
    (r) =>
      (!status || r.status === status) &&
      (!cls || r.classApplied === cls) &&
      (!cashier || r.receivedBy === cashier) &&
      (!dated || (r.paidOn !== undefined && (!from || r.paidOn >= from) && (!to || r.paidOn <= to))) &&
      (!query.trim() || `${r.name} ${r.applicationNo} ${r.father}`.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const paidRows = rows.filter((r) => r.status === "PAID");
  const byCashier = [...new Set(paidRows.map((r) => r.receivedBy ?? ""))].sort().map((name) => ({ name, rows: paidRows.filter((r) => (r.receivedBy ?? "") === name).sort((a, b) => (a.paidOn ?? "").localeCompare(b.paidOn ?? "") || (a.receiptNo ?? "").localeCompare(b.receiptNo ?? "")) }));
  const lineOf = (r: FeeCandidate, code: string) => r.lines.find((l) => l.head === code);
  const filtered = Boolean(status || cls || cashier || query || dated);

  // Print the list once the print area has painted (A4, grouped by cashier).
  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 60);
    return () => clearTimeout(t);
  }, [printing]);

  const columns: Array<Column<FeeCandidate>> = [
    {
      key: "name",
      header: "Candidate",
      render: (r) => (
        <span className="grid">
          <span className="font-medium">{r.name}</span>
          <span className="text-small text-ink-muted">
            {r.applicationNo} · {r.father}
            {ctx.campus === "ALL" ? ` · ${r.campusName}` : ""}
          </span>
        </span>
      ),
    },
    { key: "class", header: "Class", render: (r) => r.classApplied },
    { key: "test", header: "Test", render: (r) => (r.testDate ? <span className="mtb-num">{formatDate(r.testDate)}</span> : <span className="text-ink-subtle">Not set</span>) },
    ...heads.map(
      (h): Column<FeeCandidate> => ({
        key: `h-${h.code}`,
        header: h.code === "CANDIDATE" ? "Test fee" : h.title,
        align: "right",
        render: (r) => {
          const l = lineOf(r, h.code);
          return l ? <span className="mtb-num">{formatRs(r.status === "PAID" ? l.paid : l.amount)}</span> : "";
        },
      }),
    ),
    { key: "amount", header: "Received", align: "right", render: (r) => (r.status === "PAID" ? <span className="mtb-num font-semibold">{formatRs(r.received)}</span> : <span className="text-ink-subtle">—</span>) },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.status === "PAID" ? (
          <span className="grid">
            <StatusBadge status="paid" />
            <span className="text-small text-ink-muted">
              {r.receiptNo} · {r.paidOn ? formatDate(r.paidOn) : ""}
              {r.paymentMethod === "BANK" ? ` · challan ${r.bankChallanNo ?? ""}` : ""}
            </span>
          </span>
        ) : r.status === "WAIVED" ? (
          <StatusBadge status="neutral">Waived</StatusBadge>
        ) : (
          <StatusBadge status="unpaid">Not paid</StatusBadge>
        ),
    },
    { key: "by", header: "Received by", render: (r) => <span className="text-small">{r.receivedBy ?? ""}</span> },
    {
      key: "act",
      header: "",
      render: (r) =>
        r.status === "DUE" && canCollect && !readOnly && ctx.campus !== "ALL" ? (
          <Button
            size="sm"
            variant="primary"
            onClick={(e) => {
              e.stopPropagation();
              setPaying(r);
            }}
          >
            Receive
          </Button>
        ) : r.status === "PAID" ? (
          <Button
            size="sm"
            icon="printer"
            onClick={(e) => {
              e.stopPropagation();
              setSlip(r);
            }}
          >
            Slip
          </Button>
        ) : null,
    },
  ];

  return (
    <RequirePermission permission="fees.view" page="candidate fees">
      <Page>
        <PageHeader
          title="Candidate (test) fees"
          actions={
            <Button icon="printer" disabled={paidRows.length === 0} onClick={() => setPrinting(true)}>
              Print list
            </Button>
          }
        />
        <FeesNav />
        {q.isError && <LoadError what="Candidate fees" error={q.error} onRetry={() => void q.refetch()} />}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Received today" icon="fees" loading={q.isLoading} value={<AnimatedNumber value={d?.summary.paidToday.amount ?? 0} format={formatRs} />} foot={`${formatCount(d?.summary.paidToday.count ?? 0)} candidates · ${formatDate(TODAY)}`} onClick={() => { setFrom(TODAY); setTo(TODAY); }} />
          <StatCard label={`Received in ${formatSession(ctx.session)}`} icon="checkCircle" loading={q.isLoading} value={<AnimatedNumber value={d?.summary.paidSession.amount ?? 0} format={formatRs} />} foot={`${formatCount(d?.summary.paidSession.count ?? 0)} candidates`} onClick={() => setStatus("PAID")} />
          <StatCard label="Not paid yet" icon="clock" tone={(d?.summary.due.count ?? 0) > 0 ? "warning" : "neutral"} loading={q.isLoading} value={<AnimatedNumber value={d?.summary.due.count ?? 0} format={formatCount} />} foot={`${formatRs(d?.summary.due.amount ?? 0)} · no test slip until paid`} onClick={() => setStatus("DUE")} />
        </div>
        <DataTable
          caption={`Candidate fees, ${campusLabel(ctx.campus)}`}
          columns={columns}
          rows={rows}
          loading={q.isLoading}
          onRowClick={(r) => r.status === "PAID" && setSlip(r)}
          toolbar={
            <div className="flex w-full flex-wrap items-end gap-3">
              <div className="w-60">
                <Input aria-label="Search" placeholder="Name, application no. or father" icon="search" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="w-36">
                <Select aria-label="Class" value={cls} onChange={(e) => setCls(e.target.value)} options={[{ value: "", label: "Every class" }, ...classes.map((c) => ({ value: c, label: c }))]} />
              </div>
              <div className="w-36">
                <Select
                  aria-label="Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "" | FeeCandidate["status"])}
                  options={[
                    { value: "", label: "Every status" },
                    { value: "DUE", label: "Not paid" },
                    { value: "PAID", label: "Paid" },
                    { value: "WAIVED", label: "Waived" },
                  ]}
                />
              </div>
              <div className="w-40">
                <Select aria-label="Received by" value={cashier} onChange={(e) => setCashier(e.target.value)} options={[{ value: "", label: "Every cashier" }, ...(d?.cashiers ?? []).map((c) => ({ value: c, label: c }))]} />
              </div>
              <div className="w-40">
                <DatePicker aria-label="Paid from" placeholder="Paid from" value={from} onValueChange={setFrom} today={TODAY} maxDate={TODAY} />
              </div>
              <div className="w-40">
                <DatePicker aria-label="Paid to" placeholder="Paid to" value={to} onValueChange={setTo} today={TODAY} maxDate={TODAY} error={dateError} />
              </div>
              {filtered && (
                <Button
                  size="sm"
                  variant="quiet"
                  icon="x"
                  onClick={() => {
                    setStatus("");
                    setCls("");
                    setCashier("");
                    setQuery("");
                    setFrom(null);
                    setTo(null);
                  }}
                >
                  Clear filters
                </Button>
              )}
              {rows.length > 0 && (
                <span className="text-small text-ink-muted">
                  {formatCount(rows.length)} · received {formatRs(paidRows.reduce((a, r) => a + r.received, 0))}
                </span>
              )}
            </div>
          }
          footer={paidRows.length ? { name: `${formatCount(paidRows.length)} paid`, amount: formatRs(paidRows.reduce((a, r) => a + r.received, 0)), ...Object.fromEntries(heads.map((h) => [`h-${h.code}`, formatRs(paidRows.reduce((a, r) => a + (lineOf(r, h.code)?.paid ?? 0), 0))])) } : undefined}
          empty={<EmptyState icon="admissions" title={filtered ? "No candidates match" : "No candidate fees this session"} description={filtered ? "Clear the filters to see everyone." : "Applications for classes with an entrance test appear here with their test fee."} />}
        />
        {paying && d && <PayCandidatePanel c={paying} heads={d.heads} onClose={() => setPaying(null)} onPaid={(c) => { setPaying(null); setSlip(c); }} />}
        {slip && (
          <SidePanel
            open
            onClose={() => setSlip(null)}
            title={`Slip ${slip.receiptNo ?? ""}`}
            description={`${slip.name} · ${slip.classApplied}`}
            footer={
              <>
                <Button onClick={() => setSlip(null)}>Close</Button>
                <Button variant="primary" icon="printer" onClick={() => window.print()}>
                  Print slip
                </Button>
              </>
            }
          >
            <div className="grid gap-4">
              <Banner tone="success">Paid. Print the slip for the candidate; the test roll slip is printed in Admissions.</Banner>
              <div className="overflow-x-auto rounded-md bg-surface-sunken p-3">
                <CandidateSlip c={slip} />
              </div>
              <div className="fees-print-only mtb-receipt-print">
                <CandidateSlip c={slip} />
              </div>
            </div>
          </SidePanel>
        )}
        {printing && !slip && (
          <div className="fees-print-only mtb-print-area fees-print-a4">
            <PaperSize size="A4L" />
            <div className="fees-doc" data-theme="light" style={{ width: "277mm" }}>
              <div className="fees-doc-head">
                <div>
                  <h1>Candidate fee collection</h1>
                  <p>
                    {campusLabel(ctx.campus)} · Session {formatSession(ctx.session)}
                    {from || to ? ` · ${from ? formatDate(from) : "start"} to ${to ? formatDate(to) : formatDate(TODAY)}` : ""}
                    {cashier ? ` · ${cashier}` : ""}
                    {cls ? ` · ${cls}` : ""}
                  </p>
                </div>
                <p>Printed {formatDate(TODAY)}</p>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Received by</th>
                    <th>Receipt</th>
                    <th>Paid on</th>
                    <th>Application</th>
                    <th>Candidate</th>
                    <th>Class</th>
                    {heads.map((h) => (
                      <th key={h.code} className="n">
                        {h.code === "CANDIDATE" ? "Test fee" : h.title}
                      </th>
                    ))}
                    <th className="n">Total</th>
                    <th className="n">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {byCashier.map((g) => (
                    <FragmentRows key={g.name} name={g.name} rows={g.rows} heads={heads} />
                  ))}
                  <tr>
                    <td colSpan={6}>
                      <strong>Grand total · {formatCount(paidRows.length)} candidates</strong>
                    </td>
                    {heads.map((h) => (
                      <td key={h.code} className="n">
                        <strong>{formatRs(paidRows.reduce((a, r) => a + (lineOf(r, h.code)?.paid ?? 0), 0))}</strong>
                      </td>
                    ))}
                    <td className="n">
                      <strong>{formatRs(paidRows.reduce((a, r) => a + r.amount, 0))}</strong>
                    </td>
                    <td className="n">
                      <strong>{formatRs(paidRows.reduce((a, r) => a + r.received, 0))}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="fees-doc-sign">
                <div>Cashier</div>
                <div>Accountant</div>
                <div>Principal</div>
              </div>
            </div>
          </div>
        )}
      </Page>
    </RequirePermission>
  );
}

/** One cashier's candidates in the printed list, with a subtotal. */
function FragmentRows({ name, rows, heads }: { name: string; rows: FeeCandidate[]; heads: FeeCandidatesData["heads"] }) {
  const paid = (r: FeeCandidate, code: string) => r.lines.find((l) => l.head === code)?.paid ?? 0;
  return (
    <>
      {rows.map((r, i) => (
        <tr key={r.id}>
          <td>{i === 0 ? name || "—" : ""}</td>
          <td>{r.receiptNo}</td>
          <td>{r.paidOn ? formatDate(r.paidOn) : ""}</td>
          <td>{r.applicationNo}</td>
          <td>{r.name}</td>
          <td>{r.classApplied}</td>
          {heads.map((h) => (
            <td key={h.code} className="n">
              {paid(r, h.code) ? formatRs(paid(r, h.code)) : ""}
            </td>
          ))}
          <td className="n">{formatRs(r.amount)}</td>
          <td className="n">{formatRs(r.received)}</td>
        </tr>
      ))}
      <tr>
        <td colSpan={6}>
          <strong>
            {name || "—"} · {formatCount(rows.length)} candidates
          </strong>
        </td>
        {heads.map((h) => (
          <td key={h.code} className="n">
            <strong>{formatRs(rows.reduce((a, r) => a + paid(r, h.code), 0))}</strong>
          </td>
        ))}
        <td className="n">
          <strong>{formatRs(rows.reduce((a, r) => a + r.amount, 0))}</strong>
        </td>
        <td className="n">
          <strong>{formatRs(rows.reduce((a, r) => a + r.received, 0))}</strong>
        </td>
      </tr>
    </>
  );
}
