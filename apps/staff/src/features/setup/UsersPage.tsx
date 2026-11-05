import {
  ApiError,
  can,
  hrQueries,
  newIdempotencyKey,
  setupApi,
  setupPasswordOk,
  setupQueries,
  type CampusScope,
  type HrStaffSummary,
  type SetupRole,
  type SetupUser,
  type SetupUserAction,
  type SetupUserDetail,
  type SetupUserFilter,
  type SetupUserStatus,
} from "@mtb/api";
import { formatCount, formatDateTime } from "@mtb/domain";
import {
  Avatar,
  Banner,
  Button,
  Checkbox,
  Combobox,
  ConfirmDialog,
  cx,
  DataTable,
  EmptyState,
  Icon,
  IconButton,
  Input,
  KeyValue,
  Modal,
  Pagination,
  Panel,
  Radio,
  Segmented,
  Select,
  SidePanel,
  Skeleton,
  StatusBadge,
  Switch,
  Textarea,
  useToast,
  type Status,
} from "@mtb/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { useCtx, useReadOnly, useSessionUser } from "../../app/session";
import { CAMPUS_LABEL } from "../../app/shell/campus";
import { apiFieldError, ConflictBanner, conflictOf, EditButton, err, errorText, PasswordRules, PrintSheet, QueryError, useReadOnlyText, SetupPage, suggestPassword, useReveal, whenText, zodErrors, type Conflict, type FieldErrors } from "./shared";

const STATUS: Record<SetupUserStatus, { badge: Status; label: string }> = {
  ACTIVE: { badge: "success", label: "Active" },
  INVITED: { badge: "info", label: "Invited" },
  LOCKED: { badge: "danger", label: "Locked" },
  DISABLED: { badge: "neutral", label: "Disabled" },
};

const FILTERS: Array<{ id: SetupUserFilter; label: string }> = [
  { id: "ALL", label: "All" },
  { id: "ACTIVE", label: "Active" },
  { id: "INVITED", label: "Invited" },
  { id: "LOCKED", label: "Locked" },
  { id: "DISABLED", label: "Disabled" },
  { id: "NO_TWO_STEP", label: "Two-step not set up" },
  { id: "MUST_CHANGE", label: "Must change password" },
  { id: "STAFF_LEFT", label: "Staff has left" },
];

const CAMPUS_CHOICES: CampusScope[] = ["ALL", "KC", "SM", "UC", "MC", "HC"];
const LEFT_REASON = "Left the school (Staff & payroll)";

/* ------------------------------------------------------------------ Form pieces */

interface Grant {
  roleId: string;
  campus: CampusScope;
}

const userSchema = z.object({
  name: z.string().trim().min(1, { error: "Enter the person's full name." }),
  username: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9.]{2,29}$/, { error: "Use 3 to 30 small letters, numbers or dots, starting with a letter, e.g. hina.javed." }),
  mobile: z
    .string()
    .trim()
    .regex(/^03\d{2}-?\d{7}$/, { error: "Enter an 11-digit mobile number starting with 03. Sign-in codes go to this number." }),
  email: z.union([z.literal(""), z.email({ error: "Enter a full email address, or leave it empty." })]),
  grants: z.array(z.object({ roleId: z.string().min(1, { error: "Choose a role for every row." }), campus: z.string() })).min(1, { error: "Give at least one role." }),
});

/** 409 "this person already has an account" from the server, shown next to the staff field. */
function staffNoError(e: unknown): FieldErrors | null {
  if (e instanceof ApiError && e.status === 409 && e.code === "DUPLICATE_ACCOUNT") return { staffNo: e.message };
  return null;
}

/**
 * The staff member an account belongs to, chosen from the active staff at the campus (Staff & payroll). Optional:
 * accounts for people who aren't staff stay unlinked. Roles without the staff list type the number instead.
 */
function StaffPicker({ campus, value, onChange, current, error, disabled }: { campus: CampusScope; value: string; onChange: (staffNo: string, staff?: HrStaffSummary) => void; current?: SetupUser["staff"]; error?: string | undefined; disabled?: boolean }) {
  const ctx = useCtx();
  const q = useQuery({ ...hrQueries.staff({ campus, session: ctx.session }), retry: false });
  if (q.isError) {
    return (
      <Input
        label="Staff number"
        mono
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder="KC-T-0170"
        {...(error ? { error } : { help: "The staff list isn't open to your role. Type the staff number, or leave it empty for someone who isn't staff." })}
      />
    );
  }
  const active = (q.data ?? []).filter((s) => s.status === "ACTIVE");
  const options = [
    { value: "", label: "Not a staff member" },
    ...active.map((s) => ({ value: s.employeeNo, label: `${s.name} · ${s.designation} · ${s.employeeNo}`, keywords: [s.employeeNo, s.name, s.designation] })),
  ];
  if (value && !options.some((o) => o.value === value)) options.push({ value, label: current ? `${current.name} · ${current.designation} · ${value}${current.left ? " (left)" : ""}` : value, keywords: [value] });
  return (
    <Combobox
      label="Staff member"
      value={value}
      options={options}
      onValueChange={(v) => onChange(v, active.find((s) => s.employeeNo === v))}
      placeholder={q.isLoading ? "Loading staff…" : "Choose…"}
      searchPlaceholder="Name, designation or staff number"
      emptyText="No active staff member matches"
      disabled={Boolean(disabled) || q.isLoading}
      {...(error ? { error } : { help: "Links the account to the staff record. Leave it as Not a staff member for anyone else." })}
    />
  );
}

