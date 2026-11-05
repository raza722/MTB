import { accountsApi, ApiError, type AccountsAccount, type AccountsKind, type CampusCode } from "@mtb/api";
import { formatRs } from "@mtb/domain";
import { Banner, Button, Combobox, ConfirmDialog, Field, Input, Segmented, Select, SidePanel, Switch, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { CAMPUS_LABEL } from "../../app/shell/campus";
import { suggestCode } from "./voucher-model";

const CAMPUS_CODES: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];

type Field = "parentCode" | "postable" | "code" | "name" | "normalSide" | "campus" | "kind" | "bankName" | "accountNo";
type Side = "DEBIT" | "CREDIT";

/** Under a group, a new entry is an account unless the group is already split into sub-groups. */
const defaultWhat = (parentCode: string | null, accounts: AccountsAccount[]): "account" | "group" => {
  const children = accounts.filter((a) => a.parentCode === parentCode);
  return children.length > 0 && children.every((a) => !a.postable) ? "group" : "account";
};
type Errors = Partial<Record<Field, string>>;

export interface AccountPanelProps {
  open: boolean;
  /** "add" under a group, or "edit" an existing account. */
  mode: "add" | "edit";
  /** Add: the group it was opened from. Edit: the account. */
  code: string | null;
  accounts: AccountsAccount[];
  onClose: () => void;
  onSaved: (account: AccountsAccount) => void;
}

/** Add or edit an account. The form remounts each time it opens, so it starts from what was clicked. */
export function AccountPanel(props: AccountPanelProps) {
  return props.mode === "add" ? <AddForm key={`add:${props.open}:${props.code ?? ""}`} {...props} /> : <EditForm key={`edit:${props.open}:${props.code ?? ""}`} {...props} />;
}

const addSchema = z.object({
  parentCode: z.string().min(1, "Choose the group this account belongs under."),
  code: z.string().regex(/^\d+$/, "Use digits only."),
  name: z.string().trim().min(2, 'Enter the account name, e.g. "Generator fuel".').max(60, "Keep the name under 60 characters."),
  normalSide: z.enum(["DEBIT", "CREDIT"], { error: "Choose Debit or Credit." }),
});

