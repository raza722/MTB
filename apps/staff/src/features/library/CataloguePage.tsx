import {
  LIBRARY_CONDITION_LABEL,
  LIBRARY_COPY_STATUS_LABEL,
  LIBRARY_LANGUAGE_LABEL,
  LIBRARY_LANGUAGES,
  libraryApi,
  libraryQueries,
  type LibraryCondition,
  type LibraryCopy,
  type LibraryCopyRow,
  type LibraryLanguage,
  type LibrarySetup,
  type LibraryTitle,
  type LibraryTitleDetail,
  type OperationsPerson,
} from "@mtb/api";
import { formatCount, formatDate, formatRs } from "@mtb/domain";
import {
  AmountInput,
  Banner,
  Button,
  buttonClassName,
  DataTable,
  DatePicker,
  EmptyState,
  Icon,
  Input,
  KeyValue,
  Menu,
  MenuItem,
  MenuLabel,
  Modal,
  Segmented,
  Select,
  SidePanel,
  Skeleton,
  Textarea,
  Urdu,
  useToast,
  type Column,
} from "@mtb/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { CampusNote, DocHead, errorCode, errorField, errorText, LoadError, PersonPicker, Spine, StaleNote, TODAY, usePrinter, validate } from "./common";
import { CopyStatusBadge, LibraryShell, LoanStatus, MemberLink, TitleText } from "./shared";

/* ---------------------------------------------------------------- Title form */

const titleSchema = z
  .object({
    title: z.string().trim(),
    titleUr: z.string().trim(),
    authors: z.array(z.string().trim().min(1)).min(1, { error: "Enter at least one author. Put a comma between two names." }),
    publisher: z.string().trim(),
    categoryId: z.string().min(1, { error: "Choose a subject." }),
    language: z.enum(["EN", "UR", "AR", "PA"]),
    edition: z.string().trim(),
    volume: z.number({ error: "Volume is a number from 1 to 999." }).int({ error: "Volume is a whole number." }).min(1, { error: "Volume is a number from 1 to 999." }).max(999, { error: "Volume is a number from 1 to 999." }).nullable(),
    publisherCountry: z.string().trim().max(60, { error: "Keep the country under 60 letters." }),
    year: z.number().int().min(1800, { error: "Enter the year it was published, for example 2019." }).max(2027, { error: "The year can't be in the future." }).nullable(),
    isbn: z.string().trim().refine((v) => v === "" || /^(\d{9}[\dXx]|\d{13})$/.test(v.replace(/[-\s]/g, "")), { error: "An ISBN has 10 or 13 digits. Leave it empty if the book has none." }),
    pages: z.number().int().min(1, { error: "Pages must be 1 or more." }).nullable(),
  })
  .refine((v) => v.title.length >= 2 || v.titleUr.length >= 2, { error: "Enter the title in English or Urdu.", path: ["title"] });

const copiesSchema = z.object({
  count: z.number({ error: "Enter how many copies." }).int().min(1, { error: "At least 1 copy." }).max(50, { error: "Add up to 50 copies at a time." }),
  shelfId: z.string().nullable(),
  cost: z.number({ error: "Enter the price paid for one copy." }).int().min(0),
  acquiredOn: z.string({ error: "Enter the date the copies arrived." }).min(1, { error: "Enter the date the copies arrived." }),
  condition: z.enum(["NEW", "GOOD", "WORN", "DAMAGED"]),
});

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

interface TitleDraft {
  title: string;
  titleUr: string;
  authors: string;
  publisher: string;
  categoryId: string;
  language: LibraryLanguage;
  edition: string;
  volume: string;
  publisherCountry: string;
  year: string;
  isbn: string;
  pages: string;
  count: number | null;
  shelfId: string;
  cost: number | null;
  acquiredOn: string | null;
  condition: LibraryCondition;
}

function shelfOptions(setup: LibrarySetup | undefined) {
  return [{ value: "", label: "No shelf yet" }, ...(setup?.cabinets ?? []).flatMap((c) => c.shelves.map((s) => ({ value: s.id, label: `${s.fullLabel} (${c.title})` })))];
}

