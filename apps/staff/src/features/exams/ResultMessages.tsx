import { newIdempotencyKey, smsApi, smsMaskMobile, smsQueries, smsStatusQueries, type ExamDetail, type SmsAudienceRequest, type SmsLanguage, type SmsRecipientPreview } from "@mtb/api";
import { formatCount, formatDateTime, formatRs } from "@mtb/domain";
import { Banner, Button, buttonClassName, DataTable, EmptyState, Icon, Modal, Segmented, Select, Skeleton, StatusBadge, useToast, type Column } from "@mtb/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { errorText } from "./shared";

/** The last time result messages for this exam went out (from the exam's history). */
export function lastResultSend(exam: ExamDetail) {
  return exam.history.find((h) => h.action === "Result messages sent");
}

/**
 * Exams → a declared exam → "Send result messages" (the old Result Announcement screen): every family on the roster with
 * their own child's marks, sent through Messages (outbox, delivery report, pause and opt-out rules). The first send is
 * keyed to the declaration, so a double-click or a second person pressing Send can't send it twice; "Send again" is a
 * deliberate new send.
 */
export function ResultMessagesModal({ exam, onClose }: { exam: ExamDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useQuery(smsStatusQueries.status());
  const [language, setLanguage] = useState<SmsLanguage>("en");
  const [section, setSection] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);
  const last = lastResultSend(exam);
  // First send: one key per declaration and choice, so repeats are recognised. After a send: a fresh key for "Send again".
  const [againKey] = useState(newIdempotencyKey);
  const key = last ? againKey : `exam-results:${exam.id}:${exam.declaredOn ?? ""}:${language}:${section || "all"}:${excluded.join(",")}`;

  const request: SmsAudienceRequest = useMemo(
    () => ({
      campus: exam.campus,
      session: exam.session,
      templateId: "tpl-result",
      language,
      audience: { kind: "EXAM", examId: exam.id, ...(section ? { classSections: [section] } : {}) },
      channel: "APP_FIRST",
      title: `${exam.name} result`,
      source: "Exams",
      sampleSize: 500,
      ...(excluded.length ? { exclude: excluded } : {}),
    }),
    [exam, language, section, excluded],
  );
  const preview = useQuery({ ...smsQueries.preview(request), placeholderData: keepPreviousData });
  const p = preview.data;
  const paused = Boolean(status.data?.paused) && (p?.smsRecipients ?? 0) > 0;

  const send = useMutation({
    mutationFn: () => smsApi.send(request, key),
    onSuccess: async (res) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["exams"] }), queryClient.invalidateQueries({ queryKey: ["sms"] })]);
      toast(
        res.status === "AWAITING_APPROVAL"
          ? { tone: "info", title: `Waiting for approval · ${formatCount(res.queued)} families`, message: "The principal approves it in Messages → Outbox." }
          : { title: `Result messages sent · ${formatCount(res.queued)} families`, message: `${formatCount(res.appQueued ?? 0)} by app, ${formatCount(res.queued - (res.appQueued ?? 0))} by SMS · about ${formatRs(res.estCost ?? 0)}. Delivery shows in Messages → Delivery.` },
      );
      onClose();
    },
  });

  const rows = p?.sample ?? [];
  const columns: Array<Column<SmsRecipientPreview>> = [
    {
      key: "student",
      header: "Student",
      render: (r) => (
        <span className={r.unticked ? "grid opacity-60" : "grid"}>
          <span className="mtb-cell-primary">{r.studentName}</span>
          <span className="mtb-cell-secondary">
            {r.grNo} · {r.classSection}
          </span>
        </span>
      ),
    },
    {
      key: "mobile",
      header: "Guardian mobile",
      render: (r) => (
        <span className="grid">
          <span className="mtb-mono">{smsMaskMobile(r.mobile)}</span>
          <span className="mtb-cell-secondary">{r.guardian}</span>
        </span>
      ),
    },
    { key: "marks", header: "Obtained / total", render: (r) => <span className="mtb-num text-small">{r.result ?? "—"}</span> },
    {
      key: "flags",
      header: "Gets it by",
      width: 150,
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.unticked ? <StatusBadge status="neutral" dot={false}>Not sent</StatusBadge> : r.channel === "APP" ? <StatusBadge status="info" dot={false}>App · free</StatusBadge> : <StatusBadge status="neutral" dot={false}>{`SMS · ${r.parts}`}</StatusBadge>}
          {r.optedOut && (
            <StatusBadge status="warning" dot={false}>
              Opted out
            </StatusBadge>
          )}
        </span>
      ),
    },
  ];
  const ticked = new Set<unknown>(rows.filter((r) => !r.unticked).map((r) => r.key));
  const onTicked = (next: Set<unknown>) => setExcluded(rows.filter((r) => r.key && !next.has(r.key)).map((r) => r.key!));

  const sendLabel = !p ? "Send to all" : last ? `Send again · ${formatCount(p.sendable)}` : p.needsApproval ? `Send for approval · ${formatCount(p.sendable)}` : `Send to all · ${formatCount(p.sendable)}`;

  return (
    <Modal
      open
      onClose={() => {
        if (!send.isPending) onClose();
      }}
      size="xl"
      title="Send result messages"
      description={`${exam.name} · ${exam.classes.join(", ")} · each family gets their own child's marks, grade and position`}
      footerSplit
      footer={
        <>
          <Link to="/sms/compose" search={{ template: "tpl-result", to: "CLASS", sections: exam.classes.join(","), exam: exam.id } as never} className={buttonClassName({ variant: "ghost" })}>
            <Icon name="edit" size={16} />
            Change the wording in Compose
          </Link>
          <span className="flex gap-2">
            <Button onClick={onClose} disabled={send.isPending}>
              Cancel
            </Button>
            <Button variant="primary" icon="send" disabled={!p || p.sendable === 0 || paused || preview.isFetching} loading={send.isPending} loadingLabel="Sending…" onClick={() => send.mutate()}>
              {sendLabel}
            </Button>
          </span>
        </>
      }
    >
      <div className="grid gap-4">
        {last && (
          <Banner tone="warning" title="Families already got this result.">
            {last.by} on <span className="mtb-num">{formatDateTime(last.at)}</span>
            {last.detail ? `: ${last.detail.split(" · Messages ref")[0]}` : ""}. Sending again sends each family a second message.
          </Banner>
        )}
        {paused && (
          <Banner tone="danger" title="SMS is paused.">
            Families without the app can't be reached until an admin resumes SMS.
          </Banner>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Segmented
            aria-label="Language"
            value={language}
            onChange={(v) => setLanguage(v as SmsLanguage)}
            options={[
              { value: "en", label: "English" },
              { value: "ur", label: <span lang="ur">اردو</span> },
            ]}
          />
          {exam.classes.length > 1 && (
            <div className="w-44">
              <Select aria-label="Class" value={section} onChange={(e) => { setSection(e.target.value); setExcluded([]); }} options={[{ value: "", label: "Every section" }, ...exam.classes.map((cs) => ({ value: cs, label: cs }))]} />
            </div>
          )}
        </div>
        {preview.isError && <Banner tone="warning">{errorText(preview.error)}</Banner>}
        {!p ? (
          <div className="grid gap-2">
            <Skeleton height={20} width={320} />
            <Skeleton height={240} />
          </div>
        ) : (
          <>
            <p className="m-0 text-small text-ink-muted" aria-live="polite">
              <b className="text-ink">{formatCount(p.sendable)}</b> {p.sendable === 1 ? "family" : "families"} · {formatCount(p.appRecipients ?? 0)} by app (free), {formatCount(p.smsRecipients ?? 0)} by SMS · about {formatRs(p.estCost ?? 0)}
              {(p.excludedNoResult ?? 0) > 0 ? ` · ${formatCount(p.excludedNoResult ?? 0)} without a result (withheld) skipped` : ""}
              {(p.excludedByYou ?? 0) > 0 ? ` · ${formatCount(p.excludedByYou ?? 0)} unticked` : ""}
              {p.optedOutIncluded > 0 ? ` · ${formatCount(p.optedOutIncluded)} opted out of notices but still get their child's result` : ""}
            </p>
            {rows[0] && (
              <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3 text-small" lang={language} dir={language === "ur" ? "rtl" : "ltr"}>
                {(rows.find((r) => !r.unticked) ?? rows[0]).message}
              </div>
            )}
            <DataTable
              caption="Families who get the result"
              columns={columns}
              rows={rows}
              rowKey="key"
              density="dense"
              maxHeight={360}
              selectable
              selected={ticked}
              onSelectedChange={onTicked}
              empty={<EmptyState icon="exams" title="No results to send" description="Every result in this exam is withheld, or nobody has a guardian mobile on record." />}
            />
          </>
        )}
        {send.isError && <Banner tone="danger">{errorText(send.error)}</Banner>}
      </div>
    </Modal>
  );
}