function usernameFrom(name: string) {
  return name
    .toLowerCase()
    .replace(/^(mr|ms|mrs|dr|miss)\.?\s+/, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(".")
    .replace(/[^a-z.]/g, "");
}

function GrantRows({ grants, onChange, roles, error, disabled }: { grants: Grant[]; onChange: (g: Grant[]) => void; roles: SetupRole[]; error?: string | undefined; disabled?: boolean }) {
  const me = useSessionUser();
  const campuses = CAMPUS_CHOICES.filter((c) => can(me, "users.manage", c));
  const set = (i: number, patch: Partial<Grant>) => onChange(grants.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="mtb-label mb-1">Roles</legend>
      {grants.map((g, i) => {
        const role = roles.find((r) => r.id === g.roleId);
        return (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2">
            <Select
              aria-label={`Role ${i + 1}`}
              value={g.roleId}
              disabled={disabled}
              onChange={(e) => {
                const r = roles.find((x) => x.id === e.target.value);
                set(i, { roleId: e.target.value, ...(r?.scope === "CAMPUS" && g.campus === "ALL" ? { campus: campuses.find((c) => c !== "ALL") ?? "KC" } : {}) });
              }}
              options={[{ value: "", label: "Choose a role…" }, ...roles.filter((r) => r.code !== "ADMIN" || can(me, "setup.manage", "ALL")).map((r) => ({ value: r.id, label: r.system ? r.name : `${r.name} (custom)` }))]}
            />
            <Select
              aria-label={`Campus for role ${i + 1}`}
              value={g.campus}
              disabled={disabled}
              onChange={(e) => set(i, { campus: e.target.value as CampusScope })}
              options={campuses.map((c) => ({ value: c, label: CAMPUS_LABEL[c], disabled: c === "ALL" && role?.scope === "CAMPUS" }))}
            />
            <IconButton icon="trash" label={`Remove role ${i + 1}`} variant="danger-quiet" disabled={disabled || grants.length === 1} onClick={() => onChange(grants.filter((_, j) => j !== i))} />
          </div>
        );
      })}
      {error && (
        <div className="mtb-error" role="alert">
          <Icon name="alertCircle" />
          <span>{error}</span>
        </div>
      )}
      {!disabled && (
        <div>
          <Button size="sm" variant="ghost" icon="plus" onClick={() => onChange([...grants, { roleId: "", campus: campuses.find((c) => c !== "ALL") ?? "KC" }])}>
            Add another role or campus
          </Button>
        </div>
      )}
      <span className="text-small text-ink-muted">A teacher who works at two campuses gets two rows here, not two accounts.</span>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ New user */

function NewUserPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const roles = useQuery(setupQueries.roles(ctx)).data ?? [];
  const defaultCampus: CampusScope = ctx.campus === "ALL" ? "KC" : ctx.campus;
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [staffNo, setStaffNo] = useState("");
  const [grants, setGrants] = useState<Grant[]>([{ roleId: "role-teacher", campus: defaultCampus }]);
  const [twoStep, setTwoStep] = useState(false);
  const [setup, setSetup] = useState<"INVITE" | "PASSWORD">("INVITE");
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [key] = useState(newIdempotencyKey);
  const reveal = useReveal();
  const required = grants.some((g) => roles.find((r) => r.id === g.roleId)?.twoStepRequired);
  const create = useMutation({
    mutationFn: () =>
      setupApi.createUser(
        ctx,
        { name, username, mobile, email: email || null, staffNo: staffNo || null, grants, twoStep: required || twoStep, setup, ...(setup === "PASSWORD" ? { temporaryPassword: password } : {}), mustChangePassword: setup === "INVITE" ? true : mustChange },
        key,
      ),
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({
        title: setup === "INVITE" ? `${u.name} invited` : `Account created for ${u.name}`,
        message: setup === "INVITE" ? `A one-time sign-in code was sent to ${u.mobile.slice(0, 5)}•••••${u.mobile.slice(-2)}.` : "Give them the temporary password in person or by phone. It isn't shown again.",
      });
      onCreated(u.id);
    },
    onError: (e) => {
      const f = apiFieldError(e) ?? staffNoError(e);
      if (f) return setErrors(f);
      setFailure(errorText(e));
    },
  });
  const submit = () => {
    setFailure(null);
    const r = userSchema.safeParse({ name, username, mobile, email, grants });
    const next = r.success ? {} : zodErrors(r.error);
    if (setup === "PASSWORD" && !setupPasswordOk(password, username)) next.temporaryPassword = "The temporary password doesn't meet all the rules below.";
    const grantErr = Object.entries(next).find(([k]) => k.startsWith("grants"));
    if (grantErr) next.grants = grantErr[1];
    setErrors(next);
    if (Object.keys(next).length === 0) create.mutate();
  };
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title="Add user"
      description="One account per person, whatever campuses and roles they work in."
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" icon={setup === "INVITE" ? "send" : "check"} onClick={submit} loading={create.isPending} loadingLabel="Creating…">
            {setup === "INVITE" ? "Create and send code" : "Create account"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        {failure && <Banner tone="danger" title="Not created.">{failure}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Full name"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!usernameTouched) setUsername(usernameFrom(e.target.value));
              setErrors((x) => ({ ...x, name: undefined }));
            }}
            placeholder="Ms Rabia Aslam"
            {...err(errors, "name")}
          />
          <Input
            label="Username"
            required
            mono
            value={username}
            onChange={(e) => {
              setUsername(e.target.value.toLowerCase());
              setUsernameTouched(true);
              setErrors((x) => ({ ...x, username: undefined }));
            }}
            {...(errors.username ? { error: errors.username } : { help: "Used to sign in. Suggested from the name." })}
          />
          <Input label="Mobile" required inputMode="tel" value={mobile} onChange={(e) => { setMobile(e.target.value); setErrors((x) => ({ ...x, mobile: undefined })); }} placeholder="0300-5550101" {...(errors.mobile ? { error: errors.mobile } : { help: "Sign-in and reset codes go here." })} />
          <StaffPicker
            campus={grants[0]?.campus ?? defaultCampus}
            value={staffNo}
            error={errors.staffNo}
            onChange={(no, staff) => {
              setStaffNo(no);
              setErrors((x) => ({ ...x, staffNo: undefined }));
              // Fill what the staff record already knows, without overwriting anything typed.
              if (staff && !name.trim()) {
                setName(staff.name);
                if (!usernameTouched) setUsername(usernameFrom(staff.name));
              }
              if (staff && !mobile.trim() && staff.mobile) setMobile(staff.mobile);
            }}
          />
          <Input label="Email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }} className="sm:col-span-2" {...(errors.email ? { error: errors.email } : { help: "Optional." })} />
        </div>
        <GrantRows grants={grants} onChange={(g) => { setGrants(g); setErrors((x) => ({ ...x, grants: undefined })); }} roles={roles} error={errors.grants} />
        <div className="grid gap-1">
          <Switch label="Ask for a code from their phone at sign-in (two-step)" checked={required || twoStep} disabled={required} onChange={(e) => setTwoStep(e.target.checked)} />
          <span className="text-small text-ink-muted">{required ? "Required by one of the roles above." : "Recommended for anyone who handles money or results."}</span>
        </div>
        <fieldset className="m-0 grid gap-3 rounded-md border border-border p-4">
          <legend className="px-1 text-small font-medium text-ink">First sign-in</legend>
          <Radio name="setup" checked={setup === "INVITE"} onChange={() => setSetup("INVITE")} label="Send a one-time sign-in code by SMS (recommended). They choose their own password." />
          <Radio name="setup" checked={setup === "PASSWORD"} onChange={() => setSetup("PASSWORD")} label="Set a temporary password and tell them in person" />
          {setup === "PASSWORD" && (
            <div className="grid gap-3 pl-6">
              <div className="flex items-end gap-2">
                <Input
                  label="Temporary password"
                  type={reveal.type}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrors((x) => ({ ...x, temporaryPassword: undefined }));
                  }}
                  action={reveal.action}
                  className="flex-1"
                  {...err(errors, "temporaryPassword")}
                />
                <Button icon="refresh" onClick={() => setPassword(suggestPassword())}>
                  Suggest
                </Button>
              </div>
              <PasswordRules password={password} username={username} />
              <Checkbox checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} label="Must choose their own password at the first sign-in" />
            </div>
          )}
        </fieldset>
      </div>
    </SidePanel>
  );
}

