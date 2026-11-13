import { smsApi, smsQueries, type SmsGatewaySettings, type SmsProvider } from "@mtb/api";
import { formatCount, formatDateTime, formatRs } from "@mtb/domain";
import { AmountInput, Banner, Button, EmptyState, Input, KeyValue, Panel, Select, SidePanel, Skeleton, StatusBadge, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { KillSwitch } from "./KillSwitch";
import { errorField, errorText, LoadError, MessagesShell } from "./shell";

const PROVIDERS: SmsProvider[] = ["LRT", "UFONE", "ZONG", "JAZZ"];
const time12 = (s: string) => {
  const h = Number(s.slice(0, 2));
  return `${((h + 11) % 12) + 1}:${s.slice(3, 5)} ${h < 12 ? "AM" : "PM"}`;
};
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: `${String(h).padStart(2, "0")}:00`, label: time12(`${String(h).padStart(2, "0")}:00`) }));

/** /sms/settings — the SMS company each campus uses, what it costs, limits and the kill switch. */
export function SettingsPage() {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canAdmin = useCan("sms.pause");
  const readOnly = useReadOnly();
  const q = useQuery(smsQueries.settings(ctx));
  const [editing, setEditing] = useState<SmsGatewaySettings | null>(null);
  const test = useMutation({
    mutationFn: (campus: SmsGatewaySettings["campus"]) => smsApi.testGateway(campus),
    // Nothing is contacted while sending is switched off: the answer says so (ok false).
    onSuccess: async (r) => {
      toast(r.ok ? { title: "Check passed", message: r.message } : { tone: "info", title: "Sending is switched off", message: r.message });
      await queryClient.invalidateQueries({ queryKey: smsQueries.settings(ctx).queryKey });
    },
    onError: (e) => toast({ tone: "danger", title: "Check failed", message: errorText(e) }),
  });

  return (
    <MessagesShell title="SMS companies and limits">
      <p className="m-0 max-w-3xl text-small text-ink-muted">
        Sending is switched off in this system: no SMS company account is connected and no message leaves the server. Messages are written and held in the outbox. The settings below (company, sender name, price, limits and quiet hours) are kept for each campus and used to count SMS parts, estimate costs and decide which sends need approval.
      </p>
      {q.error && !q.data ? (
        <LoadError what="SMS settings" error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton height={300} />
          <Skeleton height={300} />
        </div>
      ) : !q.data?.length ? (
        <EmptyState icon="settings" title="No SMS company set up" description="No SMS settings are recorded for this campus." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data.map((s, i) => (
            <Panel
              key={s.campus}
              id={`gw-${s.campus}`}
              rise={i}
              title={s.campusName}
              description={`${s.provider}${s.backupProvider ? `, backup ${s.backupProvider}` : ", no backup"} · sender name ${s.senderName}`}
              actions={
                canAdmin && !readOnly ? (
                  <div className="flex gap-2">
                    <Button size="sm" icon="refresh" loading={test.isPending && test.variables === s.campus} loadingLabel="Checking…" onClick={() => test.mutate(s.campus)}>
                      Check
                    </Button>
                    <Button size="sm" icon="edit" onClick={() => setEditing(s)}>
                      Change
                    </Button>
                  </div>
                ) : undefined
              }
            >
              <KeyValue
                items={[
                  ["Account", s.credentials === "VERIFIED" ? <StatusBadge key="v" status="success">Connected</StatusBadge> : <StatusBadge key="v" status="neutral">Sending is switched off in this system</StatusBadge>],
                  ["Last checked", s.lastCheckedAt ? formatDateTime(s.lastCheckedAt) : "—"],
                  ["Price", `${formatRs(s.ratePer100)} per 100 SMS parts`],
                  ["Monthly budget", formatRs(s.monthlyBudget)],
                  ["Daily limit", `${formatCount(s.dailyCap)} SMS parts; the rest wait for the next day`],
                  ["Principal approves", `Sends to ${formatCount(s.approvalThreshold)} or more people`],
                  ["Quiet hours", `No SMS from ${time12(s.quietFrom)} to ${time12(s.quietTo)}`],
                  ["Delivery reports", s.deliveryReports ? "Yes — each SMS shows delivered or failed" : "None — nothing is sent from this system; old messages show “sent” or “failed” only"],
                  ["Last changed", s.updatedAt ? `${s.updatedBy || "—"}, ${formatDateTime(s.updatedAt)}` : "—"],
                ]}
              />
            </Panel>
          ))}
        </div>
      )}
      {!canAdmin && <Banner tone="neutral" icon="lock">Only an admin can change SMS companies and limits.</Banner>}
      {canAdmin && <KillSwitch />}
      <SettingsEditor key={editing?.campus ?? "none"} settings={editing} onClose={() => setEditing(null)} />
    </MessagesShell>
  );
}

