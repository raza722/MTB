import { setupApi, setupQueries, type SetupSetting, type SetupSettings } from "@mtb/api";
import { formatDateTime, formatRs } from "@mtb/domain";
import { Banner, Button, buttonClassName, Input, Panel, Select, Skeleton, StatusBadge, Switch, Textarea, Urdu, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { ConflictBanner, conflictOf, errorText, QueryError, useReadOnlyText, SetupPage, type Conflict, type FieldErrors } from "./shared";

const GROUPS: Array<{ id: SetupSetting["group"]; title: string; description: string }> = [
  { id: "Messages", title: "Messages", description: "How SMS from this campus look on parents' phones." },
  { id: "Receipts", title: "Receipts", description: "Printed on every fee receipt from this campus." },
  { id: "Fee vouchers", title: "Fee vouchers", description: "Bank details and copies on printed vouchers." },
];

/** null in `changes` = put the campus back on the default. */
type Changes = Record<string, string | null>;

function SettingControl({ item, value, onChange, disabled, error }: { item: SetupSetting; value: string; onChange: (v: string) => void; disabled: boolean; error?: string | undefined }) {
  const common = { "aria-label": item.label, disabled, ...(error ? { error } : {}) };
  switch (item.type) {
    case "choice":
      return <Select {...common} value={value} onChange={(e) => onChange(e.target.value)} options={item.options ?? []} />;
    case "switch":
      return <Switch aria-label={item.label} disabled={disabled} checked={value === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "false")} label={value === "true" ? "On" : "Off"} />;
    case "longText":
    case "longTextUrdu":
      return <Textarea {...common} rows={3} urdu={item.type === "longTextUrdu"} value={value} onChange={(e) => onChange(e.target.value)} {...(item.maxLength && !error ? { help: `${value.length} of ${item.maxLength} characters` } : {})} />;
    default:
      return <Input {...common} urdu={item.type === "textUrdu"} value={value} maxLength={item.maxLength} onChange={(e) => onChange(e.target.value)} {...(item.maxLength && !error ? { help: `${value.length} of ${item.maxLength} characters` } : {})} />;
  }
}

