import { SETUP_PERMISSION_GROUPS, setupApi, setupQueries, type Permission, type SetupRole } from "@mtb/api";
import { formatCount, formatDateTime } from "@mtb/domain";
import { Banner, Button, Checkbox, ConfirmDialog, cx, EmptyState, Icon, Input, KeyValue, Panel, Radio, SidePanel, Skeleton, StatusBadge, Switch, Textarea, Tooltip, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { apiFieldError, ConflictBanner, conflictOf, EditButton, err, errorText, PrintSheet, QueryError, useReadOnlyText, SetupPage, zodErrors, type Conflict, type FieldErrors } from "./shared";

const roleSchema = z.object({
  name: z.string().trim().min(1, { error: "Enter a name for the role, e.g. Exam office." }).max(40, { error: "Keep the name under 40 characters." }),
  permissions: z.array(z.string()).min(1, { error: "Tick at least one thing this role can do." }),
});

type Draft = { name: string; description: string; scope: "CAMPUS" | "ANY"; permissions: Set<Permission>; twoStepRequired: boolean };

function RoleEditor({ role, copyFrom, roles, onClose, onCopy }: { role: SetupRole | null; copyFrom: SetupRole | null; roles: SetupRole[]; onClose: () => void; onCopy: (r: SetupRole) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = useCan("setup.manage");
  const readOnly = useReadOnly();
  const readOnlyNote = useReadOnlyText();
  const editable = canEdit && !readOnly && !(role?.system ?? false);
  const base = role ?? copyFrom;
  const [draft, setDraft] = useState<Draft>(() => ({
    name: role ? role.name : copyFrom ? `${copyFrom.name} (copy)` : "",
    description: base?.description ?? "",
    scope: base?.scope ?? "CAMPUS",
    permissions: new Set(base?.permissions ?? []),
    twoStepRequired: base?.twoStepRequired ?? false,
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const toggle = (p: Permission, on: boolean) =>
    setDraft((d) => {
      const n = new Set(d.permissions);
      if (on) n.add(p);
      else n.delete(p);
      setErrors((e) => ({ ...e, permissions: undefined }));
      return { ...d, permissions: n };
    });
  const save = useMutation({
    mutationFn: () => setupApi.saveRole({ name: draft.name, description: draft.description, scope: draft.scope, permissions: [...draft.permissions], twoStepRequired: draft.twoStepRequired, ...(role ? { rowVer: role.rowVer } : {}) }, role?.id),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: role ? `${r.name} saved` : `Role ${r.name} created`, message: role ? `${r.userCount} ${r.userCount === 1 ? "person has" : "people have"} it; the change applies at their next page.` : "Give it to people from Users." });
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
  const remove = useMutation({
    mutationFn: () => setupApi.deleteRole(role!.id, role!.rowVer),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: `Role ${role!.name} deleted` });
      setDeleting(false);
      onClose();
    },
    onError: (e) => setDeleteError(errorText(e)),
  });
  const submit = () => {
    setFailure(null);
    const r = roleSchema.safeParse({ name: draft.name, permissions: [...draft.permissions] });
    const next = r.success ? {} : zodErrors(r.error);
    if (roles.some((x) => x.id !== role?.id && x.name.toLowerCase() === draft.name.trim().toLowerCase())) next.name = `A role called ${draft.name.trim()} already exists.`;
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };
  const title = role ? (role.system ? role.name : `Edit ${role.name}`) : "New role";
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={title}
      description={role ? `${role.userCount} ${role.userCount === 1 ? "person has" : "people have"} this role · last changed by ${role.updatedBy}, ${formatDateTime(role.updatedAt)}` : copyFrom ? `Starting from ${copyFrom.name}. Change what you need.` : "Tick what people with this role can do."}
      footer={
        <>
          {role && !role.system && editable && (
            <Button variant="danger-quiet" icon="trash" onClick={() => { setDeleteError(null); setDeleting(true); }} className="mr-auto">
              Delete role
            </Button>
          )}
          <Button onClick={onClose}>{editable ? "Cancel" : "Close"}</Button>
          {role?.system && canEdit && !readOnly && (
            <Button variant="primary" icon="copy" onClick={() => onCopy(role)}>
              Copy to a new role
            </Button>
          )}
          {editable && (
            <Button variant="primary" icon="check" onClick={submit} loading={save.isPending} loadingLabel="Saving…" disabled={Boolean(conflict)}>
              {role ? "Save role" : "Create role"}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-5">
        {role?.system && (
          <Banner tone="info" icon="lock">
            System roles come with the software and are the same for every campus. Copy one to make a role that fits your school.
          </Banner>
        )}
        {!canEdit && !role?.system && <Banner tone="info">Only head office can change roles.</Banner>}
        {readOnly && <Banner tone="info">{readOnlyNote}</Banner>}
        {conflict && <ConflictBanner conflict={conflict} onReload={() => void qc.invalidateQueries({ queryKey: ["setup"] }).then(onClose)} />}
        {failure && <Banner tone="danger" title="Not saved.">{failure}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Role name" required disabled={!editable} value={draft.name} onChange={(e) => { setDraft((d) => ({ ...d, name: e.target.value })); setErrors((x) => ({ ...x, name: undefined })); }} {...err(errors, "name")} />
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mtb-label mb-1">Can be given for</legend>
            <Radio name="scope" disabled={!editable} checked={draft.scope === "CAMPUS"} onChange={() => setDraft((d) => ({ ...d, scope: "CAMPUS" }))} label="One campus at a time" />
            <Radio name="scope" disabled={!editable} checked={draft.scope === "ANY"} onChange={() => setDraft((d) => ({ ...d, scope: "ANY" }))} label="One campus or all campuses (head office)" />
          </fieldset>
        </div>
        <Textarea label="What this role is for" rows={2} disabled={!editable} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
        <Switch label="Needs two-step sign-in" disabled={!editable} checked={draft.twoStepRequired} onChange={(e) => setDraft((d) => ({ ...d, twoStepRequired: e.target.checked }))} />
        <section className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="m-0 text-title-3">Permissions</h3>
            <span className="text-small text-ink-muted">{draft.permissions.size} ticked</span>
          </div>
          {errors.permissions && (
            <div className="mtb-error" role="alert">
              <Icon name="alertCircle" />
              <span>{errors.permissions}</span>
            </div>
          )}
          {SETUP_PERMISSION_GROUPS.map((g) => {
            const all = g.permissions.every((p) => draft.permissions.has(p.code));
            const some = g.permissions.some((p) => draft.permissions.has(p.code));
            return (
              <fieldset key={g.module} className="m-0 grid gap-2 rounded-md border border-border p-3">
                <legend className="px-1">
                  <Checkbox
                    label={<span className="font-medium">{g.module}</span>}
                    checked={all}
                    indeterminate={some && !all}
                    disabled={!editable}
                    onChange={(e) => g.permissions.forEach((p) => toggle(p.code, e.target.checked))}
                  />
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {g.permissions.map((p) => (
                    <Checkbox
                      key={p.code}
                      disabled={!editable}
                      checked={draft.permissions.has(p.code)}
                      onChange={(e) => toggle(p.code, e.target.checked)}
                      label={
                        <span className="inline-flex items-center gap-1">
                          {p.label}
                          {p.sensitive && <Icon name="shield" size={14} className="text-warning-ink" label="Sensitive: recorded and limited to trusted roles" />}
                        </span>
                      }
                    />
                  ))}
                </div>
              </fieldset>
            );
          })}
        </section>
      </div>
      {role && (
        <ConfirmDialog
          open={deleting}
          onClose={() => setDeleting(false)}
          onConfirm={() => remove.mutate()}
          tone="danger"
          icon="trash"
          title={`Delete the ${role.name} role?`}
          message="It disappears from every campus. People must not have this role any more; give them another role first."
          details={[["People with this role", formatCount(role.userCount)]]}
          {...(deleteError ? { error: deleteError } : {})}
          requireText="DELETE"
          confirmLabel="Delete role"
          loading={remove.isPending}
          loadingLabel="Deleting…"
        />
      )}
    </SidePanel>
  );
}

function Matrix({ roles, selected, onOpen, search }: { roles: SetupRole[]; selected: string | null; onOpen: (r: SetupRole) => void; search: string }) {
  const term = search.trim().toLowerCase();
  const groups = SETUP_PERMISSION_GROUPS.map((g) => ({ ...g, permissions: g.permissions.filter((p) => !term || p.label.toLowerCase().includes(term) || g.module.toLowerCase().includes(term)) })).filter((g) => g.permissions.length);
  if (!groups.length) return <EmptyState icon="search" title="No permission matches" description="Search for a word like fees, marks or SMS." />;
  return (
    <div className="mtb-table-scroll" style={{ maxHeight: 640, overflow: "auto" }}>
      <table className="setup-matrix">
        <caption className="mtb-sr-only">What each role can do</caption>
        <thead>
          <tr>
            <th scope="col">Permission</th>
            {roles.map((r) => (
              <th key={r.id} scope="col" className={cx(selected === r.id && "setup-col-sel")}>
                <button type="button" className="setup-col-btn" onClick={() => onOpen(r)} aria-label={`Open the ${r.name} role`}>
                  <span className="inline-flex items-center gap-1">
                    {r.system && <Icon name="lock" size={12} className="text-ink-subtle" />}
                    {r.name}
                  </span>
                  <span className="text-caption font-normal text-ink-muted">{formatCount(r.userCount)} people</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <FragmentRows key={g.module} module={g.module} permissions={g.permissions} roles={roles} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRows({ module, permissions, roles }: { module: string; permissions: (typeof SETUP_PERMISSION_GROUPS)[number]["permissions"]; roles: SetupRole[] }) {
  return (
    <>
      <tr className="setup-matrix-group">
        <th scope="rowgroup">{module}</th>
        {roles.map((r) => (
          <td key={r.id} />
        ))}
      </tr>
      {permissions.map((p) => (
        <tr key={p.code}>
          <th scope="row">
            <span className="inline-flex items-center gap-1">
              {p.label}
              {p.sensitive && (
                <Tooltip content="Sensitive: changes are recorded and it should only go to trusted roles.">
                  <span tabIndex={0} className="inline-flex text-warning-ink">
                    <Icon name="shield" size={14} label="Sensitive" />
                  </span>
                </Tooltip>
              )}
            </span>
          </th>
          {roles.map((r) => (
            <td key={r.id}>{r.permissions.includes(p.code) ? <Icon name="check" size={16} label={`${r.name} can`} /> : <span className="mtb-sr-only">{r.name} can't</span>}</td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function RolesPage() {
  const ctx = useCtx();
  const q = useQuery(setupQueries.roles(ctx));
  const canEdit = useCan("setup.manage");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<{ role: SetupRole | null; copyFrom: SetupRole | null } | null>(null);
  const roles = q.data ?? [];
  const system = roles.filter((r) => r.system);
  const custom = roles.filter((r) => !r.system);
  return (
    <SetupPage
      title="Roles and permissions"
      actions={
        <>
          <Button icon="printer" onClick={() => window.print()} disabled={!q.data}>
            Print for sign-off
          </Button>
          {canEdit && (
            <EditButton variant="primary" icon="plus" onClick={() => setOpen({ role: null, copyFrom: null })}>
              New role
            </EditButton>
          )}
        </>
      }
    >
      {q.isError && <QueryError what="The roles" error={q.error} onRetry={() => void q.refetch()} />}
      <Banner tone="neutral" icon="shield">
        People get what their roles allow, campus by campus. In the old software each user had their own list of screens to tick, so two cashiers could have different access; now a role is set once and applies to everyone who has it.
      </Banner>
      <div className="setup-stats">
        {(q.isLoading ? [] : [...system, ...custom]).map((r, i) => (
          <button
            key={r.id}
            type="button"
            className="mtb-stat mtb-rise text-left"
            style={{ ["--i" as string]: i, font: "inherit", cursor: "pointer" }}
            onClick={() => setOpen({ role: r, copyFrom: null })}
          >
            <div className="mtb-stat-top">
              <span className="mtb-stat-label">{r.name}</span>
              {r.system ? <StatusBadge status="neutral" dot={false}>System</StatusBadge> : <StatusBadge status="brand" dot={false}>Custom</StatusBadge>}
            </div>
            <div className="text-title-2 tabular-nums text-ink">
              {formatCount(r.userCount)} <span className="text-small font-normal text-ink-muted">{r.userCount === 1 ? "person" : "people"}</span>
            </div>
            <span className="line-clamp-2 text-small text-ink-muted">{r.description}</span>
            <span className="flex flex-wrap gap-1">
              <StatusBadge status="neutral" dot={false}>
                {r.permissions.length} permissions
              </StatusBadge>
              {r.twoStepRequired && <StatusBadge status="success" dot={false}>Two-step</StatusBadge>}
              {r.scope === "ANY" && <StatusBadge status="info" dot={false}>All campuses</StatusBadge>}
            </span>
          </button>
        ))}
        {q.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} height={150} />)}
      </div>
      <Panel
        id="roles-matrix"
        title="Who can do what"
        description="Roles across, permissions down. Click a role to see or change it."
        flush
        rise={2}
        actions={
          <div className="w-64">
            <Input aria-label="Search permissions" icon="search" placeholder="Search permissions" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        }
      >
        {q.isLoading ? <Skeleton height={400} /> : <Matrix roles={roles} selected={open?.role?.id ?? null} onOpen={(r) => setOpen({ role: r, copyFrom: null })} search={search} />}
      </Panel>
      <KeyValue
        className="text-small"
        items={[
          [<span className="inline-flex items-center gap-1"><Icon name="lock" size={14} /> System role</span>, "Comes with the software; copy it to change it."],
          [<span className="inline-flex items-center gap-1 text-warning-ink"><Icon name="shield" size={14} /> Sensitive</span>, "Money, results, roles and SMS pausing. Changes are recorded in the audit log."],
        ]}
      />
      {q.data && (
        <PrintSheet title="Roles and permissions" scope={`${roles.length} roles · ✓ = the role can do it`} signatures={["Prepared by", "Principal", "Accounts", "Head office"]}>
          <table>
            <thead>
              <tr>
                <th>Permission</th>
                {roles.map((r) => (
                  <th key={r.id}>{r.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SETUP_PERMISSION_GROUPS.flatMap((g) => [
                <tr key={g.module}>
                  <th colSpan={roles.length + 1}>{g.module}</th>
                </tr>,
                ...g.permissions.map((p) => (
                  <tr key={p.code}>
                    <td>
                      {p.label}
                      {p.sensitive ? " (sensitive)" : ""}
                    </td>
                    {roles.map((r) => (
                      <td key={r.id} className="setup-print-c">
                        {r.permissions.includes(p.code) ? "✓" : ""}
                      </td>
                    ))}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </PrintSheet>
      )}
      {open && (
        <RoleEditor
          key={`${open.role?.id ?? "new"}:${open.copyFrom?.id ?? ""}:${open.role?.rowVer ?? 0}`}
          role={open.role}
          copyFrom={open.copyFrom}
          roles={roles}
          onClose={() => setOpen(null)}
          onCopy={(r) => setOpen({ role: null, copyFrom: r })}
        />
      )}
    </SetupPage>
  );
}
