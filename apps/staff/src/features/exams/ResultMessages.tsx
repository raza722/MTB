import { type ExamDetail } from "@mtb/api";
import { formatDateTime } from "@mtb/domain";
import { Banner, Button, EmptyState, Modal } from "@mtb/ui";

/** History lines about result messages ("12 result messages held", cancellations on reopen …), newest first. */
export function resultMessageLines(exam: Pick<ExamDetail, "history">) {
  return exam.history.filter((h) => /result messages?/i.test(`${h.action} ${h.detail ?? ""}`));
}

/**
 * Exams → a declared exam → "Result messages". SMS is not switched on yet (the Messages module sends it): declaring with
 * "Hold result messages" queues one message per family with a complete result and a guardian mobile, held until SMS
 * starts; a reopen cancels the ones still held. This shows what was held. Sending and resending from here come with
 * the Messages module.
 */
export function ResultMessagesModal({ exam, onClose }: { exam: ExamDetail; onClose: () => void }) {
  const lines = resultMessageLines(exam);
  return (
    <Modal open onClose={onClose} title="Result messages" description={`${exam.name} · ${exam.classes.join(", ")}`} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="grid gap-4">
        <Banner tone="info" title="Result messages are held until SMS starts.">
          Each family with a complete result and a guardian mobile gets one message with their own child's marks, grade and position. Messages are queued when the results are declared with “Hold result messages” and sent by Messages once SMS is switched on. Reopening the results cancels the ones still held.
        </Banner>
        {lines.length === 0 ? (
          <EmptyState icon="send" title="No result messages held" description="These results were declared without result messages. Families still see them in the parent portal." />
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {lines.map((h) => (
              <li key={h.id} className="grid rounded-md border border-border px-3 py-2">
                <span className="font-medium">{h.action}</span>
                <span className="text-small text-ink-muted">
                  {h.by} · <span className="mtb-num">{formatDateTime(h.at)}</span>
                  {h.detail ? ` · ${h.detail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
