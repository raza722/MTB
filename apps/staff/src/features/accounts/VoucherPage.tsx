import {
  ACCOUNTS_MANUAL_TYPES,
  ACCOUNTS_VOUCHER_TYPE_LABEL,
  accountsApi,
  accountsCashBankKind,
  accountsQueries,
  accountsVoucherSide,
  ApiError,
  can,
  newIdempotencyKey,
  type AccountsManualType,
  type AccountsVoucher,
  type CampusCode,
} from "@mtb/api";
import { amountInWords, formatDate, formatDateTime, formatRs, formatTime } from "@mtb/domain";
import {
  AmountInput,
  Banner,
  Button,
  Combobox,
  ConfirmDialog,
  DataTable,
  DatePicker,
  EmptyState,
  Icon,
  IconButton,
  Input,
  KeyValue,
  Modal,
  Money,
  Panel,
  Select,
  Skeleton,
  Textarea,
  Timeline,
  Tooltip,
  useToast,
  type Column,
  type TimelineItem,
} from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useCan, useCtx, useReadOnly, useSessionUser } from "../../app/session";
import { CAMPUS_LABEL, campusLabel } from "../../app/shell/campus";
import { AccLink, AccountsShell, accountOptions, DocFoot, DocHead, errorField, errorText, LoadError, sessionStartOf, TODAY, TypeChip, useGo, VoucherStatus } from "./shared";
import { amountOf, draftFrom, emptyDraft, isUsed, newLine, toInput, totalsOf, validateFinal, type Draft, type DraftLine, type HeaderField, type LineErrors, type Prefill } from "./voucher-model";

const CAMPUS_CODES: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];

/** Visually hides a field's label inside table cells; screen readers still hear it. */
const cellField = "[&_.mtb-label]:sr-only";

const TITLE: Record<AccountsManualType, string> = { JV: "Journal voucher", CP: "Cash payment voucher", CR: "Cash receipt voucher", BP: "Bank payment voucher", BR: "Bank receipt voucher" };

export interface VoucherPageProps {
  voucherId: string;
  /** For a new voucher. */
  type: AccountsManualType;
  prefill: Prefill;
}

/** /accounts/vouchers/$voucherId — one voucher: entered, approved, posted, printed or reversed. "new" starts one. */
export function VoucherPage({ voucherId, type, prefill }: VoucherPageProps) {
  const ctx = useCtx();
  const go = useGo();
  const isNew = voucherId === "new";
  const q = useQuery(accountsQueries.voucher(voucherId));
  const back = () => go("/accounts/vouchers");

  if (isNew) {
    return <VoucherForm key={`new-${type}`} initial={emptyDraft(type, ctx.campus === "ALL" ? null : ctx.campus, prefill)} voucher={null} />;
  }
  if (q.isLoading) {
    return (
      <AccountsShell title="Voucher">
        <div className="mtb-card grid gap-4 p-5" aria-busy="true" aria-label="Loading voucher">
          <Skeleton width="40%" height={22} />
          <Skeleton height={40} />
          <Skeleton height={160} />
        </div>
      </AccountsShell>
    );
  }
  if (!q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <AccountsShell title="Voucher">
        {notFound ? (
          <div className="mtb-card">
            <EmptyState icon="file" title="Voucher not found" description="It may have been discarded, or the link is mistyped." action={<Button onClick={back}>Back to vouchers</Button>} />
          </div>
        ) : (
          <LoadError what="This voucher" error={q.error} onRetry={() => void q.refetch()} />
        )}
      </AccountsShell>
    );
  }
  return <VoucherForm key={`${q.data.id}:${q.data.updatedAt}:${q.data.status}`} initial={draftFrom(q.data)} voucher={q.data} />;
}

/** Live difference on a journal voucher: red when out of balance, green when balanced. Announced politely. */
function BalanceStatus({ debit, credit }: { debit: number; credit: number }) {
  const diff = debit - credit;
  let body;
  if (debit === 0 && credit === 0) body = <span className="text-ink-muted">Enter debits and credits</span>;
  else if (diff === 0)
    body = (
      <span className="inline-flex items-center gap-1.5 font-semibold text-success-ink">
        <Icon name="checkCircle" size={18} /> Balanced
      </span>
    );
  else
    body = (
      <span className="grid">
        <span className="inline-flex items-center gap-1.5 font-semibold text-danger-ink">
          <Icon name="alertCircle" size={18} /> Out of balance by <span className="mtb-num">{formatRs(Math.abs(diff))}</span>
        </span>
        <span className="text-small text-ink-muted">{diff > 0 ? "Debits are more than credits." : "Credits are more than debits."}</span>
      </span>
    );
  return (
    <div aria-live="polite" className="min-w-0">
      {body}
    </div>
  );
}

