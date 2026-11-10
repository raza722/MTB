import { ACCOUNTS_VOUCHER_TYPE_LABEL, accountsQueries, CURRENT_SESSION, type AccountsManualType, type AccountsStatusFilter, type AccountsTypeFilter, type AccountsVoucherRow } from "@mtb/api";
import { formatCount, formatDate, formatRs, formatSession } from "@mtb/domain";
import { Banner, Button, Combobox, DataTable, DatePicker, EmptyState, Input, Menu, MenuItem, MenuLabel, Money, Pagination, Segmented, Select, Tooltip, type Column } from "@mtb/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { accountOptions, AccountsShell, accToday, LoadError, sessionStartOf, TypeChip, useChart, useGo, useOpenVoucher, VoucherStatus } from "./shared";

export interface VouchersSearch {
  type?: AccountsTypeFilter;
  status?: AccountsStatusFilter;
  from?: string;
  to?: string;
  q?: string;
  account?: string;
  page?: number;
}

const TYPE_OPTIONS: Array<{ value: AccountsTypeFilter; label: string }> = [
  { value: "MANUAL", label: "Entered by staff" },
  { value: "ALL", label: "Every voucher" },
  { value: "SYSTEM", label: "Posted by the system" },
  { value: "JV", label: "Journal vouchers" },
  { value: "CP", label: "Cash payments" },
  { value: "CR", label: "Cash receipts" },
  { value: "BP", label: "Bank payments" },
  { value: "BR", label: "Bank receipts" },
  { value: "FEE", label: "Fee collections" },
  { value: "FEE_CANCEL", label: "Receipt cancellations" },
  { value: "OPENING", label: "Opening balances" },
];

const NEW_TYPES: Array<[AccountsManualType, string, string]> = [
  ["JV", "Journal voucher", "Adjustments, accruals, transfers. Posted by the accountant."],
  ["CP", "Cash payment", "Paid in cash or from petty cash."],
  ["BP", "Bank payment", "Paid by cheque or bank transfer."],
  ["CR", "Cash receipt", "Cash received, other than fees."],
  ["BR", "Bank receipt", "Money received in the bank, other than fees."],
];