function TitleForm({ existing, setup, onClose, onSaved }: { existing: LibraryTitleDetail | null; setup: LibrarySetup | undefined; onClose: () => void; onSaved: (id: string) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [d, setD] = useState<TitleDraft>(() => ({
    title: existing?.title ?? "",
    titleUr: existing?.titleUr ?? "",
    authors: existing?.authors.join(", ") ?? "",
    publisher: existing?.publisher ?? "",
    categoryId: existing?.categoryId ?? "",
    language: existing?.language ?? "EN",
    edition: existing?.edition ?? "",
    volume: existing?.volume ? String(existing.volume) : "",
    publisherCountry: existing?.publisherCountry ?? "",
    year: existing?.year ? String(existing.year) : "",
    isbn: existing?.isbn ?? "",
    pages: existing?.pages ? String(existing.pages) : "",
    count: 1,
    shelfId: "",
    cost: null,
    acquiredOn: TODAY,
    condition: "NEW",
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const set = <K extends keyof TitleDraft>(k: K, v: TitleDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: (body: Parameters<typeof libraryApi.saveTitle>[1]) => libraryApi.saveTitle(ctx, { ...body, ...(existing ? { rowVer: existing.rowVer } : {}) }, existing?.id),
    onSuccess: (t) => {
      toast({ title: existing ? `${t.title || t.titleUr} updated` : `${t.title || t.titleUr} added`, message: existing ? undefined : `${t.copies} ${t.copies === 1 ? "copy" : "copies"}: ${t.copyList.map((c) => c.accessionNo).slice(0, 3).join(", ")}${t.copies > 3 ? " …" : ""}. Write these on the spine labels.` });
      void qc.invalidateQueries({ queryKey: ["library"] });
      onSaved(t.id);
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f.replace("copies.", "")]: errorText(e) });
      else if (errorCode(e) !== "CONCURRENCY") setBanner(errorText(e));
    },
  });
  const submit = () => {
    setBanner(null);
    const base = validate(titleSchema, {
      title: d.title,
      titleUr: d.titleUr,
      authors: d.authors.split(/[,;]/).map((a) => a.trim()).filter(Boolean),
      publisher: d.publisher,
      categoryId: d.categoryId,
      language: d.language,
      edition: d.edition,
      volume: numOrNull(d.volume),
      publisherCountry: d.publisherCountry,
      year: numOrNull(d.year),
      isbn: d.isbn,
      pages: numOrNull(d.pages),
    });
    const copies = existing ? null : validate(copiesSchema, { count: d.count ?? undefined, shelfId: d.shelfId || null, cost: d.cost ?? undefined, acquiredOn: d.acquiredOn ?? "", condition: d.condition });
    const errs = { ...(base.ok ? {} : base.errors), ...(copies && !copies.ok ? copies.errors : {}) };
    setErrors(errs);
    if (!base.ok || (copies && !copies.ok)) return;
    save.mutate({ ...base.data, ...(copies?.ok ? { copies: copies.data } : {}) });
  };
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={existing ? `Edit ${existing.title || existing.titleUr}` : "Add a book to the catalogue"}
      description={existing ? "Changes apply to every copy of this title." : `Accession numbers are given in order from ${setup?.nextAccessionNo ?? "the next free number"}.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" loading={save.isPending} loadingLabel="Saving…" onClick={submit}>
            {existing ? "Save changes" : "Add to catalogue"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {banner && <Banner tone="danger">{banner}</Banner>}
        <StaleNote
          error={save.error}
          onReload={() => {
            void qc.invalidateQueries({ queryKey: ["library"] });
            onClose();
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Title (English)" value={d.title} onChange={(e) => set("title", e.target.value)} error={errors.title} placeholder="Treasure Island" />
          <Input label="Title (Urdu)" urdu value={d.titleUr} onChange={(e) => set("titleUr", e.target.value)} error={errors.titleUr} help="For Urdu books. Either title is enough." />
          <Input label="Authors" value={d.authors} onChange={(e) => set("authors", e.target.value)} error={errors.authors} list="lib-authors" help="Put a comma between two names. Known names are suggested so an author is kept once." />
          <Input label="Publisher" value={d.publisher} onChange={(e) => set("publisher", e.target.value)} list="lib-publishers" />
          <Input label="Publisher country" value={d.publisherCountry} onChange={(e) => set("publisherCountry", e.target.value)} error={errors.publisherCountry} list="lib-countries" placeholder="Pakistan" />
          <Select label="Subject" required value={d.categoryId} onChange={(e) => set("categoryId", e.target.value)} error={errors.categoryId} options={[{ value: "", label: "Choose…" }, ...(setup?.categories ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))]} />
          <Select label="Language" value={d.language} onChange={(e) => set("language", e.target.value as LibraryLanguage)} options={LIBRARY_LANGUAGES.map((l) => ({ value: l, label: LIBRARY_LANGUAGE_LABEL[l] }))} />
          <Input label="Edition" value={d.edition} onChange={(e) => set("edition", e.target.value)} placeholder="2nd edition" />
          <Input label="Volume" inputMode="numeric" value={d.volume} onChange={(e) => set("volume", e.target.value.replace(/\D/g, "").slice(0, 3))} error={errors.volume} help="For a work in several volumes. Leave empty for a single book." />
          <Input label="Year published" inputMode="numeric" value={d.year} onChange={(e) => set("year", e.target.value.replace(/\D/g, "").slice(0, 4))} error={errors.year} />
          <Input label="ISBN" mono value={d.isbn} onChange={(e) => set("isbn", e.target.value)} error={errors.isbn} help="On the back cover or the barcode. Optional." />
          <Input label="Pages" inputMode="numeric" value={d.pages} onChange={(e) => set("pages", e.target.value.replace(/\D/g, "").slice(0, 5))} error={errors.pages} />
        </div>
        <datalist id="lib-authors">
          {(setup?.authors ?? []).map((a) => (
            <option key={a.name} value={a.name} />
          ))}
        </datalist>
        <datalist id="lib-publishers">
          {(setup?.publishers ?? []).map((a) => (
            <option key={a.name} value={a.name} />
          ))}
        </datalist>
        <datalist id="lib-countries">
          {["Pakistan", "India", "Saudi Arabia", "Egypt", "Iran", "United Kingdom", "United States"].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {!existing && (
          <fieldset className="m-0 grid gap-4 rounded-md border border-border p-4">
            <legend className="px-1 text-small font-semibold">Copies arriving now</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="How many copies" inputMode="numeric" value={d.count === null ? "" : String(d.count)} onChange={(e) => set("count", numOrNull(e.target.value.replace(/\D/g, "")))} error={errors.count} />
              <Select label="Shelf" value={d.shelfId} onChange={(e) => set("shelfId", e.target.value)} options={shelfOptions(setup)} error={errors.shelfId} />
              <AmountInput label="Price of one copy" value={d.cost} onValueChange={(v) => set("cost", v)} error={errors.cost} help="Used as the most a late fine can reach, and for a lost book." />
              <DatePicker label="Arrived on" value={d.acquiredOn} onValueChange={(v) => set("acquiredOn", v)} maxDate={TODAY} today={TODAY} error={errors.acquiredOn} />
              <Select label="Condition" value={d.condition} onChange={(e) => set("condition", e.target.value as LibraryCondition)} options={(["NEW", "GOOD", "WORN"] as const).map((c) => ({ value: c, label: LIBRARY_CONDITION_LABEL[c] }))} />
            </div>
          </fieldset>
        )}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Copy actions */

type CopyAction = { copy: LibraryCopy; kind: "LOST" | "DAMAGED" | "WITHDRAWN" | "AVAILABLE" | "EDIT" };

function CopyActionModal({ action, setup, title, onClose }: { action: CopyAction; setup: LibrarySetup | undefined; title: LibraryTitleDetail; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const { copy, kind } = action;
  const [reason, setReason] = useState("");
  const [charge, setCharge] = useState<"FEES" | "WAIVE">("FEES");
  const [shelfId, setShelfId] = useState(copy.shelfId ?? "");
  const [condition, setCondition] = useState<LibraryCondition>(copy.condition);
  const [note, setNote] = useState(copy.note);
  const [approver, setApprover] = useState<OperationsPerson | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const onLoan = Boolean(copy.loan);
  const writeOff = kind === "LOST" || kind === "DAMAGED" || kind === "WITHDRAWN";
  const studentLoan = onLoan && title.loans.find((l) => l.id === copy.loan?.loanId)?.borrowerType === "STUDENT";
  const m = useMutation({
    mutationFn: () =>
      kind === "EDIT"
        ? libraryApi.updateCopy(ctx, copy.id, { shelfId: shelfId || null, condition, note })
        : libraryApi.setCopyStatus(ctx, copy.id, { status: kind, reason, ...(writeOff && approver ? { approvedById: approver.id } : {}), ...(kind === "LOST" && onLoan ? { charge: studentLoan ? charge : "WAIVE" } : {}) }),
    onSuccess: () => {
      toast({ title: kind === "EDIT" ? `${copy.accessionNo} updated` : kind === "AVAILABLE" ? `${copy.accessionNo} is back in use` : `${copy.accessionNo} marked ${kind.toLowerCase()}`, message: writeOff && approver ? `Approved by ${approver.name}.` : undefined });
      void qc.invalidateQueries({ queryKey: ["library"] });
      void qc.invalidateQueries({ queryKey: ["fees"] });
      onClose();
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const heading = { LOST: "Report lost", DAMAGED: "Mark damaged", WITHDRAWN: "Withdraw from the library", AVAILABLE: "Put back in use", EDIT: "Move or update copy" }[kind];
  const submit = () => {
    const e: Record<string, string> = {};
    if (writeOff && reason.trim().length < 3) e.reason = "Say what happened, in a few words.";
    if (writeOff && !approver) e.approvedById = "Choose the staff member who approved this.";
    setErrors(e);
    if (Object.keys(e).length === 0) m.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${heading}: ${copy.accessionNo}`}
      description={title.title || title.titleUr}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={kind === "LOST" || kind === "WITHDRAWN" ? "danger" : "primary"} loading={m.isPending} onClick={submit}>
            {heading}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {kind === "EDIT" ? (
          <>
            <Select label="Shelf" value={shelfId} onChange={(e) => setShelfId(e.target.value)} options={shelfOptions(setup)} />
            <Select label="Condition" value={condition} onChange={(e) => setCondition(e.target.value as LibraryCondition)} options={(["NEW", "GOOD", "WORN", "DAMAGED"] as const).map((c) => ({ value: c, label: LIBRARY_CONDITION_LABEL[c] }))} />
            <Textarea label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        ) : (
          <>
            {kind === "LOST" && onLoan && (
              <Banner tone="warning" title={`On loan to ${copy.loan!.borrowerName}.`}>
                The loan is closed as lost. The replacement cost is {formatRs(copy.cost)}.
              </Banner>
            )}
            {kind === "LOST" && onLoan && studentLoan && (
              <Segmented
                aria-label="Replacement cost"
                value={charge}
                onChange={(v) => setCharge(v as "FEES" | "WAIVE")}
                options={[
                  { value: "FEES", label: `Add ${formatRs(copy.cost)} to the fee account` },
                  { value: "WAIVE", label: "Don't charge" },
                ]}
              />
            )}
            {(kind === "DAMAGED" || kind === "WITHDRAWN") && onLoan && <Banner tone="warning">This copy is on loan. Take it back at the desk first.</Banner>}
            <Textarea label={kind === "AVAILABLE" ? "Note (optional)" : "What happened"} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} required={kind !== "AVAILABLE"} placeholder={kind === "DAMAGED" ? "Water damage, pages torn" : kind === "WITHDRAWN" ? "Outdated edition, replaced" : ""} />
            {writeOff && <PersonPicker label="Approved by" type="STAFF" value={approver} onChange={setApprover} error={errors.approvedById} hint={<span className="text-small text-ink-muted">The principal or the staff member who agreed to write it off. Recorded with today's date.</span>} />}
            {kind === "AVAILABLE" && copy.writtenOff && (
              <p className="m-0 text-small text-ink-muted">
                Written off on {formatDate(copy.writtenOff.on)}, approved by {copy.writtenOff.approvedBy}. Putting it back clears this.
              </p>
            )}
          </>
        )}
        {m.isError && !errorField(m.error) && <Banner tone="danger">{errorText(m.error)}</Banner>}
      </div>
    </Modal>
  );
}

