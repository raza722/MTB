import {
  ApiError,
  newIdempotencyKey,
  studentFamiliesApi,
  studentFamiliesQueries,
  studentsQueries,
  type StudentFamilyDetail,
  type StudentFamilyGuardian,
  type StudentFamilyGuardianInput,
  type StudentFamilyGuardianRelation,
} from "@mtb/api";
import { formatCnic, formatDate, formatMobile, formatRs, isValidCnic, normalizeMobile } from "@mtb/domain";
import {
  AnimatedNumber,
  Avatar,
  Banner,
  Button,
  buttonClassName,
  CnicInput,
  ConfirmDialog,
  DataTable,
  EmptyState,
  IconButton,
  Input,
  Panel,
  Segmented,
  SegmentedBar,
  Select,
  SidePanel,
  Skeleton,
  StatCard,
  StatusBadge,
  Switch,
  Timeline,
  Urdu,
  useToast,
} from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Page, PageHeader, RequirePermission } from "../../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../../app/session";
import { PrintSheet, printNow } from "../documents/print";
import { FamilySheet } from "../documents/templates";
import { apiMessage, EnrolmentBadge, fieldError, LoadError, stagger, StudentsSubNav, today } from "../shared";

const RELATIONS: StudentFamilyGuardianRelation[] = ["Father", "Mother", "Grandfather", "Grandmother", "Uncle", "Aunt", "Brother", "Other"];
const CHILD_COLOURS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const guardianSchema = z
  .object({
    name: z.string().trim().min(3, { error: "Enter the guardian's full name." }),
    relation: z.string().min(1, { error: "Choose the relation." }),
    cnic: z.string().refine((v) => !v || isValidCnic(v), { error: "A CNIC has 13 digits." }),
    mobile: z.string().refine((v) => !v || normalizeMobile(v) !== null, { error: "Enter a Pakistani mobile number, e.g. 0300-1234567." }),
    isPrimaryContact: z.boolean(),
    isFeePayer: z.boolean(),
  })
  .superRefine((v, c) => {
    if ((v.isPrimaryContact || v.isFeePayer) && !v.mobile) c.addIssue({ code: "custom", path: ["mobile"], message: "The primary contact and fee payer need a mobile number for SMS." });
  });

const EMPTY: StudentFamilyGuardianInput = { name: "", relation: "Mother", cnic: "", mobile: "", isPrimaryContact: false, isFeePayer: false, isEmergencyContact: true };

