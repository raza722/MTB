import { warehouseApi, warehouseQueries, type WarehouseSupplier } from "@mtb/api";
import { formatCount, formatDate, formatMobile, formatRs } from "@mtb/domain";
import { Banner, Button, DataTable, EmptyState, Input, SidePanel, StatusBadge, Switch, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { CampusNote, errorCode, errorField, errorText, LoadError, RequireSingleCampusOverlay, StaleNote, validate } from "../library/common";
import { WarehouseShell } from "./shared";

const supplierSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter the supplier's business name." }),
  contact: z.string().trim(),
  phone: z
    .string()
    .trim()
    .refine((v) => v === "" || [10, 11].includes(v.replace(/\D/g, "").length), { error: "Enter a landline like 068-5551234." }),
  mobile: z
    .string()
    .trim()
    .refine((v) => v === "" || /^03\d{9}$/.test(v.replace(/\D/g, "")), { error: "Enter a mobile number of 11 digits, like 0300-1234567." }),
  email: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { error: "Enter an email address like orders@example.com." }),
  address: z.string().trim(),
  ntn: z.string().trim(),
  supplies: z.string().trim().min(2, { error: 'Say what they supply, for example "Stationery".' }),
  active: z.boolean(),
});

function SupplierForm({ s, onClose }: { s: WarehouseSupplier | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [d, setD] = useState({ name: s?.name ?? "", contact: s?.contact ?? "", phone: s?.phone ?? "", mobile: s?.mobile ?? "", email: s?.email ?? "", address: s?.address ?? "", ntn: s?.ntn ?? "", supplies: s?.supplies ?? "", active: s?.active ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: z.infer<typeof supplierSchema>) => warehouseApi.saveSupplier(ctx, { ...body, ...(s ? { rowVer: s.rowVer } : {}) }, s?.id),
    onSuccess: (x) => {
      toast({ title: `${x.name} saved` });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      onClose();
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const field = (k: keyof typeof d, label: string, extra: Record<string, unknown> = {}) => (
    <Input label={label} value={String(d[k])} onChange={(e) => setD({ ...d, [k]: e.target.value })} error={errors[k]} {...extra} />
  );
  return (
    <SidePanel
      open
      onClose={onClose}
      title={s ? s.name : "Add a supplier"}
      description="One supplier list for the store and the book shop."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={m.isPending}
            onClick={() => {
              const r = validate(supplierSchema, d);
              if (!r.ok) return setErrors(r.errors);
              setErrors({});
              m.mutate(r.data);
            }}
          >
            Save supplier
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {field("name", "Business name", { required: true })}
        {field("supplies", "What they supply", { required: true, placeholder: "Stationery, registers" })}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("contact", "Contact person")}
          {field("mobile", "Mobile", { inputMode: "tel", placeholder: "0300-1234567" })}
          {field("phone", "Landline", { inputMode: "tel", placeholder: "068-5551234" })}
          {field("email", "Email", { inputMode: "email", placeholder: "orders@example.com" })}
        </div>
        {field("address", "Address")}
        {field("ntn", "NTN (tax number)", { mono: true, help: "Optional; printed on purchase records." })}
        {s && <Switch label="Still buying from them" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />}
        <p className="m-0 text-small text-ink-muted">Bills and other papers from the supplier can be attached once file uploads are switched on.</p>
        <StaleNote
          error={m.error}
          onReload={() => {
            void qc.invalidateQueries({ queryKey: ["warehouse"] });
            onClose();
          }}
        />
        {m.isError && !errorField(m.error) && errorCode(m.error) !== "CONCURRENCY" && <Banner tone="danger">{errorText(m.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

export function SuppliersPage() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("warehouse.manage") && !readOnly;
  const q = useQuery(warehouseQueries.suppliers(ctx));
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<WarehouseSupplier | null | "new">(null);
  const rows = (q.data ?? []).filter((s) => !search.trim() || `${s.name} ${s.supplies} ${s.contact} ${s.email} ${s.mobile.replace(/\D/g, "")}`.toLowerCase().includes(search.trim().toLowerCase()));
  const columns: Array<Column<WarehouseSupplier>> = [
    { key: "name", header: "Supplier", render: (s) => <span className="grid"><span className="font-medium">{s.name}</span><span className="text-small text-ink-muted">{s.supplies}{ctx.campus === "ALL" ? ` · ${campusLabel(s.campus)}` : ""}</span></span> },
    {
      key: "contact",
      header: "Contact",
      render: (s) => (
        <span className="grid">
          <span>{s.contact || "—"}</span>
          <span className="text-small text-ink-muted">{[s.mobile ? formatMobile(s.mobile) : "", s.phone ? `Landline ${s.phone}` : ""].filter(Boolean).join(" · ")}</span>
          {s.email && <span className="text-small text-ink-muted">{s.email}</span>}
        </span>
      ),
    },
    { key: "grns", header: "Receipts", align: "right", render: (s) => <span className="mtb-num">{formatCount(s.grns)}</span> },
    { key: "bought", header: "Bought this session", align: "right", render: (s) => <span className="mtb-num">{formatRs(s.purchased)}</span> },
    { key: "last", header: "Last receipt", render: (s) => (s.lastGrnOn ? formatDate(s.lastGrnOn) : "—") },
    { key: "status", header: "Status", render: (s) => (s.active ? <StatusBadge status="paid">Active</StatusBadge> : <StatusBadge status="neutral">Not buying</StatusBadge>) },
  ];
  return (
    <WarehouseShell
      title="Suppliers"
      actions={
        canManage && ctx.campus !== "ALL" ? (
          <Button variant="primary" icon="plus" onClick={() => setEdit("new")}>
            Add a supplier
          </Button>
        ) : undefined
      }
    >
      {q.isError && <LoadError what="Suppliers" error={q.error} onRetry={() => void q.refetch()} />}
      <DataTable
        caption="Suppliers"
        rows={rows}
        loading={q.isLoading}
        columns={columns}
        onRowClick={canManage ? (s) => setEdit(s) : undefined}
        toolbar={
          <div className="min-w-[240px] flex-1">
            <Input label="Search" icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, what they supply, contact, email or mobile" />
          </div>
        }
        footer={rows.length ? { name: <span className="font-semibold">{rows.length} suppliers</span>, bought: <span className="mtb-num font-semibold">{formatRs(rows.reduce((a, s) => a + s.purchased, 0))}</span> } : undefined}
        empty={<EmptyState icon="building" title="No suppliers" description="Add the shops and traders the store buys from." />}
      />
      <CampusNote />
      {edit && (
        <RequireSingleCampusOverlay onClose={() => setEdit(null)}>
          <SupplierForm s={edit === "new" ? null : edit} onClose={() => setEdit(null)} />
        </RequireSingleCampusOverlay>
      )}
    </WarehouseShell>
  );
}
