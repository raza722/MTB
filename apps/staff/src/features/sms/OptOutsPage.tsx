import { newIdempotencyKey, smsApi, smsQueries, type CampusCode, type SmsOptOut } from "@mtb/api";
import { formatDateTime, normalizeMobile } from "@mtb/domain";
import { Button, ConfirmDialog, DataTable, EmptyState, Input, Modal, Select, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { campusLabel } from "../../app/shell/campus";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { errorField, errorText, LoadError, MessagesShell } from "./shell";

const VIA = ["Asked at the school office", "Asked by phone", "Replied STOP to a notice", "Wrote to the principal"];

/** /sms/opt-outs — guardians who don't want notices. Messages about their own child still reach them. */
export function OptOutsPage() {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canSend = useCan("sms.send");
  const readOnly = useReadOnly();
  const canEdit = canSend && !readOnly;
  const list = useQuery(smsQueries.optOuts(ctx));
  const [removing, setRemoving] = useState<SmsOptOut | null>(null);
  const [adding, setAdding] = useState(false);
  const [mobile, setMobile] = useState("");
  const [via, setVia] = useState(VIA[0]!);
  const [mobileError, setMobileError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => smsApi.removeOptOut(id),
    onSuccess: async () => {
      const who = removing;
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: smsQueries.optOuts(ctx).queryKey });
      if (who) toast({ title: `${who.guardian || who.mobile} will get notices again`, message: `${who.mobile} was removed from the opt-out list.` });
    },
  });
  // Kept until the add succeeds, so a retry after a lost reply can't answer "already opted out".
  const addKey = useRef(newIdempotencyKey());
  const add = useMutation({
    mutationFn: () => smsApi.addOptOut({ campus: ctx.campus as CampusCode, mobile, via }, addKey.current),
    onSuccess: async (o) => {
      addKey.current = newIdempotencyKey();
      setAdding(false);
      setMobile("");
      await queryClient.invalidateQueries({ queryKey: smsQueries.optOuts(ctx).queryKey });
      toast({ title: `${o.guardian || o.mobile} won't get notices`, message: `Fee, attendance and result messages about ${o.students.length ? o.students.map((s) => s.name).join(", ") : "their children"} still reach ${o.mobile}.` });
    },
    onError: (e) => setMobileError(errorField(e) === "mobile" ? errorText(e) : null),
  });

  const columns: Array<Column<SmsOptOut>> = [
    {
      key: "guardian",
      header: "Guardian",
      render: (o) => (
        <span className="grid">
          <span className="mtb-cell-primary">{o.guardian || "—"}</span>
          <span className="mtb-mono text-small text-ink-muted">{o.mobile}</span>
        </span>
      ),
    },
    {
      key: "students",
      header: "Children",
      render: (o) => (
        <span className="grid">
          {o.students.map((s) => (
            <span key={s.grNo}>
              {s.name}{" "}
              <span className="mtb-cell-secondary">
                · {s.classSection} · <span className="mtb-mono">{s.grNo}</span>
              </span>
            </span>
          ))}
          {ctx.campus === "ALL" && <span className="mtb-cell-secondary">{campusLabel(o.campus)}</span>}
        </span>
      ),
    },
    {
      key: "when",
      header: "Opted out",
      width: 230,
      render: (o) => (
        <span className="grid">
          <span className="mtb-num">{formatDateTime(o.optedOutAt)}</span>
          <span className="mtb-cell-secondary">{o.via}</span>
        </span>
      ),
    },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: "",
            width: 150,
            className: "mtb-td-actions",
            render: (o: SmsOptOut) => (
              <Button size="sm" variant="secondary" onClick={() => setRemoving(o)}>
                Remove opt-out
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <MessagesShell
      title="Opt-outs"
      {...(canEdit && ctx.campus !== "ALL"
        ? {
            actions: (
              <Button
                variant="primary"
                icon="ban"
                onClick={() => {
                  setMobileError(null);
                  add.reset();
                  setAdding(true);
                }}
              >
                Add opt-out
              </Button>
            ),
          }
        : {})}
    >
      <p className="m-0 max-w-3xl text-small text-ink-muted">
        Guardians on this list don't get notices (meetings, events, holidays). Fee, attendance, result and discipline messages still reach them, because those are about their own child. Open decision: confirm this rule with MTB.
      </p>
      {list.error && !list.data ? (
        <LoadError what="The opt-out list" error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          caption="SMS opt-outs"
          columns={columns}
          rows={list.data ?? []}
          rowKey="id"
          loading={list.isPending}
          stickyHeader={false}
          empty={<EmptyState icon="checkCircle" title="No SMS opt-outs" description={`Every guardian at ${campusLabel(ctx.campus)} gets notices. When a guardian replies STOP or asks the office, they appear here.`} />}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.id)}
        title="Send notices to this guardian again?"
        message="Only do this if the guardian asked for it. The change is logged."
        details={removing ? [["Guardian", removing.guardian], ["Mobile", removing.mobile], ["Children", removing.students.map((s) => s.name).join(", ")]] : []}
        confirmLabel="Remove opt-out"
        loading={remove.isPending}
        loadingLabel="Removing…"
        error={remove.error ? errorText(remove.error) : undefined}
      />
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Stop notices to a guardian"
        description="They keep getting messages about their own child: fees, attendance, results."
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={add.isPending}
              loadingLabel="Adding…"
              onClick={() => {
                if (!normalizeMobile(mobile)) return setMobileError("Enter an 11-digit mobile number starting with 03, for example 0300-1234567.");
                setMobileError(null);
                add.mutate();
              }}
            >
              Add opt-out
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Input label="Guardian's mobile" required mono inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="0300-1234567" {...(mobileError ? { error: mobileError } : { help: "The number on the student's record." })} />
          <Select label="How they asked" value={via} onChange={(e) => setVia(e.target.value)} options={VIA} />
          {add.error && !errorField(add.error) && <p className="m-0 text-small text-danger-ink">{errorText(add.error)}</p>}
        </div>
      </Modal>
    </MessagesShell>
  );
}