function GuardianPanel({ family, guardian, open, onClose }: { family: StudentFamilyDetail; guardian: StudentFamilyGuardian | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<StudentFamilyGuardianInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => {
    if (open) {
      setForm(guardian ? { ...guardian, mobile: guardian.mobile ? formatMobile(guardian.mobile) : "" } : EMPTY);
      setErrors({});
      setKey(newIdempotencyKey());
    }
  }, [open, guardian?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => studentFamiliesApi.saveGuardian(family.id, form, key),
    onSuccess: (next) => {
      queryClient.setQueryData(studentFamiliesQueries.detail(family.id).queryKey, next);
      void queryClient.invalidateQueries({ queryKey: studentFamiliesQueries.all() });
      void queryClient.invalidateQueries({ queryKey: studentsQueries.all() });
      onClose();
      toast({ title: guardian ? "Guardian updated" : "Guardian added", message: form.isPrimaryContact ? `${form.name} is now the primary contact for all ${family.children.length} children.` : `${form.name} (${form.relation}) is on the family record.` });
    },
  });
  const submit = () => {
    const r = guardianSchema.safeParse(form);
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    save.mutate();
  };
  const set = (patch: Partial<StudentFamilyGuardianInput>) => setForm((f) => ({ ...f, ...patch }));
  const err = (f: string) => errors[f] ?? fieldError(save.error, f);
  const isFather = guardian?.relation === "Father";
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={guardian ? `Edit ${guardian.relation.toLowerCase()}` : "Add a guardian"}
      description={`${family.fatherName}'s family · ${family.id}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} loadingLabel="Saving…" onClick={submit}>
            {guardian ? "Save changes" : "Add guardian"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Full name" required value={form.name} error={err("name")} onChange={(e) => set({ name: e.target.value })} />
        <Input label="Name in Urdu" urdu value={form.nameUr ?? ""} onChange={(e) => set({ nameUr: e.target.value || undefined })} />
        <Select label="Relation to the children" required disabled={isFather} value={form.relation} error={err("relation")} onChange={(e) => set({ relation: e.target.value as StudentFamilyGuardianRelation })} options={RELATIONS.filter((r) => r !== "Father" || isFather)} />
        <Input label="Mobile" inputMode="tel" value={form.mobile} error={err("mobile")} onChange={(e) => set({ mobile: e.target.value })} />
        <CnicInput label="CNIC" value={form.cnic} onValueChange={(v) => set({ cnic: v })} error={err("cnic")} help={isFather ? "The father's CNIC links the siblings. Correct it on a student's record if it was typed wrongly." : undefined} disabled={isFather} />
        <Input label="Occupation" value={form.occupation ?? ""} onChange={(e) => set({ occupation: e.target.value || undefined })} />
        <div className="grid gap-3 rounded-lg border border-border p-3">
          <Switch label="Primary contact (SMS and calls for every child)" checked={form.isPrimaryContact} onChange={(e) => set({ isPrimaryContact: e.target.checked })} />
          <Switch label="Fee payer (name on vouchers and receipts)" checked={form.isFeePayer} onChange={(e) => set({ isFeePayer: e.target.checked })} />
          <Switch label="Emergency contact" checked={form.isEmergencyContact} onChange={(e) => set({ isEmergencyContact: e.target.checked })} />
          <Switch label="Works at MTB (staff-child concession)" checked={Boolean(form.isStaff)} onChange={(e) => set({ isStaff: e.target.checked })} />
        </div>
        {form.isPrimaryContact && !guardian?.isPrimaryContact && <Banner tone="info">{`SMS for all ${family.children.length} children will go to ${form.name || "this guardian"} instead of the current primary contact.`}</Banner>}
        {save.error && !(save.error instanceof ApiError && save.error.field) && <Banner tone="danger">{apiMessage(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/** The A4 family sheet: father, number of children, each child's class and session fee, the date. */
function FamilySheetPanel({ f, open, onClose }: { f: StudentFamilyDetail; open: boolean; onClose: () => void }) {
  const ctx = useCtx();
  const kids = f.children.filter((c) => c.status === "ACTIVE").length;
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      wide
      title="Family sheet"
      description={`${f.fatherName}'s family · ${kids} ${kids === 1 ? "child" : "children"} enrolled`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon="printer" disabled={kids === 0} onClick={printNow}>
            Print
          </Button>
        </>
      }
    >
      {kids === 0 ? (
        <EmptyState icon="students" title="No child enrolled" description="The sheet lists the children enrolled now." />
      ) : (
        <PrintSheet paper="A4" label="Family sheet" zoom={0.55}>
          <FamilySheet f={f} session={ctx.session} printedOn={today()} />
        </PrintSheet>
      )}
    </SidePanel>
  );
}