function VoucherForm({ initial, voucher }: { initial: Draft; voucher: AccountsVoucher | null }) {
  const ctx = useCtx();
  const user = useSessionUser();
  const readOnlySession = useReadOnly();
  const toast = useToast();
  const queryClient = useQueryClient();
  const go = useGo();
  const canApproveHere = useCan("approvals.decide");

  const [draft, setDraft] = useState<Draft>(initial);
  const [dirty, setDirty] = useState(false);
  const [headerErrors, setHeaderErrors] = useState<Partial<Record<HeaderField, string>>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, LineErrors>>({});
  const [dialog, setDialog] = useState<null | "post" | "submit" | "approve" | "reject" | "reverse" | "discard">(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [reverseDate, setReverseDate] = useState<string | null>(TODAY);
  const [tried, setTried] = useState(false);

  const type = draft.type;
  const side = accountsVoucherSide(type);
  const cashBankKind = accountsCashBankKind(type);
  const status = voucher?.status ?? "DRAFT";
  const system = voucher?.system ?? false;
  const campusFixed = ctx.campus !== "ALL";
  const canPost = draft.campus ? can(user, "accounts.post", draft.campus) : can(user, "accounts.post", ctx.campus);
  const canApprove = (draft.campus ? can(user, "approvals.decide", draft.campus) : canApproveHere) && !system;
  const isPreparer = Boolean(voucher && user && (voucher.createdBy === user.name || voucher.submittedBy === user.name));
  const editable = canPost && status === "DRAFT" && !readOnlySession && !system;
  const totals = totalsOf(draft);

  // Accounts for this campus (other campuses' bank accounts are hidden).
  const chart = useQuery(accountsQueries.chart({ campus: draft.campus ?? ctx.campus, session: ctx.session }));
  const accounts = useMemo(() => chart.data ?? [], [chart.data]);
  const byCode = useMemo(() => new Map(accounts.map((a) => [a.code, a])), [accounts]);
  // Cash and bank vouchers: the other side can't be cash, bank or a control account (fee office, payroll).
  const lineOptions = useMemo(() => accountOptions(accounts, (a) => (side ? a.kind === "OTHER" && !a.control : true)), [accounts, side]);
  const cashBankOptions = accounts.filter((a) => a.postable && a.active && a.kind === cashBankKind && (!draft.campus || !a.campus || a.campus === draft.campus));

  const update = (fn: (d: Draft) => Draft) => {
    setDraft(fn);
    setDirty(true);
    setActionError(null);
  };
  const setHeader = <K extends keyof Draft>(k: K, v: Draft[K], field?: HeaderField) => {
    update((d) => ({ ...d, [k]: v }));
    if (field) setHeaderErrors(({ [field]: _gone, ...rest }) => rest);
  };
  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    update((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
    setLineErrors(({ [key]: _cleared, ...rest }) => rest);
  };

  const remember = (v: AccountsVoucher) => {
    queryClient.setQueryData(accountsQueries.voucher(v.id).queryKey, v);
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
  };
  const failText = (e: unknown, what: string) => (e instanceof ApiError ? (e.isNetwork ? `${what} — no response from the server. It's safe to try again.` : e.message) : `${what}. Try again.`);
  const showServerError = (e: unknown) => {
    const f = errorField(e);
    if (f && ["campus", "date", "narration", "cashBankAccount", "party"].includes(f)) setHeaderErrors((h) => ({ ...h, [f]: errorText(e) }));
    if (f === "cheque") setHeaderErrors((h) => ({ ...h, chequeNo: errorText(e) }));
    if (f === "chequeDate") setHeaderErrors((h) => ({ ...h, chequeDate: errorText(e) }));
  };

  const save = useMutation({
    mutationFn: () => accountsApi.saveDraft(toInput(draft, ctx.session), draft.id ?? undefined),
    onSuccess: (v) => {
      setDraft((d) => ({ ...d, id: v.id }));
      setDirty(false);
      remember(v);
      toast({
        title: "Draft saved",
        message: type === "JV" ? (v.totalDebit === v.totalCredit ? "Debits equal credits; ready to post." : `Still out of balance by ${formatRs(Math.abs(v.totalDebit - v.totalCredit))}.`) : "Send it for approval when it's complete.",
      });
      if (!draft.id) go("/accounts/vouchers/$voucherId", {}, { voucherId: v.id });
    },
    onError: (e) => {
      showServerError(e);
      toast({ tone: "danger", title: "Draft not saved", message: failText(e, "Draft not saved") });
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const input = toInput(draft, ctx.session);
      const id = draft.id ?? (await accountsApi.saveDraft(input)).id;
      return accountsApi.submit(id, input);
    },
    onSuccess: (v) => {
      setDialog(null);
      setDirty(false);
      remember(v);
      toast({ title: "Sent for approval", message: `${ACCOUNTS_VOUCHER_TYPE_LABEL[v.type]} · ${formatRs(v.totalDebit)} · an admin approves it before it is posted.` });
      if (!draft.id) go("/accounts/vouchers/$voucherId", {}, { voucherId: v.id });
    },
    onError: (e) => {
      showServerError(e);
      setActionError(failText(e, "Not sent for approval"));
    },
  });

  const post = useMutation({
    mutationFn: (key: string) => (type === "JV" ? accountsApi.post(draft.id ?? "new", toInput(draft, ctx.session), key) : accountsApi.post(draft.id ?? "", undefined, key)),
    onSuccess: (v) => {
      setDialog(null);
      setActionKey(null);
      setDirty(false);
      remember(v);
      toast({ title: `${ACCOUNTS_VOUCHER_TYPE_LABEL[v.type]} ${v.voucherNo} posted`, message: `${v.campusName} · ${formatRs(v.totalDebit)} · ${v.lines.length} lines` });
      if (!draft.id || draft.id !== v.id) go("/accounts/vouchers/$voucherId", {}, { voucherId: v.id });
    },
    onError: (e) => setActionError(e instanceof ApiError ? (e.isNetwork ? "Voucher not posted — safe to try again. The connection dropped before the server replied." : e.message) : "Voucher not posted. Try again."),
  });

  const approve = useMutation({
    mutationFn: () => accountsApi.approve(draft.id ?? "", note),
    onSuccess: (v) => {
      setDialog(null);
      remember(v);
      toast({ title: "Voucher approved", message: `${ACCOUNTS_VOUCHER_TYPE_LABEL[v.type]} · ${formatRs(v.totalDebit)} · the accountant can post it now.` });
    },
    onError: (e) => setActionError(failText(e, "Not approved")),
  });

  const reject = useMutation({
    mutationFn: () => accountsApi.reject(draft.id ?? "", reason),
    onSuccess: (v) => {
      setDialog(null);
      remember(v);
      toast({ title: "Sent back to the accountant", message: "It returns as a draft with your note." });
    },
    onError: (e) => setActionError(failText(e, "Not sent back")),
  });

  const reverse = useMutation({
    mutationFn: (key: string) => accountsApi.reverse(draft.id ?? "", { reason, date: reverseDate ?? TODAY }, key),
    onSuccess: (v) => {
      setDialog(null);
      setActionKey(null);
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: `Reversed by ${v.voucherNo}`, message: `${voucher?.voucherNo} no longer counts in the ledger. Post a corrected voucher if one is needed.` });
      go("/accounts/vouchers/$voucherId", {}, { voucherId: v.id });
    },
    onError: (e) => setActionError(failText(e, "Not reversed")),
  });

  const discard = useMutation({
    mutationFn: () => accountsApi.discard(draft.id ?? ""),
    onSuccess: () => {
      setDialog(null);
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: "Draft discarded" });
      go("/accounts/vouchers");
    },
    onError: (e) => setActionError(failText(e, "Not discarded")),
  });

  const checkFinal = () => {
    setTried(true);
    const v = validateFinal(draft);
    setHeaderErrors(v.header);
    setLineErrors(v.lines);
    if (v.count > 0 || (type === "JV" && !totals.balanced)) {
      toast({ tone: "warning", title: "Check the voucher first", message: v.count > 0 ? "Some fields need attention; they are marked in red." : "Debits must equal credits." });
      return false;
    }
    setActionError(null);
    return true;
  };

  const saveDraft = () => {
    const errs: Partial<Record<HeaderField, string>> = {};
    if (!draft.campus) errs.campus = "Choose the campus this voucher belongs to.";
    if (!draft.date) errs.date = "Enter the voucher date.";
    setHeaderErrors(errs);
    if (Object.keys(errs).length === 0) save.mutate();
  };

  const openPost = () => {
    if (type === "JV" && !checkFinal()) return;
    setActionKey((k) => k ?? newIdempotencyKey());
    setActionError(null);
    setDialog("post");
  };

  const postBlockedReason = readOnlySession
    ? "2025–26 is read-only. Switch to 2026–27 to post vouchers."
    : type === "JV" && totals.debit === 0 && totals.credit === 0
      ? "Enter the amounts first."
      : type === "JV" && !totals.balanced
        ? `Post is off until debits equal credits. Out of balance by ${formatRs(Math.abs(totals.diff))}.`
        : null;

  const otherColumns: Array<Column<DraftLine>> = [
    { key: "n", header: "#", width: 44, render: (_l, i) => <span className="mtb-num text-ink-muted">{i + 1}</span> },
    {
      key: "account",
      header: side === "PAYMENT" ? "Paid for (account)" : side === "RECEIPT" ? "Received for (account)" : "Account",
      width: 320,
      render: (l, i) =>
        editable ? (
          <div className={cellField}>
            <Combobox
              label={`Account, line ${i + 1}`}
              options={lineOptions}
              value={l.accountCode}
              onValueChange={(v) => updateLine(l.key, { accountCode: v })}
              placeholder="Choose account…"
              searchPlaceholder="Type a code or name"
              emptyText={side ? "No account matches. Cash, bank and control accounts can't be used here." : "No postable account matches. Groups can't take postings."}
              {...(lineErrors[l.key]?.account ? { error: lineErrors[l.key]?.account } : {})}
            />
            {type === "JV" && l.accountCode && byCode.get(l.accountCode)?.control && (
              <span className="mt-1 block text-small text-warning-ink">Filled by the {byCode.get(l.accountCode)?.control === "FEE_OFFICE" ? "fee office" : "payroll"}; use only to correct it.</span>
            )}
          </div>
        ) : (
          <span className="grid">
            <span className="mtb-cell-primary">
              <span className="mtb-mono text-ink-muted">{l.accountCode}</span> {byCode.get(l.accountCode ?? "")?.name ?? voucher?.lines.find((x) => x.id === l.key)?.accountName ?? ""}
            </span>
          </span>
        ),
    },
    {
      key: "description",
      header: "Description",
      render: (l, i) =>
        editable ? (
          <div className={cellField}>
            <Input label={`Description, line ${i + 1}`} value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} placeholder="Bill, cheque or slip number" />
          </div>
        ) : (
          <span className="text-ink">{l.description || <span className="text-ink-muted">—</span>}</span>
        ),
    },
  ];

  const amountColumns: Array<Column<DraftLine>> = side
    ? [
        {
          key: "amount",
          header: "Amount",
          align: "right",
          width: 190,
          render: (l, i) =>
            editable ? (
              <div className={cellField}>
                <AmountInput
                  label={`Amount, line ${i + 1}`}
                  value={side === "PAYMENT" ? l.debit : l.credit}
                  onValueChange={(v) => updateLine(l.key, side === "PAYMENT" ? { debit: v, credit: null } : { credit: v, debit: null })}
                  {...(lineErrors[l.key]?.amount ? { error: lineErrors[l.key]?.amount } : {})}
                />
              </div>
            ) : (
              <Money value={amountOf(type, l)} />
            ),
        },
      ]
    : [
        {
          key: "debit",
          header: "Debit",
          align: "right",
          width: 170,
          render: (l, i) =>
            editable ? (
              <div className={cellField}>
                <AmountInput
                  label={`Debit, line ${i + 1}`}
                  value={l.debit}
                  onValueChange={(v) => updateLine(l.key, { debit: v, ...(v ? { credit: null } : {}) })}
                  {...(lineErrors[l.key]?.amount ? { error: lineErrors[l.key]?.amount } : {})}
                />
              </div>
            ) : l.debit ? (
              <Money value={l.debit} />
            ) : null,
        },
        {
          key: "credit",
          header: "Credit",
          align: "right",
          width: 170,
          render: (l, i) =>
            editable ? (
              <div className={cellField}>
                <AmountInput label={`Credit, line ${i + 1}`} value={l.credit} onValueChange={(v) => updateLine(l.key, { credit: v, ...(v ? { debit: null } : {}) })} />
              </div>
            ) : l.credit ? (
              <Money value={l.credit} />
            ) : null,
        },
      ];

  const columns: Array<Column<DraftLine>> = [
    ...otherColumns,
    ...amountColumns,
    {
      key: "remove",
      header: <span className="mtb-sr-only">Remove</span>,
      width: 52,
      render: (l, i) =>
        editable ? (
          <IconButton icon="trash" label={`Remove line ${i + 1}`} size="sm" disabled={draft.lines.length <= (side ? 1 : 2)} onClick={() => update((d) => ({ ...d, lines: d.lines.filter((x) => x.key !== l.key) }))} />
        ) : null,
    },
  ];

  const contraLine = voucher?.lines.find((l) => l.contra);
  const title = voucher?.voucherNo ? `${TITLE[type] ?? "Voucher"} ${voucher.voucherNo}` : voucher ? TITLE[type] : `New ${TITLE[type].toLowerCase()}`;
  const systemTitle = voucher?.system ? `${ACCOUNTS_VOUCHER_TYPE_LABEL[voucher.type]} ${voucher.voucherNo ?? ""}` : null;

  const postButton = (
    <Button variant="primary" icon="lock" onClick={openPost} disabled={postBlockedReason !== null}>
      Post voucher
    </Button>
  );

  const history: TimelineItem[] = (voucher?.history ?? []).map((h, i) => ({
    id: String(i),
    date: h.at.slice(0, 10),
    title: `${{ CREATED: "Created", EDITED: "Changed", SUBMITTED: "Sent for approval", APPROVED: "Approved", REJECTED: "Sent back", POSTED: "Posted", REVERSED: "Reversed" }[h.action]} by ${h.by} at ${formatTime(h.at)}`,
    ...(h.note ? { description: h.note } : {}),
    icon: h.action === "POSTED" ? "lock" : h.action === "APPROVED" ? "check" : h.action === "REJECTED" ? "x" : h.action === "REVERSED" ? "refresh" : h.action === "SUBMITTED" ? "send" : "edit",
    tone: h.action === "POSTED" ? "brand" : h.action === "APPROVED" ? "success" : h.action === "REJECTED" ? "danger" : h.action === "REVERSED" ? "warning" : "neutral",
  }));

  const usedLines = draft.lines.filter(isUsed);

  return (
    <AccountsShell
      title={systemTitle ?? title}
      meta={
        <>
          <TypeChip type={voucher?.type ?? type} />
          {voucher ? <VoucherStatus status={voucher.status} totalDebit={totals.debit} totalCredit={totals.credit} rejected={Boolean(voucher.rejection)} type={type} /> : <span className="text-small text-ink-muted">New voucher</span>}
          {dirty && editable && <span className="text-small text-ink-muted">· Unsaved changes</span>}
        </>
      }
      actions={
        <>
          <Button variant="ghost" icon="arrowLeft" onClick={() => go("/accounts/vouchers")}>
            All vouchers
          </Button>
          {voucher && (
            <Button icon="printer" onClick={() => window.print()}>
              Print
            </Button>
          )}
        </>
      }
    >
      {voucher?.system && (
        <Banner tone="info" icon="bolt" title="Posted by the system.">
          {voucher.source?.kind === "FEE_BATCH" ? (
            <>
              The fee office's collection for {formatDate(voucher.source.date)} posts to the ledger automatically when the counter closes.{" "}
              <AccLink to="/accounts/fee-posting" search={{ month: voucher.source.date.slice(0, 7), batch: `${voucher.campus}:${voucher.source.date}` }}>
                See the day's reconciliation
              </AccLink>
            </>
          ) : voucher.source?.kind === "RECEIPT_CANCELLATION" ? (
            <>
              Receipt {voucher.source.receiptNo} for {voucher.source.studentName} was cancelled ({voucher.source.cnNo}); its fee income was reversed automatically.
            </>
          ) : (
            <>Balances brought forward at the start of the session. They can't be changed by hand.</>
          )}
        </Banner>
      )}
      {status === "POSTED" && !system && voucher && (
        <Banner tone="neutral" icon="lock" title={`Posted by ${voucher.postedBy} on ${formatDateTime(voucher.postedAt ?? voucher.updatedAt)}.`}>
          Posted vouchers can't be edited. To correct one, reverse it and post the right voucher.
          {voucher.reverses && (
            <>
              {" "}
              This voucher reverses{" "}
              <AccLink to="/accounts/vouchers/$voucherId" params={{ voucherId: voucher.reverses.voucherId }}>
                {voucher.reverses.voucherNo}
              </AccLink>
              .
            </>
          )}
        </Banner>
      )}
      {status === "REVERSED" && voucher?.reversal && (
        <Banner tone="warning" icon="refresh" title={`Reversed by ${voucher.reversal.voucherNo} on ${formatDate(voucher.reversal.at)}.`}>
          {voucher.reversal.reason}.{" "}
          <AccLink to="/accounts/vouchers/$voucherId" params={{ voucherId: voucher.reversal.voucherId }}>
            Open the reversing voucher
          </AccLink>
        </Banner>
      )}
      {status === "DRAFT" && voucher?.rejection && (
        <Banner tone="danger" icon="x" title={`Sent back by ${voucher.rejection.by} on ${formatDateTime(voucher.rejection.at)}:`}>
          {voucher.rejection.reason} Correct the voucher and send it for approval again.
        </Banner>
      )}
      {status === "SUBMITTED" && voucher && (
        <Banner tone="info" icon="clock" title={`Waiting for approval since ${formatDateTime(voucher.submittedAt ?? voucher.updatedAt)}.`}>
          {canApprove && !isPreparer ? "Check the bill and the amount, then approve it or send it back with a note." : "An admin approves cash and bank vouchers before the accountant posts them."}
        </Banner>
      )}
      {status === "APPROVED" && voucher && (
        <Banner tone="success" icon="checkCircle" title={`Approved by ${voucher.approvedBy} on ${formatDateTime(voucher.approvedAt ?? voucher.updatedAt)}.`}>
          {canPost ? "Ready to post. Posting gives it a number and puts it in the ledger." : "Waiting for the accountant to post it."}
        </Banner>
      )}
      {status === "DRAFT" && !canPost && !system && (
        <Banner tone="info" title="View only.">
          Your role can see vouchers but not enter or post them.
        </Banner>
      )}

      <section className="mtb-card mtb-rise" aria-label="Voucher details">
        <div className="mtb-card-header">
          <h2>{voucher?.system ? ACCOUNTS_VOUCHER_TYPE_LABEL[voucher.type] : TITLE[type]}</h2>
          {voucher?.campusName && <span className="text-small text-ink-muted">{voucher.campusName}</span>}
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
          <DatePicker
            label="Date"
            required
            value={draft.date}
            onValueChange={(v) => setHeader("date", v, "date")}
            today={TODAY}
            minDate={sessionStartOf(ctx.session)}
            maxDate={TODAY}
            disabled={!editable}
            {...(headerErrors.date ? { error: headerErrors.date } : {})}
          />
          <Input label="Voucher number" value={voucher?.voucherNo ?? "Given when posted"} readOnly mono help={voucher?.voucherNo ? undefined : "Issued by the server, gap-free per campus."} />
          {campusFixed || !editable || draft.id ? (
            <Input label="Campus" value={draft.campus ? campusLabel(draft.campus) : "—"} readOnly />
          ) : (
            <Select
              label="Campus"
              required
              value={draft.campus ?? ""}
              onChange={(e) => setHeader("campus", (e.target.value || null) as CampusCode | null, "campus")}
              options={[{ value: "", label: "Choose…" }, ...CAMPUS_CODES.map((c) => ({ value: c, label: CAMPUS_LABEL[c] }))]}
              {...(headerErrors.campus ? { error: headerErrors.campus } : {})}
            />
          )}
          <Input label={side ? "Bill or invoice number" : "Reference"} value={draft.reference} onChange={(e) => setHeader("reference", e.target.value)} placeholder={side ? "e.g. Invoice 1187" : "Optional"} disabled={!editable} />
          {side && (
            <>
              {editable ? (
                <Select
                  label={side === "PAYMENT" ? (cashBankKind === "BANK" ? "Paid from bank account" : "Paid from") : cashBankKind === "BANK" ? "Received into bank account" : "Received into"}
                  required
                  value={draft.cashBankAccount ?? ""}
                  onChange={(e) => setHeader("cashBankAccount", e.target.value || null, "cashBankAccount")}
                  options={[{ value: "", label: draft.campus ? "Choose…" : "Choose the campus first" }, ...cashBankOptions.map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }))]}
                  {...(headerErrors.cashBankAccount ? { error: headerErrors.cashBankAccount } : {})}
                />
              ) : (
                <Input label={side === "PAYMENT" ? "Paid from" : "Received into"} value={contraLine ? `${contraLine.accountCode} ${contraLine.accountName ?? ""}` : (draft.cashBankAccount ?? "—")} readOnly />
              )}
              <Input
                label={side === "PAYMENT" ? "Paid to" : "Received from"}
                required
                value={draft.party}
                onChange={(e) => setHeader("party", e.target.value, "party")}
                placeholder={side === "PAYMENT" ? "e.g. Al-Noor Printers" : "e.g. Shahid Foods"}
                disabled={!editable}
                {...(headerErrors.party ? { error: headerErrors.party } : {})}
              />
              {cashBankKind === "BANK" && (
                <>
                  <Input
                    label={side === "PAYMENT" ? "Cheque number or transfer reference" : "Cheque, transfer or slip number"}
                    required
                    mono
                    value={draft.chequeNo}
                    onChange={(e) => setHeader("chequeNo", e.target.value, "chequeNo")}
                    placeholder={side === "PAYMENT" ? "e.g. 004513" : "e.g. IBFT 551208"}
                    disabled={!editable}
                    {...(headerErrors.chequeNo ? { error: headerErrors.chequeNo } : {})}
                  />
                  <DatePicker
                    label={side === "PAYMENT" ? "Cheque date" : "Date received"}
                    required
                    value={draft.chequeDate}
                    onValueChange={(v) => setHeader("chequeDate", v, "chequeDate")}
                    today={TODAY}
                    disabled={!editable}
                    {...(headerErrors.chequeDate ? { error: headerErrors.chequeDate } : {})}
                  />
                </>
              )}
            </>
          )}
          <div className="md:col-span-2 xl:col-span-4">
            <Textarea
              label="Narration"
              required
              rows={2}
              value={draft.narration}
              onChange={(e) => setHeader("narration", e.target.value, "narration")}
              placeholder="What this voucher is for"
              disabled={!editable}
              {...(headerErrors.narration ? { error: headerErrors.narration } : {})}
            />
          </div>
        </div>

        <div className="px-5 pb-5">
          <DataTable
            caption="Voucher lines"
            columns={columns}
            rows={draft.lines}
            rowKey="key"
            stickyHeader={false}
            footer={
              side
                ? { account: <span>Total</span>, amount: <Money value={totals.total} /> }
                : { account: <span>Totals</span>, debit: <Money value={totals.debit} />, credit: <Money value={totals.credit} /> }
            }
          />
          {side && contraLine && !editable && (
            <p className="m-0 mt-2 text-small text-ink-muted">
              {side === "PAYMENT" ? "Credited to" : "Debited to"} {contraLine.accountCode} {contraLine.accountName}: <span className="mtb-num">{formatRs(contraLine.debit || contraLine.credit)}</span>.
            </p>
          )}
          {editable && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="quiet" size="sm" icon="plus" onClick={() => update((d) => ({ ...d, lines: [...d.lines, newLine()] }))}>
                Add line
              </Button>
              <span className="text-small text-ink-muted">{side ? `The ${cashBankKind === "BANK" ? "bank" : "cash"} line is added for you from the account above.` : "Each line takes a debit or a credit, not both. Blank lines are ignored."}</span>
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-border bg-surface-raised px-5 py-3">
          {type === "JV" && !system ? (
            <BalanceStatus debit={totals.debit} credit={totals.credit} />
          ) : (
            <div className="grid min-w-0">
              <span className="font-semibold">
                Total <span className="mtb-num">{formatRs(totals.total || (voucher?.totalDebit ?? 0))}</span>
              </span>
              {(totals.total || voucher?.totalDebit) ? <span className="text-small text-ink-muted">{amountInWords(totals.total || voucher?.totalDebit || 0)}</span> : null}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {editable && draft.id && (
              <Button variant="danger-quiet" icon="trash" onClick={() => setDialog("discard")}>
                Discard draft
              </Button>
            )}
            {editable && (
              <Button onClick={saveDraft} loading={save.isPending} disabled={readOnlySession}>
                Save draft
              </Button>
            )}
            {editable && type === "JV" &&
              (postBlockedReason ? (
                <Tooltip content={postBlockedReason}>
                  <span tabIndex={0} className="rounded-md">
                    {postButton}
                  </span>
                </Tooltip>
              ) : (
                postButton
              ))}
            {editable && side && (
              <Button
                variant="primary"
                icon="send"
                onClick={() => {
                  if (checkFinal()) setDialog("submit");
                }}
              >
                Send for approval
              </Button>
            )}
            {status === "SUBMITTED" && canApprove && !isPreparer && !readOnlySession && (
              <>
                <Button variant="secondary" icon="x" onClick={() => { setActionError(null); setDialog("reject"); }}>
                  Send back
                </Button>
                <Button variant="primary" icon="check" onClick={() => { setActionError(null); setDialog("approve"); }}>
                  Approve
                </Button>
              </>
            )}
            {status === "APPROVED" && canApprove && !isPreparer && !readOnlySession && (
              <Button variant="secondary" icon="x" onClick={() => { setActionError(null); setDialog("reject"); }}>
                Send back
              </Button>
            )}
            {status === "APPROVED" && canPost && !readOnlySession && (
              <Button
                variant="primary"
                icon="lock"
                onClick={() => {
                  setActionKey((k) => k ?? newIdempotencyKey());
                  setActionError(null);
                  setDialog("post");
                }}
              >
                Post voucher
              </Button>
            )}
            {status === "POSTED" && canPost && !system && !voucher?.reverses && !readOnlySession && (
              <Button
                variant="secondary"
                icon="refresh"
                onClick={() => {
                  setActionKey((k) => k ?? newIdempotencyKey());
                  setActionError(null);
                  setReason("");
                  setReverseDate(TODAY);
                  setTried(false);
                  setDialog("reverse");
                }}
              >
                Reverse voucher
              </Button>
            )}
          </div>
        </footer>
      </section>

      {history.length > 0 && (
        <Panel id="voucher-history" title="History" description="Who did what, and when. Nothing is ever deleted from a posted voucher." rise={1}>
          <Timeline items={history} label="Voucher history" />
        </Panel>
      )}

      {voucher && <VoucherDoc voucher={voucher} />}

      <ConfirmDialog
        open={dialog === "post"}
        onClose={() => setDialog(null)}
        onConfirm={() => actionKey && post.mutate(actionKey)}
        title={`Post this ${TITLE[type].toLowerCase()}?`}
        message="Posted vouchers can't be edited. To correct one, post a reversing voucher."
        details={[
          ["Campus", draft.campus ? campusLabel(draft.campus) : "—"],
          ["Date", draft.date ? formatDate(draft.date) : "—"],
          ["Lines", String(usedLines.length + (side ? 1 : 0))],
          ["Total debit", formatRs(totals.debit)],
          ["Total credit", formatRs(totals.credit)],
        ]}
        confirmLabel={`Post voucher · ${formatRs(totals.debit)}`}
        loading={post.isPending}
        loadingLabel="Posting…"
        {...(actionError ? { error: actionError } : {})}
      />

      <ConfirmDialog
        open={dialog === "submit"}
        onClose={() => setDialog(null)}
        onConfirm={() => submit.mutate()}
        title="Send this voucher for approval?"
        message="An admin checks it before it is posted. You can't change it while it waits; the approver can send it back."
        details={[
          [side === "PAYMENT" ? "Paid to" : "Received from", draft.party || "—"],
          [side === "PAYMENT" ? "Paid from" : "Received into", byCode.get(draft.cashBankAccount ?? "")?.name ?? "—"],
          ...(cashBankKind === "BANK" ? [["Cheque / reference", draft.chequeNo || "—"] as [string, string]] : []),
          ["Amount", formatRs(totals.total)],
        ]}
        confirmLabel="Send for approval"
        icon="send"
        loading={submit.isPending}
        loadingLabel="Sending…"
        {...(actionError ? { error: actionError } : {})}
      />

      <ConfirmDialog
        open={dialog === "approve"}
        onClose={() => setDialog(null)}
        onConfirm={() => approve.mutate()}
        title="Approve this voucher?"
        message="The accountant can then post it. Approving doesn't post it."
        details={[
          [side === "PAYMENT" ? "Paid to" : "Received from", voucher?.party ?? "—"],
          ["Prepared by", voucher?.createdBy ?? "—"],
          ["Amount", formatRs(voucher?.totalDebit ?? 0)],
        ]}
        confirmLabel="Approve"
        icon="check"
        loading={approve.isPending}
        loadingLabel="Approving…"
        {...(actionError ? { error: actionError } : {})}
      >
        <Textarea label="Note for the accountant" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. Bill checked against the quotation." />
      </ConfirmDialog>

      <Modal
        open={dialog === "reject"}
        onClose={() => setDialog(null)}
        title="Send this voucher back?"
        description="It returns to the accountant as a draft with your note."
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={reject.isPending}
              loadingLabel="Sending back…"
              onClick={() => {
                setTried(true);
                if (reason.trim().length >= 5) reject.mutate();
              }}
            >
              Send back
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Textarea
            label="What needs to change"
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. The bill says Rs 8,900, not Rs 9,800."
            {...(tried && reason.trim().length < 5 ? { error: "Say what needs to change, so the accountant can fix it." } : {})}
          />
          {actionError && <Banner tone="danger">{actionError}</Banner>}
        </div>
      </Modal>

      <ConfirmDialog
        open={dialog === "reverse"}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          setTried(true);
          if (reason.trim().length >= 5 && reverseDate && actionKey) reverse.mutate(actionKey);
        }}
        tone="danger"
        icon="refresh"
        title={`Reverse ${voucher?.voucherNo ?? "this voucher"}?`}
        message="A journal voucher with every line the other way round is posted, so this voucher no longer counts. Both stay in the books."
        details={[
          ["Amount", formatRs(voucher?.totalDebit ?? 0)],
          ["Original date", voucher ? formatDate(voucher.date) : "—"],
        ]}
        confirmLabel="Post reversal"
        loading={reverse.isPending}
        loadingLabel="Reversing…"
        {...(actionError ? { error: actionError } : {})}
      >
        <div className="grid gap-4">
          <Textarea
            label="Why is it being reversed?"
            required
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Cheque cancelled before it was presented"
            {...(tried && reason.trim().length < 5 ? { error: "Say why, so the reason stays with the books." } : {})}
          />
          <DatePicker label="Date of the reversal" required value={reverseDate} onValueChange={setReverseDate} today={TODAY} minDate={voucher?.date ?? sessionStartOf(ctx.session)} maxDate={TODAY} help="Usually today. It must be in an open month." />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "discard"}
        onClose={() => setDialog(null)}
        onConfirm={() => discard.mutate()}
        tone="danger"
        icon="trash"
        title="Discard this draft?"
        message="The draft is removed. Nothing was posted, so the books don't change."
        confirmLabel="Discard draft"
        loading={discard.isPending}
        loadingLabel="Discarding…"
        {...(actionError ? { error: actionError } : {})}
      />
    </AccountsShell>
  );
}

