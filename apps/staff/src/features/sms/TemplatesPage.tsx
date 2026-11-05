import { ApiError, SMS_CATEGORY_LABEL, SMS_OPTIONAL_CATEGORIES, smsApi, smsQueries, smsUnknownVariables, type SmsTemplate, type SmsTemplateCategory } from "@mtb/api";
import { formatCount, formatDateTime } from "@mtb/domain";
import { Banner, Button, buttonClassName, ConfirmDialog, cx, EmptyState, Input, Modal, Select, Skeleton, StatusBadge, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { z } from "zod";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { errorField, errorText, LoadError, MessagesShell, slide } from "./shell";
import { insertAtCursor, NonGsmWarning, renderPreview, SmsBubble, SmsCount, toStandardCharacters, VariableChips } from "./sms-text";

export function categoryNote(t: Pick<SmsTemplate, "category">) {
  if (t.category === "STAFF") return "Staff · goes to staff mobiles only";
  return SMS_OPTIONAL_CATEGORIES.includes(t.category) ? "Notice · guardians who opted out are skipped" : "About the family's own child · sent even to guardians who opted out of notices";
}

function TemplateEditor({ template, canEdit }: { template: SmsTemplate; canEdit: boolean }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [en, setEn] = useState(template.en);
  const [ur, setUr] = useState(template.ur);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const enRef = useRef<HTMLTextAreaElement>(null);
  const urRef = useRef<HTMLTextAreaElement>(null);
  const dirty = en !== template.en || ur !== template.ur;
  const enUnknown = smsUnknownVariables(en);
  const urUnknown = smsUnknownVariables(ur);
  const unknownMsg = (list: string[]) => (list.length ? `Unknown variable {${list[0]}}. Use one of the variable chips.` : undefined);

  const save = useMutation({
    mutationFn: () => smsApi.saveTemplate(template.id, { en, ur }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: smsQueries.templates(ctx).queryKey });
      toast({ title: `Template saved · ${saved.name}`, message: "New messages use this wording from now on." });
    },
  });
  const archive = useMutation({
    mutationFn: () => smsApi.archiveTemplate(template.id),
    onSuccess: async (t) => {
      setArchiveOpen(false);
      await queryClient.invalidateQueries({ queryKey: smsQueries.templates(ctx).queryKey });
      toast({ title: `Archived · ${t.name}`, message: "It no longer appears in Compose. Messages already sent keep their wording." });
    },
  });
  const saveError = save.error instanceof ApiError ? save.error.message : save.error ? "Not saved — check your connection and try again." : null;

  const column = (lang: "en" | "ur") => {
    const value = lang === "en" ? en : ur;
    const set = lang === "en" ? setEn : setUr;
    const ref = lang === "en" ? enRef : urRef;
    const preview = renderPreview(value, lang);
    return (
      <section aria-labelledby={`tpl-${lang}`} className="grid content-start gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 id={`tpl-${lang}`} className="m-0 text-title-3">
            {lang === "en" ? (
              "English"
            ) : (
              <span>
                Urdu · <span lang="ur" className="urdu-small">اردو</span>
              </span>
            )}
          </h3>
          <SmsCount text={preview} language={lang} />
        </div>
        {canEdit && <VariableChips label={`Insert a variable into the ${lang === "en" ? "English" : "Urdu"} message`} onInsert={(token) => insertAtCursor(ref, value, token, set)} />}
        <Textarea
          ref={ref}
          label={lang === "en" ? "Message (English)" : "Message (Urdu)"}
          urdu={lang === "ur"}
          rows={lang === "en" ? 5 : 4}
          value={value}
          onChange={(e) => set(e.target.value)}
          readOnly={!canEdit}
          error={unknownMsg(lang === "en" ? enUnknown : urUnknown)}
          spellCheck={lang === "en"}
        />
        {lang === "en" && <NonGsmWarning text={preview} {...(canEdit ? { onFix: () => setEn(toStandardCharacters(en)) } : {})} />}
        <div className="grid gap-1.5">
          <span className="mtb-label">Preview with sample data</span>
          <SmsBubble text={preview} language={lang} />
        </div>
      </section>
    );
  };

  return (
    <div className="mtb-card grid gap-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="m-0 text-title-2">{template.name}</h2>
          <p className="m-0 text-small text-ink-muted">
            {SMS_CATEGORY_LABEL[template.category]} · {categoryNote(template)}
          </p>
          <p className="m-0 text-small text-ink-muted">
            Last changed by {template.updatedBy}, <span className="mtb-num">{formatDateTime(template.updatedAt)}</span>
            {template.uses ? ` · used ${formatCount(template.uses)} times this session` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && !template.builtIn && (
            <Button variant="quiet" icon="trash" onClick={() => { archive.reset(); setArchiveOpen(true); }}>
              Archive
            </Button>
          )}
          <Link to="/sms/compose" search={{ template: template.id } as never} className={buttonClassName({ variant: "secondary" })}>
            Use in a message
          </Link>
          {canEdit && (
            <>
              <Button
                variant="secondary"
                disabled={!dirty || save.isPending}
                onClick={() => {
                  setEn(template.en);
                  setUr(template.ur);
                }}
              >
                Discard changes
              </Button>
              <Button variant="primary" icon="check" disabled={!dirty || enUnknown.length > 0 || urUnknown.length > 0 || !en.trim() || !ur.trim()} loading={save.isPending} loadingLabel="Saving…" onClick={() => save.mutate()}>
                Save template
              </Button>
            </>
          )}
        </div>
      </div>
      {saveError && <Banner tone="danger">{saveError}</Banner>}
      <p className="m-0 text-small text-ink-muted">
        Counts use the sample values (Ayesha Khan, 7-B, Rs 8,500). Longer names or amounts can add a part. 160 characters per English SMS (153 per part when longer); 70 per Urdu SMS (67 per part) because Urdu uses Unicode. App notifications have no such limit and are free.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        {column("en")}
        {column("ur")}
      </div>
      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={() => archive.mutate()}
        tone="danger"
        icon="trash"
        title={`Archive “${template.name}”?`}
        message="It disappears from Compose. Messages already sent with it keep their wording in the Outbox."
        confirmLabel="Archive template"
        loading={archive.isPending}
        loadingLabel="Archiving…"
        error={archive.error ? errorText(archive.error) : undefined}
      />
    </div>
  );
}

