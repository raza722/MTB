import {
  activitiesApi,
  activitiesQueries,
  ACTIVITIES_FEE_HEAD_LABEL,
  ACTIVITIES_FEE_HEADS,
  ACTIVITIES_SCHEME_KIND_LABEL,
  ACTIVITIES_SCHEME_KINDS,
  metaQueries,
  type ActivitiesBasis,
  type ActivitiesFeeHead,
  type ActivitiesMeritBand,
  type ActivitiesScheme,
  type ActivitiesSchemeInput,
  type ActivitiesSchemeKind,
} from "@mtb/api";
import { formatCount, formatRs, formatSession } from "@mtb/domain";
import { Banner, Button, Checkbox, DataTable, EmptyState, IconButton, Input, Panel, Segmented, Select, SidePanel, StatusBadge, Switch, Textarea, Urdu, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCtx, useReadOnly } from "../../app/session";
import { ActivitiesNav, errorField, errorText, LoadError, useCanEditSchemes, useRefresh } from "./shared";

/** Classes a merit band can be limited to. */

const renewalText = (s: ActivitiesScheme) => {
  const parts = [s.renewal.minResultPercent !== null ? `result ${s.renewal.minResultPercent}%+` : null, s.renewal.minAttendancePercent !== null ? `attendance ${s.renewal.minAttendancePercent}%+` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : "Continues automatically";
};

/** The scholarship and concession schemes every campus uses (the old Scholarship Info and Merit Scholarship Info screens). */
export function SchemesPage() {
  const ctx = useCtx();
  const isAdmin = useCanEditSchemes();
  const readOnly = useReadOnly();
  const canEdit = isAdmin && !readOnly;
  const schemes = useQuery(activitiesQueries.schemes(ctx));
  const [editing, setEditing] = useState<ActivitiesScheme | "new" | null>(null);
  const [show, setShow] = useState<"ACTIVE" | "ALL">("ACTIVE");
  const rows = (schemes.data ?? []).filter((s) => show === "ALL" || s.active);

  const columns: Array<Column<ActivitiesScheme>> = [
    {
      key: "name",
      header: "Scheme",
      render: (s) => (
        <span className="grid">
          <span className="mtb-cell-primary">{s.name}</span>
          {s.nameUrdu && <Urdu size="small">{s.nameUrdu}</Urdu>}
        </span>
      ),
    },
    { key: "kind", header: "Kind", width: 170, render: (s) => ACTIVITIES_SCHEME_KIND_LABEL[s.kind] },
    {
      key: "value",
      header: "Relief",
      width: 220,
      render: (s) => (
        <span className="grid">
          <span>{s.basis === "FIXED" ? `${formatRs(s.value)} a month` : s.meritBands.length ? `${Math.min(...s.meritBands.map((b) => b.value))}–${Math.max(...s.meritBands.map((b) => b.value))}% by marks` : `${s.value}%`}</span>
          <span className="mtb-cell-secondary">off {s.feeHeads.map((h) => ACTIVITIES_FEE_HEAD_LABEL[h].replace(/ \(.*\)$/, "").toLowerCase()).join(", ")}</span>
        </span>
      ),
    },
    { key: "renewal", header: "Renewal", width: 210, render: (s) => <span className="text-small">{renewalText(s)}</span> },
    { key: "awards", header: "Awards", align: "right", width: 90, render: (s) => <span className="mtb-num">{formatCount(s.awards)}</span> },
    { key: "relief", header: "Off a month", align: "right", width: 120, render: (s) => <span className="mtb-num">{formatRs(s.monthlyRelief)}</span> },
    { key: "status", header: "Status", width: 120, render: (s) => (s.active ? <StatusBadge status="success">In use</StatusBadge> : <StatusBadge status="neutral">Switched off</StatusBadge>) },
  ];

  return (
    <Page>
      <PageHeader
        title="Scholarship schemes"
        context={`Shared by every campus · awards counted for ${campusLabel(ctx.campus)}, session ${formatSession(ctx.session)}`}
        actions={
          canEdit ? (
            <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
              Add scheme
            </Button>
          ) : undefined
        }
      />
      <ActivitiesNav />
      {!isAdmin && (
        <Banner tone="info" title="Schemes are the same at every campus">
          Only the all-campus admin can add or change a scheme, so a concession means the same thing everywhere. You can open any scheme to read its rules.
        </Banner>
      )}
      {schemes.isError && <LoadError what="Schemes" error={schemes.error} onRetry={() => void schemes.refetch()} />}
      <Panel
        id="schemes"
        title="Schemes"
        description="Who qualifies, how much comes off which fee, and what is checked before an award is renewed."
        rise={0}
        flush
        actions={
          <Segmented
            aria-label="Show"
            value={show}
            onChange={(v) => setShow(v as typeof show)}
            options={[
              { value: "ACTIVE", label: "In use" },
              { value: "ALL", label: "All" },
            ]}
          />
        }
      >
        <DataTable caption="Scholarship schemes" columns={columns} rows={rows} loading={schemes.isLoading} onRowClick={(s) => setEditing(s)} empty={<EmptyState icon="layers" title="No schemes" description="Add the first scheme, for example Merit or Need-based." />} />
      </Panel>
      {editing && <SchemePanel scheme={editing === "new" ? null : editing} readOnly={!canEdit} onClose={() => setEditing(null)} />}
    </Page>
  );
}

const schemeSchema = z.object({
  name: z.string().trim().min(3, "Give the scheme a name, for example “Merit scholarship”."),
  value: z.number({ error: "Enter the usual figure." }),
  criteria: z.string().trim().min(10, "Say who qualifies, in a sentence."),
  feeHeads: z.array(z.string()).min(1, "Tick at least one fee."),
});

function SchemePanel({ scheme, readOnly, onClose }: { scheme: ActivitiesScheme | null; readOnly: boolean; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const refresh = useRefresh();
  const [f, setF] = useState({
    name: scheme?.name ?? "",
    nameUrdu: scheme?.nameUrdu ?? "",
    kind: scheme?.kind ?? ("NEED" as ActivitiesSchemeKind),
    basis: scheme?.basis ?? ("PERCENT" as ActivitiesBasis),
    value: String(scheme?.value ?? 25),
    feeHeads: scheme?.feeHeads ?? (["TUITION"] as ActivitiesFeeHead[]),
    criteria: scheme?.criteria ?? "",
    evidence: (scheme?.evidence ?? []).join("\n"),
    bands: (scheme?.meritBands ?? []).map((b) => ({ from: String(b.fromPercent), to: String(b.toPercent), value: String(b.value), cls: b.classShort ?? "" })),
    minResult: scheme?.renewal.minResultPercent?.toString() ?? "",
    minAttendance: scheme?.renewal.minAttendancePercent?.toString() ?? "",
    renewalNote: scheme?.renewal.note ?? "",
    seats: scheme?.seatsPerClass?.toString() ?? "",
    needsTest: scheme?.needsTest ?? false,
    active: scheme?.active ?? true,
  });
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const fixed = f.basis === "FIXED";
  // Fees holds a concession as a percentage only, so the server refuses fixed-rupee schemes for now (spec 09 D4, C1):
  // the choice is offered only for a scheme that already is one.
  const offerFixed = scheme?.basis === "FIXED";
  // Merit bands can be limited to any class the campus (or, with "All campuses", any campus) teaches.
  const classes = useQuery(metaQueries.classes(ctx.campus));
  const bandClasses = [...new Set([...(classes.data ?? []).map((c) => c.short), ...f.bands.map((b) => b.cls).filter(Boolean)])];
  const classLabel = (short: string) => classes.data?.find((c) => c.short === short)?.name ?? (/^\d+$/.test(short) ? `Class ${short}` : short);
  const check = schemeSchema.safeParse({ name: f.name, value: f.value === "" ? undefined : Number(f.value), criteria: f.criteria, feeHeads: fixed ? ["TUITION"] : f.feeHeads });
  const errs: Record<string, string> = check.success ? {} : Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message]));
  const v = Number(f.value);
  if (f.value !== "" && !fixed && (v < 1 || v > 100)) errs.value = "Enter a percentage from 1 to 100.";
  if (f.value !== "" && fixed && (!Number.isInteger(v) || v < 100)) errs.value = "Enter whole rupees, at least Rs 100.";
  const bands: ActivitiesMeritBand[] = f.bands.map((b) => ({ fromPercent: Number(b.from), toPercent: Number(b.to), value: Number(b.value), ...(b.cls ? { classShort: b.cls } : {}) }));
  if (bands.some((b) => !(b.fromPercent < b.toPercent) || b.value < 1 || b.value > 100)) errs.bands = "Each band needs “from” below “to” and a % off from 1 to 100.";

  const save = useMutation({
    mutationFn: () => {
      const body: ActivitiesSchemeInput = {
        name: f.name.trim(),
        nameUrdu: f.nameUrdu.trim(),
        kind: f.kind,
        basis: f.basis,
        value: v,
        feeHeads: fixed ? ["TUITION"] : f.feeHeads,
        criteria: f.criteria.trim(),
        evidence: f.evidence.split("\n").map((x) => x.trim()).filter(Boolean),
        meritBands: bands,
        renewal: { minResultPercent: f.minResult === "" ? null : Number(f.minResult), minAttendancePercent: f.minAttendance === "" ? null : Number(f.minAttendance), note: f.renewalNote.trim() },
        seatsPerClass: f.seats === "" ? null : Number(f.seats),
        needsTest: f.needsTest,
        active: f.active,
      };
      return activitiesApi.saveScheme(ctx, body, scheme?.id);
    },
    onSuccess: (s) => {
      refresh();
      toast({ title: scheme ? "Scheme saved" : "Scheme added", message: `${s.name}. Every campus uses the new rules for awards from now on.` });
      onClose();
    },
  });
  const sf = save.isError ? errorField(save.error) : undefined;
  const err = (k: string) => (tried ? errs[k] : undefined) ?? (sf === k ? errorText(save.error) : undefined);

  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={readOnly ? (scheme?.name ?? "Scheme") : scheme ? `Edit ${scheme.name}` : "Add scheme"}
      description={scheme ? `${formatCount(scheme.awards)} approved and ${formatCount(scheme.pending)} waiting at ${campusLabel(ctx.campus)} this session. Changes apply to new awards; existing awards keep their figure.` : "Shared by every campus."}
      footer={
        readOnly ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              loading={save.isPending}
              onClick={() => {
                setTried(true);
                if (Object.keys(errs).length === 0) save.mutate();
              }}
            >
              {scheme ? "Save" : "Add scheme"}
            </Button>
          </>
        )
      }
    >
      <fieldset disabled={readOnly} className="m-0 grid gap-4 border-0 p-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" required value={f.name} onChange={(e) => set({ name: e.target.value })} error={err("name")} />
          <Input label="Name in Urdu" urdu value={f.nameUrdu} onChange={(e) => set({ nameUrdu: e.target.value })} help="Printed on Urdu award letters." />
        </div>
        <div className={offerFixed ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
          <Select label="Kind" value={f.kind} onChange={(e) => set({ kind: e.target.value as ActivitiesSchemeKind, needsTest: e.target.value === "MERIT" ? true : f.needsTest })} options={ACTIVITIES_SCHEME_KINDS.map((k) => ({ value: k, label: ACTIVITIES_SCHEME_KIND_LABEL[k] }))} />
          {offerFixed && (
          <div className="grid gap-1">
            <span className="mtb-label">Relief is</span>
            <Segmented
              aria-label="Relief is"
              value={f.basis}
              onChange={(b) => set({ basis: b as ActivitiesBasis, value: b === "FIXED" ? "1000" : "25", feeHeads: b === "FIXED" ? ["TUITION"] : f.feeHeads })}
              options={[
                { value: "PERCENT", label: "A percentage" },
                { value: "FIXED", label: "Fixed rupees a month" },
              ]}
            />
          </div>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={fixed ? "Off the tuition each month" : "Usual percentage off"} required amount inputMode="numeric" prefix={fixed ? "Rs" : undefined} suffix={fixed ? undefined : "%"} value={f.value} onChange={(e) => set({ value: e.target.value.replace(/\D/g, "") })} error={err("value")} help="Each award can differ; this is the starting figure." />
          <Input label="Most awards per class" inputMode="numeric" value={f.seats} onChange={(e) => set({ seats: e.target.value.replace(/\D/g, "") })} help="Leave empty for no limit." error={err("seatsPerClass")} />
        </div>
        {!fixed && (
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mtb-label mb-1">Fees it takes money off</legend>
            {ACTIVITIES_FEE_HEADS.map((h) => (
              <Checkbox key={h} label={ACTIVITIES_FEE_HEAD_LABEL[h]} checked={f.feeHeads.includes(h)} onChange={(e) => set({ feeHeads: e.target.checked ? [...f.feeHeads, h] : f.feeHeads.filter((x) => x !== h) })} />
            ))}
            {err("feeHeads") && <span className="mtb-error">{err("feeHeads")}</span>}
          </fieldset>
        )}
        <Textarea label="Who qualifies" required rows={3} value={f.criteria} onChange={(e) => set({ criteria: e.target.value })} error={err("criteria")} />
        <Textarea label="Documents to keep on file" rows={3} value={f.evidence} onChange={(e) => set({ evidence: e.target.value })} help="One per line, for example “Hifz certificate (sanad)”." />

        {(f.kind === "MERIT" || f.bands.length > 0) && !fixed && (
          <section className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="mtb-label">Merit bands: marks → % off</span>
              {!readOnly && (
                <Button size="sm" icon="plus" onClick={() => set({ bands: [...f.bands, { from: "", to: "", value: "", cls: "" }] })}>
                  Add band
                </Button>
              )}
            </div>
            {f.bands.length === 0 && <p className="m-0 text-small text-ink-muted">No bands: every qualifier gets the usual percentage.</p>}
            {f.bands.map((b, i) => (
              <div key={i} className="grid grid-cols-[1.2fr_1fr_1fr_1fr_auto] items-end gap-2">
                <Select label={i === 0 ? "Class" : undefined} aria-label="Class" value={b.cls} disabled={readOnly} onChange={(e) => set({ bands: f.bands.map((x, j) => (j === i ? { ...x, cls: e.target.value } : x)) })} options={[{ value: "", label: "Every class" }, ...bandClasses.map((c) => ({ value: c, label: classLabel(c) }))]} />
                <Input label={i === 0 ? "Marks from" : undefined} aria-label="Marks from" suffix="%" inputMode="decimal" value={b.from} onChange={(e) => set({ bands: f.bands.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} />
                <Input label={i === 0 ? "to" : undefined} aria-label="Marks to" suffix="%" inputMode="decimal" value={b.to} onChange={(e) => set({ bands: f.bands.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} />
                <Input label={i === 0 ? "% off" : undefined} aria-label="Percentage off" suffix="%" inputMode="numeric" value={b.value} onChange={(e) => set({ bands: f.bands.map((x, j) => (j === i ? { ...x, value: e.target.value.replace(/\D/g, "") } : x)) })} />
                {!readOnly && <IconButton icon="trash" label={`Remove band ${i + 1}`} onClick={() => set({ bands: f.bands.filter((_, j) => j !== i) })} />}
              </div>
            ))}
            {(err("bands") || err("meritBands")) && <span className="mtb-error">{err("bands") ?? err("meritBands")}</span>}
            <p className="m-0 text-small text-ink-muted">The merit list suggests each student's award from these bands. A class with bands of its own uses them; other classes use the “Every class” bands. In the old system the bands were kept but never used.</p>
          </section>
        )}

        <section className="grid gap-2">
          <span className="mtb-label">Renewal: checked before the next session</span>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Latest result at least" suffix="%" inputMode="numeric" value={f.minResult} onChange={(e) => set({ minResult: e.target.value.replace(/\D/g, "") })} help="Empty = not checked." />
            <Input label="Attendance at least" suffix="%" inputMode="numeric" value={f.minAttendance} onChange={(e) => set({ minAttendance: e.target.value.replace(/\D/g, "") })} help="Empty = not checked." />
          </div>
          <Input label="Other condition" value={f.renewalNote} onChange={(e) => set({ renewalNote: e.target.value })} placeholder="For example: continues while the parent works at MTB." />
        </section>

        <Checkbox label="Given only from a scholarship test's merit list" checked={f.needsTest} onChange={(e) => set({ needsTest: e.target.checked })} />
        <Switch label={f.active ? "In use: can be chosen for new awards" : "Switched off: kept for old awards only"} checked={f.active} onChange={(e) => set({ active: e.target.checked })} />
        {save.isError && !sf && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </fieldset>
    </SidePanel>
  );
}
