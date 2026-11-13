import { clockTime, setupApi, setupIsEmail, setupIsMobile, setupIsPhone, setupQueries, SETUP_MODULES, type SetupCampus, type SetupCampusInput, type SetupCampusTimings, type SetupModuleCode } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, sessionCode } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, buttonClassName, ConfirmDialog, DataTable, DatePicker, EmptyState, Input, Panel, Segmented, SidePanel, Skeleton, StatusBadge, Switch, Textarea, Urdu, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { z } from "zod";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { apiFieldError, ConflictBanner, conflictOf, EditButton, err, errorText, QueryError, useCanAny, useReadOnlyText, SetupPage, zodErrors, type Conflict, type FieldErrors } from "./shared";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;
const mobile = z.string().trim().refine((v) => v === "" || setupIsMobile(v), { error: "Enter an 11-digit mobile starting with 03, e.g. 0300-5550101." });
/** Office numbers: a landline with its area code, or a mobile. */
const phone = z.string().trim().refine((v) => v === "" || setupIsPhone(v), { error: "Enter a landline with its area code, e.g. 068-5550100, or an 11-digit mobile starting with 03." });

const campusSchema = z.object({
  name: z.string().trim().min(1, { error: "Enter the campus name." }),
  nameUrdu: z.string().trim().min(1, { error: "Enter the campus name in Urdu. It prints on Urdu result cards and certificates." }),
  city: z.string().trim(),
  address: z.string().trim(),
  phone,
  smsPhone: z.string().trim().refine((v) => v === "" || setupIsMobile(v), { error: "Parents call back on a mobile. Enter an 11-digit number starting with 03, e.g. 0300-5550101." }),
  ownerName: z.string().trim().min(1, { error: "Enter who runs the campus, e.g. the trust or society." }).max(80, { error: "Keep it to 80 characters." }),
  foundedOn: z.string().nullable().refine((v) => !v || v <= "2026-11-04", { error: "The start date can't be after today." }),
  phone2: phone,
  mobile1: mobile,
  mobile2: mobile,
  email: z.string().trim().refine((v) => v === "" || setupIsEmail(v), { error: "Enter an email like office@school.pk, or leave it empty." }),
  docPrefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,4}$/, { error: "Use 2 to 4 letters, e.g. KC." }),
  reportHeading: z.string().trim().min(1, { error: "Enter the heading printed on reports." }),
  reportHeadingUrdu: z.string().trim(),
});

type CampusForm = Omit<SetupCampusInput, "rowVer">;

const formOf = (c: SetupCampus): CampusForm => ({
  name: c.name,
  nameUrdu: c.nameUrdu,
  city: c.city,
  address: c.address,
  phone: c.phone,
  smsPhone: c.smsPhone,
  ownerName: c.ownerName,
  foundedOn: c.foundedOn,
  phone2: c.phone2,
  mobile1: c.mobile1,
  mobile2: c.mobile2,
  email: c.email,
  docPrefix: c.docPrefix,
  reportHeading: c.reportHeading,
  reportHeadingUrdu: c.reportHeadingUrdu,
});

/** "07:45 AM to 01:30 PM" */
const span = (t: SetupCampusTimings) => `${clockTime(t.assembly)} to ${clockTime(t.dayEnds)}`;

/** Shown while the campus has no bell timings yet (they come from Timetable › Bell timings). */
const TIMINGS_NOT_SET = "Not set yet, see Timetable › Bell timings.";

/**
 * The campus school day, read from Timetable › Bell timings: one place keeps the bell, so Setup shows it and links
 * there instead of holding its own copy of the times.
 */