/* ---------------------------------------------------------------- Print */

/** The printed voucher (A4): header, lines, amount in words and signature boxes. */
function VoucherDoc({ voucher }: { voucher: AccountsVoucher }) {
  const side = accountsVoucherSide(voucher.type);
  const typeLabel = ACCOUNTS_MANUAL_TYPES.includes(voucher.type as AccountsManualType) ? TITLE[voucher.type as AccountsManualType] : ACCOUNTS_VOUCHER_TYPE_LABEL[voucher.type];
  const posted = voucher.status === "POSTED" || voucher.status === "REVERSED";
  return (
    <div className="acc-print-only mtb-print-area" aria-hidden="true">
      <article className="acc-doc">
        <DocHead
          title={typeLabel}
          subtitle={voucher.campusName}
          right={
            <>
              <div className="mtb-mono text-[14px] font-bold">{voucher.voucherNo ?? "Not posted"}</div>
              <div>Date: {formatDate(voucher.date)}</div>
            </>
          }
        />
        {!posted && <div className="acc-doc-draft">{voucher.status === "APPROVED" ? "APPROVED — NOT YET POSTED" : "DRAFT — NOT POSTED"}</div>}
        {voucher.status === "REVERSED" && <div className="acc-doc-draft">REVERSED BY {voucher.reversal?.voucherNo}</div>}
        <div className="acc-doc-meta">
          {voucher.party && (
            <div>
              <b>{side === "RECEIPT" ? "Received from" : "Paid to"}:</b> {voucher.party}
            </div>
          )}
          {voucher.cheque && (
            <div>
              <b>Cheque / reference:</b> {voucher.cheque.number} · {formatDate(voucher.cheque.date)}
            </div>
          )}
          {voucher.reference && (
            <div>
              <b>Bill / reference:</b> {voucher.reference}
            </div>
          )}
          <div className="col-span-2">
            <b>Narration:</b> {voucher.narration}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th>
              <th style={{ width: 60 }}>Code</th>
              <th>Account</th>
              <th>Description</th>
              <th className="num" style={{ width: 100 }}>
                Debit
              </th>
              <th className="num" style={{ width: 100 }}>
                Credit
              </th>
            </tr>
          </thead>
          <tbody>
            {voucher.lines.map((l, i) => (
              <tr key={l.id}>
                <td>{i + 1}</td>
                <td>{l.accountCode}</td>
                <td>{l.accountName}</td>
                <td>{l.description}</td>
                <td className="num">{l.debit ? formatRs(l.debit) : ""}</td>
                <td className="num">{l.credit ? formatRs(l.credit) : ""}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={4} style={{ textAlign: "right", fontWeight: 600 }}>
                Total
              </td>
              <td className="num" style={{ fontWeight: 600 }}>
                {formatRs(voucher.totalDebit)}
              </td>
              <td className="num" style={{ fontWeight: 600 }}>
                {formatRs(voucher.totalCredit)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="m-0 mt-2">
          <b>Amount in words:</b> {amountInWords(voucher.totalDebit)}
        </p>
        <KeyValue
          className="mt-2"
          items={[
            ["Prepared by", `${voucher.createdBy}`],
            ...(voucher.approvedBy ? [["Approved by", `${voucher.approvedBy}, ${formatDateTime(voucher.approvedAt ?? voucher.updatedAt)}`] as [string, string]] : []),
            ...(voucher.postedBy ? [["Posted by", `${voucher.postedBy}, ${formatDateTime(voucher.postedAt ?? voucher.updatedAt)}`] as [string, string]] : []),
          ]}
        />
        <div className="acc-doc-sign">
          <div>Prepared by</div>
          <div>Checked / approved by</div>
          <div>Posted by</div>
          <div>{side === "PAYMENT" ? "Received by (payee)" : side === "RECEIPT" ? "Paid by" : "Principal / head office"}</div>
        </div>
        <DocFoot />
      </article>
    </div>
  );
}