function AddForm({ open, code: initialParent, accounts, onClose, onSaved }: AccountPanelProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const codes = accounts.map((a) => a.code);
  const [parentCode, setParentCode] = useState<string | null>(initialParent);
  const [code, setCode] = useState(initialParent ? suggestCode(initialParent, codes) : "");
  const [codeTouched, setCodeTouched] = useState(false);
  const [what, setWhat] = useState<"account" | "group">(() => defaultWhat(initialParent, accounts));
  const [side, setSide] = useState<Side | null>(null);
  const [name, setName] = useState("");
  const [campus, setCampus] = useState<CampusCode | "">("");
  const [kind, setKind] = useState<AccountsKind>("OTHER");
  const [bankName, setBankName] = useState("");
  const [branch, setBranch] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const parent = accounts.find((a) => a.code === parentCode);
  const underClass = parent ? parent.parentCode === null : false;
  const makesGroup = parent ? underClass || what === "group" : false;
  const canBeCashBank = parent?.code === "11" && !makesGroup;
  const groups = accounts.filter((a) => !a.postable && a.active);
  const leafUnder = parent ? accounts.find((a) => a.parentCode === parent.code && a.postable) : undefined;
  const normalSide: Side = side ?? parent?.normalSide ?? "DEBIT";
  const contra = parent ? normalSide !== parent.normalSide : false;
  const width = parent ? parent.code.length + (underClass ? 1 : 2) : 4;

  const add = useMutation({
    mutationFn: () =>
      accountsApi.addAccount({
        parentCode: parentCode ?? "",
        code: code.trim(),
        name: name.trim(),
        ...(parent && !underClass ? { postable: what === "account" } : {}),
        normalSide,
        ...(campus ? { campus } : {}),
        ...(canBeCashBank ? { kind } : {}),
        ...(kind === "BANK" ? { bank: { bankName: bankName.trim(), branch: branch.trim(), accountNoMasked: accountNo } } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (acc) => {
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: `${acc.postable ? "Account" : underClass ? "Group" : "Sub-group"} ${acc.code} ${acc.name} added`, message: `Under ${parent ? `${parent.code} ${parent.name}` : "its group"}${acc.postable ? "; ready for vouchers." : "; add accounts under it before posting."}` });
      onSaved(acc);
    },
    onError: (e) => {
      const f = e instanceof ApiError ? e.field : undefined;
      const msg = e instanceof ApiError && !e.isNetwork ? e.message : "Not saved — no response from the server. Try again.";
      if (f === "parentCode" || f === "postable" || f === "code" || f === "name" || f === "normalSide" || f === "campus" || f === "kind" || f === "bankName" || f === "accountNo") setErrors({ [f]: msg });
      else setErrors({ name: msg });
    },
  });

  const submit = () => {
    const next: Errors = {};
    const parsed = addSchema.safeParse({ parentCode: parentCode ?? "", code: code.trim(), name, normalSide });
    if (!parsed.success) for (const i of parsed.error.issues) next[String(i.path[0]) as Field] ??= i.message;
    if (parent && !underClass && what === "group" && leafUnder) next.postable = `${parent.name} already has accounts under it (${leafUnder.code} ${leafUnder.name}), so it can't also have sub-groups. Add an account here, or choose another group.`;
    if (!next.code && parent && (code.trim().length !== width || !code.trim().startsWith(parent.code))) next.code = `Use ${width} digits starting with ${parent.code}, e.g. ${suggestCode(parent.code, codes)}.`;
    if (!next.code && codes.includes(code.trim())) next.code = `Code ${code.trim()} is already used. Try ${parent ? suggestCode(parent.code, codes) : "another code"}.`;
    if (kind === "BANK") {
      if (!campus) next.campus = "A bank account belongs to one campus. Choose it.";
      if (!bankName.trim()) next.bankName = "Enter the bank's name, e.g. Meezan Bank.";
      if (accountNo.replace(/\D/g, "").length < 4) next.accountNo = "Enter at least the last four digits of the account number.";
    }
    setErrors(next);
    if (Object.keys(next).length === 0) add.mutate();
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Add account"
      description="New accounts start with a zero balance. Only accounts without sub-accounts take postings."
      footer={
        <>
          <Button onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button variant="primary" icon="plus" onClick={submit} loading={add.isPending} loadingLabel="Adding…">
            Add account
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Combobox
          label="Group"
          required
          options={groups.map((g) => ({ value: g.code, label: `${g.code} ${g.name}`, keywords: [g.code, g.name] }))}
          value={parentCode}
          onValueChange={(v) => {
            setParentCode(v);
            if (!codeTouched) setCode(suggestCode(v, codes));
            if (v !== "11") setKind("OTHER");
            setWhat(defaultWhat(v, accounts));
            setSide(null);
            setErrors((e) => ({ ...e, parentCode: undefined, postable: undefined, code: undefined }));
          }}
          placeholder="Choose a group…"
          searchPlaceholder="Type a code or name"
          {...(errors.parentCode ? { error: errors.parentCode } : {})}
        />
        {parent && !underClass && (
          <Field
            label="Group or account?"
            {...(errors.postable
              ? { error: errors.postable }
              : { help: what === "group" ? `A sub-group holds accounts of its own, one level below ${parent.name}.` : "An account takes postings from vouchers." })}
          >
            <Segmented
              aria-label="Group or account"
              value={what}
              onChange={(v) => {
                setWhat(v as "account" | "group");
                if (v === "group") setKind("OTHER");
                setErrors((e) => ({ ...e, postable: undefined }));
              }}
              options={[
                { value: "account", label: "Account" },
                { value: "group", label: "Sub-group" },
              ]}
            />
          </Field>
        )}
        <Input
          label="Code"
          required
          mono
          inputMode="numeric"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ""));
            setCodeTouched(true);
            setErrors((er) => ({ ...er, code: undefined }));
          }}
          {...(errors.code ? { error: errors.code } : { help: parent ? `${width} digits. Suggested: the next free code under ${parent.name}.` : "Choose a group to get a suggested code." })}
        />
        <Input
          label="Account name"
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErrors((er) => ({ ...er, name: undefined }));
          }}
          placeholder="e.g. Generator fuel"
          {...(errors.name ? { error: errors.name } : {})}
        />
        <Select
          label="Normal balance"
          value={normalSide}
          onChange={(e) => {
            setSide(e.target.value as Side);
            setErrors((er) => ({ ...er, normalSide: undefined }));
          }}
          options={[
            { value: "DEBIT", label: "Debit (Dr)" },
            { value: "CREDIT", label: "Credit (Cr)" },
          ]}
          {...(errors.normalSide
            ? { error: errors.normalSide }
            : {
                help: contra
                  ? `Contra account: the other side from ${parent?.name ?? "its group"}, like accumulated depreciation under fixed assets.`
                  : `Same side as ${parent?.name ?? "its group"}. Pick the other side only for a contra account, such as accumulated depreciation.`,
              })}
        />
        {canBeCashBank && !makesGroup && (
          <div className="grid gap-2">
            <span className="text-small font-medium">What kind of account?</span>
            <Segmented
              aria-label="Kind of account"
              value={kind}
              onChange={(v) => setKind(v as AccountsKind)}
              options={[
                { value: "OTHER", label: "Other" },
                { value: "CASH", label: "Cash" },
                { value: "BANK", label: "Bank" },
              ]}
            />
            <span className="text-small text-ink-muted">Cash and bank accounts are the ones cash and bank vouchers pay from or receive into.</span>
          </div>
        )}
        <Select
          label="Used by"
          value={campus}
          onChange={(e) => {
            setCampus(e.target.value as CampusCode | "");
            setErrors((er) => ({ ...er, campus: undefined }));
          }}
          options={[{ value: "", label: "All campuses" }, ...CAMPUS_CODES.map((c) => ({ value: c, label: `${CAMPUS_LABEL[c]} only` }))]}
          help="Choose one campus only for things that belong to it, such as a campus bank account."
          {...(errors.campus ? { error: errors.campus } : {})}
        />
        {kind === "BANK" && (
          <>
            <Input label="Bank" required value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Meezan Bank" {...(errors.bankName ? { error: errors.bankName } : {})} />
            <Input label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="e.g. Sadiqabad branch" />
            <Input
              label="Account number"
              required
              mono
              inputMode="numeric"
              value={accountNo}
              onChange={(e) => setAccountNo(e.target.value.replace(/[^\d-]/g, ""))}
              help="Only the last four digits are kept and shown."
              {...(errors.accountNo ? { error: errors.accountNo } : {})}
            />
          </>
        )}
        <Textarea label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional: what this account is for" />
        {parent && (
          <Banner tone="neutral" title={makesGroup ? (underClass ? "This makes a new group." : "This makes a sub-group.") : "This makes an account that takes postings."}>
            {makesGroup ? `It sits under ${parent.code} ${parent.name}; add accounts under it before posting.` : `It sits under ${parent.code} ${parent.name} and can be used on vouchers straight away.`}
          </Banner>
        )}
      </div>
    </SidePanel>
  );
}

