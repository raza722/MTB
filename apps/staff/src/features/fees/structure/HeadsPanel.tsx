import { ApiError, FEE_BILLING_LABEL, feeSetupApi, newIdempotencyKey, type FeeBilling, type FeeHead, type FeeHeadCategory, type FeeHeadInput, type FeeStructure } from "@mtb/api";
import { formatCount, formatRs } from "@mtb/domain";
import { Banner, Button, Checkbox, Input, Panel, Segmented, Select, SidePanel, StatusBadge, Switch, Textarea, Tooltip, useToast } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { className, errorField, errorText, slide } from "../shared";

const CATEGORY_LABEL: Record<FeeHeadCategory, string> = { FEE: "Fee", FINE: "Fine", APPLICATION: "Application (before admission)" };
const PLAN_BILLINGS: FeeBilling[] = ["MONTHLY", "QUARTERLY", "TERMLY", "ANNUAL"];
const OTHER_BILLINGS: FeeBilling[] = ["ON_ADMISSION", "ON_APPLICATION", "WHEN_RAISED"];

interface Draft {
  title: string;
  titleUr: string;
  shortTitle: string;
  category: FeeHeadCategory;
  billing: FeeBilling;
  order: string;
  concessionEligible: boolean;
  lateFine: boolean;
  classes: string[];
  active: boolean;
  note: string;
}

const draftOf = (h: FeeHead | null, nextOrder: number): Draft =>
  h
    ? { title: h.title, titleUr: h.titleUr, shortTitle: h.shortTitle, category: h.category, billing: h.billing, order: String(h.order), concessionEligible: h.concessionEligible, lateFine: h.lateFine, classes: h.classes ?? [], active: h.active, note: h.note }
    : { title: "", titleUr: "", shortTitle: "", category: "FEE", billing: "WHEN_RAISED", order: String(nextOrder), concessionEligible: false, lateFine: false, classes: [], active: true, note: "" };

