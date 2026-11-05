import { ACCOUNTS_VOUCHER_TYPE_LABEL, accountsQueries, can, type CampusCode } from "@mtb/api";
import { formatDate, formatDateTime, type IsoDate } from "@mtb/domain";
import { Button, DataTable, Icon, KeyValue, Money, SidePanel, Skeleton } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useSessionUser } from "../../app/session";
import { errorText, TypeChip, useOpenVoucher, VoucherStatus } from "./shared";

/**
 * A fee batch is one campus's collection for a day; this opens Fees › Daily collection on that day, where each
 * receipt (student, father, G.R. No.) is listed. Shown to roles that can see fee reports.
 */
export function DayReceiptsLink({ campus, date }: { campus: CampusCode; date: IsoDate }) {
  const user = useSessionUser();
  if (!can(user, "fees.reports", campus)) return null;
  return (
    <Link to="/fees/reports/collection" search={{ from: date, to: date, campus }} className="inline-flex items-center gap-1 text-small font-medium text-brand-ink underline-offset-2 hover:underline">
      See the day's receipts
      <Icon name="arrowRight" size={14} />
    </Link>
  );
}

/** Drill-down from a ledger, batch or bank line: the voucher in a side panel, with a link to open it in full. */
export function VoucherPeek({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ ...accountsQueries.voucher(id ?? ""), enabled: Boolean(id) });
  const open = useOpenVoucher();
  const v = q.data;
  return (
    <SidePanel
      open={Boolean(id)}
      onClose={onClose}
      wide
      title={v ? `${ACCOUNTS_VOUCHER_TYPE_LABEL[v.type]} ${v.voucherNo ?? ""}` : "Voucher"}
      {...(v ? { description: v.narration } : {})}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" iconRight="arrowRight" disabled={!v} onClick={() => v && open(v.id)}>
            Open voucher
          </Button>
        </>
      }
    >
      {q.isLoading ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton height={20} width="60%" />
          <Skeleton height={120} />
        </div>
      ) : !v ? (
        <p className="m-0 text-ink-muted">{q.error ? errorText(q.error) : "Voucher not found."}</p>
      ) : (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <TypeChip type={v.type} />
            <VoucherStatus status={v.status} totalDebit={v.totalDebit} totalCredit={v.totalCredit} rejected={Boolean(v.rejection)} type={v.type} />
          </div>
          <KeyValue
            items={[
              ["Date", formatDate(v.date)],
              ["Campus", v.campusName],
              ...(v.party ? [[v.type === "CR" || v.type === "BR" ? "Received from" : "Paid to", v.party] as [string, string]] : []),
              ...(v.cheque ? [["Cheque / reference", `${v.cheque.number} · ${formatDate(v.cheque.date)}`] as [string, string]] : []),
              ...(v.postedBy ? [["Posted", `${v.postedBy}, ${formatDateTime(v.postedAt ?? v.updatedAt)}`] as [string, string]] : []),
              ...(v.reversal ? [["Reversed by", `${v.reversal.voucherNo}: ${v.reversal.reason}`] as [string, string]] : []),
            ]}
          />
          {v.source?.kind === "FEE_BATCH" && (
            <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-muted">
              <span>
                {v.source.receipts.toLocaleString("en-PK")} fee receipts on {formatDate(v.source.date)}, posted as one line.
              </span>
              <DayReceiptsLink campus={v.campus} date={v.source.date} />
            </p>
          )}
          <DataTable
            caption="Voucher lines"
            density="dense"
            stickyHeader={false}
            rows={v.lines}
            rowKey="id"
            columns={[
              {
                key: "account",
                header: "Account",
                render: (l) => (
                  <span className="grid">
                    <span>
                      <span className="mtb-mono text-ink-muted">{l.accountCode}</span> {l.accountName}
                    </span>
                    {l.description && <span className="mtb-cell-secondary">{l.description}</span>}
                  </span>
                ),
              },
              { key: "debit", header: "Debit", align: "right", width: 130, render: (l) => (l.debit ? <Money value={l.debit} /> : null) },
              { key: "credit", header: "Credit", align: "right", width: 130, render: (l) => (l.credit ? <Money value={l.credit} /> : null) },
            ]}
            footer={{ account: "Totals", debit: <Money value={v.totalDebit} />, credit: <Money value={v.totalCredit} /> }}
          />
        </div>
      )}
    </SidePanel>
  );
}