const schema = z.object({
  senderName: z.string().regex(/^[A-Za-z0-9 -]{3,11}$/, "Use 3 to 11 letters, numbers, spaces or dashes."),
  ratePer100: z.number({ message: "Enter the price for 100 SMS." }).int().min(1, "Enter the price for 100 SMS.").max(999, "That price looks too high; check it."),
  monthlyBudget: z.number({ message: "Enter the monthly budget." }).int().min(0),
  dailyCap: z.number().int().min(100, "Allow at least 100 SMS a day."),
  approvalThreshold: z.number().int().min(50, "Approval is needed from at least 50 recipients."),
});

function SettingsEditor({ settings, onClose }: { settings: SmsGatewaySettings | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<SmsProvider>(settings?.provider ?? "LRT");
  const [backup, setBackup] = useState<SmsProvider | "">(settings?.backupProvider ?? "");
  const [senderName, setSenderName] = useState(settings?.senderName ?? "");
  const [rate, setRate] = useState<number | null>(settings?.ratePer100 ?? null);
  const [budget, setBudget] = useState<number | null>(settings?.monthlyBudget ?? null);
  const [cap, setCap] = useState(String(settings?.dailyCap ?? ""));
  const [threshold, setThreshold] = useState(String(settings?.approvalThreshold ?? ""));
  const [quietFrom, setQuietFrom] = useState(settings?.quietFrom ?? "21:00");
  const [quietTo, setQuietTo] = useState(settings?.quietTo ?? "07:00");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => smsApi.saveSettings(settings!.campus, { provider, backupProvider: backup || null, senderName, ratePer100: rate ?? 0, monthlyBudget: budget ?? 0, dailyCap: Number(cap), approvalThreshold: Number(threshold), quietFrom, quietTo }),
    onSuccess: async (s) => {
      await queryClient.invalidateQueries({ queryKey: smsQueries.settings(ctx).queryKey });
      onClose();
      toast({ title: `Saved · ${s.campusName}`, message: "New messages use these settings from now on." });
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const submit = () => {
    const r = schema.safeParse({ senderName, ratePer100: rate ?? Number.NaN, monthlyBudget: budget ?? 0, dailyCap: Number(cap) || 0, approvalThreshold: Number(threshold) || 0 });
    const next: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) next[String(i.path[0])] ??= i.message;
    if (backup && backup === provider) next.backupProvider = "Choose a different company as the backup, or none.";
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  };
  return (
    <SidePanel
      open={settings !== null}
      onClose={onClose}
      title={settings ? `SMS settings · ${settings.campusName}` : "SMS settings"}
      description="Changes apply to new messages. No account details are entered here: sending is switched off in this system."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" loading={save.isPending} loadingLabel="Saving…" onClick={submit}>
            Save settings
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {save.error && !errorField(save.error) && <Banner tone="danger">{errorText(save.error)}</Banner>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="SMS company" value={provider} onChange={(e) => setProvider(e.target.value as SmsProvider)} options={PROVIDERS} />
          <Select label="Backup company" value={backup} onChange={(e) => setBackup(e.target.value as SmsProvider | "")} options={[{ value: "", label: "None" }, ...PROVIDERS]} {...(errors.backupProvider ? { error: errors.backupProvider } : {})} />
        </div>
        <Input label="Sender name families see" mono value={senderName} onChange={(e) => setSenderName(e.target.value.toUpperCase())} help="Must be approved by the SMS company, e.g. MTB-KC." {...(errors.senderName ? { error: errors.senderName } : {})} />
        <div className="grid gap-3 sm:grid-cols-2">
          <AmountInput label="Price per 100 SMS parts" value={rate} onValueChange={setRate} {...(errors.ratePer100 ? { error: errors.ratePer100 } : {})} />
          <AmountInput label="Monthly budget" value={budget} onValueChange={setBudget} {...(errors.monthlyBudget ? { error: errors.monthlyBudget } : {})} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Daily limit" suffix="SMS parts" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} {...(errors.dailyCap ? { error: errors.dailyCap } : {})} />
          <Input label="Principal approves sends to" suffix="or more people" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ""))} {...(errors.approvalThreshold ? { error: errors.approvalThreshold } : {})} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="No SMS from" value={quietFrom} onChange={(e) => setQuietFrom(e.target.value)} options={HOURS} />
          <Select label="Until" value={quietTo} onChange={(e) => setQuietTo(e.target.value)} options={HOURS} help="Scheduled SMS can't be set in these hours. App notifications are not affected." />
        </div>
      </div>
    </SidePanel>
  );
}