const CATEGORIES: SmsTemplateCategory[] = ["NOTICE", "FEE", "ATTENDANCE", "RESULT", "ADMISSION", "DISCIPLINE", "STAFF", "GENERAL"];

const newSchema = z.object({
  name: z.string().trim().min(3, "Give the template a name of at least 3 letters.").max(50, "Keep the name under 50 characters."),
  en: z.string().trim().min(1, "Write the English message.").refine((v) => smsUnknownVariables(v).length === 0, "Use only the variables offered as chips."),
  ur: z.string().trim().min(1, "Write the Urdu message.").refine((v) => smsUnknownVariables(v).length === 0, "Use only the variables offered as chips."),
});

function NewTemplate({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<SmsTemplateCategory>("NOTICE");
  const [en, setEn] = useState("");
  const [ur, setUr] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const enRef = useRef<HTMLTextAreaElement>(null);
  const urRef = useRef<HTMLTextAreaElement>(null);
  const create = useMutation({
    mutationFn: () => smsApi.createTemplate({ name, category, en, ur }),
    onSuccess: async (t) => {
      await queryClient.invalidateQueries({ queryKey: smsQueries.templates(ctx).queryKey });
      toast({ title: `Template added · ${t.name}`, message: "It is ready to use in Compose." });
      setName("");
      setEn("");
      setUr("");
      onCreated(t.id);
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const submit = () => {
    const r = newSchema.safeParse({ name, en, ur });
    if (!r.success) {
      const next: Record<string, string> = {};
      for (const i of r.error.issues) next[String(i.path[0])] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New message template"
      description="Write it once in English and Urdu; staff pick it in Compose."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" loading={create.isPending} loadingLabel="Adding…" onClick={submit}>
            Add template
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Picnic permission" {...(errors.name ? { error: errors.name } : {})} />
          <Select label="Kind" value={category} onChange={(e) => setCategory(e.target.value as SmsTemplateCategory)} options={CATEGORIES.map((c) => ({ value: c, label: SMS_CATEGORY_LABEL[c] }))} help={categoryNote({ category })} />
        </div>
        <VariableChips label="Insert a variable into the English message" onInsert={(t) => insertAtCursor(enRef, en, t, setEn)} />
        <Textarea ref={enRef} label="Message (English)" required rows={3} value={en} onChange={(e) => setEn(e.target.value)} {...(errors.en ? { error: errors.en } : {})} />
        {en && <SmsCount text={renderPreview(en, "en")} language="en" />}
        <VariableChips label="Insert a variable into the Urdu message" onInsert={(t) => insertAtCursor(urRef, ur, t, setUr)} />
        <Textarea ref={urRef} label="Message (Urdu)" required urdu rows={3} value={ur} onChange={(e) => setUr(e.target.value)} {...(errors.ur ? { error: errors.ur } : {})} />
        {ur && <SmsCount text={renderPreview(ur, "ur")} language="ur" />}
        {create.error && !errorField(create.error) && <Banner tone="danger">{errorText(create.error)}</Banner>}
      </div>
    </Modal>
  );
}

/** /sms/templates — ready-made messages, side by side in English and Urdu. */
export function TemplatesPage({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canSend = useCan("sms.send");
  const templates = useQuery(smsQueries.templates(ctx));
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const all = templates.data ?? [];
  const list = all.filter((t) => showArchived || !t.archived);
  const current = list.find((t) => t.id === selected) ?? list[0];
  const canEdit = canSend && !readOnly;

  return (
    <MessagesShell
      title="Message templates"
      {...(canEdit
        ? {
            actions: (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                New template
              </Button>
            ),
          }
        : {})}
    >
      {templates.isPending ? (
        <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]" aria-busy="true">
          <Skeleton height={320} />
          <Skeleton height={320} />
        </div>
      ) : templates.isError ? (
        <LoadError what="Templates" error={templates.error} onRetry={() => void templates.refetch()} />
      ) : !current ? (
        <EmptyState icon="message" title="No templates yet" description="Add one with “New template”." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <nav aria-label="Templates" className="grid content-start gap-1">
            <span className="mtb-label px-1 pb-1">Templates</span>
            {list.map((t, i) => (
              <button
                key={t.id}
                type="button"
                aria-current={t.id === current.id ? "true" : undefined}
                onClick={() => onSelect(t.id)}
                className={cx("mtb-slide-in grid gap-1 rounded-md border px-3 py-2 text-left", t.id === current.id ? "border-transparent bg-surface-selected" : "border-border bg-surface-raised hover:bg-surface-hover")}
                style={slide(i)}
              >
                <span className={cx("font-medium", t.id === current.id ? "text-brand-ink" : "text-ink", t.archived && "line-through")}>{t.name}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={t.category === "NOTICE" || t.category === "GENERAL" ? "info" : t.category === "STAFF" ? "brand" : "neutral"} dot={false}>
                    {SMS_CATEGORY_LABEL[t.category]}
                  </StatusBadge>
                  {t.archived && <StatusBadge status="neutral" dot={false}>Archived</StatusBadge>}
                  {t.uses ? <span className="text-small text-ink-subtle">used {formatCount(t.uses)}×</span> : null}
                </span>
              </button>
            ))}
            <label className="mt-2 flex items-center gap-2 px-1 text-small text-ink-muted">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
            </label>
            {!canEdit && <p className="m-0 mt-2 px-1 text-small text-ink-muted">{readOnly ? "Past sessions are read-only." : "Your role can view templates but not change them."}</p>}
          </nav>
          <TemplateEditor key={current.id + current.updatedAt + String(current.archived)} template={current} canEdit={canEdit && !current.archived} />
        </div>
      )}
      <NewTemplate
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          onSelect(id);
        }}
      />
    </MessagesShell>
  );
}