function EditForm({ open, code, accounts, onClose, onSaved }: AccountPanelProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const acc = accounts.find((a) => a.code === code);
  const [name, setName] = useState(acc?.name ?? "");
  const [note, setNote] = useState(acc?.note ?? "");
  const [campus, setCampus] = useState<CampusCode | "">(acc?.campus ?? "");
  const [active, setActive] = useState(acc?.active ?? true);
  const [bankName, setBankName] = useState(acc?.bank?.bankName ?? "");
  const [branch, setBranch] = useState(acc?.bank?.branch ?? "");
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      accountsApi.updateAccount(code ?? "", {
        name,
        note,
        ...(acc?.postable && !acc.used && (campus || null) !== (acc.campus ?? null) ? { campus: campus || null } : {}),
        ...(active !== acc?.active ? { active } : {}),
        ...(acc?.kind === "BANK" ? { bank: { bankName: bankName.trim(), branch: branch.trim(), accountNoMasked: acc.bank?.accountNoMasked ?? "" } } : {}),
      }),
    onSuccess: (a) => {
      setConfirmOff(false);
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: `${a.code} ${a.name} saved`, message: a.active ? "The change shows on every voucher and report." : "It no longer appears in account pickers. Its history stays." });
      onSaved(a);
    },
    onError: (e) => {
      setConfirmOff(false);
      setError({ ...(e instanceof ApiError && e.field ? { field: e.field } : {}), message: e instanceof ApiError && !e.isNetwork ? e.message : "Not saved — no response from the server. Try again." });
    },
  });

  if (!acc) return null;
  const submit = () => {
    if (name.trim().length < 2) {
      setError({ field: "name", message: "Enter the account name." });
      return;
    }
    if (!active && acc.active) setConfirmOff(true);
    else save.mutate();
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={`${acc.code} ${acc.name}`}
      description={acc.postable ? "Change the name or note, or switch the account off when it is no longer used." : "Rename the group, or switch it off once nothing under it is in use."}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={save.isPending} loadingLabel="Saving…">
            Save changes
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Input label="Code" value={acc.code} readOnly mono help={acc.used ? "Codes never change once vouchers use them." : "Codes never change; add a new account for a new code."} />
        <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} {...(error?.field === "name" ? { error: error.message } : {})} />
        {acc.postable && (
          <Select
            label="Used by"
            value={campus}
            disabled={acc.used || acc.kind === "BANK"}
            onChange={(e) => setCampus(e.target.value as CampusCode | "")}
            options={[{ value: "", label: "All campuses" }, ...CAMPUS_CODES.map((c) => ({ value: c, label: `${CAMPUS_LABEL[c]} only` }))]}
            help={acc.used ? "Vouchers already use this account, so its campus stays as it is." : acc.kind === "BANK" ? "A bank account belongs to its campus." : "Choose one campus only for things that belong to it."}
            {...(error?.field === "campus" ? { error: error.message } : {})}
          />
        )}
        {acc.kind === "BANK" && (
          <>
            <Input label="Bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
            <Input label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
            <Input label="Account number" value={acc.bank?.accountNoMasked ?? ""} readOnly mono help="Only the last four digits are kept." />
          </>
        )}
        <Textarea label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="grid gap-1">
          <Switch label="In use" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={Boolean(acc.control)} />
          <span className="text-small text-ink-muted">
            {acc.control
              ? `Filled by the ${acc.control === "FEE_OFFICE" ? "fee office" : "payroll"}; it can't be switched off.`
              : acc.postable
                ? `Switched-off accounts disappear from account pickers. Their history stays. Balance now: ${formatRs(Math.abs(acc.netDebit))}${acc.netDebit > 0 ? " Dr" : acc.netDebit < 0 ? " Cr" : ""}.`
                : "A group can be switched off once every account under it is off."}
          </span>
        </div>
        {error && !error.field && <Banner tone="danger">{error.message}</Banner>}
      </div>
      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        onConfirm={() => save.mutate()}
        tone="warning"
        title={`Switch off ${acc.code} ${acc.name}?`}
        message="It won't appear in account pickers any more. Vouchers already posted to it stay as they are, and you can switch it back on."
        confirmLabel="Switch off"
        loading={save.isPending}
        loadingLabel="Saving…"
      />
    </SidePanel>
  );
}
