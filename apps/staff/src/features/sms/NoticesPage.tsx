import { metaQueries, NOTICE_AUDIENCE_LABEL, NOTICE_CATEGORY_LABEL, noticesApi, noticesQueries, smsStatusQueries, type CampusCode, type Notice, type NoticeAudience, type NoticeCategory, type NoticeInput } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, type IsoDate } from "@mtb/domain";
import { Banner, Button, Checkbox, ConfirmDialog, DatePicker, EmptyState, Field, Icon, Input, Segmented, Select, SidePanel, Skeleton, StatusBadge, Tabs, TabPanel, Textarea, Urdu, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { RequireSingleCampus } from "../../app/shell/page";
import { errorField, errorText, LoadError, MessagesShell, slide } from "./shell";
import { UrduWithLtrRuns } from "./sms-text";

export interface NoticesSearch {
  new?: 1;
  notice?: string;
  show?: "PUBLISHED" | "DRAFT" | "ALL";
}

const TODAY: IsoDate = "2026-11-04";
const CATEGORIES: NoticeCategory[] = ["GENERAL", "HOLIDAY", "FEES", "EXAMS", "EVENT", "MEETING"];

const isTakenDown = (n: Notice) => n.status === "DRAFT" && Boolean(n.unpublishedAt);

function NoticeStatus({ n }: { n: Notice }) {
  if (n.status === "PUBLISHED") return n.expiresOn && n.expiresOn < TODAY ? <StatusBadge status="neutral">Expired</StatusBadge> : <StatusBadge status="success">Published</StatusBadge>;
  if (isTakenDown(n)) return <StatusBadge status="danger">Taken down</StatusBadge>;
  return <StatusBadge status="draft" />;
}

/** /sms/notices — the notice board families see in the portal and app, in English and Urdu. */
export function NoticesPage({ search, setSearch }: { search: NoticesSearch; setSearch: (next: NoticesSearch) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canSend = useCan("sms.send");
  const readOnly = useReadOnly();
  const canEdit = canSend && !readOnly;
  const list = useQuery(noticesQueries.list(ctx));
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<"" | NoticeAudience>("");
  const [takeDown, setTakeDown] = useState<Notice | null>(null);
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState<Notice | null>(null);
  const show = search.show ?? "ALL";

  const all = list.data ?? [];
  const q = query.trim().toLowerCase();
  const rows = all.filter((n) => (show === "ALL" || n.status === show) && (!audience || n.audience === audience) && (!q || `${n.title} ${n.body} ${n.publishedBy}`.toLowerCase().includes(q)));
  const counts = { PUBLISHED: all.filter((n) => n.status === "PUBLISHED").length, DRAFT: all.filter((n) => n.status === "DRAFT").length };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notices"] });
  const publish = useMutation({
    mutationFn: (id: string) => noticesApi.publish(id),
    onSuccess: async (n) => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["sms"] });
      toast({ title: `Published · ${n.title}`, message: `Families see it in the portal${n.batchId ? " and get a notification" : ""}.` });
    },
    onError: (e) => toast({ tone: "danger", title: "Not published", message: errorText(e) }),
  });
  const unpublish = useMutation({
    mutationFn: () => noticesApi.unpublish(takeDown!.id, reason),
    onSuccess: async (n) => {
      setTakeDown(null);
      await refresh();
      toast({ tone: "warning", title: `Taken down · ${n.title}`, message: "Families no longer see it. It is kept here as a draft you can fix and publish again." });
    },
  });
  const remove = useMutation({
    mutationFn: () => noticesApi.remove(removing!.id),
    onSuccess: async () => {
      const t = removing?.title;
      setRemoving(null);
      await refresh();
      toast({ title: "Draft deleted", message: t });
    },
  });

  const editing = search.new ? null : (all.find((n) => n.id === search.notice) ?? null);
  const editorOpen = Boolean(search.new) || Boolean(search.notice && editing);
  const close = () => setSearch({ ...(search.show ? { show: search.show } : {}) });

  return (
    <MessagesShell
      title="Notices"
      {...(canEdit
        ? {
            actions: (
              <Button variant="primary" icon="plus" disabled={ctx.campus === "ALL"} title={ctx.campus === "ALL" ? "Choose a campus first" : undefined} onClick={() => setSearch({ ...search, new: 1 })}>
                New notice
              </Button>
            ),
          }
        : {})}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          aria-label="Show"
          value={show}
          onChange={(v) => setSearch({ ...(v !== "ALL" ? { show: v as NoticesSearch["show"] } : {}) })}
          options={[
            { value: "ALL", label: "All" },
            { value: "PUBLISHED", label: `Published (${counts.PUBLISHED})` },
            { value: "DRAFT", label: `Drafts and taken down (${counts.DRAFT})` },
          ]}
        />
        <div className="w-52">
          <Select aria-label="For" value={audience} onChange={(e) => setAudience(e.target.value as "" | NoticeAudience)} options={[{ value: "", label: "Everyone" }, { value: "ALL_PARENTS", label: "All parents" }, { value: "CLASS", label: "Selected classes" }, { value: "STAFF", label: "Staff" }]} />
        </div>
        <div className="w-64">
          <Input aria-label="Search notices" icon="search" placeholder="Title or words in the notice" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {list.error && !list.data ? (
        <LoadError what="Notices" error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={170} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="mtb-card">
          <EmptyState icon="flag" title={all.length ? "No notices match" : "No notices yet"} description={all.length ? "Try another filter or clear the search." : "Write the first one with “New notice”. Families see it in the portal and the MTB app."} />
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2">
          {rows.map((n, i) => (
            <li key={n.id} className="sms-notice mtb-slide-in" style={slide(i)}>
              <div className="flex flex-wrap items-center gap-2">
                <NoticeStatus n={n} />
                <StatusBadge status="neutral" dot={false}>
                  {NOTICE_CATEGORY_LABEL[n.category ?? "GENERAL"]}
                </StatusBadge>
                {n.pinned && n.status === "PUBLISHED" && (
                  <span className="inline-flex items-center gap-1 text-small font-medium text-brand-ink">
                    <Icon name="star" size={14} /> Pinned
                  </span>
                )}
                {ctx.campus === "ALL" && <span className="text-small text-ink-muted">{campusLabel(n.campus)}</span>}
              </div>
              <div className="grid gap-1">
                <h3 className="m-0 text-title-3">{n.title}</h3>
                <Urdu size="small" className="sms-notice-ur">
                  <UrduWithLtrRuns text={n.titleUr} />
                </Urdu>
                <p className="m-0 line-clamp-2 text-small text-ink-muted">{n.body}</p>
              </div>
              <div className="sms-notice-meta">
                <span className="inline-flex items-center gap-1">
                  <Icon name="calendar" size={14} /> About <span className="mtb-num text-ink">{formatDate(n.date)}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <Icon name="students" size={14} /> {n.audience === "CLASS" ? `Classes ${(n.classSections ?? []).slice(0, 4).join(", ")}${(n.classSections?.length ?? 0) > 4 ? ` +${(n.classSections?.length ?? 0) - 4}` : ""}` : NOTICE_AUDIENCE_LABEL[n.audience]}
                </span>
                {(n.sendApp || n.sendSms) && (
                  <span className="inline-flex items-center gap-1">
                    <Icon name="bell" size={14} /> {[n.sendApp && "App", n.sendSms && "SMS"].filter(Boolean).join(" + ")}
                  </span>
                )}
              </div>
              {n.status === "PUBLISHED" && n.audienceCount ? (
                <div className="grid gap-1">
                  <div className="mtb-meter" role="progressbar" aria-valuenow={Math.round(((n.readCount ?? 0) / n.audienceCount) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${formatCount(n.readCount ?? 0)} of ${formatCount(n.audienceCount)} opened it`}>
                    <span style={{ width: `${Math.min(100, ((n.readCount ?? 0) / n.audienceCount) * 100)}%` }} />
                  </div>
                  <span className="text-small text-ink-muted">
                    Opened by <span className="mtb-num text-ink">{formatCount(n.readCount ?? 0)}</span> of {formatCount(n.audienceCount)} {n.audience === "STAFF" ? "staff" : "families"} · published by {n.publishedBy}, {formatDateTime(n.publishedAt)}
                  </span>
                </div>
              ) : isTakenDown(n) ? (
                <p className="m-0 text-small text-danger-ink">
                  Taken down by {n.unpublishedBy}, {formatDateTime(n.unpublishedAt!)}
                  {n.unpublishReason ? ` — ${n.unpublishReason}` : ""}
                </p>
              ) : (
                <p className="m-0 text-small text-ink-muted">Draft by {n.createdBy ?? n.publishedBy}{n.updatedAt ? `, last changed ${formatDateTime(n.updatedAt)}` : ""}. Families can't see it yet.</p>
              )}
              {canEdit && (
                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                  {n.status === "DRAFT" && !n.unpublishedAt && (
                    <Button size="sm" variant="quiet" icon="trash" onClick={() => { remove.reset(); setRemoving(n); }}>
                      Delete draft
                    </Button>
                  )}
                  {n.status === "PUBLISHED" && (
                    <Button size="sm" variant="quiet" icon="eyeOff" onClick={() => { setReason(""); unpublish.reset(); setTakeDown(n); }}>
                      Take down
                    </Button>
                  )}
                  <Button size="sm" icon="edit" onClick={() => setSearch({ ...(search.show ? { show: search.show } : {}), notice: n.id })}>
                    {n.status === "PUBLISHED" ? "Correct" : "Edit"}
                  </Button>
                  {n.status === "DRAFT" && (
                    <Button size="sm" variant="primary" icon="send" loading={publish.isPending && publish.variables === n.id} loadingLabel="Publishing…" onClick={() => publish.mutate(n.id)}>
                      Publish
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <NoticeEditor key={search.new ? "new" : (editing?.id ?? "none")} open={editorOpen} notice={editing} onClose={close} />

      <ConfirmDialog
        open={takeDown !== null}
        onClose={() => setTakeDown(null)}
        onConfirm={() => {
          if (reason.trim()) unpublish.mutate();
        }}
        tone="warning"
        icon="eyeOff"
        title="Take this notice down?"
        message="Families stop seeing it in the portal and app straight away. App notifications and SMS already sent can't be called back."
        confirmLabel="Take down"
        loading={unpublish.isPending}
        loadingLabel="Taking down…"
        error={unpublish.error ? errorText(unpublish.error) : undefined}
      >
        <div className="mt-4">
          <Textarea label="Why" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: the date was wrong" help="Kept with the notice for the record." />
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => remove.mutate()}
        tone="danger"
        icon="trash"
        title="Delete this draft?"
        message="It was never published, so no family has seen it. This can't be undone."
        details={removing ? [["Title", removing.title]] : []}
        confirmLabel="Delete draft"
        loading={remove.isPending}
        loadingLabel="Deleting…"
        error={remove.error ? errorText(remove.error) : undefined}
      />
    </MessagesShell>
  );
}

const noticeSchema = z
  .object({
    title: z.string().trim().min(1, "Write the title in English.").max(120, "Keep the title under 120 characters."),
    titleUr: z.string().trim().min(1, "Write the title in Urdu. Parents who read Urdu see this one."),
    body: z.string().trim().min(1, "Write the notice in English.").max(1000, "Keep the notice under 1,000 characters."),
    bodyUr: z.string().trim().min(1, "Write the notice in Urdu."),
    date: z.string().nullable(),
    audience: z.enum(["ALL_PARENTS", "CLASS", "STAFF"]),
    classSections: z.array(z.string()),
    expiresOn: z.string().nullable(),
  })
  .superRefine((v, ctx) => {
    if (!v.date) ctx.addIssue({ code: "custom", path: ["date"], message: "Choose the date the notice is about." });
    if (v.audience === "CLASS" && v.classSections.length === 0) ctx.addIssue({ code: "custom", path: ["classSections"], message: "Choose at least one class." });
    if (v.expiresOn && v.expiresOn < TODAY) ctx.addIssue({ code: "custom", path: ["expiresOn"], message: "Choose today or a later day, or leave it empty." });
  });

function NoticeEditor({ open, notice, onClose }: { open: boolean; notice: Notice | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const classes = useQuery(metaQueries.classes(ctx.campus));
  const status = useQuery(smsStatusQueries.status());
  const [tab, setTab] = useState("write");
  const [title, setTitle] = useState(notice?.title ?? "");
  const [titleUr, setTitleUr] = useState(notice?.titleUr ?? "");
  const [body, setBody] = useState(notice?.body ?? "");
  const [bodyUr, setBodyUr] = useState(notice?.bodyUr ?? "");
  const [date, setDate] = useState<IsoDate | null>(notice?.date ?? null);
  const [category, setCategory] = useState<NoticeCategory>(notice?.category ?? "GENERAL");
  const [audience, setAudience] = useState<NoticeAudience>(notice?.audience ?? "ALL_PARENTS");
  const [sections, setSections] = useState<string[]>(notice?.classSections ?? []);
  const [expiresOn, setExpiresOn] = useState<IsoDate | null>(notice?.expiresOn ?? null);
  const [pinned, setPinned] = useState(Boolean(notice?.pinned));
  const [sendApp, setSendApp] = useState(notice ? Boolean(notice.sendApp) : true);
  const [sendSms, setSendSms] = useState(Boolean(notice?.sendSms));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const published = notice?.status === "PUBLISHED";
  const alreadySent = Boolean(notice?.batchId || notice?.unpublishedAt);

  useEffect(() => setTab("write"), [open]);

  const input = (): NoticeInput => ({
    campus: (notice?.campus ?? ctx.campus) as CampusCode,
    title,
    titleUr,
    body,
    bodyUr,
    date: date ?? "",
    category,
    audience,
    ...(audience === "CLASS" ? { classSections: sections } : {}),
    ...(expiresOn ? { expiresOn } : {}),
    pinned,
    sendApp,
    sendSms,
  });

  const done = async (n: Notice, verb: string) => {
    await queryClient.invalidateQueries({ queryKey: ["notices"] });
    if (n.batchId) await queryClient.invalidateQueries({ queryKey: ["sms"] });
    setConfirm(false);
    onClose();
    toast({ title: `${verb} · ${n.title}`, message: n.status === "PUBLISHED" ? `Families see it in the portal${n.batchId ? " and get a notification" : ""}.` : "Saved as a draft. Families can't see it yet." });
  };
  const save = useMutation({
    mutationFn: (publish: boolean) => (notice ? noticesApi.update(notice.id, input()) : noticesApi.create({ ...input(), publish })),
    onSuccess: (n, publish) => done(n, notice ? (published ? "Corrected" : "Saved") : publish ? "Published" : "Draft saved"),
    onError: (e) => {
      setConfirm(false);
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const publishNow = useMutation({
    mutationFn: async () => {
      const saved = await noticesApi.update(notice!.id, input());
      return noticesApi.publish(saved.id);
    },
    onSuccess: (n) => done(n, "Published"),
    onError: () => setConfirm(false),
  });

  const validate = () => {
    const r = noticeSchema.safeParse({ title, titleUr, body, bodyUr, date, audience, classSections: sections, expiresOn });
    if (r.success) {
      setErrors({});
      return true;
    }
    const next: Record<string, string> = {};
    for (const i of r.error.issues) next[String(i.path[0])] ??= i.message;
    setErrors(next);
    setTab("write");
    return false;
  };

  const classList = classes.data ?? [];
  const busy = save.isPending || publishNow.isPending;
  const apiError = (save.error && !errorField(save.error) ? save.error : null) ?? publishNow.error;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      wide
      title={notice ? (published ? "Correct a published notice" : "Edit notice") : "New notice"}
      description={published ? "Changes show in the portal straight away. Notifications already sent are not sent again." : "Write it in English and Urdu. Families read it in the portal and the MTB app."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <div className="flex gap-2">
            {!published && (
              <Button loading={save.isPending && save.variables === false} loadingLabel="Saving…" disabled={busy} onClick={() => validate() && save.mutate(false)}>
                Save draft
              </Button>
            )}
            <Button variant="primary" icon={published ? "check" : "send"} disabled={busy} onClick={() => validate() && (published ? save.mutate(false) : setConfirm(true))}>
              {published ? "Save correction" : "Publish"}
            </Button>
          </div>
        </>
      }
    >
      <RequireSingleCampus action="notices">
        <div className="grid gap-4">
          <Tabs
            aria-label="Notice"
            idPrefix="notice-"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "write", label: "Write", icon: "edit" },
              { id: "preview", label: "Preview", icon: "eye" },
            ]}
          />
          <TabPanel id="write" idPrefix="notice-" active={tab === "write"}>
            <div className="grid gap-4">
              {apiError && <Banner tone="danger">{errorText(apiError)}</Banner>}
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Title (English)" required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={130} {...(errors.title ? { error: errors.title } : {})} />
                <Input label="Title (Urdu)" required urdu value={titleUr} onChange={(e) => setTitleUr(e.target.value)} {...(errors.titleUr ? { error: errors.titleUr } : {})} />
              </div>
              <Textarea label="Notice (English)" required rows={4} value={body} onChange={(e) => setBody(e.target.value)} help={`${body.length} of 1,000 characters`} {...(errors.body ? { error: errors.body } : {})} />
              <Textarea label="Notice (Urdu)" required urdu rows={3} value={bodyUr} onChange={(e) => setBodyUr(e.target.value)} help="Write dates and amounts in English digits, e.g. 10-Nov-2026 and Rs 8,500; they display left to right." {...(errors.bodyUr ? { error: errors.bodyUr } : {})} />
              <div className="grid gap-3 sm:grid-cols-3">
                <DatePicker label="About the date" required value={date} onValueChange={setDate} today={TODAY} {...(errors.date ? { error: errors.date } : {})} />
                <Select label="Kind" value={category} onChange={(e) => setCategory(e.target.value as NoticeCategory)} options={CATEGORIES.map((c) => ({ value: c, label: NOTICE_CATEGORY_LABEL[c] }))} />
                <DatePicker label="Hide after (optional)" value={expiresOn} onValueChange={setExpiresOn} today={TODAY} minDate={TODAY} {...(errors.expiresOn ? { error: errors.expiresOn } : {})} />
              </div>
              <div className="grid gap-2">
                <span className="mtb-label">For</span>
                <Segmented
                  aria-label="For"
                  value={audience}
                  onChange={(v) => setAudience(v as NoticeAudience)}
                  options={[
                    { value: "ALL_PARENTS", label: "All parents" },
                    { value: "CLASS", label: "Selected classes" },
                    { value: "STAFF", label: "Staff" },
                  ]}
                />
              </div>
              {audience === "CLASS" && (
                <Field label="Classes" {...(errors.classSections ? { error: errors.classSections } : {})}>
                  {() => (
                    <div className="grid gap-2">
                      {classList.map((c) => {
                        const all = c.sections.map((s) => `${c.short}-${s}`);
                        const allOn = all.every((cs) => sections.includes(cs));
                        return (
                          <div key={c.short} className="sms-class-row">
                            <button type="button" className="sms-chip" aria-pressed={allOn} onClick={() => setSections((prev) => (allOn ? prev.filter((cs) => !all.includes(cs)) : [...new Set([...prev, ...all])]))}>
                              {c.name}
                            </button>
                            <div className="sms-chips">
                              {all.map((cs) => (
                                <button key={cs} type="button" className="sms-chip" aria-pressed={sections.includes(cs)} onClick={() => setSections((prev) => (prev.includes(cs) ? prev.filter((x) => x !== cs) : [...prev, cs]))}>
                                  {cs}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Field>
              )}
              <div className="grid gap-2 rounded-md border border-border p-3">
                <span className="mtb-label">When it is published</span>
                <Checkbox label="Pin it to the top of the portal home page" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
                <Checkbox label="Send an app notification (free)" checked={sendApp} disabled={alreadySent} onChange={(e) => setSendApp(e.target.checked)} />
                <Checkbox label="Also send it by SMS to families without the app (costs per SMS)" checked={sendSms} disabled={alreadySent} onChange={(e) => setSendSms(e.target.checked)} />
                {alreadySent && <p className="m-0 text-small text-ink-muted">Notifications for this notice were already sent once; they are not sent again.</p>}
                {sendSms && status.data?.paused && <Banner tone="warning">All SMS are paused. Untick SMS to publish now with the app notification only.</Banner>}
              </div>
            </div>
          </TabPanel>
          <TabPanel id="preview" idPrefix="notice-" active={tab === "preview"}>
            <div className="grid gap-4">
              <p className="m-0 text-small text-ink-muted">How families see it in the portal and the app, in each language.</p>
              <article className="sms-portal-card">
                <span className="text-small text-ink-muted">
                  {NOTICE_CATEGORY_LABEL[category]} · {date ? formatDate(date) : "date not set"}
                </span>
                <h3 className="m-0 text-title-3">{title || "Title in English"}</h3>
                <p className="m-0 whitespace-pre-wrap text-ink">{body || "The notice in English appears here."}</p>
              </article>
              <article className="sms-portal-card" dir="rtl" lang="ur">
                <span className="urdu-small text-ink-muted">
                  <bdi dir="ltr">{date ? formatDate(date) : ""}</bdi>
                </span>
                <h3 className="urdu-title m-0">{titleUr ? <UrduWithLtrRuns text={titleUr} /> : "اردو عنوان"}</h3>
                <p className="urdu-body m-0 whitespace-pre-wrap text-ink">{bodyUr ? <UrduWithLtrRuns text={bodyUr} /> : "اردو میں نوٹس یہاں نظر آئے گا۔"}</p>
              </article>
              <p className="m-0 text-small text-ink-muted">
                The parent portal shows published notices for the family's campus{audience === "CLASS" ? " and the chosen classes" : ""}. <Link to="/sms/templates" className="font-medium text-brand-ink">Message templates</Link> are separate: they are for SMS.
              </p>
            </div>
          </TabPanel>
        </div>
      </RequireSingleCampus>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => (notice ? publishNow.mutate() : save.mutate(true))}
        icon="send"
        title={`Publish “${title}”?`}
        message={`${audience === "STAFF" ? "Staff" : "Families"} see it straight away${sendApp || sendSms ? `, and get ${[sendApp && "an app notification", sendSms && "an SMS if they don't have the app"].filter(Boolean).join(" or ")}` : ""}. You can take it down later, but notifications can't be called back.`}
        details={[
          ["For", audience === "CLASS" ? `${sections.length} sections` : NOTICE_AUDIENCE_LABEL[audience]],
          ["About", date ? formatDate(date) : "—"],
          ["Notify", [sendApp && "App", sendSms && "SMS"].filter(Boolean).join(" + ") || "No — portal only"],
        ]}
        confirmLabel="Publish"
        loading={busy}
        loadingLabel="Publishing…"
        error={apiError ? errorText(apiError) : undefined}
      />
    </SidePanel>
  );
}
