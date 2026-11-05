import { libraryApi, libraryQueries, type LibraryCabinet, type LibraryCategory, type LibraryFinePolicy, type LibraryLibrary, type LibraryNameCount, type LibraryTitle } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatRs } from "@mtb/domain";
import { AmountInput, Banner, Button, Combobox, DataTable, EmptyState, Input, KeyValue, Modal, Panel, Select, SidePanel, Skeleton, StatusBadge, Switch, TabPanel, Tabs, Textarea, Urdu, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { z } from "zod";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { CampusNote, DocHead, errorCode, errorField, errorText, LoadError, slide, StaleNote, usePrinter, validate } from "./common";
import { LibraryShell } from "./shared";

/* ---------------------------------------------------------------- Libraries */

const librarySchema = z.object({
  name: z.string().trim().min(3, { error: 'Enter the library\'s name, for example "Junior library".' }),
  seatingCapacity: z.number({ error: "Enter how many readers it seats." }).int().min(0, { error: "Seats are 0 to 500." }).max(500, { error: "Seats are 0 to 500." }),
  active: z.boolean(),
});

function LibraryForm({ library, onClose }: { library: LibraryLibrary | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(library?.name ?? "");
  const [seats, setSeats] = useState<number | null>(library?.seatingCapacity ?? 30);
  const [active, setActive] = useState(library?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: z.infer<typeof librarySchema>) => libraryApi.saveLibrary(ctx, { ...body, ...(library ? { rowVer: library.rowVer } : {}) }, library?.id),
    onSuccess: (l) => {
      toast({ title: `${l.name} saved` });
      void qc.invalidateQueries({ queryKey: ["library"] });
      onClose();
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const submit = () => {
    const r = validate(librarySchema, { name, seatingCapacity: seats ?? undefined, active });
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    m.mutate(r.data);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={library ? `Edit ${library.name}` : "Add a library"}
      description="A campus can run more than one library. Each cabinet stands in one of them."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={submit}>
            Save library
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="Junior library" />
        <Input label="Seats for readers" inputMode="numeric" value={seats === null ? "" : String(seats)} onChange={(e) => setSeats(e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null)} error={errors.seatingCapacity} />
        <Switch label="In use" checked={active} onChange={(e) => setActive(e.target.checked)} />
        {errors.active && <span className="mtb-error">{errors.active}</span>}
        <StaleNote
          error={m.error}
          onReload={() => {
            void qc.invalidateQueries({ queryKey: ["library"] });
            onClose();
          }}
        />
        {m.isError && !errorField(m.error) && errorCode(m.error) !== "CONCURRENCY" && <Banner tone="danger">{errorText(m.error)}</Banner>}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Cabinets */

const cabinetSchema = z.object({
  libraryId: z.string().min(1, { error: "Choose the library the cabinet stands in." }),
  code: z.string().trim().regex(/^[A-Za-z0-9-]{2,8}$/, { error: "Use a short code such as C-08." }),
  title: z.string().trim().min(2, { error: 'Say what the cabinet holds, for example "Urdu poetry".' }),
  capacity: z.number({ error: "Enter how many books it holds." }).int().min(1, { error: "Enter how many books it holds." }),
  shelves: z.array(z.string().trim().min(1)).min(1, { error: "Add at least one shelf." }),
  active: z.boolean(),
});

function CabinetForm({ cabinet, libraries, onClose }: { cabinet: LibraryCabinet | null; libraries: LibraryLibrary[]; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const usable = libraries.filter((l) => l.active || l.id === cabinet?.libraryId);
  const [libraryId, setLibraryId] = useState(cabinet?.libraryId ?? (usable.length === 1 ? usable[0]!.id : ""));
  const [code, setCode] = useState(cabinet?.code ?? "");
  const [title, setTitle] = useState(cabinet?.title ?? "");
  const [capacity, setCapacity] = useState<number | null>(cabinet?.capacity ?? 180);
  const [shelves, setShelves] = useState((cabinet?.shelves.map((s) => s.label) ?? ["Shelf 1", "Shelf 2", "Shelf 3"]).join("\n"));
  const [active, setActive] = useState(cabinet?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: z.infer<typeof cabinetSchema>) => libraryApi.saveCabinet(ctx, { ...body, code: body.code.toUpperCase(), ...(cabinet ? { rowVer: cabinet.rowVer } : {}) }, cabinet?.id),
    onSuccess: (c) => {
      toast({ title: `Cabinet ${c.code} saved`, message: `${c.shelves.length} shelves in ${c.libraryName}.` });
      void qc.invalidateQueries({ queryKey: ["library"] });
      onClose();
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const submit = () => {
    const r = validate(cabinetSchema, { libraryId, code, title, capacity: capacity ?? undefined, shelves: shelves.split("\n").map((s) => s.trim()).filter(Boolean), active });
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    m.mutate(r.data);
  };
  return (
    <SidePanel
      open
      onClose={onClose}
      title={cabinet ? `Cabinet ${cabinet.code}` : "Add a cabinet"}
      description="Shelves replace the old cabinet-number ranges: name them as they are labelled."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={submit}>
            Save cabinet
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Select label="Library" required value={libraryId} onChange={(e) => setLibraryId(e.target.value)} error={errors.libraryId} options={[{ value: "", label: "Choose…" }, ...usable.map((l) => ({ value: l.id, label: l.active ? l.name : `${l.name} (not in use)` }))]} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} error={errors.code} placeholder="C-08" />
          <Input label="Holds about" inputMode="numeric" suffix="books" value={capacity === null ? "" : String(capacity)} onChange={(e) => setCapacity(e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null)} error={errors.capacity} />
        </div>
        <Input label="What it holds" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
        <Textarea label="Shelves, one per line" rows={5} value={shelves} onChange={(e) => setShelves(e.target.value)} error={errors.shelves} help="A shelf that still holds copies can't be removed; move the copies first." />
        <Switch label="In use" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <StaleNote
          error={m.error}
          onReload={() => {
            void qc.invalidateQueries({ queryKey: ["library"] });
            onClose();
          }}
        />
        {m.isError && !errorField(m.error) && errorCode(m.error) !== "CONCURRENCY" && <Banner tone="danger">{errorText(m.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

const pctFull = (c: LibraryCabinet) => Math.round((c.copies / Math.max(1, c.capacity)) * 100);

/** Cabinet list (legacy "Cabinet info report"): library, cabinet, what it holds, capacity and copies now. */
function CabinetList({ cabinets, subtitle, campus }: { cabinets: LibraryCabinet[]; subtitle: string; campus: string }) {
  const rows = [...cabinets].sort((a, b) => a.libraryName.localeCompare(b.libraryName) || a.code.localeCompare(b.code));
  const cap = rows.reduce((a, c) => a + c.capacity, 0);
  const copies = rows.reduce((a, c) => a + c.copies, 0);
  return (
    <div className="ops-doc">
      <DocHead title="Cabinet list" subtitle={subtitle} campus={campus} />
      <table>
        <thead>
          <tr>
            <th className="n">Sr</th>
            <th>Library</th>
            <th>Cabinet</th>
            <th>What it holds</th>
            <th className="n">Capacity</th>
            <th className="n">Copies now</th>
            <th className="n">% full</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={c.id}>
              <td className="n">{i + 1}</td>
              <td>{c.libraryName}</td>
              <td>
                {c.code}
                {c.active ? "" : " (not in use)"}
              </td>
              <td>{c.title}</td>
              <td className="n">{formatCount(c.capacity)}</td>
              <td className="n">{formatCount(c.copies)}</td>
              <td className="n">{pctFull(c)}%</td>
            </tr>
          ))}
          <tr className="tot">
            <td colSpan={4}>Total ({rows.length} cabinets)</td>
            <td className="n">{formatCount(cap)}</td>
            <td className="n">{formatCount(copies)}</td>
            <td className="n">{cap ? Math.round((copies / cap) * 100) : 0}%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CabinetCard({ c, i, edit }: { c: LibraryCabinet; i: number; edit?: () => void }) {
  const ctx = useCtx();
  return (
    <Panel
      id={`cab-${c.id}`}
      rise={i}
      title={`${c.code} · ${c.title}`}
      description={`${formatCount(c.copies)} of about ${formatCount(c.capacity)} books${ctx.campus === "ALL" ? ` · ${campusLabel(c.campus)}` : ""}`}
      actions={
        edit ? (
          <Button size="sm" variant="quiet" icon="edit" onClick={edit}>
            Edit
          </Button>
        ) : !c.active ? (
          <StatusBadge status="neutral">Not in use</StatusBadge>
        ) : undefined
      }
    >
      <div className="grid gap-2">
        <div className="ops-meter" role="img" aria-label={`${pctFull(c)}% full`}>
          <span style={{ width: `${Math.min(100, pctFull(c))}%` }} />
        </div>
        <ul className="m-0 grid list-none gap-1 p-0 text-small">
          {c.shelves.map((sh) => (
            <li key={sh.id} className="flex justify-between">
              <span>{sh.label}</span>
              <span className="mtb-num text-ink-muted">{sh.copies} copies</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- Subjects */

function SubjectForm({ subject, onClose }: { subject: LibraryCategory | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(subject?.name ?? "");
  const [nameUr, setNameUr] = useState(subject?.nameUr ?? "");
  const [active, setActive] = useState(subject?.active ?? true);
  const [err, setErr] = useState<string | undefined>();
  const m = useMutation({
    mutationFn: () => libraryApi.saveCategory(ctx, { name, nameUr, active }, subject?.id),
    onSuccess: () => {
      toast({ title: `Subject "${name}" saved` });
      void qc.invalidateQueries({ queryKey: ["library"] });
      onClose();
    },
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={subject ? `Edit ${subject.name}` : "Add a subject"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => (name.trim().length < 2 ? setErr("Enter the subject name.") : m.mutate())}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Subject" value={name} onChange={(e) => setName(e.target.value)} error={err} />
        <Input label="Subject in Urdu" urdu value={nameUr} onChange={(e) => setNameUr(e.target.value)} />
        <Switch label="In use" checked={active} onChange={(e) => setActive(e.target.checked)} />
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Fine rules */

const policySchema = z.object({
  loanDays: z.number({ error: "Enter the loan period." }).int().min(1, { error: "Loan period is 1 to 60 days." }).max(60, { error: "Loan period is 1 to 60 days." }),
  graceDays: z.number({ error: "Enter 0 for none." }).int().min(0).max(14, { error: "Days without a fine are 0 to 14." }),
  ratePerDay: z.number({ error: "Enter the fine a day, or 0." }).int().min(0).max(100, { error: "The fine is 0 to Rs 100 a day." }),
  maxLoans: z.number({ error: "Enter how many books at a time." }).int().min(1, { error: "1 to 10 books at a time." }).max(10, { error: "1 to 10 books at a time." }),
  capAtCost: z.boolean(),
});

function PolicyCard({ p, i, editable }: { p: LibraryFinePolicy; i: number; editable: boolean }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState({ loanDays: p.loanDays as number | null, graceDays: p.graceDays as number | null, ratePerDay: p.ratePerDay as number | null, maxLoans: p.maxLoans as number | null, capAtCost: p.capAtCost });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: z.infer<typeof policySchema>) => libraryApi.savePolicy(ctx, { borrowerType: p.borrowerType, ...body }),
    onSuccess: () => {
      toast({ title: `${p.borrowerType === "STUDENT" ? "Student" : "Staff"} rule saved`, message: "It applies to books returned from now on." });
      void qc.invalidateQueries({ queryKey: ["library"] });
      setEdit(false);
    },
  });
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/\D/g, "")));
  const example = (p.ratePerDay > 0 ? `A book 10 days late costs ${formatRs(Math.max(0, 10 - p.graceDays) * p.ratePerDay)}` : "No late fine") + (p.capAtCost ? ", never more than the book's price." : ".");
  return (
    <Panel
      id={`policy-${p.borrowerType}`}
      rise={i}
      title={p.borrowerType === "STUDENT" ? "Students" : "Staff"}
      description={`Changed ${formatDateTime(p.updatedAt)} by ${p.updatedBy}`}
      actions={
        editable && !edit ? (
          <Button size="sm" icon="edit" onClick={() => setEdit(true)}>
            Change
          </Button>
        ) : undefined
      }
    >
      {!edit ? (
        <div className="grid gap-3">
          <KeyValue
            items={[
              ["Loan period", `${p.loanDays} days`],
              ["Days late without a fine", p.graceDays ? `${p.graceDays} days` : "None"],
              ["Fine a day", p.ratePerDay ? formatRs(p.ratePerDay) : "No fine"],
              ["Books at a time", String(p.maxLoans)],
              ["Highest fine", p.capAtCost ? "The book's price" : "No limit"],
            ]}
          />
          <p className="m-0 text-small text-ink-muted">{example}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Loan period" suffix="days" inputMode="numeric" value={d.loanDays ?? ""} onChange={(e) => setD({ ...d, loanDays: num(e.target.value) })} error={errors.loanDays} />
            <Input label="Days late without a fine" suffix="days" inputMode="numeric" value={d.graceDays ?? ""} onChange={(e) => setD({ ...d, graceDays: num(e.target.value) })} error={errors.graceDays} />
            <AmountInput label="Fine a day" value={d.ratePerDay} onValueChange={(v) => setD({ ...d, ratePerDay: v })} error={errors.ratePerDay} />
            <Input label="Books at a time" inputMode="numeric" value={d.maxLoans ?? ""} onChange={(e) => setD({ ...d, maxLoans: num(e.target.value) })} error={errors.maxLoans} />
          </div>
          <Switch label="Never charge more than the book's price" checked={d.capAtCost} onChange={(e) => setD({ ...d, capAtCost: e.target.checked })} />
          {m.isError && <Banner tone="danger">{errorText(m.error)}</Banner>}
          <div className="flex gap-2">
            <Button
              variant="primary"
              loading={m.isPending}
              onClick={() => {
                const r = validate(policySchema, { loanDays: d.loanDays ?? undefined, graceDays: d.graceDays ?? undefined, ratePerDay: d.ratePerDay ?? undefined, maxLoans: d.maxLoans ?? undefined, capAtCost: d.capAtCost });
                if (!r.ok) return setErrors(r.errors);
                setErrors({});
                m.mutate(r.data);
              }}
            >
              Save rule
            </Button>
            <Button variant="quiet" onClick={() => setEdit(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- Authors */

function NameList({ rows, kind, campus }: { rows: LibraryNameCount[]; kind: string; campus: string }) {
  return (
    <div className="ops-doc">
      <DocHead title={`${kind} list`} subtitle={`${rows.length} names, each kept once`} campus={campus} />
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th className="n">Titles</th>
            <th className="n">Copies</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td className="n">{r.titles}</td>
              <td className="n">{r.copies}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Books by author (legacy Authors' List): an author heading with the total copies, then each of their books. */
function BooksByAuthor({ titles, author, campus }: { titles: LibraryTitle[]; author: string; campus: string }) {
  const byAuthor = new Map<string, LibraryTitle[]>();
  for (const t of titles) for (const a of t.authors) if (!author || a === author) byAuthor.set(a, [...(byAuthor.get(a) ?? []), t]);
  const groups = [...byAuthor.entries()].sort(([a], [b]) => a.localeCompare(b));
  let sr = 0;
  return (
    <div className="ops-doc">
      <DocHead title={author ? `Books by ${author}` : "Books by author"} subtitle={`${groups.length} ${groups.length === 1 ? "author" : "authors"} · ${groups.reduce((a, [, ts]) => a + ts.length, 0)} titles`} campus={campus} />
      <table>
        <thead>
          <tr>
            <th className="n">Sr</th>
            <th>Title</th>
            <th>Subject</th>
            <th>Shelf</th>
            <th className="n">Copies</th>
            <th className="n">On shelf</th>
            <th className="n">On loan</th>
            <th>Added on</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([name, ts]) => (
            <Fragment key={name}>
              <tr>
                <th colSpan={4}>{name}</th>
                <th colSpan={4} className="n">
                  Total books: {ts.reduce((a, t) => a + t.copies, 0)}
                </th>
              </tr>
              {[...ts]
                .sort((a, b) => (a.title || a.titleUr).localeCompare(b.title || b.titleUr))
                .map((t) => (
                  <tr key={`${name}-${t.id}`}>
                    <td className="n">{++sr}</td>
                    <td>
                      {t.title}
                      {t.volume ? `, vol. ${t.volume}` : ""}
                      {t.titleUr && <span className="ops-doc-urdu">{t.title ? " · " : ""}{t.titleUr}</span>}
                    </td>
                    <td>{t.category}</td>
                    <td>{t.shelves.join(", ") || "Not shelved"}</td>
                    <td className="n">{t.copies}</td>
                    <td className="n">{t.available}</td>
                    <td className="n">{t.onLoan}</td>
                    <td>{formatDate(t.addedOn)}</td>
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- Page */

export function LibrarySetupPage() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("library.manage") && !readOnly;
  const singleCampus = ctx.campus !== "ALL";
  const navigate = useNavigate();
  const q = useQuery(libraryQueries.setup(ctx));
  const titlesQ = useQuery(libraryQueries.titles(ctx));
  const s = q.data;
  const [tab, setTab] = useState("cabinets");
  const [library, setLibrary] = useState<LibraryLibrary | null | "new">(null);
  const [cabinet, setCabinet] = useState<LibraryCabinet | null | "new">(null);
  const [subject, setSubject] = useState<LibraryCategory | null | "new">(null);
  const [names, setNames] = useState("authors");
  const [libFilter, setLibFilter] = useState("");
  const [author, setAuthor] = useState("");
  const printer = usePrinter();
  const campus = campusLabel(ctx.campus);
  const cabinets = (s?.cabinets ?? []).filter((c) => !libFilter || c.libraryId === libFilter);
  const libGroups = (s?.libraries ?? []).filter((l) => !libFilter || l.id === libFilter).map((l) => ({ l, cabs: cabinets.filter((c) => c.libraryId === l.id) }));

  return (
    <LibraryShell title="Shelves and rules">
      {q.isError && <LoadError what="Library setup" error={q.error} onRetry={() => void q.refetch()} />}
      <Tabs
        aria-label="Library setup"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "cabinets", label: "Cabinets and shelves", icon: "layers", ...(s ? { count: s.cabinets.length } : {}) },
          { id: "libraries", label: "Libraries", icon: "building", ...(s ? { count: s.libraries.length } : {}) },
          { id: "subjects", label: "Subjects", icon: "folder", ...(s ? { count: s.categories.length } : {}) },
          { id: "names", label: "Authors and publishers", icon: "user" },
          { id: "rules", label: "Loan and fine rules", icon: "fees" },
        ]}
      />
      {!s ? (
        q.isError ? null : <Skeleton height={280} />
      ) : (
        <>
          <TabPanel id="cabinets" active={tab === "cabinets"}>
            <div className="grid gap-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <Select label="Library" value={libFilter} onChange={(e) => setLibFilter(e.target.value)} options={[{ value: "", label: "All libraries" }, ...s.libraries.map((l) => ({ value: l.id, label: ctx.campus === "ALL" ? `${l.name} · ${campusLabel(l.campus)}` : l.name }))]} />
                  <p className="m-0 self-center text-small text-ink-muted">
                    Next accession number: <span className="mtb-mono text-ink">{s.nextAccessionNo}</span>. Numbers are given in order and never reused.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button icon="printer" disabled={!cabinets.length} onClick={() => printer.print(<CabinetList cabinets={cabinets} subtitle={`${s.libraries.find((l) => l.id === libFilter)?.name ?? "All libraries"} · ${cabinets.length} cabinets`} campus={campus} />)}>
                    Print cabinet list
                  </Button>
                  {canManage && singleCampus && (
                    <Button variant="primary" icon="plus" onClick={() => setCabinet("new")}>
                      Add a cabinet
                    </Button>
                  )}
                </div>
              </div>
              {libGroups.map(({ l, cabs }) => (
                <section key={l.id} className="grid gap-3">
                  <h3 className="m-0 text-body font-semibold">
                    {l.name}
                    <span className="ml-2 text-small font-normal text-ink-muted">
                      {cabs.length} cabinets · {formatCount(cabs.reduce((a, c) => a + c.copies, 0))} copies{ctx.campus === "ALL" ? ` · ${campusLabel(l.campus)}` : ""}
                      {l.active ? "" : " · not in use"}
                    </span>
                  </h3>
                  {cabs.length === 0 ? (
                    <p className="m-0 text-small text-ink-muted">No cabinets in this library yet.</p>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {cabs.map((c, i) => (
                        <CabinetCard key={c.id} c={c} i={i} {...(canManage && singleCampus ? { edit: () => setCabinet(c) } : {})} />
                      ))}
                    </div>
                  )}
                </section>
              ))}
              {libGroups.length === 0 && <EmptyState icon="building" title="No libraries yet" description="Add a library first, then its cabinets." />}
              <CampusNote />
            </div>
          </TabPanel>

          <TabPanel id="libraries" active={tab === "libraries"}>
            <DataTable
              caption="Libraries"
              rows={s.libraries}
              columns={[
                { key: "name", header: "Library", render: (l) => <span className="grid"><span className="font-medium">{l.name}</span>{ctx.campus === "ALL" && <span className="text-small text-ink-muted">{campusLabel(l.campus)}</span>}</span> },
                { key: "seats", header: "Seats", align: "right", render: (l) => <span className="mtb-num">{formatCount(l.seatingCapacity)}</span> },
                { key: "cabinets", header: "Cabinets", align: "right", render: (l) => <span className="mtb-num">{l.cabinets}</span> },
                { key: "copies", header: "Copies", align: "right", render: (l) => <span className="mtb-num">{formatCount(l.copies)}</span> },
                { key: "active", header: "Status", render: (l) => (l.active ? <StatusBadge status="paid">In use</StatusBadge> : <StatusBadge status="neutral">Not in use</StatusBadge>) },
              ]}
              onRowClick={canManage && singleCampus ? (l) => setLibrary(l) : undefined}
              toolbar={
                <div className="flex w-full flex-wrap items-center justify-between gap-3">
                  <span className="text-small text-ink-muted">Each cabinet stands in one library. The catalogue can show one library at a time.</span>
                  {canManage && singleCampus && (
                    <Button icon="plus" onClick={() => setLibrary("new")}>
                      Add a library
                    </Button>
                  )}
                </div>
              }
              empty={<EmptyState icon="building" title="No libraries yet" />}
            />
          </TabPanel>

          <TabPanel id="subjects" active={tab === "subjects"}>
            <DataTable
              caption="Subjects"
              rows={s.categories}
              columns={[
                { key: "name", header: "Subject", render: (c) => <span className="font-medium">{c.name}</span> },
                { key: "ur", header: "In Urdu", render: (c) => (c.nameUr ? <Urdu size="small">{c.nameUr}</Urdu> : "—") },
                { key: "titles", header: "Titles", align: "right", render: (c) => <span className="mtb-num">{c.titles}</span> },
                { key: "active", header: "Status", render: (c) => (c.active ? <StatusBadge status="paid">In use</StatusBadge> : <StatusBadge status="neutral">Not in use</StatusBadge>) },
              ]}
              onRowClick={canManage ? (c) => setSubject(c) : undefined}
              toolbar={
                canManage ? (
                  <div className="ml-auto">
                    <Button icon="plus" onClick={() => setSubject("new")}>
                      Add a subject
                    </Button>
                  </div>
                ) : undefined
              }
            />
          </TabPanel>

          <TabPanel id="names" active={tab === "names"}>
            <div className="grid gap-4">
              <Banner tone="info" icon="info">
                Each author and publisher is kept once. When a book is added, a name typed with different spacing or capitals is matched to the one already on file, so lists no longer fill up with near-duplicates.
                {names === "authors" ? " Click an author to see their books in the catalogue." : ""}
              </Banner>
              <DataTable
                caption={names === "authors" ? "Authors" : "Publishers"}
                rowKey="name"
                rows={names === "authors" ? s.authors : s.publishers}
                density="dense"
                onRowClick={names === "authors" ? (r) => void navigate({ to: "/library/catalogue", search: { author: r.name } as never }) : undefined}
                columns={[
                  { key: "name", header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
                  { key: "titles", header: "Titles", align: "right", render: (r) => <span className="mtb-num">{r.titles}</span> },
                  { key: "copies", header: "Copies", align: "right", render: (r) => <span className="mtb-num">{r.copies}</span> },
                ]}
                toolbar={
                  <div className="flex w-full flex-wrap items-end justify-between gap-3">
                    <div className="flex gap-2 self-center">
                      <Button size="sm" variant={names === "authors" ? "primary" : "secondary"} onClick={() => setNames("authors")}>
                        Authors ({s.authors.length})
                      </Button>
                      <Button size="sm" variant={names === "publishers" ? "primary" : "secondary"} onClick={() => setNames("publishers")}>
                        Publishers ({s.publishers.length})
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <Button size="sm" icon="printer" onClick={() => printer.print(<NameList rows={names === "authors" ? s.authors : s.publishers} kind={names === "authors" ? "Authors'" : "Publishers'"} campus={campus} />)}>
                        Print list
                      </Button>
                      {names === "authors" && (
                        <>
                          <div className="min-w-[220px]">
                            <Combobox label="Author" options={[{ value: "", label: "Every author" }, ...s.authors.map((a) => ({ value: a.name, label: a.name, hint: `${a.titles} titles` }))]} value={author} onValueChange={setAuthor} placeholder="Every author" searchPlaceholder="Type a name" />
                          </div>
                          <Button size="sm" icon="printer" disabled={!titlesQ.data} onClick={() => printer.print(<BooksByAuthor titles={titlesQ.data ?? []} author={author} campus={campus} />)}>
                            Print books by author
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                }
                empty={<EmptyState title="No names yet" />}
              />
            </div>
          </TabPanel>

          <TabPanel id="rules" active={tab === "rules"}>
            <div className="grid gap-4">
              <Banner tone="info" icon="info">
                The fine is worked out by the system from these rules when a book comes back. Nobody types it in, so the same lateness costs the same at every desk.
                {!singleCampus && " Choose a campus to see or change its rules."}
              </Banner>
              <div className="grid gap-4 md:grid-cols-2">
                {s.policies.map((p, i) => (
                  <div key={p.borrowerType} className="mtb-rise" style={slide(i)}>
                    <PolicyCard p={p} i={i} editable={canManage && singleCampus} />
                  </div>
                ))}
              </div>
            </div>
          </TabPanel>
        </>
      )}
      {library && <LibraryForm library={library === "new" ? null : library} onClose={() => setLibrary(null)} />}
      {cabinet && <CabinetForm cabinet={cabinet === "new" ? null : cabinet} libraries={s?.libraries ?? []} onClose={() => setCabinet(null)} />}
      {subject && <SubjectForm subject={subject === "new" ? null : subject} onClose={() => setSubject(null)} />}
      {printer.element}
    </LibraryShell>
  );
}