/** The "New voucher" menu (journal, cash and bank vouchers). */
export function NewVoucherMenu() {
  const go = useGo();
  const canPost = useCan("accounts.post");
  const readOnly = useReadOnly();
  const { session } = useCtx();
  if (!canPost) return null;
  const trigger = (
    <Button variant="primary" icon="plus" iconRight="chevronDown" disabled={readOnly}>
      New voucher
    </Button>
  );
  if (readOnly)
    return (
      <Tooltip content={`${formatSession(session)} is read-only. Switch to ${formatSession(CURRENT_SESSION)} to enter vouchers.`}>
        <span tabIndex={0} className="rounded-md">
          {trigger}
        </span>
      </Tooltip>
    );
  return (
    <Menu trigger={trigger} align="end" label="New voucher">
      <MenuLabel>Choose the kind of voucher</MenuLabel>
      {NEW_TYPES.map(([t, label, hint]) => (
        <MenuItem key={t} icon={t === "JV" ? "file" : t.startsWith("B") ? "building" : "fees"} onSelect={() => go("/accounts/vouchers/$voucherId", { type: t }, { voucherId: "new" })}>
          <span className="grid">
            <span>{label}</span>
            <span className="text-small text-ink-muted">{hint}</span>
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}

/** Journal vouchers saved as drafts that don't balance yet. */
export function OutOfBalanceBanners() {
  const ctx = useCtx();
  const open = useOpenVoucher();
  const q = useQuery(accountsQueries.vouchers(ctx, { type: "JV", status: "DRAFT", pageSize: 50 }));
  const list = (q.data?.items ?? []).filter((v) => v.totalDebit !== v.totalCredit);
  return (
    <>
      {list.map((v) => (
        <Banner
          key={v.id}
          tone="warning"
          title={`Draft "${v.narration}" is out of balance by ${formatRs(Math.abs(v.totalDebit - v.totalCredit))}.`}
          actions={
            <Button size="sm" variant="secondary" onClick={() => open(v.id)}>
              Open draft
            </Button>
          }
        >
          It can be saved but not posted until debits equal credits.
        </Banner>
      ))}
    </>
  );
}

const STATUS_TABS: Array<[AccountsStatusFilter, string]> = [
  ["ALL", "All"],
  ["DRAFT", "Drafts"],
  ["SUBMITTED", "Waiting for approval"],
  ["APPROVED", "Approved"],
  ["POSTED", "Posted"],
  ["REVERSED", "Reversed"],
];

/** /accounts/vouchers — every voucher of the session, with filters in one row. */
export function VouchersPage({ search, setSearch }: { search: VouchersSearch; setSearch: (next: VouchersSearch) => void }) {
  const ctx = useCtx();
  const open = useOpenVoucher();
  const { accounts } = useChart();
  const filters = {
    type: search.type ?? "MANUAL",
    status: search.status ?? "ALL",
    ...(search.from ? { from: search.from } : {}),
    ...(search.to ? { to: search.to } : {}),
    ...(search.q ? { q: search.q } : {}),
    ...(search.account ? { account: search.account } : {}),
    page: search.page ?? 1,
    pageSize: 25,
  };
  const q = useQuery({ ...accountsQueries.vouchers(ctx, filters), placeholderData: keepPreviousData });
  const [text, setText] = useState(search.q ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((search.q ?? "") !== text.trim()) setSearch({ ...search, q: text.trim() || undefined, page: undefined });
    }, 350);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<VouchersSearch>) => setSearch({ ...search, ...patch, page: undefined });
  const filtered = Boolean(search.from || search.to || search.q || search.account || (search.type && search.type !== "MANUAL"));
  const counts = q.data?.counts;

  const columns: Array<Column<AccountsVoucherRow>> = [
    {
      key: "no",
      header: "Number",
      width: 200,
      render: (v) => (v.voucherNo ? <span className="mtb-mono text-ink">{v.voucherNo}</span> : <span className="text-ink-muted">Not posted yet</span>),
    },
    { key: "type", header: "Type", width: 64, render: (v) => <TypeChip type={v.type} /> },
    { key: "date", header: "Date", width: 120, render: (v) => <span className="mtb-num">{formatDate(v.date)}</span> },
    ...(ctx.campus === "ALL" ? [{ key: "campus", header: "Campus", width: 150, render: (v: AccountsVoucherRow) => v.campusName }] : []),
    {
      key: "narration",
      header: "Narration",
      render: (v) => (
        <span className="grid min-w-0">
          <span className="mtb-cell-primary truncate">{v.narration || "No narration yet"}</span>
          <span className="mtb-cell-secondary truncate">
            {v.party ? `${v.party} · ` : ""}
            {v.status === "POSTED" || v.status === "REVERSED" ? `posted by ${v.postedBy}` : `prepared by ${v.createdBy}`}
          </span>
        </span>
      ),
    },
    { key: "amount", header: "Amount", align: "right", width: 140, render: (v) => <Money value={v.amount} /> },
    { key: "status", header: "Status", width: 250, render: (v) => <VoucherStatus status={v.status} totalDebit={v.totalDebit} totalCredit={v.totalCredit} rejected={v.rejected} type={v.type} /> },
  ];

  return (
    <AccountsShell title="Vouchers" actions={<NewVoucherMenu />}>
      <OutOfBalanceBanners />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          aria-label="Show vouchers by status"
          value={filters.status}
          onChange={(v) => set({ status: v as AccountsStatusFilter })}
          options={STATUS_TABS.map(([value, label]) => ({ value, label: counts ? `${label} · ${formatCount(counts[value])}` : label }))}
        />
        <span className="text-small text-ink-muted">Cash and bank vouchers are approved by an admin before they are posted.</span>
      </div>
      {q.error && !q.data ? (
        <LoadError what="Vouchers" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable
          caption={`Vouchers, ${campusLabel(ctx.campus)}`}
          columns={columns}
          rows={q.data?.items ?? []}
          rowKey="id"
          loading={q.isLoading}
          onRowClick={(v) => open(v.id)}
          rowClassName={() => "mtb-slide-in"}
          toolbar={
            <div className="grid w-full gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_150px_150px_minmax(0,1.2fr)_auto] md:items-end">
              <Input aria-label="Search vouchers" icon="search" placeholder="Number, narration, party, cheque or amount" value={text} onChange={(e) => setText(e.target.value)} />
              <Select aria-label="Kind of voucher" value={filters.type} onChange={(e) => set({ type: e.target.value as AccountsTypeFilter })} options={TYPE_OPTIONS} />
              <DatePicker aria-label="From" placeholder="From" value={search.from ?? null} onValueChange={(v) => set({ from: v ?? undefined })} today={accToday()} minDate={sessionStartOf(ctx.session)} />
              <DatePicker aria-label="To" placeholder="To" value={search.to ?? null} onValueChange={(v) => set({ to: v ?? undefined })} today={accToday()} minDate={sessionStartOf(ctx.session)} />
              <Combobox options={accountOptions(accounts)} value={search.account ?? null} onValueChange={(v) => set({ account: v })} placeholder="Any account" searchPlaceholder="Type a code or name" />
              <Button variant="ghost" icon="x" disabled={!filtered} onClick={() => { setText(""); setSearch({ status: search.status }); }}>
                Clear
              </Button>
            </div>
          }
          empty={
            <EmptyState
              icon="accounts"
              title={filtered || filters.status !== "ALL" ? "No vouchers match" : "No vouchers in this session yet"}
              description={filtered || filters.status !== "ALL" ? "Change the filters, or clear them to see every voucher." : `Vouchers entered for ${campusLabel(ctx.campus)} will appear here, those needing action first.`}
            />
          }
          pagination={q.data && q.data.total > 0 ? <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={(p) => setSearch({ ...search, page: p })} /> : undefined}
        />
      )}
      <p className="m-0 text-small text-ink-muted">
        {ACCOUNTS_VOUCHER_TYPE_LABEL.FEE} and {ACCOUNTS_VOUCHER_TYPE_LABEL.FEE_CANCEL.toLowerCase()} vouchers are posted from the fee office, salary journals from payroll, and vouchers from the old system came over with it; choose "Posted by the system" to see them.
      </p>
    </AccountsShell>
  );
}