/* ------------------------------------------------------------------ Reset password */

function ResetPasswordModal({ user, onClose }: { user: SetupUserDetail; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [signOut, setSignOut] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reveal = useReveal();
  const okRules = setupPasswordOk(password, user.username);
  const reset = useMutation({
    mutationFn: () => setupApi.resetPassword(ctx, user.id, { temporaryPassword: password, mustChangePassword: mustChange, signOutEverywhere: signOut, rowVer: user.rowVer }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: `Password reset for ${user.name}`, message: "Tell them the temporary password in person or by phone. It isn't shown again or sent by SMS." });
      onClose();
    },
    onError: (e) => setError(conflictOf(e) ? "This account was changed by someone else. Close this and open the account again." : errorText(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password for ${user.name}`}
      description="Set a temporary password. Nobody, including admins, can see anyone's current password."
      footer={
        <>
          <Button onClick={onClose} disabled={reset.isPending}>
            Cancel
          </Button>
          <Button variant="primary" icon="key" disabled={!okRules} loading={reset.isPending} loadingLabel="Resetting…" onClick={() => reset.mutate()}>
            Reset password
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {user.status === "LOCKED" && <Banner tone="info">Resetting the password also unlocks the account.</Banner>}
        {error && <Banner tone="danger" title="Not reset.">{error}</Banner>}
        <div className="flex items-end gap-2">
          <Input label="Temporary password" type={reveal.type} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} action={reveal.action} className="flex-1" data-autofocus />
          <Button icon="refresh" onClick={() => setPassword(suggestPassword())}>
            Suggest
          </Button>
        </div>
        <PasswordRules password={password} username={user.username} />
        <Checkbox checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} label="Must choose their own password at the next sign-in" />
        <Checkbox checked={signOut} onChange={(e) => setSignOut(e.target.checked)} label="Sign them out on every computer and phone now" />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ User detail */

type Confirming = { kind: "LOCK" | "DISABLE" | "SIGN_OUT" | "TWO_STEP_OFF" } | null;

function UserDetailBody({ user, roles }: { user: SetupUserDetail; roles: SetupRole[] }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useSessionUser();
  const readOnly = useReadOnly();
  const readOnlyNote = useReadOnlyText();
  const editable = user.managedHere && !readOnly;
  const self = me?.id === user.id;
  const [form, setForm] = useState({ name: user.name, username: user.username, mobile: user.mobile, email: user.email ?? "", staffNo: user.staffNo ?? "" });
  const [grants, setGrants] = useState<Grant[]>(user.grants.map((g) => ({ roleId: g.roleId, campus: g.campus })));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [reason, setReason] = useState("");
  const dirty =
    form.name !== user.name ||
    form.username !== user.username ||
    form.mobile !== user.mobile ||
    form.email !== (user.email ?? "") ||
    form.staffNo !== (user.staffNo ?? "") ||
    JSON.stringify(grants) !== JSON.stringify(user.grants.map((g) => ({ roleId: g.roleId, campus: g.campus })));
  const required = grants.some((g) => roles.find((r) => r.id === g.roleId)?.twoStepRequired);
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const save = useMutation({
    mutationFn: () => setupApi.updateUser(ctx, user.id, { ...form, email: form.email || null, staffNo: form.staffNo || null, grants, twoStep: user.twoStep, rowVer: user.rowVer }),
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: `${u.name} saved`, message: "Role changes apply from the next page they open." });
    },
    onError: (e) => {
      const c = conflictOf(e);
      if (c) return setConflict(c);
      const f = apiFieldError(e) ?? staffNoError(e);
      if (f) return setErrors(f);
      setFailure(errorText(e));
    },
  });
  const act = useMutation({
    mutationFn: (a: SetupUserAction) => setupApi.userAction(ctx, user.id, a, user.rowVer),
    onSuccess: (u, a) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      const msg: Record<SetupUserAction["type"], string> = {
        LOCK: `${u.name} is locked and signed out everywhere.`,
        UNLOCK: `${u.name} can sign in again.`,
        DISABLE: `${u.name}'s account is disabled. Their past work stays on record.`,
        ENABLE: `${u.name}'s account is enabled. They must choose a new password.`,
        TWO_STEP: u.twoStep ? `Two-step sign-in is on for ${u.name}.` : `Two-step sign-in is off for ${u.name}.`,
        FORCE_CHANGE: u.mustChangePassword ? `${u.name} must change their password at the next sign-in.` : "Password change cancelled.",
        SIGN_OUT_EVERYWHERE: `${u.name} is signed out on every device.`,
        RESEND_INVITE: `A new sign-in code was sent to ${u.mobile.slice(0, 5)}•••••${u.mobile.slice(-2)}.`,
      };
      toast({ title: msg[a.type] });
      setConfirming(null);
      setReason("");
    },
    onError: (e) => {
      setConfirming(null);
      const c = conflictOf(e);
      if (c) return setConflict(c);
      setFailure(errorText(e));
    },
  });
  const submit = () => {
    setFailure(null);
    const r = userSchema.safeParse({ ...form, grants });
    if (!r.success) {
      const next = zodErrors(r.error);
      const g = Object.entries(next).find(([k]) => k.startsWith("grants"));
      if (g) next.grants = g[1];
      return setErrors(next);
    }
    save.mutate();
  };

  return (
    <>
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={STATUS[user.status].badge}>{STATUS[user.status].label}</StatusBadge>
          {user.twoStep ? <StatusBadge status="success" dot={false}>Two-step on</StatusBadge> : user.twoStepRequired ? <StatusBadge status="warning">Two-step needed</StatusBadge> : <StatusBadge status="neutral" dot={false}>Password only</StatusBadge>}
          {user.mustChangePassword && <StatusBadge status="info" dot={false}>Must change password</StatusBadge>}
        </div>
        {conflict && <ConflictBanner conflict={conflict} onReload={() => void qc.invalidateQueries({ queryKey: ["setup"] })} />}
        {failure && <Banner tone="danger" title="Not saved.">{failure}</Banner>}
        {!user.managedHere && <Banner tone="info" icon="lock">This is a head-office account. You can see it because it covers your campus; only head office can change it.</Banner>}
        {readOnly && <Banner tone="info">{readOnlyNote}</Banner>}
        {user.status === "LOCKED" && (
          <Banner tone="danger" title={`Locked ${whenText(user.lockedAt)}.`} actions={editable && <Button size="sm" onClick={() => act.mutate({ type: "UNLOCK" })} loading={act.isPending}>Unlock</Button>}>
            {user.failedAttempts ? `After ${user.failedAttempts} wrong passwords. ` : ""}Speak to them first: if it wasn't them, reset the password instead.
          </Banner>
        )}
        {user.status === "DISABLED" && <Banner tone="neutral" title="Disabled.">{user.disabledReason ?? "No reason recorded."}</Banner>}
        {user.staff?.left && user.status !== "DISABLED" && (
          <Banner
            tone="warning"
            title={`${user.staff.name} has left the school.`}
            actions={editable && !self && <Button size="sm" variant="danger-quiet" icon="ban" onClick={() => act.mutate({ type: "DISABLE", reason: LEFT_REASON })} loading={act.isPending}>Disable now</Button>}
          >
            Staff &amp; payroll shows them as left, but this account can still sign in.
          </Banner>
        )}
        {user.status === "INVITED" && (
          <Banner tone="info" title="Hasn't signed in yet." actions={editable && <Button size="sm" icon="send" onClick={() => act.mutate({ type: "RESEND_INVITE" })} loading={act.isPending}>Resend code</Button>}>
            The one-time code works for 48 hours.
          </Banner>
        )}

        {editable && (
          <div className="flex flex-wrap gap-2">
            {user.status !== "DISABLED" && (
              <Button size="sm" icon="key" onClick={() => setResetting(true)}>
                Reset password
              </Button>
            )}
            {user.status === "ACTIVE" && !self && (
              <Button size="sm" icon="lock" variant="danger-quiet" onClick={() => setConfirming({ kind: "LOCK" })}>
                Lock
              </Button>
            )}
            {user.status !== "DISABLED" && user.status !== "INVITED" && (
              <Button size="sm" icon="logout" variant="ghost" onClick={() => setConfirming({ kind: "SIGN_OUT" })}>
                Sign out everywhere
              </Button>
            )}
            {user.status === "DISABLED" ? (
              <Button size="sm" icon="unlock" onClick={() => act.mutate({ type: "ENABLE" })} loading={act.isPending}>
                Enable account
              </Button>
            ) : (
              !self && (
                <Button size="sm" icon="ban" variant="danger-quiet" onClick={() => setConfirming({ kind: "DISABLE" })}>
                  Disable (left the school)
                </Button>
              )
            )}
          </div>
        )}

        <section className="grid gap-3">
          <h3 className="m-0 text-title-3">Sign-in security</h3>
          <div className="grid gap-1">
            <Switch
              label="Two-step sign-in (code from their phone)"
              checked={user.twoStep}
              disabled={!editable || act.isPending || (user.twoStep && user.twoStepRequired)}
              onChange={(e) => (e.target.checked ? act.mutate({ type: "TWO_STEP", on: true }) : setConfirming({ kind: "TWO_STEP_OFF" }))}
            />
            <span className="text-small text-ink-muted">{user.twoStepRequired ? "Required by their role, so it can't be turned off here." : "Optional for their role."}</span>
          </div>
          <Switch label="Must change password at the next sign-in" checked={user.mustChangePassword} disabled={!editable || act.isPending || user.status === "INVITED"} onChange={(e) => act.mutate({ type: "FORCE_CHANGE", on: e.target.checked })} />
          <KeyValue
            items={[
              ["Last sign-in", user.lastSignInAt ? `${whenText(user.lastSignInAt)}${user.lastSignInDevice ? ` · ${user.lastSignInDevice}` : ""}` : "Never"],
              ["Password last set", user.passwordChangedAt ? formatDateTime(user.passwordChangedAt) : "Not yet"],
              ["Account created", `${formatDateTime(user.createdAt)} by ${user.createdBy}`],
              ["Last changed", `${formatDateTime(user.updatedAt)} by ${user.updatedBy}`],
            ]}
          />
        </section>

        <section className="grid gap-4">
          <h3 className="m-0 text-title-3">Details and roles</h3>
          {user.staff ? (
            <KeyValue
              items={[
                ["Staff record", `${user.staff.name} · ${user.staff.designation}`],
                ["Works at", `${user.staff.campusName}${user.staff.left ? " · has left" : ""}`],
              ]}
            />
          ) : user.staffNo ? (
            <Banner tone="warning">No staff record has the number {user.staffNo}. Choose the person from the staff list.</Banner>
          ) : (
            <p className="m-0 text-small text-ink-muted">Not linked to a staff record.</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" required disabled={!editable} value={form.name} onChange={(e) => set("name", e.target.value)} {...err(errors, "name")} />
            <Input label="Username" required mono disabled={!editable} value={form.username} onChange={(e) => set("username", e.target.value.toLowerCase())} {...err(errors, "username")} />
            <Input label="Mobile" required inputMode="tel" disabled={!editable} value={form.mobile} onChange={(e) => set("mobile", e.target.value)} {...err(errors, "mobile")} />
            <StaffPicker campus={grants[0]?.campus ?? ctx.campus} value={form.staffNo} current={user.staff} disabled={!editable} error={errors.staffNo} onChange={(no) => set("staffNo", no)} />
            <Input label="Email" type="email" disabled={!editable} value={form.email} onChange={(e) => set("email", e.target.value)} className="sm:col-span-2" {...err(errors, "email")} />
          </div>
          <GrantRows grants={grants} onChange={(g) => { setGrants(g); setErrors((x) => ({ ...x, grants: undefined })); }} roles={roles} error={errors.grants} disabled={!editable} />
          {required && !user.twoStep && <Banner tone="warning">One of these roles needs two-step sign-in. They will be asked to set it up at their next sign-in.</Banner>}
          {editable && (
            <div className="flex justify-end gap-2">
              <Button variant="primary" icon="check" disabled={!dirty || Boolean(conflict)} loading={save.isPending} loadingLabel="Saving…" onClick={submit}>
                Save changes
              </Button>
            </div>
          )}
        </section>

        <section className="grid gap-2">
          <h3 className="m-0 text-title-3">Recent sign-ins</h3>
          {user.signIns.length === 0 ? (
            <p className="m-0 text-small text-ink-muted">No sign-ins yet.</p>
          ) : (
            <ul className="setup-list">
              {user.signIns.map((s, i) => (
                <li key={`${s.at}-${i}`} className="setup-row">
                  <span className={cx("setup-row-icon", s.outcome === "SUCCESS" ? "tone-success" : s.outcome === "LOCKED" ? "tone-danger" : "tone-warning")} aria-hidden="true">
                    <Icon name={s.outcome === "SUCCESS" ? "check" : s.outcome === "LOCKED" ? "lock" : "x"} size={16} />
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <span className="text-ink">{s.outcome === "SUCCESS" ? "Signed in" : s.outcome === "LOCKED" ? "Account locked" : s.outcome === "WRONG_CODE" ? "Wrong two-step code" : "Wrong password"}</span>
                    <span className="truncate text-small text-ink-muted">
                      {s.device} · {s.place}
                    </span>
                  </span>
                  <span className="text-small tabular-nums text-ink-muted">{whenText(s.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {resetting && <ResetPasswordModal user={user} onClose={() => setResetting(false)} />}
      <ConfirmDialog
        open={confirming?.kind === "LOCK"}
        onClose={() => setConfirming(null)}
        onConfirm={() => act.mutate({ type: "LOCK" })}
        tone="danger"
        icon="lock"
        title={`Lock ${user.name}'s account?`}
        message="They are signed out everywhere at once and can't sign in until someone unlocks the account. Use this if a phone is lost or you suspect someone else is using the account."
        confirmLabel="Lock account"
        loading={act.isPending}
        loadingLabel="Locking…"
      />
      <ConfirmDialog
        open={confirming?.kind === "SIGN_OUT"}
        onClose={() => setConfirming(null)}
        onConfirm={() => act.mutate({ type: "SIGN_OUT_EVERYWHERE" })}
        tone="warning"
        icon="logout"
        title={`Sign ${user.name} out everywhere?`}
        message="Every computer and phone they are signed in on is signed out now. Their password doesn't change."
        confirmLabel="Sign out everywhere"
        loading={act.isPending}
      />
      <ConfirmDialog
        open={confirming?.kind === "TWO_STEP_OFF"}
        onClose={() => setConfirming(null)}
        onConfirm={() => act.mutate({ type: "TWO_STEP", on: false })}
        tone="warning"
        icon="shield"
        title={`Turn off two-step sign-in for ${user.name}?`}
        message="They will sign in with a password only. Anyone who learns the password could then sign in as them."
        confirmLabel="Turn off"
        loading={act.isPending}
      />
      <ConfirmDialog
        open={confirming?.kind === "DISABLE"}
        onClose={() => {
          setConfirming(null);
          setReason("");
        }}
        onConfirm={() => reason.trim() && act.mutate({ type: "DISABLE", reason })}
        tone="danger"
        icon="ban"
        title={`Disable ${user.name}'s account?`}
        message="Use this when someone leaves. They can't sign in, and their receipts, marks and approvals stay on record under their name."
        confirmLabel="Disable account"
        loading={act.isPending}
        loadingLabel="Disabling…"
      >
        <div className="mt-3">
          <Textarea label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Left the school on 30-Nov-2026" {...(reason.trim() ? {} : { help: "Required. Shown on the account and in the audit log." })} />
        </div>
      </ConfirmDialog>
    </>
  );
}

function UserPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const ctx = useCtx();
  const q = useQuery(setupQueries.user(ctx, id));
  const roles = useQuery(setupQueries.roles(ctx)).data ?? [];
  const u = q.data;
  return (
    <SidePanel open wide onClose={onClose} title={u?.name ?? "User"} description={u ? `${u.username}${u.staff ? ` · ${u.staff.designation}` : ""}${u.staffNo ? ` · ${u.staffNo}` : ""} · ${u.mobile}` : "Loading…"}>
      {q.isError ? (
        <QueryError what="This account" error={q.error} onRetry={() => void q.refetch()} />
      ) : !u ? (
        <div className="grid gap-3">
          <Skeleton height={24} width="40%" />
          <Skeleton height={120} />
          <Skeleton height={200} />
        </div>
      ) : (
        <UserDetailBody key={`${u.id}:${u.rowVer}`} user={u} roles={roles} />
      )}
    </SidePanel>
  );
}

/* ------------------------------------------------------------------ Page */

export function UsersPage({ filter, onFilter }: { filter: SetupUserFilter; onFilter: (f: SetupUserFilter) => void }) {
  const ctx = useCtx();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const roles = useQuery(setupQueries.roles(ctx)).data ?? [];
  const list = useQuery({ ...setupQueries.users(ctx, { q: q.trim(), role, filter, page, pageSize }), placeholderData: keepPreviousData });
  const everyone = useQuery(setupQueries.users(ctx, { filter: "ALL", page: 1, pageSize: 100 }));
  const data = list.data;
  const counts = data?.counts;
  const readOnly = useReadOnly();
  const toast = useToast();
  const qc = useQueryClient();
  // One click for accounts whose staff member has left (Staff & payroll); the reason is recorded in the audit log.
  const disable = useMutation({
    mutationFn: (u: SetupUser) => setupApi.userAction(ctx, u.id, { type: "DISABLE", reason: LEFT_REASON }, u.rowVer),
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: `${u.name}'s account is disabled`, message: "Their past work stays on record." });
    },
    onError: (e) => toast({ tone: "danger", title: "Not disabled", message: conflictOf(e) ? "Someone changed this account. Open it and try again." : errorText(e) }),
  });
  const searching = Boolean(q.trim() || role || filter !== "ALL");

  return (
    <SetupPage
      title="Users"
      actions={
        <>
          <Button icon="printer" onClick={() => window.print()} disabled={!everyone.data}>
            Print access review
          </Button>
          <EditButton variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add user
          </EditButton>
        </>
      }
    >
      <Panel id="users-list" title="Accounts" description="Passwords are never shown or sent by SMS. Click a person to manage their account." flush rise={0}>
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          <Segmented
            aria-label="Show"
            className="max-w-full flex-wrap"
            value={filter}
            onChange={(v) => {
              onFilter(v as SetupUserFilter);
              setPage(1);
            }}
            options={FILTERS.map((f) => ({ value: f.id, label: counts ? `${f.label} · ${formatCount(counts[f.id])}` : f.label }))}
          />
        </div>
        <DataTable
          rows={data?.items ?? []}
          loading={list.isLoading}
          onRowClick={(u) => setOpen(u.id)}
          caption="User accounts"
          rowClassName={(u) => (u.status === "DISABLED" ? "opacity-70" : undefined)}
          toolbar={
            <div className="flex w-full flex-wrap items-center gap-3">
              <div className="w-72 max-w-full">
                <Input
                  aria-label="Search users"
                  icon="search"
                  placeholder="Name, username, mobile or staff number"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="w-52">
                <Select
                  aria-label="Role"
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value);
                    setPage(1);
                  }}
                  options={[{ value: "", label: "All roles" }, ...roles.map((r) => ({ value: r.id, label: r.name }))]}
                />
              </div>
              {searching && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="x"
                  onClick={() => {
                    setQ("");
                    setRole("");
                    onFilter("ALL");
                    setPage(1);
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          }
          empty={
            list.isError ? (
              <div className="p-4">
                <QueryError what="The users" error={list.error} onRetry={() => void list.refetch()} />
              </div>
            ) : (
              <EmptyState icon="user" title={searching ? "No one matches" : "No accounts yet"} description={searching ? "Check the spelling, or clear the filters." : "Add the first user for this campus."} />
            )
          }
          columns={[
            {
              key: "name",
              header: "Person",
              render: (u: SetupUser) => (
                <span className="flex items-center gap-3">
                  <Avatar name={u.name.replace(/^(Mr|Ms|Mrs|Dr)\s+/, "")} size="sm" />
                  <span className="grid min-w-0">
                    <span className="font-medium">{u.name}</span>
                    <span className="mtb-cell-secondary">
                      <span className="mtb-mono">{u.username}</span>
                      {u.staff && <> · {u.staff.designation}</>}
                    </span>
                  </span>
                </span>
              ),
            },
            {
              key: "roles",
              header: "Roles",
              render: (u) => (
                <span className="flex flex-wrap gap-1">
                  {u.grants.map((g) => (
                    <StatusBadge key={`${g.roleId}${g.campus}`} status={g.campus === "ALL" ? "brand" : "neutral"} dot={false}>
                      {g.roleName} — {g.campus === "ALL" ? "All campuses" : g.campusName}
                    </StatusBadge>
                  ))}
                </span>
              ),
            },
            { key: "mobile", header: "Mobile", render: (u) => <span className="tabular-nums">{u.mobile}</span> },
            { key: "twoStep", header: "Two-step", render: (u) => (u.twoStep ? <StatusBadge status="success" dot={false}>On</StatusBadge> : u.twoStepRequired && u.status !== "DISABLED" ? <StatusBadge status="warning">Needed</StatusBadge> : <span className="text-small text-ink-muted">Off</span>) },
            { key: "last", header: "Last sign-in", render: (u) => <span className="text-small">{whenText(u.lastSignInAt)}</span> },
            { key: "status", header: "Status", render: (u) => <StatusBadge status={STATUS[u.status].badge}>{STATUS[u.status].label}</StatusBadge> },
            ...(filter === "STAFF_LEFT"
              ? [
                  {
                    key: "disable",
                    header: <span className="mtb-sr-only">Disable</span>,
                    width: 120,
                    render: (u: SetupUser) =>
                      u.managedHere && u.status !== "DISABLED" && !readOnly ? (
                        <Button
                          size="sm"
                          variant="danger-quiet"
                          icon="ban"
                          loading={disable.isPending && disable.variables?.id === u.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            disable.mutate(u);
                          }}
                        >
                          Disable
                        </Button>
                      ) : null,
                  },
                ]
              : []),
          ]}
          pagination={
            data && data.total > 0 ? (
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPageChange={setPage}
                pageSizes={[10, 25, 50]}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setPage(1);
                }}
              />
            ) : undefined
          }
        />
      </Panel>
      {everyone.data && (
        <PrintSheet title="Access review: who can sign in and what they can do" scope={`${CAMPUS_LABEL[ctx.campus]} · ${formatCount(everyone.data.total)} accounts`}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Roles</th>
                <th>Two-step</th>
                <th>Last sign-in</th>
                <th>Status</th>
                <th>Keep? (tick)</th>
              </tr>
            </thead>
            <tbody>
              {everyone.data.items.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.username}</td>
                  <td>{u.grants.map((g) => `${g.roleName} — ${g.campus === "ALL" ? "All campuses" : g.campusName}`).join("; ")}</td>
                  <td>{u.twoStep ? "On" : u.twoStepRequired ? "Needed" : "Off"}</td>
                  <td>{whenText(u.lastSignInAt)}</td>
                  <td>{STATUS[u.status].label}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </PrintSheet>
      )}
      {open && <UserPanel id={open} onClose={() => setOpen(null)} />}
      {adding && (
        <NewUserPanel
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            setOpen(id);
          }}
        />
      )}
    </SetupPage>
  );
}
