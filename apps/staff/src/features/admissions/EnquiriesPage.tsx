import {
  ADMISSIONS_ENQUIRY_SOURCE_LABEL,
  admissionsApi,
  admissionsQueries,
  ApiError,
  newIdempotencyKey,
  type AdmissionsEnquiry,
  type AdmissionsEnquiryInput,
  type AdmissionsEnquirySource,
} from "@mtb/api";
import { formatCount, formatDate, formatMobile, normalizeMobile } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, buttonClassName, DataTable, DatePicker, EmptyState, Input, KeyValue, Modal, Radio, Segmented, Select, SidePanel, StatCard, StatusBadge, Textarea, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { apiMessage, fieldError, LoadError, stagger, TODAY } from "../students/shared";
import { AdmissionsSubNav } from "./shared";
import { BlankFormModal } from "./NewApplicationPage";

const CLASSES = ["Prep", ...Array.from({ length: 10 }, (_, i) => `Class ${i + 1}`)];
const SOURCES = Object.keys(ADMISSIONS_ENQUIRY_SOURCE_LABEL) as AdmissionsEnquirySource[];

const schema = z.object({
  childName: z.string().trim().min(3, { error: "Enter the child's name." }),
  parentName: z.string().trim().min(3, { error: "Enter the parent's name." }),
  mobile: z.string().refine((v) => normalizeMobile(v) !== null, { error: "Enter a Pakistani mobile number, e.g. 0300-1234567." }),
  classInterest: z.string().min(1, { error: "Choose the class." }),
});

function followUp(e: AdmissionsEnquiry): { text: string; tone: "danger" | "warning" | "neutral" } | null {
  if (e.status !== "OPEN" || !e.followUpOn) return null;
  if (e.followUpOn < TODAY) return { text: `Overdue · ${formatDate(e.followUpOn)}`, tone: "danger" };
  if (e.followUpOn === TODAY) return { text: "Call today", tone: "warning" };
  return { text: formatDate(e.followUpOn), tone: "neutral" };
}

function NewEnquiryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const empty: AdmissionsEnquiryInput = { childName: "", gender: "F", parentName: "", mobile: "", classInterest: "", source: "WALK_IN", followUpOn: "2026-11-06" };
  const [form, setForm] = useState<AdmissionsEnquiryInput>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => {
    if (open) {
      setForm(empty);
      setErrors({});
      setKey(newIdempotencyKey());
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => admissionsApi.createEnquiry(ctx, form, key),
    onSuccess: (e) => {
      void queryClient.invalidateQueries({ queryKey: admissionsQueries.all() });
      onClose();
      toast({ title: `Enquiry ${e.enquiryNo} saved`, message: e.followUpOn ? `Follow-up call on ${formatDate(e.followUpOn)}.` : "Start the application when the family is ready." });
    },
  });
  const set = (p: Partial<AdmissionsEnquiryInput>) => setForm((f) => ({ ...f, ...p }));
  const err = (f: string) => errors[f] ?? fieldError(save.error, f);
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="New enquiry"
      description="A family asking about admission: takes a minute, and nobody is forgotten"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              const r = schema.safeParse(form);
              if (!r.success) {
                setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
                return;
              }
              setErrors({});
              save.mutate();
            }}
          >
            Save enquiry
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Child's name" required value={form.childName} error={err("childName")} onChange={(e) => set({ childName: e.target.value })} />
        <fieldset className="m-0 flex gap-4 border-0 p-0">
          <legend className="mtb-label mb-1">Gender</legend>
          <Radio name="enq-gender" label="Girl" checked={form.gender === "F"} onChange={() => set({ gender: "F" })} />
          <Radio name="enq-gender" label="Boy" checked={form.gender === "M"} onChange={() => set({ gender: "M" })} />
        </fieldset>
        <Input label="Parent's name" required value={form.parentName} error={err("parentName")} onChange={(e) => set({ parentName: e.target.value })} />
        <Input label="Mobile" required inputMode="tel" value={form.mobile} error={err("mobile")} onChange={(e) => set({ mobile: e.target.value })} />
        <Select label="Class" required value={form.classInterest} error={err("classInterest")} onChange={(e) => set({ classInterest: e.target.value })} options={[{ value: "", label: "Choose…" }, ...CLASSES]} />
        <Select label="How they heard of us" value={form.source} onChange={(e) => set({ source: e.target.value as AdmissionsEnquirySource })} options={SOURCES.map((s) => ({ value: s, label: ADMISSIONS_ENQUIRY_SOURCE_LABEL[s] }))} />
        <DatePicker label="Follow-up call" value={form.followUpOn ?? null} minDate={TODAY} onValueChange={(v) => set({ followUpOn: v ?? undefined })} />
        <Textarea label="Notes" rows={3} value={form.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} />
        {save.error && !(save.error instanceof ApiError && save.error.field) && <Banner tone="danger">{apiMessage(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

function EnquiryPanel({ e, onClose }: { e: AdmissionsEnquiry | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = useCan("admissions.manage");
  const readOnly = useReadOnly();
  const [follow, setFollow] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [closing, setClosing] = useState(false);
  const [why, setWhy] = useState("");
  useEffect(() => {
    setFollow(e?.followUpOn ?? null);
    setNotes(e?.notes ?? "");
    setClosing(false);
    setWhy("");
  }, [e]);
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof admissionsApi.updateEnquiry>[1]) => admissionsApi.updateEnquiry(e!.id, patch, newIdempotencyKey()),
    onSuccess: (n) => {
      void queryClient.invalidateQueries({ queryKey: admissionsQueries.all() });
      setClosing(false);
      onClose();
      toast({ title: n.status === "CLOSED" ? `Enquiry ${n.enquiryNo} closed` : "Follow-up saved", message: n.status === "CLOSED" ? n.closedReason : n.followUpOn ? `Call on ${formatDate(n.followUpOn)}` : undefined });
    },
  });
  if (!e) return null;
  const editable = canManage && !readOnly && e.status === "OPEN";
  return (
    <SidePanel
      open={Boolean(e)}
      onClose={onClose}
      title={`${e.childName} · ${e.classInterest}`}
      description={`${e.enquiryNo} · ${ADMISSIONS_ENQUIRY_SOURCE_LABEL[e.source]} · ${formatDate(e.receivedOn)}`}
      footer={
        editable ? (
          <>
            <Button variant="danger-quiet" onClick={() => setClosing(true)}>
              Close enquiry
            </Button>
            <Button loading={update.isPending} onClick={() => update.mutate({ ...(follow ? { followUpOn: follow } : {}), notes })}>
              Save follow-up
            </Button>
            <Link to="/admissions/new" search={(prev: Record<string, unknown>) => ({ ...prev, enquiry: e.id }) as never} className={buttonClassName({ variant: "primary" })}>
              Start application
            </Link>
          </>
        ) : e.applicationNo ? (
          <Link to="/admissions" search={(prev: Record<string, unknown>) => ({ ...prev, applicant: `adm-${e.campus}-${Number(e.applicationNo!.split("-").pop())}` }) as never} className={buttonClassName({ variant: "primary" })}>
            Open application {e.applicationNo}
          </Link>
        ) : undefined
      }
    >
      <div className="grid gap-5">
        <KeyValue
          items={[
            ["Parent", e.parentName],
            ["Mobile", <span className="tabular-nums">{formatMobile(e.mobile)}</span>],
            ["Child", `${e.childName} (${e.gender === "F" ? "girl" : "boy"})`],
            ["Class", e.classInterest],
            ["Taken by", e.takenBy],
            ["Status", e.status === "OPEN" ? <StatusBadge status="pending">Open</StatusBadge> : e.status === "CONVERTED" ? <StatusBadge status="success">Application {e.applicationNo}</StatusBadge> : <StatusBadge status="neutral">Closed</StatusBadge>],
            ...(e.closedReason ? ([["Closed because", e.closedReason]] as Array<[string, string]>) : []),
          ]}
        />
        {editable ? (
          <div className="grid gap-4">
            <DatePicker label="Next follow-up call" value={follow} minDate={TODAY} onValueChange={setFollow} />
            <Textarea label="Notes" rows={4} value={notes} onChange={(ev) => setNotes(ev.target.value)} />
          </div>
        ) : (
          e.notes && <p className="m-0 rounded-md bg-surface-sunken p-3 text-small">{e.notes}</p>
        )}
        {update.error && <Banner tone="danger">{apiMessage(update.error)}</Banner>}
      </div>
      <Modal
        open={closing}
        onClose={() => setClosing(false)}
        title="Close this enquiry?"
        description="It stays on record. Closed enquiries don't appear in the follow-up list."
        footer={
          <>
            <Button onClick={() => setClosing(false)}>Back</Button>
            <Button variant="danger" disabled={!why.trim()} loading={update.isPending} onClick={() => update.mutate({ status: "CLOSED", closedReason: why })}>
              Close enquiry
            </Button>
          </>
        }
      >
        <Textarea label="Reason" required rows={3} value={why} onChange={(ev) => setWhy(ev.target.value)} placeholder="No seat this term; family will apply in March." />
      </Modal>
    </SidePanel>
  );
}

export function EnquiriesPage({ openNew, setOpenNew }: { openNew: boolean; setOpenNew: (v: boolean) => void }) {
  const ctx = useCtx();
  const canManage = useCan("admissions.manage");
  const readOnly = useReadOnly();
  const list = useQuery(admissionsQueries.enquiries(ctx));
  const [blankForm, setBlankForm] = useState(false);
  const [filter, setFilter] = useState<"OPEN" | "CONVERTED" | "CLOSED" | "">("OPEN");
  const [open, setOpen] = useState<AdmissionsEnquiry | null>(null);
  const items = list.data ?? [];
  const rows = useMemo(() => items.filter((e) => !filter || e.status === filter), [items, filter]);
  const due = items.filter((e) => e.status === "OPEN" && e.followUpOn && e.followUpOn <= TODAY).length;
  const converted = items.filter((e) => e.status === "CONVERTED").length;

  const columns: Array<Column<AdmissionsEnquiry>> = [
    { key: "enquiryNo", header: "Enquiry", width: 160, render: (e) => <span className="mtb-mono">{e.enquiryNo}</span> },
    {
      key: "childName",
      header: "Child",
      render: (e) => (
        <span className="grid">
          <span className="mtb-cell-primary">{e.childName}</span>
          <span className="mtb-cell-secondary">{e.classInterest}</span>
        </span>
      ),
    },
    {
      key: "parentName",
      header: "Parent",
      render: (e) => (
        <span className="grid">
          <span>{e.parentName}</span>
          <span className="mtb-cell-secondary tabular-nums">{formatMobile(e.mobile)}</span>
        </span>
      ),
    },
    { key: "source", header: "Source", width: 170, render: (e) => ADMISSIONS_ENQUIRY_SOURCE_LABEL[e.source] },
    { key: "receivedOn", header: "Received", width: 120, render: (e) => <span className="tabular-nums">{formatDate(e.receivedOn)}</span> },
    {
      key: "followUpOn",
      header: "Follow-up",
      width: 170,
      render: (e) => {
        const f = followUp(e);
        if (e.status === "CONVERTED") return <StatusBadge status="success">Applied · {e.applicationNo?.split("-").pop()}</StatusBadge>;
        if (e.status === "CLOSED") return <StatusBadge status="neutral">Closed</StatusBadge>;
        return f ? <StatusBadge status={f.tone}>{f.text}</StatusBadge> : <span className="text-ink-subtle">—</span>;
      },
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Enquiries"
        actions={
          <>
            <Button icon="printer" variant="quiet" onClick={() => setBlankForm(true)}>
              Print blank form
            </Button>
            {canManage && !readOnly && (
              <Button variant="primary" icon="plus" disabled={ctx.campus === "ALL"} title={ctx.campus === "ALL" ? "Choose a campus first" : undefined} onClick={() => setOpenNew(true)}>
                New enquiry
              </Button>
            )}
          </>
        }
      />
      <BlankFormModal open={blankForm} onClose={() => setBlankForm(false)} />
      <AdmissionsSubNav />
      {list.isError && <LoadError what="enquiries" error={list.error} onRetry={() => void list.refetch()} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="mtb-rise" style={stagger(1)}>
          <StatCard label="Open enquiries" icon="phone" loading={!list.data} value={list.data ? <AnimatedNumber value={items.filter((e) => e.status === "OPEN").length} format={formatCount} /> : undefined} foot="families still deciding" />
        </div>
        <div className="mtb-rise" style={stagger(2)}>
          <StatCard label="Calls due today" icon="clock" tone={due ? "warning" : "neutral"} loading={!list.data} value={list.data ? <AnimatedNumber value={due} format={formatCount} /> : undefined} foot="follow-ups due or overdue" />
        </div>
        <div className="mtb-rise" style={stagger(3)}>
          <StatCard label="Became applications" icon="checkCircle" tone="info" loading={!list.data} value={list.data ? <AnimatedNumber value={converted} format={formatCount} /> : undefined} foot={items.length ? `${Math.round((converted / items.length) * 100)}% of enquiries this session` : undefined} />
        </div>
      </div>
      <DataTable
        caption="Enquiries"
        columns={columns}
        rows={rows}
        loading={list.isLoading}
        onRowClick={setOpen}
        empty={<EmptyState icon="phone" title="No enquiries here" description="Walk-ins, phone calls and website forms appear here until they become applications." />}
        toolbar={
          <Segmented
            aria-label="Status"
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
            options={[
              { value: "OPEN", label: `Open · ${items.filter((e) => e.status === "OPEN").length}` },
              { value: "CONVERTED", label: `Applied · ${converted}` },
              { value: "CLOSED", label: `Closed · ${items.filter((e) => e.status === "CLOSED").length}` },
              { value: "", label: "All" },
            ]}
          />
        }
      />
      {ctx.campus !== "ALL" && <NewEnquiryPanel open={openNew} onClose={() => setOpenNew(false)} />}
      <EnquiryPanel e={open} onClose={() => setOpen(null)} />
    </Page>
  );
}
