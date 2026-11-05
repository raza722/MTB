import { feesQueries, type CampusCode, type LedgerDocType, type LedgerEntry } from "@mtb/api";
import { formatDate, formatRs, formatSession } from "@mtb/domain";
import { Button, cx, EmptyState, Icon, IconButton, Money, Select, Skeleton, StatusBadge, Tooltip } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";
import { useCtx, useReadOnly } from "../../../app/session";
import { PaperSize, TODAY, useCanAny } from "../shared";
import { AddChargePanel, CancelChargeModal } from "./ChargePanels";

const DOC_LABEL: Record<LedgerDocType, string> = { CHARGE: "Charge", LATE_FINE: "Late fine", RECEIPT: "Receipt", CANCELLATION: "Cancellation" };

/** The student the ledger belongs to, for the printed statement and for adding charges. */
export interface LedgerStudent {
  grNo: string;
  name: string;
  relation: "s/o" | "d/o";
  father: string;
  classSection: string;
  campus: CampusCode;
  campusName: string;
  status: string;
}

function DocCell({ e }: { e: LedgerEntry }) {
  return (
    <span className="grid">
      <span className="font-medium">{DOC_LABEL[e.docType]}</span>
      {e.docNo &&
        (e.receiptNo && e.docType !== "LATE_FINE" ? (
          <Link to="/fees/receipts/$receiptNo" params={{ receiptNo: e.receiptNo }} className="mtb-mono text-small text-brand-ink underline-offset-2 hover:underline">
            {e.docNo}
          </Link>
        ) : (
          <span className="mtb-mono text-small text-ink-muted">{e.docNo}</span>
        ))}
    </span>
  );
}

/** Calculated figures are read-only, with a lock and an explanation. Nothing here can be typed. */
function Calculated({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <div className="grid gap-0.5">
      <span className="mtb-label">{label}</span>
      <span className="flex items-center gap-2">
        <span className={cx("text-title-2 tabular-nums", tone === "danger" && value > 0 && "text-status-overdue-ink")}>{formatRs(value)}</span>
        <Tooltip content="Calculated from the ledger. It can't be edited; it changes only when charges, fines, receipts or cancellations are posted.">
          <span className="mtb-no-print inline-flex items-center gap-1 rounded-sm bg-surface-sunken px-1.5 py-0.5 text-small text-ink-muted" tabIndex={0}>
            <Icon name="lock" size={14} /> Calculated from the ledger
          </span>
        </Tooltip>
      </span>
    </div>
  );
}

/** Paid / part paid / payable (overdue when past its due date). */
function ChargeStatus({ e }: { e: LedgerEntry }) {
  if (e.cancelled) return <StatusBadge status="cancelled" />;
  if (e.settled === "PAID") return <StatusBadge status="paid" />;
  if (e.settled === "PART_PAID") return <StatusBadge status="warning">Part paid</StatusBadge>;
  return (e.dueDate ?? e.date) < TODAY ? <StatusBadge status="overdue">Payable · overdue</StatusBadge> : <StatusBadge status="unpaid">Payable</StatusBadge>;
}

const cancellable = (e: LedgerEntry) => e.docType === "CHARGE" && !e.cancelled && !e.cancelPending && e.settled === "PAYABLE" && (e.coveredBy?.length ?? 0) === 0;

/**
 * Running ledger: charges, late fines, receipts and cancellations with a calculated balance.
 * Expand a receipt to see the charges it paid; select a charge to highlight the receipts that covered it.
 * Document = Charges shows the fee card: each charge with its status and the date it was paid.
 */