function SchoolDay({ campus }: { campus: SetupCampus }) {
  const canOpen = useCan("timetable.view");
  const canChange = useCan("timetable.manage");
  const t = campus.timings;
  const footer = (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-small text-ink-muted">Bell times are kept in one place, Timetable › Bell timings. Teacher attendance and late marks start from them.</span>
      {canOpen && (
        <Link to="/timetable/periods" className={buttonClassName({ size: "sm", variant: "secondary" })}>
          {canChange ? "Change bell timings" : "Open bell timings"}
        </Link>
      )}
    </div>
  );
  if (!t) {
    return (
      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="mtb-label mb-2">School day</legend>
        <p className="m-0 text-small text-ink-muted">{TIMINGS_NOT_SET}</p>
        {footer}
      </fieldset>
    );
  }
  const rows: Array<[string, string]> = [
    ["Assembly", clockTime(t.assembly)],
    ["Period 1", clockTime(t.firstPeriod)],
    ["Break", t.breakStart && t.breakEnd ? `${clockTime(t.breakStart)} to ${clockTime(t.breakEnd)}` : "No break"],
    ["School closes", clockTime(t.dayEnds)],
    ["Friday closes", clockTime(t.fridayEnds)],
  ];
  return (
    <fieldset className="m-0 grid gap-3 border-0 p-0">
      <legend className="mtb-label mb-2">School day</legend>
      <div className="flex flex-wrap items-center gap-2 text-small text-ink-muted">
        <span className="font-medium text-ink">{t.name}</span>
        <StatusBadge status="success">{campus.timingsSeason} in use</StatusBadge>
        <span>
          {t.periods} periods · {t.sections.length} {t.sections.length === 1 ? "class" : "classes"}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-0.5">
            <dt className="text-caption uppercase text-ink-muted">{label}</dt>
            <dd className="m-0 tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {campus.otherTimings.length > 0 && (
        <ul className="m-0 grid gap-1 p-0 text-small" aria-label="Other timings in use">
          {campus.otherTimings.map((o) => (
            <li key={o.name} className="list-none">
              <span className="font-medium text-ink">{o.name}</span>
              <span className="tabular-nums text-ink-muted">
                {" "}
                · {span(o)} · {o.sections.length ? o.sections.join(", ") : "no classes yet"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {footer}
    </fieldset>
  );
}

function CampusEditor({ campus, onClose }: { campus: SetupCampus; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  // The details belong to head office; campus-level setup (the principal) sees them and the school day read-only.
  const details = useCan("setup.manage");
  const [form, setForm] = useState<CampusForm>(() => formOf(campus));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const set = <K extends keyof CampusForm>(k: K, v: CampusForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const save = useMutation({
    mutationFn: () => setupApi.updateCampus(campus.code, { ...form, email: form.email.trim().toLowerCase(), docPrefix: form.docPrefix.toUpperCase(), rowVer: campus.rowVer }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: `${c.name} saved`, message: "Reports and receipts use the new details from now on." });
      onClose();
    },
    onError: (e) => {
      const c = conflictOf(e);
      if (c) return setConflict(c);
      const f = apiFieldError(e);
      if (f) return setErrors(f);
      setFailure(errorText(e));
    },
  });
  // Reloading brings a new rowVer; the editor is keyed by it, so it reopens with the latest values.
  const reload = useMutation({ mutationFn: () => qc.invalidateQueries({ queryKey: ["setup"] }) });

  const submit = () => {
    setFailure(null);
    const r = campusSchema.safeParse(form);
    if (!r.success) return setErrors(zodErrors(r.error));
    save.mutate();
  };

  const sample = `${form.docPrefix.toUpperCase() || "KC"}-${sessionCode(ctx.session)}-004821`;
  return (
    <SidePanel
      open
      onClose={onClose}
      wide
      title={details ? `Edit ${campus.name}` : campus.name}
      description={`Last changed by ${campus.updatedBy}, ${formatDateTime(campus.updatedAt)}`}
      footer={
        details ? (
          <>
            <Button onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button variant="primary" icon="check" onClick={submit} loading={save.isPending} loadingLabel="Saving…" disabled={Boolean(conflict)}>
              Save campus
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="grid gap-5">
        {conflict && <ConflictBanner conflict={conflict} onReload={() => reload.mutate()} reloading={reload.isPending} />}
        {failure && <Banner tone="danger" title="Not saved.">{failure}</Banner>}
        {!details && (
          <Banner tone="info" icon="lock">
            Head office changes the name, numbers and report heading. School-day times are set in Timetable › Bell timings.
          </Banner>
        )}
        <fieldset className="m-0 grid gap-5 border-0 p-0" disabled={!details}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Campus name" required value={form.name} onChange={(e) => set("name", e.target.value)} {...err(errors, "name")} />
            <Input label="Name in Urdu" required urdu value={form.nameUrdu} onChange={(e) => set("nameUrdu", e.target.value)} {...err(errors, "nameUrdu")} />
            <Input label="Run by" required value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} placeholder="The trust or society" {...(errors.ownerName ? { error: errors.ownerName } : { help: "The trust or society that owns the campus." })} />
            <DatePicker label="Started on" value={form.foundedOn} onValueChange={(v) => set("foundedOn", v)} today="2026-11-04" maxDate="2026-11-04" disabled={!details} {...err(errors, "foundedOn")} />
            <Input label="City" value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Not recorded yet" />
            <Input
              label="Document prefix"
              required
              mono
              maxLength={4}
              value={form.docPrefix}
              onChange={(e) => set("docPrefix", e.target.value.toUpperCase())}
              {...(errors.docPrefix ? { error: errors.docPrefix } : { help: <>New receipts and vouchers: <span className="mtb-mono">{sample}</span>. Existing numbers never change.</> })}
            />
          </div>
          <Textarea label="Address" rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Office phone" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="068-5550100" {...(errors.phone ? { error: errors.phone } : { help: "A landline with its area code, or a mobile." })} />
            <Input label="Second phone" inputMode="tel" value={form.phone2} onChange={(e) => set("phone2", e.target.value)} {...(errors.phone2 ? { error: errors.phone2 } : { help: "Optional." })} />
            <Input label="Mobile 1" inputMode="tel" value={form.mobile1} onChange={(e) => set("mobile1", e.target.value)} {...(errors.mobile1 ? { error: errors.mobile1 } : { help: "Optional." })} />
            <Input label="Mobile 2" inputMode="tel" value={form.mobile2} onChange={(e) => set("mobile2", e.target.value)} {...(errors.mobile2 ? { error: errors.mobile2 } : { help: "Optional." })} />
            <Input label="Email" type="email" inputMode="email" autoComplete="off" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="office@school.pk" {...(errors.email ? { error: errors.email } : { help: "Optional. Printed with the phone on certificates and letters." })} />
            <Input label="SMS call-back number" inputMode="tel" value={form.smsPhone} onChange={(e) => set("smsPhone", e.target.value)} {...(errors.smsPhone ? { error: errors.smsPhone } : { help: "Parents call this mobile about a message." })} />
          </div>
          <Input label="Report heading" required value={form.reportHeading} onChange={(e) => set("reportHeading", e.target.value)} {...(errors.reportHeading ? { error: errors.reportHeading } : { help: "Printed at the top of result cards, certificates and reports." })} />
          <Input label="Report heading in Urdu" urdu value={form.reportHeadingUrdu} onChange={(e) => set("reportHeadingUrdu", e.target.value)} />
          <div className="setup-print-preview" aria-label="How the heading prints">
            <div className="text-caption uppercase text-ink-muted">How it prints</div>
            <div className="text-title-3 text-ink">{form.reportHeading || "—"}</div>
            {form.reportHeadingUrdu && (
              <Urdu as="div" size="small">
                {form.reportHeadingUrdu}
              </Urdu>
            )}
          </div>
        </fieldset>
        <SchoolDay campus={campus} />
      </div>
    </SidePanel>
  );
}

function ModulesEditor({ campus, onClose }: { campus: SetupCampus; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const canHeadOffice = useCan("setup.manage");
  const { campus: scope } = useCtx();
  const readOnly = useReadOnly();
  const readOnlyNote = useReadOnlyText();
  const editable = canHeadOffice && scope === "ALL" && !readOnly;
  const [on, setOn] = useState<Set<SetupModuleCode>>(() => new Set(campus.modules));
  const [confirm, setConfirm] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const turningOff = campus.modules.filter((m) => !on.has(m));
  const save = useMutation({
    mutationFn: () => setupApi.setModules(campus.code, { modules: [...on], rowVer: campus.rowVer }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: `Modules saved for ${c.name}`, message: `${c.modules.length} of ${SETUP_MODULES.length} modules on.` });
      setConfirm(false);
      onClose();
    },
    onError: (e) => {
      setConfirm(false);
      const c = conflictOf(e);
      setFailure(c ? `This campus was changed by ${c.by}. Close this panel and open it again to see the latest.` : errorText(e));
    },
  });
  const groups = [...new Set(SETUP_MODULES.map((m) => m.group))];
  const changed = SETUP_MODULES.some((m) => campus.modules.includes(m.code) !== on.has(m.code));
  const name = (c: SetupModuleCode) => SETUP_MODULES.find((m) => m.code === c)?.name ?? c;
  return (
    <SidePanel
      open
      onClose={onClose}
      title={`Modules at ${campus.name}`}
      description="A module that is off disappears from menus at this campus. Its records are kept and come back when it is switched on."
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {editable && (
            <Button variant="primary" icon="check" disabled={!changed} loading={save.isPending} onClick={() => (turningOff.length ? setConfirm(true) : save.mutate())}>
              Save modules
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-5">
        {!editable && <Banner tone="info">{readOnly ? readOnlyNote : canHeadOffice ? "Choose All campuses in the campus switcher to change modules." : "Only head office can switch modules on or off."}</Banner>}
        {failure && <Banner tone="danger" title="Not saved.">{failure}</Banner>}
        {groups.map((g) => (
          <fieldset key={g} className="m-0 grid gap-3 border-0 p-0">
            <legend className="mtb-label mb-1">{g}</legend>
            {SETUP_MODULES.filter((m) => m.group === g).map((m) => (
              <div key={m.code} className="flex items-start justify-between gap-3">
                <div className="grid">
                  <span className="font-medium text-ink">{m.name}</span>
                  <span className="text-small text-ink-muted">{m.description}</span>
                </div>
                {m.core ? (
                  <StatusBadge status="neutral" dot={false}>
                    Always on
                  </StatusBadge>
                ) : (
                  <Switch
                    aria-label={`${m.name} at ${campus.name}`}
                    checked={on.has(m.code)}
                    disabled={!editable}
                    onChange={(e) =>
                      setOn((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(m.code);
                        else n.delete(m.code);
                        return n;
                      })
                    }
                  />
                )}
              </div>
            ))}
          </fieldset>
        ))}
        <p className="m-0 text-small text-ink-muted">Starting switches follow what each campus uses in the old software. Confirm them with each campus before it moves over.</p>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => save.mutate()}
        tone="warning"
        title={`Switch off ${turningOff.length === 1 ? name(turningOff[0]!) : `${turningOff.length} modules`} at ${campus.name}?`}
        message="Staff at this campus will no longer see it in their menus. Nothing is deleted."
        details={turningOff.map((m): [string, string] => [name(m), "Off"])}
        confirmLabel="Switch off"
        loading={save.isPending}
        loadingLabel="Saving…"
      />
    </SidePanel>
  );
}

function CampusCard({ c, i, onEdit, onModules }: { c: SetupCampus; i: number; onEdit: () => void; onModules: () => void }) {
  const canManage = useCan("setup.manage");
  return (
    <Panel
      id={`campus-${c.code}`}
      rise={i}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {c.name}
          {c.isMain && <StatusBadge status="brand">Main campus</StatusBadge>}
        </span>
      }
      description={[c.city || "City not recorded", c.address].filter(Boolean).join(" · ")}
      actions={<span className="mtb-mono rounded-sm bg-surface-sunken px-2 py-0.5 text-small text-ink-muted" title="Document prefix">{c.docPrefix}</span>}
    >
      <div className="grid gap-4">
        <Urdu size="body" className="text-ink-muted">
          {c.nameUrdu}
        </Urdu>
        <div className="grid gap-1 text-small">
          <span className="text-ink-muted">Run by</span>
          <span className="text-ink">
            {c.ownerName || "Not recorded"}
            {c.foundedOn && <span className="text-ink-muted"> · since {formatDate(c.foundedOn)}</span>}
          </span>
          <span className="tabular-nums text-ink-muted">{[c.phone, c.phone2, c.mobile1, c.mobile2].filter(Boolean).join(" · ") || "No office number"}</span>
          {c.email && <span className="text-ink-muted">{c.email}</span>}
        </div>
        <div className="grid gap-1 text-small">
          <span className="text-ink-muted">School day{c.timings && c.timingsSeason ? ` (${c.timingsSeason.toLowerCase()})` : ""}</span>
          <span className={c.timings ? "tabular-nums text-ink" : "text-ink-muted"}>{c.timings ? span(c.timings) : TIMINGS_NOT_SET}</span>
          {c.otherTimings.map((o) => (
            <span key={o.name} className="tabular-nums text-ink-muted">
              {o.name}: {span(o)}
            </span>
          ))}
        </div>
        <div className="setup-campus-figures">
          {(
            [
              ["Students", c.counts.students],
              ["Sections", c.counts.sections],
              ["Staff", c.counts.staff],
              ["Users", c.counts.users],
            ] as const
          ).map(([label, n]) => (
            <div key={label}>
              <span className="text-caption uppercase text-ink-muted">{label}</span>
              <span className="text-title-2 tabular-nums text-ink">
                <AnimatedNumber value={n} format={formatCount} />
              </span>
            </div>
          ))}
        </div>
        <div className="grid gap-1 text-small">
          <span className="text-ink-muted">Report heading</span>
          <span className="text-ink">{c.reportHeading}</span>
        </div>
        <div className="grid gap-1">
          <div className="flex items-baseline justify-between text-small">
            <span className="text-ink-muted">Modules</span>
            <span className="tabular-nums text-ink-muted">
              {c.modules.length} of {SETUP_MODULES.length} on
            </span>
          </div>
          <div className="mtb-meter" role="progressbar" aria-valuenow={c.modules.length} aria-valuemin={0} aria-valuemax={SETUP_MODULES.length} aria-label={`${c.modules.length} of ${SETUP_MODULES.length} modules on`}>
            <span style={{ width: `${(c.modules.length / SETUP_MODULES.length) * 100}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <EditButton size="sm" icon="edit" onClick={onEdit}>
            {canManage ? "Edit details" : "Details and school day"}
          </EditButton>
          <Button size="sm" variant="ghost" icon="layers" onClick={onModules}>
            Modules
          </Button>
        </div>
      </div>
    </Panel>
  );
}

export function CampusesPage() {
  const ctx = useCtx();
  const q = useQuery(setupQueries.campuses(ctx));
  const readOnly = useReadOnly();
  const canEdit = useCanAny(["setup.manage", "setup.campus"]);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [editing, setEditing] = useState<string | null>(null);
  const [modules, setModules] = useState<string | null>(null);
  const campuses = q.data ?? [];
  const editCampus = campuses.find((c) => c.code === editing);
  const moduleCampus = campuses.find((c) => c.code === modules);

  return (
    <SetupPage
      title="Campuses"
      actions={<Segmented aria-label="Show as" value={view} onChange={(v) => setView(v as "cards" | "table")} options={[{ value: "cards", label: "Cards" }, { value: "table", label: "Table" }]} />}
    >
      <Banner tone="neutral" icon="building">
        Every campus works in the same system and sees only its own records. Head office can look at one campus or all of them together from the campus switcher.
      </Banner>
      {q.isError && <QueryError what="The campuses" error={q.error} onRetry={() => void q.refetch()} />}
      {q.isLoading ? (
        <div className="setup-campuses">
          {[0, 1, 2].map((i) => (
            <div key={i} className="mtb-card grid gap-3 p-5">
              <Skeleton width="50%" height={18} />
              <Skeleton height={60} />
              <Skeleton width="70%" />
            </div>
          ))}
        </div>
      ) : campuses.length === 0 && !q.isError ? (
        <div className="mtb-card">
          <EmptyState icon="building" title="No campuses to show" description="Your role covers no campus here. Ask head office if this is wrong." />
        </div>
      ) : view === "cards" ? (
        <div className="setup-campuses">
          {campuses.map((c, i) => (
            <CampusCard key={c.code} c={c} i={i} onEdit={() => setEditing(c.code)} onModules={() => setModules(c.code)} />
          ))}
        </div>
      ) : (
        <Panel id="campus-table" title="All campuses" description="Figures for the current session." flush rise={0}>
          <DataTable
            rows={campuses}
            rowKey="code"
            {...(readOnly || !canEdit ? {} : { onRowClick: (c: SetupCampus) => setEditing(c.code) })}
            columns={[
              { key: "name", header: "Campus", render: (c) => <span className="grid"><span className="font-medium">{c.name}</span><span className="mtb-cell-secondary">{c.city || "City not recorded"}</span></span> },
              { key: "owner", header: "Run by", render: (c) => <span className="text-small">{c.ownerName || "—"}</span> },
              { key: "phone", header: "Office phone", render: (c) => <span className="tabular-nums">{c.phone || "—"}</span> },
              { key: "docPrefix", header: "Prefix", render: (c) => <span className="mtb-mono">{c.docPrefix}</span> },
              { key: "students", header: "Students", align: "right", render: (c) => formatCount(c.counts.students) },
              { key: "sections", header: "Sections", align: "right", render: (c) => formatCount(c.counts.sections) },
              { key: "staff", header: "Staff", align: "right", render: (c) => formatCount(c.counts.staff) },
              { key: "users", header: "Users", align: "right", render: (c) => formatCount(c.counts.users) },
              { key: "modules", header: "Modules on", align: "right", render: (c) => `${c.modules.length} / ${SETUP_MODULES.length}` },
              { key: "updated", header: "Last changed", render: (c) => <span className="text-small text-ink-muted">{c.updatedBy}, {formatDateTime(c.updatedAt)}</span> },
            ]}
            footer={{
              name: <span className="font-medium">Total</span>,
              students: formatCount(campuses.reduce((a, c) => a + c.counts.students, 0)),
              sections: formatCount(campuses.reduce((a, c) => a + c.counts.sections, 0)),
              staff: formatCount(campuses.reduce((a, c) => a + c.counts.staff, 0)),
              users: formatCount(campuses.reduce((a, c) => a + c.counts.users, 0)),
            }}
          />
        </Panel>
      )}
      <p className="m-0 text-small text-ink-muted" style={stagger(0)}>
        Opening a new campus is done with the MTB support team, because it also sets up numbering, fee structure and the move of its old records.
      </p>
      {editCampus && <CampusEditor key={`${editCampus.code}:${editCampus.rowVer}`} campus={editCampus} onClose={() => setEditing(null)} />}
      {moduleCampus && <ModulesEditor key={`${moduleCampus.code}:${moduleCampus.rowVer}`} campus={moduleCampus} onClose={() => setModules(null)} />}
    </SetupPage>
  );
}
