import { libraryApi, libraryQueries, newIdempotencyKey, smsSegments, type LibraryLoan } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatMobile, formatRs } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, DataTable, EmptyState, Input, KeyValue, Modal, Segmented, StatCard, StatusBadge, Urdu, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { addDays, DocHead, errorCode, errorText, LoadError, opsToday, slide, Spine, usePrinter } from "./common";
import { LibraryShell, MemberLink, TitleText } from "./shared";

// Preview of the built-in "Library book overdue" template (Messages, purpose Library overdue reminder). The server
// renders the real text from the template as it stands, so an admin's rewording shows in the outbox, not here. The
// template has no book-title variable, so the message names the borrower, the due date and the fine, not the book.
// The guardian's name is not in the loan row: the preview says "Parent".
const whoOf = (l: LibraryLoan) => (l.borrowerType === "STUDENT" ? "Parent" : l.borrowerName);

function englishText(l: LibraryLoan, campus: string) {
  return `Dear ${whoOf(l)}, the library book issued to ${l.borrowerName} was due on ${formatDate(l.dueOn)}. Please return it to the library. Fine so far: Rs ${formatCount(l.fine)}. - MTB ${campus}`;
}

/** The Urdu message as held (for counting SMS parts); the preview below shows it with dates kept left-to-right. */
function urduText(l: LibraryLoan, campus: string) {
  return `محترم ${whoOf(l)}، ${l.borrowerName} کو جاری کی گئی لائبریری کی کتاب کی واپسی کی تاریخ ${formatDate(l.dueOn)} تھی۔ براہِ کرم کتاب لائبریری میں واپس کریں۔ اب تک جرمانہ: ${formatCount(l.fine)} روپے۔ — MTB ${campus}`;
}

function UrduPreview({ l, campus }: { l: LibraryLoan; campus: string }) {
  return (
    <Urdu>
      محترم {whoOf(l)}، {l.borrowerName} کو جاری کی گئی لائبریری کی کتاب کی واپسی کی تاریخ <bdi dir="ltr">{formatDate(l.dueOn)}</bdi> تھی۔ براہِ کرم کتاب لائبریری میں واپس کریں۔ اب تک جرمانہ:{" "}
      <bdi dir="ltr">{formatCount(l.fine)}</bdi> روپے۔ — MTB {campus}
    </Urdu>
  );
}