function Previews({ value, data }: { value: (key: string) => string; data: SetupSettings }) {
  const copies = Number(value("voucher.copies") || 1);
  const labels = value("voucher.copyLabels").split("·").map((s) => s.trim()).filter(Boolean);
  const lang = value("sms.language");
  return (
    <div className="grid gap-6">
      <Panel id="preview-sms" title="Message preview" description="An absence message as a parent receives it." rise={4}>
        <div className="grid gap-2">
          <span className="text-small font-medium text-ink">{value("sms.senderName") || "—"}</span>
          {lang !== "ur" && (
            <p className="setup-sms m-0">
              Ayesha Khan (7-B) was absent today, <bdi dir="ltr">04-Nov-2026</bdi>. Please call the school if this is unexpected. {value("sms.signature")}
            </p>
          )}
          {lang !== "en" && (
            <Urdu as="p" size="small" className="setup-sms m-0">
              عائشہ خان (<bdi dir="ltr">7-B</bdi>) آج <bdi dir="ltr">04-Nov-2026</bdi> کو غیر حاضر تھیں۔ اگر یہ غیر متوقع ہو تو اسکول سے رابطہ کریں۔
            </Urdu>
          )}
        </div>
      </Panel>
      <Panel id="preview-receipt" title="Receipt and voucher preview" description="Bottom of an A5 receipt, and the voucher's tear-off copies." rise={5}>
        <div className="grid gap-4">
          <div className="setup-print-preview grid gap-1 text-left">
            <span className="text-caption uppercase text-ink-muted">Receipt footer</span>
            {data.items.some((i) => i.key === "receipt.policyNotes") &&
              value("receipt.policyNotes")
                .split("\n")
                .map((n) => n.trim())
                .filter(Boolean)
                .map((n) => (
                  <span key={n} className="text-small text-ink">
                    <b>Note:</b> {n}
                  </span>
                ))}
            <span className="text-small text-ink">{value("receipt.footer") || "—"}</span>
            {value("receipt.footerUrdu") && (
              <Urdu as="span" size="small">
                {value("receipt.footerUrdu")}
              </Urdu>
            )}
            {value("receipt.showCashier") === "true" && <span className="text-small text-ink-muted">Received by: Usman Ali</span>}
          </div>
          <div className="setup-voucher" aria-label={`${copies} voucher copies`}>
            {Array.from({ length: copies }, (_, i) => (
              <div key={i} className="setup-voucher-copy">
                <div className="flex justify-between gap-2 font-medium text-ink">
                  <span>{value("voucher.title") || "MTB"}</span>
                  <span>{labels[i] ?? `Copy ${i + 1}`}</span>
                </div>
                <div>{value("voucher.bankName") || "Bank not set"}</div>
                <div>
                  {value("voucher.accountTitle") || "Account title not set"} · <span className="mtb-mono">{value("voucher.accountNo") || "—"}</span>
                </div>
                {data.docPrefix && <div className="mtb-mono">Voucher {data.docPrefix}-V-2627-018422</div>}
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function SettingsForm({ data }: { data: SetupSettings }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const readOnlyNote = useReadOnlyText();
  const canFees = useCan("fees.setup");
  const [changes, setChanges] = useState<Changes>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const defaults = data.scope === "ALL";
  const item = (key: string) => data.items.find((i) => i.key === key)!;
  const value = (key: string) => {
    if (key in changes) return changes[key] ?? item(key).defaultValue;
    return item(key).value;
  };
  const overridden = (key: string) => (key in changes ? changes[key] !== null : item(key).overridden);
  const count = Object.keys(changes).length;
  const save = useMutation({
    mutationFn: () => setupApi.saveSettings(ctx, { values: changes, rowVer: data.rowVer }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: defaults ? "Defaults saved" : `${campusLabel(ctx.campus)} settings saved`, message: defaults ? "Campuses without their own value use these now." : "New receipts, vouchers and messages use them now." });
    },
    onError: (e) => {
      const c = conflictOf(e);
      if (c) return setConflict(c);
      const ex = e as { field?: string; status?: number; message: string };
      if (ex.status === 422 && ex.field) return setErrors({ [ex.field]: ex.message });
      setFailure(errorText(e));
    },
  });
  const submit = () => {
    setFailure(null);
    const next: FieldErrors = {};
    for (const [k, v] of Object.entries(changes)) {
      const it = item(k);
      if (v === null) continue;
      if (it.maxLength && v.length > it.maxLength) next[k] = `Keep it to ${it.maxLength} characters (now ${v.length}).`;
      if (k === "sms.senderName" && !/^[A-Za-z0-9 ]{2,11}$/.test(v)) next[k] = "Use 2 to 11 letters, numbers or spaces. SMS companies don't allow other characters.";
    }
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };
  const edit = (key: string, v: string) => {
    setChanges((c) => ({ ...c, [key]: v }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  return (
    <>
      {defaults && (
        <Banner tone="info" icon="layers">
          You are editing the defaults every campus starts from. A campus can set its own value; choose it in the campus switcher.
        </Banner>
      )}
      {readOnly && <Banner tone="info">{readOnlyNote}</Banner>}
      {conflict && <ConflictBanner conflict={conflict} onReload={() => void qc.invalidateQueries({ queryKey: ["setup"] })} />}
      {failure && <Banner tone="danger" title="Not saved.">{failure}</Banner>}
      <div className="setup-split" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)" }}>
        <div className="grid gap-6">
          {GROUPS.map((g, gi) => (
            <Panel key={g.id} id={`settings-${g.id}`} title={g.title} description={g.description} rise={gi}>
              {data.items
                .filter((i) => i.group === g.id)
                .map((it) => (
                  <div key={it.key} className="setup-setting">
                    <div className="grid content-start gap-1">
                      <span className="font-medium text-ink">{it.label}</span>
                      <span className="text-small text-ink-muted">{it.help}</span>
                      {!defaults && (
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          {overridden(it.key) ? (
                            <>
                              <StatusBadge status="info" dot={false}>
                                Set for this campus
                              </StatusBadge>
                              {!readOnly && (
                                <button type="button" className="border-0 bg-transparent p-0 text-small text-brand-ink underline-offset-2 hover:underline" onClick={() => setChanges((c) => ({ ...c, [it.key]: null }))}>
                                  Use the default{it.defaultValue ? ` (${it.options?.find((o) => o.value === it.defaultValue)?.label ?? (it.type === "switch" ? (it.defaultValue === "true" ? "On" : "Off") : it.defaultValue)})` : ""}
                                </button>
                              )}
                            </>
                          ) : (
                            <StatusBadge status="neutral" dot={false}>
                              Default
                            </StatusBadge>
                          )}
                        </span>
                      )}
                    </div>
                    <SettingControl item={it} value={value(it.key)} onChange={(v) => edit(it.key, v)} disabled={readOnly} error={errors[it.key]} />
                  </div>
                ))}
            </Panel>
          ))}
          <Panel id="settings-fees" title="Late fine" description="Set by the Fees module so receipts and reports always agree." rise={3}>
            <div className="grid gap-3">
              <p className="m-0 text-ink">
                {formatRs(data.lateFine.ratePerDay)} a day from the day after the due date
                {data.lateFine.graceDays ? `, after ${data.lateFine.graceDays} grace days` : ", with no grace days"}
                {data.lateFine.maxFine === null ? " and no maximum." : `, up to ${formatRs(data.lateFine.maxFine)} per charge.`}
              </p>
              <div className="flex flex-wrap gap-2">
                {canFees && (
                  <Link to="/fees/fines" className={buttonClassName({ size: "sm", variant: "secondary" })}>
                    Open fine rules
                  </Link>
                )}
                <Link to="/settings" className={buttonClassName({ size: "sm", variant: "ghost" })}>
                  Compare grace days and a maximum
                </Link>
              </div>
            </div>
          </Panel>
        </div>
        <Previews value={value} data={data} />
      </div>
      {count > 0 && !readOnly && (
        <div className="setup-savebar" role="region" aria-label="Unsaved changes">
          <span className="text-ink">
            <b>{count}</b> unsaved {count === 1 ? "change" : "changes"} · last saved by {data.updatedBy}, {formatDateTime(data.updatedAt)}
          </span>
          <span className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setChanges({});
                setErrors({});
              }}
              disabled={save.isPending}
            >
              Discard
            </Button>
            <Button variant="primary" icon="check" onClick={submit} loading={save.isPending} loadingLabel="Saving…" disabled={Boolean(conflict)}>
              Save settings
            </Button>
          </span>
        </div>
      )}
    </>
  );
}

export function CampusSettingsPage() {
  const ctx = useCtx();
  const q = useQuery(setupQueries.settings(ctx));
  return (
    <SetupPage title={ctx.campus === "ALL" ? "Campus settings: defaults" : "Campus settings"}>
      {q.isError && <QueryError what="The settings" error={q.error} onRetry={() => void q.refetch()} />}
      {q.isLoading ? (
        <div className="grid gap-4">
          <Skeleton height={180} />
          <Skeleton height={220} />
        </div>
      ) : q.data ? (
        <SettingsForm key={`${q.data.scope}:${q.data.rowVer}`} data={q.data} />
      ) : null}
    </SetupPage>
  );
}
