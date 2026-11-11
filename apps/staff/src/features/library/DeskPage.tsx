import {
  LIBRARY_CONDITION_LABEL,
  libraryApi,
  libraryQueries,
  newIdempotencyKey,
  type LibraryCondition,
  type LibraryFineAction,
  type LibraryLookup,
  type OperationsPerson,
  CURRENT_SESSION,
} from "@mtb/api";
import { formatDate, formatRs, formatSession } from "@mtb/domain";
import { Banner, Button, ConfirmDialog, DataTable, DatePicker, EmptyState, Icon, Input, KeyValue, Panel, Segmented, Select, Skeleton, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { RequireSingleCampus } from "../../app/shell/page";
import { addDays, errorCode, errorText, languageLabel, LoadError, opsToday, PersonPicker, Spine } from "./common";
import { CopyStatusBadge, LibraryShell, LoanStatus, MemberLink, TitleText } from "./shared";

function CopyCard({ found }: { found: LibraryLookup }) {
  const { copy, title } = found;
  return (
    <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
      <span className="grid h-12 w-12 place-content-center rounded-md bg-brand-tint text-brand-ink" aria-hidden="true">
        <Icon name="book" />
      </span>
      <div className="grid gap-2">
        <TitleText title={title.title} titleUr={title.titleUr} sub={`${title.authors.join(", ")}${title.publisher ? ` · ${title.publisher}` : ""}`} />
        <div className="flex flex-wrap items-center gap-2">
          <Spine>{copy.accessionNo}</Spine>
          <CopyStatusBadge status={copy.status} />
          <span className="text-small text-ink-muted">
            {copy.shelfLabel ?? "No shelf yet"} · {title.category || "—"} · {languageLabel(title.language)} · {LIBRARY_CONDITION_LABEL[copy.condition]}
          </span>
        </div>
      </div>
    </div>
  );
}

function IssueForm({ found, onDone }: { found: LibraryLookup; onDone: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [person, setPerson] = useState<OperationsPerson | null>(null);
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [confirmOverdue, setConfirmOverdue] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const key = useMemo(() => newIdempotencyKey(), [found.copy.id, person?.id]);
  const member = useQuery(libraryQueries.member(ctx, person?.type ?? "STUDENT", person?.id ?? ""));
  const m = member.data;
  const today = opsToday();
  useEffect(() => {
    if (m) setDueOn(addDays(opsToday(), m.policy.loanDays));
  }, [m?.person.id, m?.policy.loanDays]);

  const issue = useMutation({
    mutationFn: (allowOverdue: boolean) => libraryApi.issue(ctx, { copyId: found.copy.id, borrowerType: person!.type, borrowerId: person!.id, dueOn: dueOn!, allowOverdue }, key),
    onSuccess: (loan) => {
      toast({ title: `${loan.title || loan.titleUr} issued to ${loan.borrowerName}`, message: `Due back ${formatDate(loan.dueOn)}. ${loan.accessionNo}` });
      void qc.invalidateQueries({ queryKey: ["library"] });
      setConfirmOverdue(false);
      onDone();
    },
    onError: (e) => {
      if (errorCode(e) === "HAS_OVERDUE") setConfirmOverdue(true);
    },
  });
  const submit = () => {
    const next: Record<string, string> = {};
    if (!person) next.person = "Choose who is borrowing the book.";
    if (!dueOn) next.dueOn = "Choose the date it is due back.";
    else if (dueOn < today) next.dueOn = "The due date can't be in the past.";
    setErr(next);
    if (Object.keys(next).length === 0) issue.mutate(false);
  };
  const blocked = Boolean(m?.blockReason);
  return (
    <div className="grid gap-4">
      <PersonPicker
        label="Borrower"
        value={person}
        onChange={(p) => {
          setPerson(p);
          setErr({});
        }}
        autoFocus
        error={err.person}
        hint={
          person && m ? (
            <span className="text-small text-ink-muted">
              {m.totals.open} of {m.policy.maxLoans} books out
              {m.totals.overdue > 0 ? ` · ${m.totals.overdue} overdue` : ""} · {m.policy.loanDays}-day loans
              {m.policy.ratePerDay > 0 ? ` · ${formatRs(m.policy.ratePerDay)} a day late` : " · no late fine"} ·{" "}
              <MemberLink type={person.type} id={person.id}>
                history
              </MemberLink>
            </span>
          ) : null
        }
      />
      {blocked && <Banner tone="warning" title="This person can't borrow now.">{m!.blockReason}</Banner>}
      {m && m.totals.overdue > 0 && !blocked && (
        <Banner tone="warning" title={`${m.person.name} has ${m.totals.overdue} overdue ${m.totals.overdue === 1 ? "book" : "books"}.`}>
          You can still issue this book; you'll be asked to confirm.
        </Banner>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <DatePicker label="Due back on" value={dueOn} onValueChange={setDueOn} minDate={today} maxDate={addDays(today, 60)} today={today} error={err.dueOn} help={m ? `${m.policy.loanDays} days is the usual loan.` : undefined} />
      </div>
      {issue.isError && errorCode(issue.error) !== "HAS_OVERDUE" && <Banner tone="danger">{errorText(issue.error)}</Banner>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon="arrowRight" loading={issue.isPending} loadingLabel="Issuing…" disabled={blocked || member.isFetching} onClick={submit}>
          Issue book
        </Button>
      </div>
      <ConfirmDialog
        open={confirmOverdue}
        onClose={() => setConfirmOverdue(false)}
        onConfirm={() => issue.mutate(true)}
        tone="warning"
        title={`Issue to ${person?.name ?? ""} anyway?`}
        message={`${person?.name ?? "This borrower"} has an overdue book. Remind them to bring it back; the fine keeps adding up until they do.`}
        confirmLabel="Issue anyway"
        loading={issue.isPending}
        loadingLabel="Issuing…"
      />
    </div>
  );
}

function LoanFacts({ loan }: { loan: NonNullable<LibraryLookup["loan"]> }) {
  return (
    <KeyValue
      items={[
        ["Borrowed by", <MemberLink type={loan.borrowerType} id={loan.borrowerId}>{`${loan.borrowerName} · ${loan.borrowerDetail}`}</MemberLink>],
        ["Issued", `${formatDate(loan.issuedOn)} by ${loan.issuedBy}`],
        ["Due back", formatDate(loan.dueOn)],
        ["Status", <LoanStatus loan={loan} />],
      ]}
    />
  );
}

/**
 * Shown in place of the issue and return forms when the desk is locked (a closed session, or a role that can
 * only look books up). The lookup still works; nothing that changes a loan is on screen.
 */
function LockedView({ found, note }: { found: LibraryLookup; note: string }) {
  const loan = found.loan;
  return (
    <div className="grid gap-4">
      {loan && <LoanFacts loan={loan} />}
      {loan && loan.fine > 0 && (
        <span className="text-small text-ink-muted">
          Late fine so far: <span className="mtb-num">{formatRs(loan.fine)}</span> ({loan.daysLate} days late).
        </span>
      )}
      <Banner tone="info" icon="lock" title={loan ? "On loan. It can't be taken back here." : "On the shelf. It can't be issued here."}>
        {note}
      </Banner>
    </div>
  );
}

function ReturnForm({ found, onDone }: { found: LibraryLookup; onDone: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const loan = found.loan!;
  const isStudent = loan.borrowerType === "STUDENT";
  const [action, setAction] = useState<LibraryFineAction>(isStudent ? "FEES" : "CASH");
  const [note, setNote] = useState("");
  const [condition, setCondition] = useState<LibraryCondition>(found.copy.condition === "NEW" ? "GOOD" : found.copy.condition);
  const [noteErr, setNoteErr] = useState<string | undefined>();
  const [renewTo, setRenewTo] = useState<string | null>(null);
  const today = opsToday();
  const ret = useMutation({
    mutationFn: () => libraryApi.returnLoan(ctx, loan.id, { fineAction: action, note, condition }),
    onSuccess: (l) => {
      toast({
        title: `${l.title || l.titleUr} returned`,
        message: l.fine > 0 ? `${l.daysLate} days late · fine ${formatRs(l.fine)} ${action === "FEES" ? "added to the fee account" : action === "WAIVE" ? "waived" : "paid at the desk"}.` : "On time, no fine.",
      });
      void qc.invalidateQueries({ queryKey: ["library"] });
      void qc.invalidateQueries({ queryKey: ["fees"] });
      onDone();
    },
  });
  const renew = useMutation({
    mutationFn: () => libraryApi.renew(ctx, loan.id, renewTo!),
    onSuccess: (l) => {
      toast({ title: `Renewed until ${formatDate(l.dueOn)}`, message: `${l.title || l.titleUr} stays with ${l.borrowerName}.` });
      void qc.invalidateQueries({ queryKey: ["library"] });
      onDone();
    },
  });
  const submit = () => {
    if (loan.fine > 0 && action === "WAIVE" && note.trim().length < 5) {
      setNoteErr("Say why the fine is waived (a few words).");
      return;
    }
    setNoteErr(undefined);
    ret.mutate();
  };
  return (
    <div className="grid gap-4">
      <LoanFacts loan={loan} />
      {loan.fine > 0 ? (
        <div className="grid gap-3 rounded-md border border-border bg-surface-sunken p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">Late fine</span>
            <span className="text-title-3 mtb-num">{formatRs(loan.fine)}</span>
          </div>
          <span className="text-small text-ink-muted">
            {loan.daysLate} days late, worked out from the campus rule. Nobody types the amount.
          </span>
          <Segmented
            aria-label="How the fine is settled"
            value={action}
            onChange={(v) => setAction(v as LibraryFineAction)}
            options={[...(isStudent ? [{ value: "FEES", label: "Add to fee account" }] : []), { value: "CASH", label: "Paid now" }, { value: "WAIVE", label: "Waive" }]}
          />
          {action === "FEES" && <span className="text-small text-ink-muted">It shows at the fee counter with the next fee and on the family's account.</span>}
          {(action === "WAIVE" || action === "CASH") && (
            <Textarea label={action === "WAIVE" ? "Why is it waived?" : "Note (optional)"} rows={2} value={note} onChange={(e) => setNote(e.target.value)} error={noteErr} required={action === "WAIVE"} />
          )}
        </div>
      ) : loan.daysLate > 0 ? (
        <Banner tone="info">Returned {loan.daysLate} days late. No late fine under the campus rule.</Banner>
      ) : (
        <Banner tone="success" icon="checkCircle">
          On time. No fine.
        </Banner>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Condition now"
          value={condition}
          onChange={(e) => setCondition(e.target.value as LibraryCondition)}
          options={(["GOOD", "WORN", "DAMAGED"] as const).map((c) => ({ value: c, label: LIBRARY_CONDITION_LABEL[c] }))}
          help={condition === "DAMAGED" ? "The copy goes out of circulation until it is repaired." : undefined}
        />
      </div>
      {ret.isError && <Banner tone="danger">{errorText(ret.error)}</Banner>}
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="primary" icon="arrowLeft" loading={ret.isPending} loadingLabel="Taking back…" onClick={submit}>
          Take back{loan.fine > 0 ? ` · ${formatRs(loan.fine)}` : ""}
        </Button>
        {loan.dueOn >= today && (
          <div className="flex flex-wrap items-end gap-2 sm:ml-auto">
            <DatePicker label="Or renew until" value={renewTo} onValueChange={setRenewTo} minDate={addDays(loan.dueOn, 1)} maxDate={addDays(today, 60)} today={today} />
            <Button icon="refresh" disabled={!renewTo} loading={renew.isPending} onClick={() => renew.mutate()}>
              Renew
            </Button>
          </div>
        )}
      </div>
      {renew.isError && <Banner tone="danger">{errorText(renew.error)}</Banner>}
    </div>
  );
}

function TodayList() {
  const ctx = useCtx();
  const today = opsToday();
  const q = useQuery(libraryQueries.loans(ctx, { from: today, to: today }));
  const due = useQuery(libraryQueries.loans(ctx, { status: "OPEN" }));
  const dueToday = (due.data ?? []).filter((l) => l.dueOn === today);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Panel id="desk-today" rise={2} title="Issued today" description="Every book that left the library today." flush={!q.isError}>
        {q.isError ? (
          <LoadError what="Today's loans" error={q.error} onRetry={() => void q.refetch()} />
        ) : (
        <DataTable
          caption="Books issued today"
          rows={q.data ?? []}
          loading={q.isLoading}
          density="dense"
          empty={<EmptyState icon="book" title="Nothing issued yet today" />}
          columns={[
            { key: "title", header: "Book", render: (l) => <TitleText title={l.title} titleUr={l.titleUr} sub={l.accessionNo} /> },
            { key: "who", header: "Borrower", render: (l) => <span className="grid"><span>{l.borrowerName}</span><span className="text-small text-ink-muted">{l.borrowerDetail}</span></span> },
            { key: "due", header: "Due", render: (l) => formatDate(l.dueOn) },
          ]}
        />
        )}
      </Panel>
      <Panel id="desk-due" rise={3} title="Due back today" description="Books that should come back before the end of the day." flush={!due.isError}>
        {due.isError ? (
          <LoadError what="Books due back today" error={due.error} onRetry={() => void due.refetch()} />
        ) : (
        <DataTable
          caption="Books due back today"
          rows={dueToday}
          loading={due.isLoading}
          density="dense"
          empty={<EmptyState icon="checkCircle" title="Nothing due back today" />}
          columns={[
            { key: "title", header: "Book", render: (l) => <TitleText title={l.title} titleUr={l.titleUr} sub={l.accessionNo} /> },
            { key: "who", header: "Borrower", render: (l) => <MemberLink type={l.borrowerType} id={l.borrowerId}>{l.borrowerName}</MemberLink> },
            { key: "class", header: "Class", render: (l) => l.borrowerDetail },
          ]}
        />
        )}
      </Panel>
    </div>
  );
}

export function DeskPage({ accession, setAccession }: { accession: string; setAccession: (v: string) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("library.manage");
  const [typed, setTyped] = useState(accession);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setTyped(accession), [accession]);
  const look = useQuery(libraryQueries.lookup(ctx, accession));
  const found = look.data;
  const reset = () => {
    setAccession("");
    setTyped("");
    window.setTimeout(() => input.current?.focus(), 50);
  };
  // Looking a book up is a read, so the scan box always works. Issuing, taking back and renewing need the
  // current session and library.manage; when either is missing the forms are replaced by a read-only note.
  const lockNote = readOnly
    ? `Session ${formatSession(ctx.session)} is closed, so nothing can be issued, taken back or renewed. Switch to ${formatSession(CURRENT_SESSION)} to use the desk.`
    : !canManage
      ? "Your role can look books up but not issue, take back or renew them. Ask the librarian."
      : null;
  const notFound = look.isError && errorCode(look.error) === "NOT_FOUND";
  const resultTitle = look.isError
    ? notFound
      ? "Book not found"
      : "Look-up failed"
    : !found
      ? look.isLoading
        ? "Looking up the book"
        : "Book"
      : found.loan
        ? lockNote
          ? "On loan"
          : "Coming back"
        : found.copy.status === "AVAILABLE"
          ? lockNote
            ? "On the shelf"
            : "Going out"
          : "Book found";
  const resultDescription =
    !found || lockNote ? undefined : found.loan ? "Check the book, settle any fine and take it back." : found.copy.status === "AVAILABLE" ? "Choose the borrower and the due date." : undefined;

  return (
    <LibraryShell title="Issue and return">
      <RequireSingleCampus action="the library desk">
        <Panel id="desk-scan" rise={0} title="Scan or type the accession number" description="It is on the label on the book's spine. The desk works out whether the book is going out or coming back.">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setAccession(typed.trim());
            }}
          >
            <div className="w-full max-w-[340px]">
              <Input ref={input} label="Accession number" icon="search" mono size="lg" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`${ctx.campus}-L-00001 or 5210`} autoFocus />
            </div>
            <Button type="submit" variant="primary" size="lg" disabled={typed.trim().length < 1}>
              Find book
            </Button>
            <Link to="/library/catalogue" className="text-small font-medium text-brand-ink underline-offset-2 hover:underline">
              No label? Search the catalogue by title
            </Link>
          </form>
          {lockNote && (
            <p className="m-0 mt-3 flex items-start gap-2 text-small text-ink-muted">
              <Icon name="lock" size={14} className="mt-[3px] shrink-0" />
              <span>{lockNote}</span>
            </p>
          )}
        </Panel>

        {accession && (
          <Panel
            id="desk-result"
            rise={1}
            title={resultTitle}
            description={resultDescription}
            actions={
              <Button size="sm" variant="quiet" icon="x" onClick={reset}>
                Clear
              </Button>
            }
          >
            {look.isLoading ? (
              <div className="grid gap-3">
                <Skeleton width="50%" height={20} />
                <Skeleton width="80%" />
                <Skeleton height={120} />
              </div>
            ) : notFound ? (
              <Banner tone="warning" title="Book not found.">
                {errorText(look.error)}
              </Banner>
            ) : look.isError ? (
              <LoadError what="This book" error={look.error} onRetry={() => void look.refetch()} />
            ) : found ? (
              <div className="grid gap-5">
                <CopyCard found={found} />
                {lockNote && (found.loan || found.copy.status === "AVAILABLE") ? (
                  <LockedView found={found} note={lockNote} />
                ) : found.loan ? (
                  <ReturnForm key={found.loan.id} found={found} onDone={reset} />
                ) : found.copy.status === "AVAILABLE" ? (
                  <IssueForm key={found.copy.id} found={found} onDone={reset} />
                ) : (
                  <Banner tone="warning" title={`This copy is marked ${found.copy.status.toLowerCase().replace("_", " ")}.`}>
                    {found.copy.note || "It is out of circulation."} Open it in the catalogue to put it back in use before issuing it.{" "}
                    <Link to="/library/catalogue" search={{ title: found.title.id } as never} className="font-medium text-brand-ink underline-offset-2 hover:underline">
                      Open in the catalogue
                    </Link>
                  </Banner>
                )}
              </div>
            ) : null}
          </Panel>
        )}
        <TodayList />
      </RequireSingleCampus>
    </LibraryShell>
  );
}
