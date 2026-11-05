import { ApiError, teacherQueries, type RegisterCode, type TeacherRegister } from "@mtb/api";
import { formatDate, formatLongDate } from "@mtb/domain";
import { Banner, BottomSheet, Button, Field, Select, Textarea, useToast } from "@mtb/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useCtx } from "../../app/session";
import { errorText } from "../../app/shell/QueryState";
import { enqueue } from "../../app/sync/outbox";
import { MARK_LABEL, MarkControl } from "./marks";

const schema = z.object({
  grNo: z.string().min(1, { error: "Choose the student." }),
  to: z.enum(["P", "A", "L", "LT"], { error: "Choose the new status." }),
  reason: z
    .string()
    .trim()
    .min(5, { error: "Say why the mark should change, in a few words." })
    .max(200, { error: "Keep the reason under 200 characters." }),
});

type Errors = Partial<Record<"grNo" | "to" | "reason" | "form", string>>;

/**
 * After a register is submitted it is locked: a correction is a request (student, new status, reason) that the
 * principal approves on the staff dashboard. Until then the register keeps the original mark.
 */
export function ChangeSheet({
  open,
  onClose,
  reg,
  initialGrNo,
  queuedGrNos,
}: {
  open: boolean;
  onClose: () => void;
  reg: TeacherRegister;
  initialGrNo: string | null;
  queuedGrNos: string[];
}) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [grNo, setGrNo] = useState("");
  const [to, setTo] = useState<RegisterCode>("LT");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);

  // Each opening starts from the student that was tapped (or none). A refresh of the register while the sheet is
  // open must not wipe what the teacher typed, so only opening (or a different student) resets the form.
  useEffect(() => {
    if (!open) return;
    const s = reg.students.find((x) => x.grNo === initialGrNo);
    setGrNo(s?.grNo ?? "");
    setTo(s ? (s.mark === "A" ? "LT" : s.mark === "P" ? "A" : "P") : "LT");
    setReason("");
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialGrNo]);

  const student = reg.students.find((s) => s.grNo === grNo);

  const send = async () => {
    const parsed = schema.safeParse({ grNo, to, reason });
    const next: Errors = {};
    if (!parsed.success) for (const i of parsed.error.issues) next[i.path[0] as keyof Errors] ??= i.message;
    if (student && student.mark === to) next.to = `${student.name} is already marked ${MARK_LABEL[to]}. Choose a different status.`;
    if (student && (student.pending || queuedGrNos.includes(student.grNo))) next.grNo = `A change for ${student.name} is already waiting for approval.`;
    setErrors(next);
    if (Object.keys(next).length || !parsed.success || !student) return;

    setSending(true);
    const res = await enqueue({
      ctx,
      payload: { kind: "register.change", classSection: reg.classSection, studentName: student.name, body: { date: reg.date, grNo, to, reason: parsed.data.reason } },
      label: `Change for ${student.name} · ${reg.classSection} · ${formatDate(reg.date)}`,
    });
    setSending(false);
    if (res.status === "rejected") {
      const field = res.error instanceof ApiError ? res.error.field : undefined;
      if (field === "grNo" || field === "to" || field === "reason") setErrors({ [field]: res.error.message });
      else setErrors({ form: errorText(res.error) });
      return;
    }
    onClose();
    if (res.status === "sent") {
      void queryClient.invalidateQueries({ queryKey: teacherQueries.all(ctx) });
      toast({ title: "Change sent for approval", message: `${student.name}: ${MARK_LABEL[student.mark]} → ${MARK_LABEL[to]}. The register shows "Change pending approval" until the principal decides.` });
    } else {
      toast({ tone: "warning", title: "Saved on this phone", message: `The change for ${student.name} is sent when the connection is back.` });
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={sending ? undefined : onClose}
      title="Request change"
      description={
        <>
          {reg.classSection} · <bdi dir="ltr">{formatLongDate(reg.date)}</bdi>. The principal approves changes to a submitted register.
        </>
      }
      footer={
        <>
          <Button size="touch" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button size="touch" variant="primary" icon="send" loading={sending} loadingLabel="Sending…" onClick={() => void send()}>
            Send for approval
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {errors.form && (
          <Banner tone="danger" title="Not sent.">
            {errors.form}
          </Banner>
        )}
        <Select
          label="Student"
          required
          value={grNo}
          onChange={(e) => {
            setGrNo(e.target.value);
            setErrors((x) => ({ ...x, grNo: undefined }));
          }}
          error={errors.grNo}
          className="[&_select]:h-11 [&_select]:text-[16px]"
          options={[
            { value: "", label: "Choose a student" },
            ...reg.students.map((s) => ({ value: s.grNo, label: `${s.rollNo} · ${s.name} — now ${MARK_LABEL[s.mark]}${s.pending ? " (change waiting)" : ""}` })),
          ]}
        />
        <Field label="New status" required error={errors.to}>
          {() => (
            <MarkControl
              name={student?.name ?? "the student"}
              value={to}
              onChange={(c) => {
                setTo(c);
                setErrors((x) => ({ ...x, to: undefined }));
              }}
            />
          )}
        </Field>
        {student && (
          <p className="m-0 -mt-2 text-small text-ink-muted">
            {MARK_LABEL[student.mark]} → <b className="text-ink">{MARK_LABEL[to]}</b>
          </p>
        )}
        <Textarea
          label="Reason"
          required
          rows={3}
          placeholder="For example: arrived at 08:20 with his father; the school van was late."
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setErrors((x) => ({ ...x, reason: undefined }));
          }}
          error={errors.reason}
          help="The principal reads this before approving."
        />
      </form>
    </BottomSheet>
  );
}