/** Add or change a fee head (legacy Fee Type Info). One list for every campus. */
function HeadEditor({ structure, head, onClose }: { structure: FeeStructure; head: FeeHead | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const nextOrder = Math.max(0, ...structure.heads.map((h) => h.order)) + 1;
  const [d, setD] = useState<Draft>(() => draftOf(head, nextOrder));
  const [tried, setTried] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const others = structure.heads.filter((h) => h.code !== head?.code);
  const inUse = head?.openCharges ?? 0;
  const lockedOff = Boolean(head?.system) || inUse > 0;
  const planBilling = d.category === "FEE";

  const schema = z.object({
    title: z
      .string()
      .trim()
      .min(3, "Enter the head's title, at least 3 letters.")
      .max(60, "Keep the title to 60 characters.")
      .refine((t) => !others.some((h) => h.title.toLowerCase() === t.toLowerCase()), "There is already a head with this title."),
    shortTitle: z
      .string()
      .trim()
      .min(2, "Enter a short title for vouchers and reports.")
      .max(16, "Keep the short title to 16 characters.")
      .refine((t) => !others.some((h) => h.shortTitle.toLowerCase() === t.toLowerCase()), "Another head already uses this short title."),
    order: z.number({ error: "Enter the order, a whole number." }).int("Use a whole number.").min(1, "Order starts at 1.").max(999, "Order goes up to 999."),
    note: z.string().max(160, "Keep the note to one line (160 characters)."),
    billing: z.string().refine((b) => planBilling || !PLAN_BILLINGS.includes(b as FeeBilling), "Fines and application heads are charged when raised, not on a plan."),
  });
  const parsed = schema.safeParse({ ...d, order: d.order === "" ? undefined : Number(d.order) });
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;

  const body: FeeHeadInput = {
    title: d.title.trim(),
    titleUr: d.titleUr.trim(),
    shortTitle: d.shortTitle.trim(),
    category: d.category,
    billing: d.billing,
    order: Number(d.order),
    concessionEligible: d.category === "FEE" && d.concessionEligible,
    lateFine: d.category === "FEE" && d.lateFine,
    classes: structure.classes.length > 0 && d.classes.length === structure.classes.length ? [] : d.classes,
    active: d.active,
    note: d.note.trim(),
    ...(head ? { rowVer: head.rowVer ?? 1 } : {}),
  };
  const key = useMemo(() => newIdempotencyKey(), [JSON.stringify(body)]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => (head ? feeSetupApi.updateHead(structure.campus, head.code, body, key) : feeSetupApi.createHead(structure.campus, body, key)),
    onSuccess: (h) => {
      void queryClient.invalidateQueries({ queryKey: ["fees", "setup"] });
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast(
        head
          ? { title: `${h.title} saved`, message: h.active ? "The change applies at every campus." : "Switched off: it can't be added to new charges." }
          : { title: `${h.title} added`, message: h.category === "FEE" && h.billing !== "WHEN_RAISED" ? "Give it an amount under a class to start billing it." : "It can now be charged to a student from the fee ledger." },
      );
      onClose();
    },
  });
  // The server answers 409 CONCURRENCY when someone else saved the head first (the mock said CONFLICT).
  const conflict = save.error instanceof ApiError && save.error.status === 409 && (save.error.code === "CONCURRENCY" || save.error.code === "CONFLICT");
  const serverField = errorField(save.error);
  const err = (f: string) => (tried ? (errors[f] ?? (serverField === f ? errorText(save.error) : undefined)) : undefined);
  const toggleClass = (c: string) => set("classes", d.classes.includes(c) ? d.classes.filter((x) => x !== c) : [...d.classes, c]);

  return (
    <SidePanel
      open
      onClose={onClose}
      title={head ? head.title : "New fee head"}
      description="One list for every campus, so reports add up across the school."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            loadingLabel="Saving…"
            onClick={() => {
              setTried(true);
              if (parsed.success) save.mutate();
            }}
          >
            {head ? "Save head" : "Add head"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        {head?.system && <Banner tone="neutral">Built in: you can rename it and change its order or note. Its type and billing stay as they are.</Banner>}
        <Input label="Title" required value={d.title} onChange={(e) => set("title", e.target.value)} error={err("title")} placeholder="For example: Gym fee" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Short title" required value={d.shortTitle} onChange={(e) => set("shortTitle", e.target.value)} error={err("shortTitle")} help="On vouchers and report columns." maxLength={16} />
          <Input label="Order" required inputMode="numeric" value={d.order} onChange={(e) => set("order", e.target.value.replace(/[^\d]/g, ""))} error={err("order")} help="Lists and vouchers follow this order." />
        </div>
        <Input label="Title in Urdu" urdu value={d.titleUr} onChange={(e) => set("titleUr", e.target.value)} help="Printed on Urdu vouchers and the parent portal." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Type"
            required
            disabled={Boolean(head?.system)}
            value={d.category}
            onChange={(e) => {
              const c = e.target.value as FeeHeadCategory;
              setD((p) => ({ ...p, category: c, ...(c !== "FEE" ? { concessionEligible: false, lateFine: false, billing: c === "APPLICATION" ? "ON_APPLICATION" : "WHEN_RAISED" } : {}) }));
            }}
            options={(Object.keys(CATEGORY_LABEL) as FeeHeadCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
          />
          <Select
            label="Billed"
            required
            disabled={Boolean(head?.system)}
            value={d.billing}
            onChange={(e) => set("billing", e.target.value as FeeBilling)}
            options={[...(planBilling ? PLAN_BILLINGS : []), ...OTHER_BILLINGS].map((b) => ({ value: b, label: FEE_BILLING_LABEL[b] }))}
            error={err("billing")}
            help={d.billing === "WHEN_RAISED" ? "Charged to one student at a time from the fee ledger." : PLAN_BILLINGS.includes(d.billing) ? "Billed on the plan's due dates once a class has an amount." : undefined}
          />
        </div>
        {d.category === "FEE" && (
          <div className="grid gap-3 rounded-md border border-border p-3">
            <Switch label="Concessions and scholarships can reduce it" checked={d.concessionEligible} onChange={(e) => set("concessionEligible", e.target.checked)} />
            <Switch label="Late fine runs on it after the due date" checked={d.lateFine} onChange={(e) => set("lateFine", e.target.checked)} />
          </div>
        )}
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mtb-label mb-1">Classes</legend>
          <Segmented
            aria-label="Classes"
            value={d.classes.length === 0 ? "ALL" : "SOME"}
            onChange={(v) => set("classes", v === "ALL" ? [] : structure.classes.slice(-1).map((c) => c.classShort))}
            options={[
              { value: "ALL", label: "Every class" },
              { value: "SOME", label: "Only some classes" },
            ]}
          />
          {d.classes.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {structure.classes.map(({ classShort: c, className: name }) => (
                <Checkbox key={c} label={name} checked={d.classes.includes(c)} onChange={() => toggleClass(c)} />
              ))}
            </div>
          )}
        </fieldset>
        <Textarea label="Note for staff" rows={2} value={d.note} onChange={(e) => set("note", e.target.value)} error={err("note")} placeholder="What it is for, in one line." />
        <div className="grid gap-1.5">
          <Switch label={d.active ? "In use" : "Switched off"} checked={d.active} disabled={d.active && lockedOff} onChange={(e) => set("active", e.target.checked)} />
          <span className="text-small text-ink-muted">
            {head?.system
              ? "Built-in heads stay on."
              : inUse > 0
                ? `${formatCount(inUse)} unpaid ${inUse === 1 ? "charge uses" : "charges use"} it, so it can't be switched off until they are collected or cancelled.`
                : "A switched-off head keeps its history but can't be added to new charges."}
          </span>
        </div>
        {head && (
          <p className="m-0 text-small text-ink-muted">
            Collections under it post to the income account set in{" "}
            <Link to="/accounts/fee-posting" className="text-brand-ink underline-offset-2 hover:underline">
              Accounts → Fee posting
            </Link>
            .
          </p>
        )}
        {save.error && !serverField && (
          <Banner tone="danger" title={conflict ? "Someone else saved this head first." : "Not saved."}>
            {errorText(save.error)}
          </Banner>
        )}
      </div>
    </SidePanel>
  );
}

const CATEGORY_TONE = { FEE: "neutral", FINE: "warning", APPLICATION: "info" } as const;

/** The fee head list with add and edit (legacy Fee Type). */
export function HeadsPanel({ structure, editable }: { structure: FeeStructure; editable: boolean }) {
  const nameOf = (short: string) => structure.classes.find((c) => c.classShort === short)?.className ?? className(short);
  const [editing, setEditing] = useState<FeeHead | "new" | null>(null);
  const [show, setShow] = useState<"active" | "all">("active");
  const heads = structure.heads.filter((h) => show === "all" || h.active);
  const off = structure.heads.filter((h) => !h.active).length;
  return (
    <Panel
      id="heads"
      title="Fee heads"
      description={editable ? "The same list at every campus. Choose a head to change it." : "The same list at every campus, so reports add up across the school."}
      rise={2}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {off > 0 && (
            <Segmented
              aria-label="Show heads"
              value={show}
              onChange={(v) => setShow(v as "active" | "all")}
              options={[
                { value: "active", label: "In use" },
                { value: "all", label: `All (${structure.heads.length})` },
              ]}
            />
          )}
          {editable && (
            <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing("new")}>
              New fee head
            </Button>
          )}
        </div>
      }
    >
      <ul className="m-0 grid list-none gap-2 p-0">
        {heads.map((h, i) => {
          const body = (
            <>
              <div className="grid min-w-0 gap-0.5 text-left">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {h.title}
                  <span className="text-small font-normal text-ink-muted">({h.shortTitle})</span>
                  <span className="urdu-small text-ink-muted" lang="ur" dir="rtl">
                    {h.titleUr}
                  </span>
                </span>
                <span className="text-small text-ink-muted">
                  {h.note}
                  {h.linked === "TRANSPORT" &&
                    (structure.transport ? (
                      <>
                        {" "}
                        {formatRs(structure.transport.from)} – {formatRs(structure.transport.to)} a month on {structure.transport.routes} routes.
                      </>
                    ) : (
                      " Fares are set per route in Transport."
                    ))}
                  {h.classes?.length ? ` Only ${h.classes.map(nameOf).join(", ")}.` : ""}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {!h.active && <StatusBadge status="cancelled">Switched off</StatusBadge>}
                <StatusBadge status={CATEGORY_TONE[h.category]} dot={false}>
                  {FEE_BILLING_LABEL[h.billing]}
                </StatusBadge>
                {h.concessionEligible && (
                  <Tooltip content="Concessions and scholarships reduce it">
                    <span>
                      <StatusBadge status="success" dot={false} icon="award">
                        Concession
                      </StatusBadge>
                    </span>
                  </Tooltip>
                )}
                {h.lateFine && (
                  <Tooltip content="The late fine runs on it after the due date">
                    <span>
                      <StatusBadge status="pending" dot={false} icon="clock">
                        Late fine
                      </StatusBadge>
                    </span>
                  </Tooltip>
                )}
                <span className="text-small text-ink-subtle tabular-nums">#{h.order}</span>
              </div>
            </>
          );
          const cls = `mtb-slide-in grid w-full gap-1 rounded-md border border-border px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] ${h.active ? "" : "bg-surface-sunken"}`;
          return (
            <li key={h.code} style={slide(i)}>
              {editable ? (
                <button type="button" className={`${cls} hover:border-brand`} onClick={() => setEditing(h)} aria-label={`${h.title}: change this head`}>
                  {body}
                </button>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {editing && <HeadEditor structure={structure} head={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}