function AddCopiesForm({ title, setup, onDone }: { title: LibraryTitleDetail; setup: LibrarySetup | undefined; onDone: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const last = title.copyList[title.copyList.length - 1];
  const [count, setCount] = useState<number | null>(1);
  const [shelfId, setShelfId] = useState(last?.shelfId ?? "");
  const [cost, setCost] = useState<number | null>(last?.cost ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: z.infer<typeof copiesSchema>) => libraryApi.addCopies(ctx, title.id, body),
    onSuccess: (t) => {
      const added = t.copyList.filter((c) => !title.copyList.some((x) => x.id === c.id));
      toast({ title: `${added.length} ${added.length === 1 ? "copy" : "copies"} added`, message: `${added.map((c) => c.accessionNo).join(", ")}. Write these on the spine labels.` });
      void qc.invalidateQueries({ queryKey: ["library"] });
      onDone();
    },
  });
  const submit = () => {
    const r = validate(copiesSchema, { count: count ?? undefined, shelfId: shelfId || null, cost: cost ?? undefined, acquiredOn: TODAY, condition: "NEW" });
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    m.mutate(r.data);
  };
  return (
    <div className="grid gap-3 rounded-md border border-border p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Copies" inputMode="numeric" value={count === null ? "" : String(count)} onChange={(e) => setCount(numOrNull(e.target.value.replace(/\D/g, "")))} error={errors.count} />
        <Select label="Shelf" value={shelfId} onChange={(e) => setShelfId(e.target.value)} options={shelfOptions(setup)} />
        <AmountInput label="Price of one" value={cost} onValueChange={setCost} error={errors.cost} />
      </div>
      {m.isError && <Banner tone="danger">{errorText(m.error)}</Banner>}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" icon="plus" loading={m.isPending} onClick={submit}>
          Add copies
        </Button>
        <Button size="sm" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function TitlePanel({ id, setup, onClose, onEdit }: { id: string; setup: LibrarySetup | undefined; onClose: () => void; onEdit: (t: LibraryTitleDetail) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("library.manage") && !readOnly;
  const navigate = useNavigate();
  const q = useQuery(libraryQueries.title(ctx, id));
  const t = q.data;
  const [action, setAction] = useState<CopyAction | null>(null);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState("copies");
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={t ? t.title || t.titleUr : "Loading…"}
      description={t ? `${t.authors.join(", ")} · ${t.category}` : undefined}
      footer={
        canManage && t ? (
          <>
            <Button icon="edit" onClick={() => onEdit(t)}>
              Edit details
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
              Add copies
            </Button>
          </>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <div className="grid gap-3">
          <Skeleton height={20} width="60%" />
          <Skeleton height={140} />
        </div>
      ) : q.isError ? (
        <LoadError what="This title" error={q.error} onRetry={() => void q.refetch()} />
      ) : t ? (
        <div className="grid gap-5">
          {t.titleUr && (
            <Urdu size="title" as="p" className="m-0">
              {t.titleUr}
            </Urdu>
          )}
          <KeyValue
            items={[
              ["Publisher", [t.publisher, t.publisherCountry ? `(${t.publisherCountry})` : ""].filter(Boolean).join(" ") || "—"],
              ["Language", LIBRARY_LANGUAGE_LABEL[t.language]],
              ["Edition, volume and year", [t.edition, t.volume ? `Volume ${t.volume}` : "", t.year].filter(Boolean).join(", ") || "—"],
              ["ISBN", t.isbn ? <span className="mtb-mono">{t.isbn}</span> : "None recorded"],
              ["Pages", t.pages ? formatCount(t.pages) : "—"],
              ["Copies", `${t.available} on the shelf · ${t.onLoan} on loan${t.outOfUse ? ` · ${t.outOfUse} out of use` : ""}`],
            ]}
          />
          {adding && <AddCopiesForm title={t} setup={setup} onDone={() => setAdding(false)} />}
          <Segmented
            aria-label="Show"
            value={tab}
            onChange={setTab}
            options={[
              { value: "copies", label: `Copies (${t.copies})` },
              { value: "history", label: `Borrowing history (${t.loans.length})` },
            ]}
          />
          {tab === "copies" ? (
            <DataTable
              caption="Copies of this title"
              rows={t.copyList}
              density="dense"
              columns={[
                { key: "acc", header: "Accession", render: (c) => <Spine>{c.accessionNo}</Spine> },
                {
                  key: "status",
                  header: "Status",
                  render: (c) => (
                    <span className="grid gap-0.5">
                      <CopyStatusBadge status={c.status} />
                      {c.loan && (
                        <span className="text-small text-ink-muted">
                          {c.loan.borrowerName}, due {formatDate(c.loan.dueOn)}
                        </span>
                      )}
                      {c.writtenOff && (
                        <span className="text-small text-ink-muted">
                          Written off {formatDate(c.writtenOff.on)} · approved by {c.writtenOff.approvedBy}
                        </span>
                      )}
                      {c.note && !c.loan && <span className="text-small text-ink-muted">{c.note}</span>}
                    </span>
                  ),
                },
                { key: "shelf", header: "Shelf", render: (c) => c.shelfLabel ?? <span className="text-ink-subtle">Not shelved</span> },
                { key: "placed", header: "Placed on", render: (c) => (c.placedOn ? <span className="mtb-num">{formatDate(c.placedOn)}</span> : <span className="text-ink-subtle">—</span>) },
                { key: "cond", header: "Condition", render: (c) => LIBRARY_CONDITION_LABEL[c.condition] },
                { key: "loans", header: "Times borrowed", align: "right", render: (c) => <span className="mtb-num">{c.loans}</span> },
                {
                  key: "act",
                  header: <span className="mtb-sr-only">Actions</span>,
                  render: (c) =>
                    canManage ? (
                      <Menu label={`Actions for ${c.accessionNo}`} align="end" trigger={<Button size="sm" variant="quiet" icon="more" aria-label={`Actions for ${c.accessionNo}`} />}>
                        <MenuLabel>{c.accessionNo}</MenuLabel>
                        {c.status === "AVAILABLE" && ctx.campus !== "ALL" && (
                          <MenuItem icon="arrowRight" onSelect={() => void navigate({ to: "/library/desk", search: { accession: c.accessionNo } as never })}>
                            Issue this copy
                          </MenuItem>
                        )}
                        <MenuItem icon="edit" onSelect={() => setAction({ copy: c, kind: "EDIT" })}>
                          Move or update
                        </MenuItem>
                        {c.status !== "LOST" && c.status !== "WITHDRAWN" && (
                          <MenuItem icon="alert" onSelect={() => setAction({ copy: c, kind: "LOST" })}>
                            Report lost
                          </MenuItem>
                        )}
                        {c.status === "AVAILABLE" && (
                          <MenuItem icon="ban" onSelect={() => setAction({ copy: c, kind: "DAMAGED" })}>
                            Mark damaged
                          </MenuItem>
                        )}
                        {c.status === "AVAILABLE" || c.status === "DAMAGED" ? (
                          <MenuItem icon="trash" onSelect={() => setAction({ copy: c, kind: "WITHDRAWN" })}>
                            Withdraw
                          </MenuItem>
                        ) : null}
                        {["DAMAGED", "MISSING", "LOST", "WITHDRAWN"].includes(c.status) && (
                          <MenuItem icon="refresh" onSelect={() => setAction({ copy: c, kind: "AVAILABLE" })}>
                            Put back in use
                          </MenuItem>
                        )}
                      </Menu>
                    ) : null,
                },
              ]}
            />
          ) : t.loans.length === 0 ? (
            <EmptyState icon="book" title="Never borrowed" description="Loans of every copy show here." />
          ) : (
            <DataTable
              caption="Borrowing history"
              rows={t.loans}
              density="dense"
              columns={[
                { key: "acc", header: "Copy", render: (l) => <Spine>{l.accessionNo}</Spine> },
                { key: "who", header: "Borrower", render: (l) => <MemberLink type={l.borrowerType} id={l.borrowerId}>{l.borrowerName}</MemberLink> },
                { key: "out", header: "Issued", render: (l) => formatDate(l.issuedOn) },
                { key: "due", header: "Due", render: (l) => formatDate(l.dueOn) },
                { key: "back", header: "Returned", render: (l) => (l.returnedOn ? formatDate(l.returnedOn) : "—") },
                { key: "st", header: "Status", render: (l) => <LoanStatus loan={l} /> },
              ]}
            />
          )}
          {action && <CopyActionModal action={action} setup={setup} title={t} onClose={() => setAction(null)} />}
        </div>
      ) : null}
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Printouts */

function ShelfList({ titles, setup, libraryId, campus }: { titles: LibraryTitle[]; setup: LibrarySetup; libraryId: string; campus: string }) {
  const libraries = setup.libraries.filter((l) => !libraryId || l.id === libraryId);
  return (
    <div className="ops-doc">
      <DocHead title="Shelf list, cabinet by cabinet" subtitle="Every title with its shelves and copies, library by library." campus={campus} />
      {libraries.map((lib) => {
        const cabs = setup.cabinets.filter((c) => c.libraryId === lib.id && titles.some((t) => t.shelves.some((s) => s.startsWith(`${c.code} ·`))));
        if (cabs.length === 0) return null;
        return (
          <section key={lib.id}>
            <h2>
              {lib.name} ({cabs.length} cabinets, {cabs.reduce((a, c) => a + c.copies, 0)} copies)
            </h2>
            {cabs.map((cab) => (
              <ShelfListCabinet key={cab.id} cab={cab} titles={titles} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function ShelfListCabinet({ cab, titles }: { cab: LibrarySetup["cabinets"][number]; titles: LibraryTitle[] }) {
  const here = titles.filter((t) => t.shelves.some((s) => s.startsWith(`${cab.code} ·`)));
  return (
          <section>
            <h2>
              {cab.code} · {cab.title} ({cab.copies} copies)
            </h2>
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Authors</th>
                  <th>Shelves</th>
                  <th className="n">Copies</th>
                  <th className="n">On shelf</th>
                </tr>
              </thead>
              <tbody>
                {here.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.title}
                      {t.titleUr && <span className="ops-doc-urdu"> · {t.titleUr}</span>}
                    </td>
                    <td>{t.authors.join(", ")}</td>
                    <td>{t.shelves.filter((s) => s.startsWith(`${cab.code} ·`)).map((s) => s.split(" · ")[1]).join(", ")}</td>
                    <td className="n">{t.copies}</td>
                    <td className="n">{t.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
  );
}

/** Every copy, cabinet by cabinet, with when it was placed and any write-off (legacy "Book info cabinet wise"). */
function CopiesByCabinet({ rows, subtitle, campus }: { rows: LibraryCopyRow[]; subtitle: string; campus: string }) {
  const byCabinet = new Map<string, LibraryCopyRow[]>();
  for (const r of rows) byCabinet.set(r.cabinetId ?? "", [...(byCabinet.get(r.cabinetId ?? "") ?? []), r]);
  return (
    <div className="ops-doc">
      <DocHead title="Copies by cabinet" subtitle={`${subtitle} · ${rows.length} copies`} campus={campus} />
      {[...byCabinet.values()].map((list) => {
        const first = list[0]!;
        return (
          <section key={first.cabinetId ?? "none"}>
            <h2>
              {first.cabinetId ? `${first.libraryName} · ${first.cabinetCode} · ${first.cabinetTitle}` : "Not on a shelf"} · total copies {list.length}
            </h2>
            <table>
              <thead>
                <tr>
                  <th className="n">Sr</th>
                  <th>Accession no.</th>
                  <th>Title</th>
                  <th>Subject</th>
                  <th>Shelf</th>
                  <th>Placed on</th>
                  <th>Status</th>
                  <th>Written off on</th>
                  <th>Approved by</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => (
                  <tr key={r.copyId}>
                    <td className="n">{i + 1}</td>
                    <td>{r.accessionNo}</td>
                    <td>
                      {r.title}
                      {r.titleUr && <span className="ops-doc-urdu">{r.title ? " · " : ""}{r.titleUr}</span>}
                    </td>
                    <td>{r.category}</td>
                    <td>{r.shelfLabel || "—"}</td>
                    <td>{r.placedOn ? formatDate(r.placedOn) : "—"}</td>
                    <td>{LIBRARY_COPY_STATUS_LABEL[r.status]}</td>
                    <td>{r.writtenOffOn ? formatDate(r.writtenOffOn) : ""}</td>
                    <td>{r.approvedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

/** Full book list with the bibliographic columns (legacy General Books Report), A4 landscape. */
function GeneralBooksList({ titles, price, subtitle, campus }: { titles: LibraryTitle[]; price: Map<string, number>; subtitle: string; campus: string }) {
  const copies = titles.reduce((a, t) => a + t.copies, 0);
  return (
    <div className="ops-doc">
      <DocHead title="General books list" subtitle={subtitle} campus={campus} />
      <dl className="ops-doc-kv">
        <dt>Total titles</dt>
        <dd>{formatCount(titles.length)}</dd>
        <dt>Total copies</dt>
        <dd>{formatCount(copies)}</dd>
      </dl>
      <table>
        <thead>
          <tr>
            <th className="n">Sr</th>
            <th>Title</th>
            <th>Subject</th>
            <th className="n">Vol.</th>
            <th>Language</th>
            <th>Authors</th>
            <th>Edition</th>
            <th>Publisher</th>
            <th>Country</th>
            <th className="n">Year</th>
            <th className="n">Pages</th>
            <th className="n">Copies</th>
            <th className="n">On shelf</th>
            <th className="n">Price</th>
          </tr>
        </thead>
        <tbody>
          {titles.map((t, i) => (
            <tr key={t.id}>
              <td className="n">{i + 1}</td>
              <td>
                {t.title}
                {t.titleUr && <span className="ops-doc-urdu">{t.title ? " · " : ""}{t.titleUr}</span>}
              </td>
              <td>{t.category}</td>
              <td className="n">{t.volume ?? ""}</td>
              <td>{LIBRARY_LANGUAGE_LABEL[t.language]}</td>
              <td>{t.authors.join(", ")}</td>
              <td>{t.edition}</td>
              <td>{t.publisher}</td>
              <td>{t.publisherCountry}</td>
              <td className="n">{t.year ?? ""}</td>
              <td className="n">{t.pages ?? ""}</td>
              <td className="n">{t.copies}</td>
              <td className="n">{t.available}</td>
              <td className="n">{price.has(t.id) ? formatRs(price.get(t.id)!) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Chooses the cabinet for the copy list, fetches its copies and prints them. */
function CopiesByCabinetModal({ setup, subject, libraryId, onPrint, onClose }: { setup: LibrarySetup; subject: string; libraryId: string; onPrint: (rows: LibraryCopyRow[], subtitle: string) => void; onClose: () => void }) {
  const ctx = useCtx();
  const qc = useQueryClient();
  const [cabinetId, setCabinetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cabinets = setup.cabinets.filter((c) => !libraryId || c.libraryId === libraryId);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const rows = await qc.fetchQuery(libraryQueries.copies(ctx, { cabinetId, categoryId: subject, libraryId }));
      const cab = setup.cabinets.find((c) => c.id === cabinetId);
      const subtitle = [cab ? `${cab.code} · ${cab.title}` : (setup.libraries.find((l) => l.id === libraryId)?.name ?? "Every cabinet"), setup.categories.find((c) => c.id === subject)?.name].filter(Boolean).join(" · ");
      if (rows.length === 0) setErr("No copies in this cabinet for these filters.");
      else {
        onPrint(rows, subtitle);
        onClose();
      }
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Print copies by cabinet"
      description="Every copy with its accession number, shelf, the date it was placed and any write-off. The subject and library filters on the catalogue apply."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="printer" loading={busy} onClick={() => void go()}>
            Print
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Select label="Cabinet" value={cabinetId} onChange={(e) => setCabinetId(e.target.value)} options={[{ value: "", label: "Every cabinet" }, ...cabinets.map((c) => ({ value: c.id, label: `${c.code} · ${c.title} (${c.libraryName})` }))]} />
        {err && <Banner tone="warning">{err}</Banner>}
      </div>
    </Modal>
  );
}

function TitleCount({ titles, campus }: { titles: LibraryTitle[]; campus: string }) {
  return (
    <div className="ops-doc">
      <DocHead title="Copies per title" subtitle={`${titles.length} titles, ${titles.reduce((a, t) => a + t.copies, 0)} copies`} campus={campus} />
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Subject</th>
            <th className="n">Copies</th>
            <th className="n">On shelf</th>
            <th className="n">On loan</th>
            <th className="n">Out of use</th>
          </tr>
        </thead>
        <tbody>
          {titles.map((t) => (
            <tr key={t.id}>
              <td>{t.title || t.titleUr}</td>
              <td>{t.category}</td>
              <td className="n">{t.copies}</td>
              <td className="n">{t.available}</td>
              <td className="n">{t.onLoan}</td>
              <td className="n">{t.outOfUse}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- Page */

export function CataloguePage({ openTitle, setOpenTitle, author = "", setAuthor = () => {} }: { openTitle: string; setOpenTitle: (id: string) => void; author?: string; setAuthor?: (a: string) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("library.manage") && !readOnly && ctx.campus !== "ALL";
  const qc = useQueryClient();
  const q = useQuery({ ...libraryQueries.titles(ctx), placeholderData: keepPreviousData });
  const setupQ = useQuery(libraryQueries.setup(ctx));
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [lang, setLang] = useState("");
  const [avail, setAvail] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [editing, setEditing] = useState<LibraryTitleDetail | null | "new">(null);
  const [copiesFor, setCopiesFor] = useState(false);
  const [printErr, setPrintErr] = useState<string | null>(null);
  const printer = usePrinter();
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? [])
      .filter((t) => !s || `${t.title} ${t.titleUr} ${t.authors.join(" ")} ${t.publisher} ${t.isbn}`.toLowerCase().includes(s))
      .filter((t) => !author || t.authors.includes(author))
      .filter((t) => !subject || t.categoryId === subject)
      .filter((t) => !lang || t.language === lang)
      .filter((t) => !libraryId || t.libraryIds.includes(libraryId))
      .filter((t) => (avail === "SHELF" ? t.available > 0 : avail === "OUT" ? t.available === 0 && t.onLoan > 0 : avail === "UNUSED" ? t.outOfUse > 0 : true));
  }, [q.data, search, author, subject, lang, libraryId, avail]);
  const totals = { titles: rows.length, copies: rows.reduce((a, t) => a + t.copies, 0) };
  const campusName = campusLabel(ctx.campus);
  const anyFilter = Boolean(search || subject || lang || avail || libraryId || author);
  const filterText = [author ? `Books by ${author}` : "", setupQ.data?.libraries.find((l) => l.id === libraryId)?.name, setupQ.data?.categories.find((c) => c.id === subject)?.name, lang ? LIBRARY_LANGUAGE_LABEL[lang as LibraryLanguage] : "", search ? `“${search}”` : ""].filter(Boolean).join(" · ");
  const printGeneral = async () => {
    setPrintErr(null);
    try {
      // The price of one copy: what the latest copy of each title cost.
      const copies = await qc.fetchQuery(libraryQueries.copies(ctx, {}));
      const price = new Map<string, number>();
      for (const c of copies) price.set(c.titleId, c.cost);
      printer.print(<GeneralBooksList titles={rows} price={price} subtitle={filterText || "Every title"} campus={campusName} />, "A4L");
    } catch (e) {
      setPrintErr(errorText(e));
    }
  };

  const columns: Array<Column<LibraryTitle>> = [
    { key: "title", header: "Title", render: (t) => <TitleText title={t.title} titleUr={t.titleUr} sub={t.authors.join(", ")} /> },
    { key: "subject", header: "Subject", render: (t) => <span className="text-small">{t.category}</span> },
    { key: "lang", header: "Language", width: 90, render: (t) => LIBRARY_LANGUAGE_LABEL[t.language] },
    { key: "shelves", header: "Shelf", render: (t) => <span className="text-small text-ink-muted">{t.shelves.join(", ") || "Not shelved"}</span> },
    ...(ctx.campus === "ALL" ? [{ key: "campus", header: "Campus", render: (t: LibraryTitle) => campusLabel(t.campus) }] : []),
    {
      key: "copies",
      header: "On shelf",
      align: "right",
      render: (t) => (
        <span className="grid justify-items-end">
          <span className={`mtb-num font-medium ${t.available === 0 ? "text-status-overdue-ink" : ""}`}>
            {t.available} of {t.copies}
          </span>
          {t.outOfUse > 0 && <span className="text-small text-ink-muted">{t.outOfUse} out of use</span>}
        </span>
      ),
    },
  ];

  return (
    <LibraryShell
      title="Catalogue"
      actions={
        <>
          <Menu
            label="Print"
            align="end"
            trigger={
              <Button icon="printer" disabled={!q.data || !setupQ.data}>
                Print
              </Button>
            }
          >
            <MenuLabel>Print for this campus</MenuLabel>
            <MenuItem icon="layers" onSelect={() => printer.print(<ShelfList titles={rows} setup={setupQ.data!} libraryId={libraryId} campus={campusName} />)}>
              Shelf list (cabinet by cabinet)
            </MenuItem>
            <MenuItem icon="book" onSelect={() => setCopiesFor(true)}>
              Copies by cabinet
            </MenuItem>
            <MenuItem icon="file" onSelect={() => void printGeneral()}>
              General books list
            </MenuItem>
            <MenuItem icon="listChecks" onSelect={() => printer.print(<TitleCount titles={rows} campus={campusName} />)}>
              Copies per title
            </MenuItem>
          </Menu>
          {canManage && (
            <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
              Add a book
            </Button>
          )}
        </>
      }
    >
      {q.isError && <LoadError what="The catalogue" error={q.error} onRetry={() => void q.refetch()} />}
      {printErr && <Banner tone="danger" title="The list couldn't be printed.">{printErr}</Banner>}
      {author && (
        <Banner
          tone="info"
          icon="user"
          title={`Books by ${author}`}
          actions={
            <Button size="sm" onClick={() => setAuthor("")}>
              Show every author
            </Button>
          }
        >
          {formatCount(rows.length)} titles match. Opened from the authors' list.
        </Banner>
      )}
      <DataTable
        caption="Library catalogue"
        rows={rows}
        loading={q.isLoading}
        columns={columns}
        onRowClick={(t) => setOpenTitle(t.id)}
        toolbar={
          <div className="flex w-full flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <Input label="Search" icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title, author, publisher or ISBN" />
            </div>
            {(setupQ.data?.libraries.length ?? 0) > 1 && (
              <Select label="Library" value={libraryId} onChange={(e) => setLibraryId(e.target.value)} options={[{ value: "", label: "All libraries" }, ...(setupQ.data?.libraries ?? []).map((l) => ({ value: l.id, label: ctx.campus === "ALL" ? `${l.name} · ${campusLabel(l.campus)}` : l.name }))]} />
            )}
            <Select label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} options={[{ value: "", label: "All subjects" }, ...(setupQ.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
            <Select label="Language" value={lang} onChange={(e) => setLang(e.target.value)} options={[{ value: "", label: "All" }, ...LIBRARY_LANGUAGES.map((l) => ({ value: l, label: LIBRARY_LANGUAGE_LABEL[l] }))]} />
            <Select
              label="Show"
              value={avail}
              onChange={(e) => setAvail(e.target.value)}
              options={[
                { value: "", label: "Every title" },
                { value: "SHELF", label: "On the shelf now" },
                { value: "OUT", label: "Every copy out" },
                { value: "UNUSED", label: "With copies out of use" },
              ]}
            />
            <span className="ml-auto self-center text-small text-ink-muted">
              {formatCount(totals.titles)} titles · {formatCount(totals.copies)} copies
            </span>
          </div>
        }
        empty={
          <EmptyState
            icon="book"
            title={anyFilter ? "No books match" : "The catalogue is empty"}
            description={anyFilter ? "Clear a filter or check the spelling." : "Add the first book; accession numbers are given automatically."}
            action={
              anyFilter ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setSubject("");
                    setLang("");
                    setAvail("");
                    setLibraryId("");
                    if (author) setAuthor("");
                  }}
                >
                  Clear filters
                </Button>
              ) : canManage ? (
                <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing("new")}>
                  Add a book
                </Button>
              ) : undefined
            }
          />
        }
      />
      <CampusNote />
      {openTitle && !editing && <TitlePanel id={openTitle} setup={setupQ.data} onClose={() => setOpenTitle("")} onEdit={(t) => setEditing(t)} />}
      {editing && (
        <TitleForm
          existing={editing === "new" ? null : editing}
          setup={setupQ.data}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            setOpenTitle(id);
          }}
        />
      )}
      {copiesFor && setupQ.data && (
        <CopiesByCabinetModal setup={setupQ.data} subject={subject} libraryId={libraryId} onClose={() => setCopiesFor(false)} onPrint={(list, subtitle) => printer.print(<CopiesByCabinet rows={list} subtitle={subtitle} campus={campusName} />, "A4")} />
      )}
      {printer.element}
      <p className="m-0 text-small text-ink-muted">
        Copies sold or given away are withdrawn, not deleted, so their borrowing history stays.{" "}
        <Link to="/library/setup" className={buttonClassName({ variant: "ghost", size: "sm" })}>
          <Icon name="settings" size={14} />
          Cabinets, subjects and fine rules
        </Link>
      </p>
    </LibraryShell>
  );
}

