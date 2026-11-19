import { ApiError, newIdempotencyKey, teacherApi, teacherQueries, type RegisterCode, type TeacherRegister } from "@mtb/api";
import { formatLongDate } from "@mtb/domain";
import { Banner, Button, Field, Select, SidePanel, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useCtx } from "../../app/session";
import { errorText, MARK_LABEL, MarkControl } from "./shared";

const schema = z.object({
  grNo: z.string().min(1, { error: "Choose the student." }),
  to: z.enum(["P", "A", "L", "LT"], { error: "Choose the new status." }),
  reason: z
    .string()
    .trim()
    .min(5, { error: "Say why the mark should change, in a few words." })
    .max(300, { error: "Keep the reason under 300 letters." }),
});

type Errors = Partial<Record<"grNo" | "to" | "reason" | "form", string>>;

/**
 * After a register is submitted it is locked: a correction is a request (student, new status, reason) that the
 * principal approves. Until then the register keeps the original mark.
 */
export function ChangeRequestPanel({ open, onClose, reg, initialGrNo }: { open: boolean; onClose: () => void; reg: TeacherRegister; initialGrNo: string | null }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [grNo, setGrNo] = useState("");
  const [to, setTo] = useState<RegisterCode>("LT");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  // Kept for every attempt at one request, so a retry after a lost reply can't send it twice.
  const key = useRef(newIdempotencyKey());

  // Each opening starts from the student that was chosen (or none). A refresh of the register while the panel is
  // open must not wipe what the teacher typed, so only opening (or a different student) resets the form.
  useEffect(() => {
    if (!open) return;
    const s = reg.students.find((x) => x.grNo === initialGrNo);
    setGrNo(s?.grNo ?? "");
    setTo(s ? (s.mark === "A" ? "LT" : s.mark === "P" ? "A" : "P") : "LT");
    setReason("");
    setErrors({});
    key.current = newIdempotencyKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialGrNo]);

  const student = reg.students.find((s) => s.grNo === grNo);

  const send = useMutation({
    mutationFn: (body: { grNo: string; to: RegisterCode; reason: string }) => teacherApi.requestChange(ctx, reg.classSection, { date: reg.date, ...body }, key.current),
    onSuccess: (_r, body) => {
      key.current = newIdempotencyKey();
      void queryClient.invalidateQueries({ queryKey: teacherQueries.all(ctx) });
      const s = reg.students.find((x) => x.grNo === body.grNo);
      onClose();
      toast({
        title: "Change sent for approval",
        message: s ? `${s.name}: ${MARK_LABEL[s.mark]} → ${MARK_LABEL[body.to]}. The register shows "Change pending approval" until the principal decides.` : "The principal decides.",
      });
    },
    onError: (e) => {
      const field = e instanceof ApiError ? e.field : undefined;
      if (field === "grNo" || field === "to" || field === "reason") setErrors({ [field]: e.message });
      else setErrors({ form: errorText(e) });
    },
  });

  const submit = () => {
    const parsed = schema.safeParse({ grNo, to, reason });
    const next: Errors = {};
    if (!parsed.success) for (const i of parsed.error.issues) next[i.path[0] as keyof Errors] ??= i.message;
    if (student && student.mark === to) next.to = `${student.name} is already marked ${MARK_LABEL[to]}. Choose a different status.`;
    if (student?.pending) next.grNo = `A change for ${student.name} is already waiting for approval.`;
    setErrors(next);
    if (Object.keys(next).length || !parsed.success || !student) return;
    send.mutate({ grNo, to, reason: parsed.data.reason });
  };

  return (
    <SidePanel
      open={open}
      onClose={() => !send.isPending && onClose()}
      title="Request change"
      description={`${reg.classSection} · ${formatLongDate(reg.date)}. The principal approves changes to a submitted register.`}
      footer={
        <>
          <Button onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button variant="primary" icon="send" loading={send.isPending} loadingLabel="Sending…" onClick={submit}>
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
          submit();
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
          options={[
            { value: "", label: "Choose a student" },
            ...reg.students.map((s) => ({ value: s.grNo, label: `${s.rollNo ? `${s.rollNo} · ` : ""}${s.name} · ${s.grNo} — now ${MARK_LABEL[s.mark]}${s.pending ? " (change waiting)" : ""}` })), // G.R. to tell two Kashafs apart; no "0 ·" without a roll number (test run F-045)
          ]}
        />
        <Field label="New status" required error={errors.to}>
          {() => (
            <MarkControl
              compact
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
    </SidePanel>
  );
}