export function LedgerTable({ grNo, defaultSession, student }: { grNo: string; defaultSession: number; student?: LedgerStudent }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canCharge = useCanAny(["fees.setup", "fees.collect"]);
  const canCancel = useCanAny(["fees.setup", "fees.collect", "fees.cancel.request"]);
  const [session, setSession] = useState<string>(String(defaultSession));
  const [docType, setDocType] = useState<LedgerDocType | "">("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<{ chargeId?: string; receiptNo?: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<LedgerEntry | null>(null);
  const [printing, setPrinting] = useState(false);
  const ledger = useQuery(feesQueries.ledger(grNo, session === "ALL" ? "ALL" : Number(session)));

  // A4 for the statement, only while it prints (the app's default paper is the A5 receipt).
  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 60);
    return () => clearTimeout(t);
  }, [printing]);

  const enrolled = student ? !["LEFT", "EXPELLED", "PASSED_OUT"].includes(student.status) : false;
  const current = session === String(ctx.session) && !readOnly;
  const showAdd = Boolean(student) && canCharge && current && enrolled && student!.campus === ctx.campus;
  const showCancel = canCancel && current;

  const linked = (e: LedgerEntry): boolean => {
    if (!focus) return false;
    if (focus.chargeId) return e.chargeId === focus.chargeId || (e.docType === "RECEIPT" && Boolean(e.allocations?.some((a) => a.chargeId === focus.chargeId)));
    if (focus.receiptNo) return e.receiptNo === focus.receiptNo || e.docNo === focus.receiptNo || Boolean(e.coveredBy?.some((c) => c.receiptNo === focus.receiptNo));
    return false;
  };
  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const rows = (ledger.data?.entries ?? []).filter((e) => !docType || e.docType === docType);
  const charges = rows.filter((e) => e.docType === "CHARGE");
  const live = charges.filter((e) => !e.cancelled);
  const total = live.reduce((a, e) => a + e.charge, 0);
  const due = live.reduce((a, e) => a + (e.due ?? 0), 0);
  const sessionText = session === "ALL" ? "All sessions" : `Session ${formatSession(Number(session))}`;
  const cardView = docType === "CHARGE";

  return (
    <div className="mtb-print-area grid gap-4">
      {printing && <PaperSize size="A4" />}
      {student && (
        <div className="fees-print-only">
          <div className="fees-doc-head" style={{ display: "flex" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: "13pt" }}>MTB {student.campusName}</h1>
              <p style={{ margin: 0 }}>{cardView ? "Student fee card" : "Student fee statement"} · {sessionText}</p>
            </div>
            <p style={{ margin: 0 }}>Printed {formatDate(TODAY)}</p>
          </div>
          <dl className="m-0 mb-3 grid grid-cols-[auto_1fr_auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-ink-muted">Name</dt>
            <dd className="m-0 font-medium">{student.name}</dd>
            <dt className="text-ink-muted">G.R. no.</dt>
            <dd className="m-0 mtb-mono">{student.grNo}</dd>
            <dt className="text-ink-muted">{student.relation === "d/o" ? "Daughter of" : "Son of"}</dt>
            <dd className="m-0">{student.father}</dd>
            <dt className="text-ink-muted">Class</dt>
            <dd className="m-0">{student.classSection}</dd>
          </dl>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        {ledger.data ? (
          <div className="flex flex-wrap gap-8">
            <Calculated label="Balance" value={ledger.data.balance} />
            <Calculated label="Arrears (overdue)" value={ledger.data.arrears} tone="danger" />
          </div>
        ) : (
          <Skeleton width={360} height={44} />
        )}
        <div className="mtb-no-print flex flex-wrap items-end gap-3">
          <Select
            label="Session"
            value={session}
            onChange={(e) => setSession(e.target.value)}
            options={[
              { value: String(defaultSession), label: formatSession(defaultSession) },
              { value: String(defaultSession - 1), label: formatSession(defaultSession - 1) },
              { value: "ALL", label: "All sessions" },
            ]}
          />
          <Select
            label="Document"
            value={docType}
            onChange={(e) => setDocType(e.target.value as LedgerDocType | "")}
            options={[
              { value: "", label: "All documents" },
              { value: "CHARGE", label: "Charges (fee card)" },
              { value: "LATE_FINE", label: "Late fines" },
              { value: "RECEIPT", label: "Receipts" },
              { value: "CANCELLATION", label: "Cancellations" },
            ]}
          />
          <Button icon="printer" onClick={() => setPrinting(true)} disabled={!ledger.data}>
            {cardView ? "Print fee card" : "Print statement"}
          </Button>
          {showAdd && (
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
              Add a charge
            </Button>
          )}
        </div>
      </div>

      <p className="mtb-no-print m-0 text-small text-ink-muted">
        {cardView ? "Each charge with whether it is paid and when. Unpaid charges can be cancelled with the principal's approval." : "Select a charge to highlight the receipts that paid it; expand a receipt to see the charges it paid."}
      </p>

      {cardView ? (
        <div className="mtb-table-wrap">
          <div className="mtb-table-scroll">
            <table className="mtb-table mtb-table-dense" aria-busy={ledger.isLoading || undefined}>
              <caption className="mtb-sr-only">Fee card: charges with status</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 44 }}>
                    No.
                  </th>
                  <th scope="col" style={{ width: 120 }}>
                    Due date
                  </th>
                  <th scope="col">Fee head</th>
                  <th scope="col" className="mtb-th-num" style={{ width: 110 }}>
                    Amount
                  </th>
                  <th scope="col" style={{ width: 150 }}>
                    Status
                  </th>
                  <th scope="col" style={{ width: 120 }}>
                    Date paid
                  </th>
                  <th scope="col" className="mtb-th-num" style={{ width: 110 }}>
                    Paid
                  </th>
                  <th scope="col" className="mtb-th-num" style={{ width: 110 }}>
                    Payable
                  </th>
                  {showCancel && <th scope="col" className="mtb-no-print" style={{ width: 48 }} />}
                </tr>
              </thead>
              <tbody>
                {ledger.isLoading &&
                  Array.from({ length: 5 }, (_, i) => (
                    <tr key={i} aria-hidden="true">
                      {Array.from({ length: 8 }, (__, j) => (
                        <td key={j}>
                          <Skeleton width="70%" />
                        </td>
                      ))}
                    </tr>
                  ))}
                {!ledger.isLoading && charges.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: 0 }}>
                      <EmptyState icon="receipt" title="No charges" description="Nothing has been charged in this session yet." />
                    </td>
                  </tr>
                )}
                {charges.map((e, i) => (
                  <tr key={e.id} className={cx(e.cancelled && "is-muted")}>
                    <td className="tabular-nums">{i + 1}</td>
                    <td className="tabular-nums">{formatDate(e.dueDate ?? e.date)}</td>
                    <td>
                      <span className={cx(e.cancelled && "mtb-strike")}>{e.description.replace(/ · due$/, "")}</span>
                      {e.cancelPending && (
                        <StatusBadge status="pending" className="ml-2">
                          Cancellation waiting for approval
                        </StatusBadge>
                      )}
                    </td>
                    <td className="mtb-td-num">
                      <Money value={e.charge} strike={Boolean(e.cancelled)} />
                    </td>
                    <td>
                      <ChargeStatus e={e} />
                    </td>
                    <td className="tabular-nums">{e.paidOn ? formatDate(e.paidOn) : ""}</td>
                    <td className="mtb-td-num">{!e.cancelled && e.charge - (e.due ?? 0) > 0 ? <Money value={e.charge - (e.due ?? 0)} /> : ""}</td>
                    <td className="mtb-td-num">{!e.cancelled && (e.due ?? 0) > 0 ? <Money value={e.due ?? 0} /> : ""}</td>
                    {showCancel && (
                      <td className="mtb-no-print">
                        {cancellable(e) && <IconButton icon="ban" size="sm" label={`Cancel ${e.description.replace(/ · .*$/, "")}`} onClick={() => setCancelling(e)} />}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              {live.length > 0 && (
                <tfoot>
                  <tr>
                    <td />
                    <td />
                    <td className="font-semibold">Total of charges</td>
                    <td className="mtb-td-num font-semibold">
                      <Money value={total} />
                    </td>
                    <td />
                    <td />
                    <td className="mtb-td-num font-semibold">
                      <Money value={total - due} />
                    </td>
                    <td className="mtb-td-num font-semibold">
                      <Money value={due} />
                    </td>
                    {showCancel && <td className="mtb-no-print" />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      ) : (
        <div className="mtb-table-wrap">
          <div className="mtb-table-scroll">
            <table className="mtb-table mtb-table-dense" aria-busy={ledger.isLoading || undefined}>
              <caption className="mtb-sr-only">Fee ledger</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 36 }} />
                  <th scope="col" style={{ width: 120 }}>
                    Date
                  </th>
                  <th scope="col" style={{ width: 170 }}>
                    Document
                  </th>
                  <th scope="col">Description</th>
                  <th scope="col" className="mtb-th-num" style={{ width: 120 }}>
                    Charge
                  </th>
                  <th scope="col" className="mtb-th-num" style={{ width: 120 }}>
                    Payment
                  </th>
                  <th scope="col" className="mtb-th-num" style={{ width: 130 }}>
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {ledger.isLoading &&
                  Array.from({ length: 6 }, (_, i) => (
                    <tr key={i} aria-hidden="true">
                      {Array.from({ length: 7 }, (__, j) => (
                        <td key={j}>
                          <Skeleton width={j >= 4 ? 70 : "70%"} style={j >= 4 ? { marginLeft: "auto" } : undefined} />
                        </td>
                      ))}
                    </tr>
                  ))}
                {!ledger.isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: 0 }}>
                      <EmptyState icon="receipt" title="Nothing in this view" description="No ledger entries for this session and document type." />
                    </td>
                  </tr>
                )}
                {rows.map((e) => {
                  const isReceipt = e.docType === "RECEIPT";
                  const open = expanded.has(e.id);
                  const selectable = e.docType === "CHARGE" || isReceipt;
                  const isFocus = focus && ((focus.chargeId && e.id === `c:${focus.chargeId}`) || (focus.receiptNo && e.id === `r:${focus.receiptNo}`));
                  return (
                    <Fragment key={e.id}>
                      <tr
                        className={cx(selectable && "is-clickable", linked(e) && "is-selected", e.cancelled && "is-muted")}
                        onClick={(ev) => {
                          if ((ev.target as HTMLElement).closest("a, button")) return;
                          if (!selectable) return;
                          const next = e.docType === "CHARGE" ? { chargeId: e.chargeId ?? "" } : { receiptNo: e.receiptNo ?? "" };
                          setFocus(isFocus ? null : next);
                        }}
                        tabIndex={selectable ? 0 : undefined}
                        onKeyDown={(ev) => {
                          if (selectable && (ev.key === "Enter" || ev.key === " ")) {
                            ev.preventDefault();
                            setFocus(isFocus ? null : e.docType === "CHARGE" ? { chargeId: e.chargeId ?? "" } : { receiptNo: e.receiptNo ?? "" });
                          }
                        }}
                        aria-selected={selectable ? Boolean(isFocus) : undefined}
                      >
                        <td>
                          {isReceipt && (
                            <IconButton icon={open ? "chevronDown" : "chevronRight"} label={open ? `Hide charges paid by ${e.docNo}` : `Show charges paid by ${e.docNo}`} size="sm" aria-expanded={open} onClick={() => toggle(e.id)} />
                          )}
                          {showCancel && cancellable(e) && (
                            <span className="mtb-no-print">
                              <IconButton icon="ban" size="sm" label={`Cancel ${e.description.replace(/ · .*$/, "")}`} onClick={() => setCancelling(e)} />
                            </span>
                          )}
                        </td>
                        <td className="tabular-nums">{formatDate(e.date)}</td>
                        <td>
                          <DocCell e={e} />
                        </td>
                        <td>
                          <span className={cx(e.cancelled && "mtb-strike")}>{e.description}</span>
                          {e.cancelled && (
                            <StatusBadge status="cancelled" className="ml-2">
                              Cancelled
                            </StatusBadge>
                          )}
                          {e.cancelPending && (
                            <StatusBadge status="pending" className="ml-2">
                              Cancellation waiting for approval
                            </StatusBadge>
                          )}
                        </td>
                        <td className="mtb-td-num">{e.charge ? <Money value={e.charge} strike={Boolean(e.cancelled)} /> : ""}</td>
                        <td className="mtb-td-num">{e.payment ? <Money value={e.payment} strike={Boolean(e.cancelled)} /> : ""}</td>
                        <td className="mtb-td-num font-medium">
                          <Money value={e.balance} />
                        </td>
                      </tr>
                      {isReceipt &&
                        open &&
                        (e.allocations ?? []).map((a) => (
                          <tr key={`${e.id}-${a.chargeId}`} className="is-muted">
                            <td />
                            <td />
                            <td className="text-small">Paid towards</td>
                            <td className="text-small">{a.head}</td>
                            <td />
                            <td className="mtb-td-num text-small">
                              <Money value={a.amount} />
                            </td>
                            <td />
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {student && (
        <div className="fees-print-only">
          <p className="m-0 text-small">
            <strong>Note:</strong> Fines and other charges can be added during the session when a rule is broken. Fee once paid is not refundable.
          </p>
          <div className="fees-doc-sign">
            <div>Accountant</div>
            <div>Parent / guardian</div>
            <div>Date</div>
          </div>
        </div>
      )}

      {adding && student && <AddChargePanel student={student} onClose={() => setAdding(false)} />}
      {cancelling && cancelling.chargeId && (
        <CancelChargeModal
          charge={{ chargeId: cancelling.chargeId, head: cancelling.description.replace(/ · .*$/, ""), amount: cancelling.charge, dueDate: cancelling.dueDate ?? cancelling.date, studentName: student?.name ?? grNo }}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  );
}