function ReminderModal({ rows, onClose, onSent }: { rows: LibraryLoan[]; onClose: () => void; onSent: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [lang, setLang] = useState<"en" | "ur">("en");
  const key = useMemo(() => newIdempotencyKey(), [rows, lang]);
  const first = rows[0];
  const campus = campusLabel(ctx.campus);
  const text = first ? englishText(first, campus) : "";
  const parts = smsSegments(first ? (lang === "ur" ? urduText(first, campus) : text) : "");
  const send = useMutation({
    mutationFn: () => libraryApi.remind(ctx, { loanIds: rows.map((r) => r.id), language: lang }, key),
    onSuccess: (r) => {
      toast({
        title: `${formatCount(r.queued)} ${r.queued === 1 ? "reminder" : "reminders"} held (SMS sending is off)`,
        message: r.skipped.length ? `${formatCount(r.skipped.length)} skipped: ${r.skipped.map((s) => `${s.name} (${s.reason.toLowerCase()})`).join(", ")}` : "They wait in the Messages outbox. Nothing is sent from this system.",
      });
      void qc.invalidateQueries({ queryKey: ["library"] });
      onSent();
    },
  });
  const paused = errorCode(send.error) === "SMS_PAUSED";
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Add an overdue reminder for ${rows.length} ${rows.length === 1 ? "book" : "books"} to the outbox?`}
      description="Students' guardians get the message; staff get it on their own mobile. SMS sending is off, so the messages are held in the Messages outbox; numbers that opted out of SMS are skipped."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="send" loading={send.isPending} loadingLabel="Saving…" onClick={() => send.mutate()}>
            Hold {rows.length} SMS
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Segmented aria-label="Language" value={lang} onChange={(v) => setLang(v as "en" | "ur")} options={[{ value: "en", label: "English" }, { value: "ur", label: "اردو" }]} />
        {first && (
          <div className="grid gap-1">
            <span className="text-small text-ink-muted">
              To {first.borrowerType === "STUDENT" ? "the guardian of " : ""}
              {first.borrowerName} · <bdi dir="ltr">{formatMobile(first.mobile)}</bdi>
            </span>
            <div className="max-w-[460px] rounded-[18px_18px_18px_4px] bg-surface-sunken px-4 py-3 text-[14px] leading-5">{lang === "ur" ? <UrduPreview l={first} campus={campus} /> : text}</div>
            <span className="text-small text-ink-muted">
              About {parts.parts} SMS {parts.parts === 1 ? "part" : "parts"} each. Every message carries its own borrower, due date and fine; the wording is the
              "Library book overdue" template in Messages.
            </span>
          </div>
        )}
        <KeyValue
          items={[
            ["Books", formatCount(rows.length)],
            ["Fines so far", formatRs(rows.reduce((a, r) => a + r.fine, 0))],
            ["Reminded before", `${rows.filter((r) => r.reminders > 0).length} of ${rows.length}`],
          ]}
        />
        {send.isError && (
          <Banner tone={paused ? "warning" : "danger"} title={paused ? "All SMS are paused by the admin." : undefined}>
            {errorText(send.error)}
          </Banner>
        )}
      </div>
    </Modal>
  );
}

function OverdueList({ rows, campus }: { rows: LibraryLoan[]; campus: string }) {
  return (
    <div className="ops-doc">
      <DocHead title="Overdue books" subtitle={`${rows.length} books · fines to date ${formatRs(rows.reduce((a, r) => a + r.fine, 0))}`} campus={campus} />
      <table>
        <thead>
          <tr>
            <th>Borrower</th>
            <th>Class or post</th>
            <th>Mobile</th>
            <th>Book</th>
            <th>Accession</th>
            <th>Due</th>
            <th className="n">Days late</th>
            <th className="n">Fine</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td>{l.borrowerName}</td>
              <td>{l.borrowerDetail}</td>
              <td>{formatMobile(l.mobile)}</td>
              <td>{l.title || l.titleUr}</td>
              <td>{l.accessionNo}</td>
              <td>{formatDate(l.dueOn)}</td>
              <td className="n">{l.daysLate}</td>
              <td className="n">{l.fine > 0 ? formatRs(l.fine) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OverduePage() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canSend = useCan("library.manage") && !readOnly && ctx.campus !== "ALL";
  const q = useQuery(libraryQueries.loans(ctx, { status: "OVERDUE" }));
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<unknown>>(new Set());
  const [reminding, setReminding] = useState(false);
  const printer = usePrinter();
  useEffect(() => setSelected(new Set()), [ctx.campus, ctx.session, type]);
  const rows = (q.data ?? []).filter((l) => (!type || l.borrowerType === type) && (!search.trim() || `${l.borrowerName} ${l.title} ${l.borrowerDetail}`.toLowerCase().includes(search.trim().toLowerCase())));
  const chosen = rows.filter((r) => selected.has(r.id));
  const weekAgo = addDays(opsToday(), -7);
  const totals = {
    count: rows.length,
    fines: rows.reduce((a, r) => a + r.fine, 0),
    long: rows.filter((r) => r.daysLate > 30).length,
    notReminded: rows.filter((r) => !r.lastReminderAt || r.lastReminderAt.slice(0, 10) < weekAgo).length,
  };

  const columns: Array<Column<LibraryLoan>> = [
    {
      key: "who",
      header: "Borrower",
      render: (l) => (
        <span className="grid">
          <MemberLink type={l.borrowerType} id={l.borrowerId}>
            {l.borrowerName}
          </MemberLink>
          <span className="text-small text-ink-muted">
            {l.borrowerDetail} · <bdi dir="ltr">{formatMobile(l.mobile)}</bdi>
          </span>
        </span>
      ),
    },
    { key: "book", header: "Book", render: (l) => <TitleText title={l.title} titleUr={l.titleUr} sub={<Spine>{l.accessionNo}</Spine>} /> },
    { key: "due", header: "Was due", width: 110, render: (l) => <span className="mtb-num">{formatDate(l.dueOn)}</span> },
    { key: "late", header: "Days late", align: "right", render: (l) => <span className={`mtb-num font-medium ${l.daysLate > 30 ? "text-status-overdue-ink" : ""}`}>{l.daysLate}</span> },
    { key: "fine", header: "Fine to date", align: "right", render: (l) => (l.fine > 0 ? <span className="mtb-num">{formatRs(l.fine)}</span> : <span className="text-small text-ink-muted">No fine</span>) },
    {
      key: "rem",
      header: "Last reminder",
      render: (l) =>
        l.lastReminderAt ? (
          <span className="grid">
            <span className="text-small">{formatDateTime(l.lastReminderAt)}</span>
            <span className="text-small text-ink-muted">{l.reminders} held in the outbox</span>
          </span>
        ) : (
          <StatusBadge status="neutral" dot={false}>
            Not reminded
          </StatusBadge>
        ),
    },
  ];

  return (
    <LibraryShell
      title="Overdue books"
      actions={
        <>
          <Button icon="printer" disabled={!rows.length} onClick={() => printer.print(<OverdueList rows={rows} campus={campusLabel(ctx.campus)} />)}>
            Print list
          </Button>
          {canSend && (
            <Button variant="primary" icon="send" disabled={chosen.length === 0} onClick={() => setReminding(true)}>
              Send reminder{chosen.length ? ` (${chosen.length})` : ""}
            </Button>
          )}
        </>
      }
    >
      {q.isError && <LoadError what="Overdue books" error={q.error} onRetry={() => void q.refetch()} />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Overdue books", value: totals.count, icon: "clock" as const, tone: totals.count ? ("danger" as const) : undefined, foot: "Not back by the due date" },
          { label: "Fines so far", value: totals.fines, icon: "fees" as const, money: true, foot: "Worked out from the campus rule" },
          { label: "More than 30 days late", value: totals.long, icon: "alert" as const, tone: totals.long ? ("warning" as const) : undefined, foot: "Consider reporting them lost" },
          { label: "Not reminded this week", value: totals.notReminded, icon: "send" as const, foot: "Select and send a reminder" },
        ].map((k, i) => (
          <div key={k.label} className="mtb-rise" style={slide(i)}>
            <StatCard loading={q.isLoading} label={k.label} icon={k.icon} tone={k.tone} value={<AnimatedNumber value={k.value} format={k.money ? formatRs : formatCount} />} foot={k.foot} />
          </div>
        ))}
      </div>
      <DataTable
        caption="Overdue books"
        rows={rows}
        loading={q.isLoading}
        columns={columns}
        selectable={canSend}
        selected={selected}
        onSelectedChange={setSelected}
        isRowSelectable={(l) => Boolean(l.mobile)}
        toolbar={
          <div className="flex w-full flex-wrap items-end gap-3">
            <Segmented
              aria-label="Borrowers"
              value={type}
              onChange={setType}
              options={[
                { value: "", label: "Everyone" },
                { value: "STUDENT", label: "Students" },
                { value: "STAFF", label: "Staff" },
              ]}
            />
            <div className="min-w-[220px] flex-1">
              <Input label="Search" icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Borrower, class or book" />
            </div>
          </div>
        }
        empty={<EmptyState icon="checkCircle" title="Nothing is overdue" description="Every book is back or not yet due." />}
      />
      {reminding && chosen.length > 0 && (
        <ReminderModal
          rows={chosen}
          onClose={() => setReminding(false)}
          onSent={() => {
            setReminding(false);
            setSelected(new Set());
          }}
        />
      )}
      {printer.element}
    </LibraryShell>
  );
}