function FeesPanel({ f }: { f: StudentFamilyDetail }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const withDues = f.children.filter((c) => c.balance > 0);
  return (
    <Panel
      id="family-fees"
      rise={6}
      title="Family fees"
      description="Balance per child and the family's recent payments"
      actions={
        <Segmented
          aria-label="Show as"
          value={view}
          onChange={(v) => setView(v as "chart" | "table")}
          options={[
            { value: "chart", label: "Chart" },
            { value: "table", label: "Table" },
          ]}
        />
      }
    >
      <div className="grid gap-4">
        {f.fees.concession && <Banner tone="info">{f.fees.concession}</Banner>}
        {view === "chart" ? (
          withDues.length === 0 ? (
            <EmptyState icon="checkCircle" title="All dues cleared" description="No child in this family owes anything today." />
          ) : (
            <div className="grid gap-3">
              <p className="m-0 flex items-baseline gap-2">
                <span className="text-display tabular-nums">{formatRs(f.fees.balance)}</span>
                <span className="text-small text-ink-muted">outstanding across {withDues.length} {withDues.length === 1 ? "child" : "children"}</span>
              </p>
              <SegmentedBar label="Family balance by child" format={formatRs} segments={withDues.map((c, i) => ({ key: c.grNo, label: c.name, value: c.balance, color: CHILD_COLOURS[i % CHILD_COLOURS.length]! }))} />
              <ul className="m-0 grid list-none gap-1 p-0">
                {withDues.map((c, i) => (
                  <li key={c.grNo} className="flex items-center gap-2 text-small">
                    <span className="mtb-chart-key" style={{ background: CHILD_COLOURS[i % CHILD_COLOURS.length] }} aria-hidden="true" />
                    <span className="flex-1 text-ink">
                      {c.name} <span className="text-ink-muted">· {c.classSection}</span>
                    </span>
                    <StatusBadge status={c.feeStatus} />
                    <b className="w-28 text-right tabular-nums text-ink">{formatRs(c.balance)}</b>
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : (
          <DataTable
            caption="Balance per child"
            rows={f.children.map((c) => ({ ...c, id: c.grNo }))}
            stickyHeader={false}
            density="dense"
            columns={[
              { key: "name", header: "Child", render: (c) => `${c.name} · ${c.classSection}` },
              { key: "monthlyFee", header: "Monthly tuition", align: "right", render: (c) => (c.status === "ACTIVE" ? formatRs(c.monthlyFee) : "—") },
              {
                key: "sessionFee",
                header: "Session fee",
                align: "right",
                render: (c) =>
                  c.status === "ACTIVE" ? (
                    <span className="grid justify-items-end">
                      <span className="tabular-nums">{formatRs(c.sessionFee.net)}</span>
                      {c.sessionFee.concession > 0 && <span className="mtb-cell-secondary">after {formatRs(c.sessionFee.concession)} concession</span>}
                    </span>
                  ) : (
                    "—"
                  ),
              },
              { key: "lastPayment", header: "Last payment", render: (c) => (c.lastPayment ? `${formatDate(c.lastPayment.on)} · ${formatRs(c.lastPayment.amount)}` : "—") },
              { key: "balance", header: "Balance", align: "right", render: (c) => <b className="tabular-nums">{formatRs(c.balance)}</b> },
            ]}
            footer={{ name: "Family total", monthlyFee: formatRs(f.fees.monthly), sessionFee: formatRs(f.fees.session), balance: <b className="tabular-nums">{formatRs(f.fees.balance)}</b> }}
          />
        )}
        <div className="grid gap-2">
          <span className="mtb-label">Recent payments</span>
          {f.fees.payments.length === 0 ? (
            <p className="m-0 text-small text-ink-muted">No payments recorded this session.</p>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0">
              {f.fees.payments.map((pm, i) => (
                <li key={pm.receiptNo} className="mtb-slide-in flex flex-wrap items-center gap-x-3 border-b border-border py-1.5 text-small last:border-b-0" style={stagger(i)}>
                  <Link to="/fees/receipts/$receiptNo" params={{ receiptNo: pm.receiptNo }} className="mtb-mono text-brand-ink underline-offset-2 hover:underline">
                    {pm.receiptNo}
                  </Link>
                  <span className="text-ink-muted tabular-nums">{formatDate(pm.on)}</span>
                  <span className="flex-1 text-ink">{pm.studentName}</span>
                  <b className="tabular-nums text-ink">{formatRs(pm.amount)}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

export function FamilyPage({ familyId }: { familyId: string }) {
  const ctx = useCtx();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = useCan("students.edit");
  const canFees = useCan("fees.view");
  const canCollect = useCan("fees.collect");
  const readOnly = useReadOnly();
  const family = useQuery(studentFamiliesQueries.detail(familyId));
  const [editing, setEditing] = useState<StudentFamilyGuardian | null | "new">(null);
  const [removing, setRemoving] = useState<StudentFamilyGuardian | null>(null);
  const [sheet, setSheet] = useState(false);
  const remove = useMutation({
    mutationFn: (g: StudentFamilyGuardian) => studentFamiliesApi.removeGuardian(familyId, g.id, newIdempotencyKey()),
    onSuccess: (next, g) => {
      queryClient.setQueryData(studentFamiliesQueries.detail(familyId).queryKey, next);
      setRemoving(null);
      toast({ title: "Guardian removed", message: `${g.name} is no longer on the family record.` });
    },
  });
  const f = family.data;
  const editable = canEdit && !readOnly;

  if (family.error instanceof ApiError && (family.error.status === 404 || family.error.status === 403)) {
    return (
      <Page>
        <div className="mtb-card">
          <EmptyState
            icon="home"
            title={family.error.status === 403 ? "This family is at another campus" : "Family not found"}
            description={family.error.message}
            action={
              <Link to="/students/families" className={buttonClassName({ size: "sm" })}>
                Back to families
              </Link>
            }
          />
        </div>
      </Page>
    );
  }

  const enrolled = f?.children.filter((c) => c.status === "ACTIVE").length ?? 0;
  const campuses = new Set(f?.children.map((c) => c.campusName));

  return (
    <RequirePermission permission="students.view" page="family records">
      <Page>
        <PageHeader
          title={f ? `${f.fatherName}'s family` : "Family"}
          context={f ? `${f.id} · Father's CNIC ${f.fatherCnic ? formatCnic(f.fatherCnic) : "not given"} · ${f.address}` : undefined}
          meta={f?.fatherNameUr ? <Urdu size="small">{f.fatherNameUr}</Urdu> : undefined}
          actions={
            f && (editable || canFees) ? (
              <>
                {canFees && (
                  <Button icon="printer" onClick={() => setSheet(true)}>
                    Family sheet
                  </Button>
                )}
                {editable && (
                  <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
                    Add guardian
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
        <StudentsSubNav />
        {family.isError && <LoadError what="family record" error={family.error} onRetry={() => void family.refetch()} />}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="mtb-rise" style={stagger(1)}>
            <StatCard label="Children" icon="students" loading={!f} value={f ? <AnimatedNumber value={f.children.length} format={String} /> : undefined} foot={f ? `${enrolled} enrolled now` : undefined} />
          </div>
          <div className="mtb-rise" style={stagger(2)}>
            <StatCard label="Campuses" icon="building" loading={!f} value={f ? <AnimatedNumber value={campuses.size} format={String} /> : undefined} foot={f ? [...campuses].join(", ") : undefined} />
          </div>
          {canFees && (
            <>
              <div className="mtb-rise" style={stagger(3)}>
                <StatCard label="Monthly tuition" icon="fees" loading={!f} value={f ? <AnimatedNumber value={f.fees.monthly} format={formatRs} /> : undefined} foot="for the enrolled children" />
              </div>
              <div className="mtb-rise" style={stagger(4)}>
                <StatCard label="Family balance" icon="receipt" tone={f && f.fees.overdueChildren > 0 ? "danger" : f && f.fees.balance > 0 ? "warning" : "neutral"} loading={!f} value={f ? <AnimatedNumber value={f.fees.balance} format={formatRs} /> : undefined} foot={f ? (f.fees.overdueChildren ? `${f.fees.overdueChildren} overdue` : f.fees.balance ? "not yet overdue" : "All dues cleared") : undefined} />
              </div>
            </>
          )}
        </div>

        {!f ? (
          <Skeleton height={320} style={{ borderRadius: "var(--radius-lg)" }} />
        ) : (
          <>
            <Panel id="children" rise={5} title="Children" description="Siblings are linked by the father's CNIC, at every campus">
              <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
                {f.children.map((c, i) => (
                  <li key={c.grNo} className="mtb-slide-in grid gap-3 rounded-lg border border-border p-4" style={stagger(i)}>
                    <div className="flex items-start gap-3">
                      <Avatar name={c.name} size="lg" />
                      <div className="grid min-w-0 flex-1">
                        <Link to="/students/$grNo" params={{ grNo: c.grNo }} className="font-medium text-ink underline-offset-2 hover:underline">
                          {c.name}
                        </Link>
                        {c.nameUr && <Urdu size="small">{c.nameUr}</Urdu>}
                        <span className="text-small text-ink-muted">
                          <span className="mtb-mono">{c.grNo}</span> · {c.classSection} · roll {c.rollNo || "—"}
                        </span>
                        <span className="text-small text-ink-muted">{c.campusName}</span>
                      </div>
                      <EnrolmentBadge status={c.status} />
                    </div>
                    {canFees && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-sunken px-3 py-2 text-small">
                        <StatusBadge status={c.feeStatus} />
                        <span className="text-ink-muted">{c.lastPayment ? `Paid ${formatRs(c.lastPayment.amount)} on ${formatDate(c.lastPayment.on)}` : "No payment yet"}</span>
                        <b className="tabular-nums text-ink">{formatRs(c.balance)}</b>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Link to="/students/$grNo" params={{ grNo: c.grNo }} className={buttonClassName({ size: "sm" })}>
                        Student record
                      </Link>
                      {canCollect && c.balance > 0 && c.campus === ctx.campus && (
                        <Button size="sm" variant="primary" icon="fees" onClick={() => navigate({ to: "/fees/counter", search: (prev: Record<string, unknown>) => ({ ...prev, gr: c.grNo }) } as never)}>
                          Collect fee
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel id="guardians" rise={6} title="Parents and guardians" description="One record for every child: change a number once and every child is updated">
                <ul className="m-0 grid list-none gap-2 p-0">
                  {f.guardians.map((g, i) => (
                    <li key={g.id} className="mtb-slide-in flex items-start gap-3 rounded-lg border border-border px-3 py-2.5" style={stagger(i)}>
                      <Avatar name={g.name} size="sm" tone={g.relation === "Father" ? 1 : g.relation === "Mother" ? 2 : 3} />
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <b className="font-medium text-ink">{g.name}</b>
                          <span className="text-small text-ink-muted">{g.relation}</span>
                          {g.nameUr && <Urdu size="small">{g.nameUr}</Urdu>}
                        </span>
                        <span className="text-small text-ink-muted">
                          {g.mobile ? <span className="tabular-nums">{formatMobile(g.mobile)}</span> : "No mobile"}
                          {g.cnic ? (
                            <>
                              {" "}
                              · <span className="mtb-mono">{formatCnic(g.cnic)}</span>
                            </>
                          ) : null}
                          {g.occupation ? ` · ${g.occupation}` : ""}
                        </span>
                        <span className="flex flex-wrap gap-1 pt-1">
                          {g.isPrimaryContact && <StatusBadge status="info">Primary contact</StatusBadge>}
                          {g.isFeePayer && <StatusBadge status="neutral">Fee payer</StatusBadge>}
                          {g.isEmergencyContact && <StatusBadge status="warning">Emergency</StatusBadge>}
                          {g.isStaff && <StatusBadge status="success">MTB staff</StatusBadge>}
                        </span>
                      </div>
                      {editable && (
                        <span className="flex gap-1">
                          <IconButton icon="edit" label={`Edit ${g.name}`} onClick={() => setEditing(g)} />
                          {g.relation !== "Father" && !g.isPrimaryContact && !g.isFeePayer && <IconButton icon="trash" label={`Remove ${g.name}`} onClick={() => setRemoving(g)} />}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
              {canFees && <FeesPanel f={f} />}
            </div>

            <Panel id="family-timeline" rise={7} title="Family history" description="Admissions, promotions, transfers and record changes for every child">
              {f.timeline.length === 0 ? <p className="m-0 text-small text-ink-muted">Nothing recorded yet.</p> : <Timeline label="Family history" items={f.timeline.slice(0, 14).map((e) => ({ id: e.id, date: e.date, title: e.text, ...(e.by ? { description: `By ${e.by}` } : {}), icon: "clock", tone: "neutral" }))} />}
            </Panel>

            <GuardianPanel family={f} guardian={editing === "new" ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
            {canFees && <FamilySheetPanel f={f} open={sheet} onClose={() => setSheet(false)} />}
            <ConfirmDialog
              open={removing !== null}
              onClose={() => {
                setRemoving(null);
                remove.reset();
              }}
              onConfirm={() => removing && remove.mutate(removing)}
              tone="danger"
              icon="trash"
              title={`Remove ${removing?.name ?? "guardian"}?`}
              message="They are taken off the family record. Children's records, fees and receipts are not changed. The removal is logged in the family history."
              confirmLabel="Remove guardian"
              loading={remove.isPending}
              loadingLabel="Removing…"
              error={remove.error ? apiMessage(remove.error) : undefined}
            />
          </>
        )}
      </Page>
    </RequirePermission>
  );
}
