import { admissionsApi, admissionsQueries, ApiError, newIdempotencyKey, type AdmissionsMeritRow, type Ctx } from "@mtb/api";
import { formatDate, formatPercent } from "@mtb/domain";
import { Banner, Button, Checkbox, ConfirmDialog, cx, EmptyState, Icon, Input, Modal, Segmented, Select, Skeleton, StatusBadge, useToast } from "@mtb/ui";
import { PrintSheet, printNow } from "../students/documents/print";
import { MeritListPrint, meritRemark } from "./slips";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useCan, useReadOnly } from "../../app/session";
import { DiamondMindsBadge, relationName, scoreOf, scoreShare } from "./shared";

/** Percentage of the candidate's papers; null (shown "—") without a score or a total, never over a 0 base. */
const pct = (r: AdmissionsMeritRow): number | null => {
  const share = scoreShare(r.applicant);
  return share === null ? null : share * 100;
};

/** "1st merit list", "2nd merit list"… */
export const roundTitle = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"} merit list`;

const seatsSchema = z.string().regex(/^\d{1,3}$/, { error: "Enter a whole number of seats." }).refine((v) => Number(v) >= 1 && Number(v) <= 500, { error: "Seats must be 1 to 500." });
const titleSchema = z.string().trim().min(3, { error: "Give the list a title, for example “2nd merit list”." });

export function MeritListView({ ctx, cls, onClassChange }: { ctx: Ctx; cls: string; onClassChange: (c: string) => void }) {
  const [testId, setTestId] = useState("");
  const [gender, setGender] = useState<"" | "F" | "M">("");
  const [seatsText, setSeatsText] = useState("");
  const seatsOk = seatsSchema.safeParse(seatsText);
  const seats = seatsText && seatsOk.success ? Number(seatsText) : undefined;
  const merit = useQuery({ ...admissionsQueries.merit(ctx, cls, { testId, gender, ...(seats !== undefined ? { seats } : {}) }), placeholderData: (prev) => (prev?.classApplied === cls || !cls ? prev : undefined) });
  const canManage = useCan("admissions.manage");
  const readOnly = useReadOnly();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [offerKey, setOfferKey] = useState(newIdempotencyKey);
  const [printing, setPrinting] = useState(false);
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveKey, setSaveKey] = useState(newIdempotencyKey);
  const data = merit.data;

  // A new class or round starts with the round's default title and the class's seats.
  useEffect(() => {
    if (data) setTitle(roundTitle(data.round));
  }, [data?.classApplied, data?.round]); // eslint-disable-line react-hooks/exhaustive-deps

  const eligible = useMemo(() => (data?.rows ?? []).filter((r) => r.rank <= data!.seats && r.applicant.stage === "MERIT"), [data]);
  const chosen = eligible.filter((r) => selected.has(r.applicant.id));
  const canAct = canManage && !readOnly;

  const offer = useMutation({
    mutationFn: () => admissionsApi.offer(ctx, chosen.map((r) => r.applicant.id), offerKey, { classApplied: data!.classApplied, ...(testId ? { testId } : {}), ...(gender ? { gender } : {}), seats: data!.seats }),
    onSuccess: (res) => {
      setConfirming(false);
      setSelected(new Set());
      setOfferKey(newIdempotencyKey());
      void queryClient.invalidateQueries({ queryKey: admissionsQueries.all() });
      const names = res.offered.map((a) => a.name).join(", ");
      const until = res.offered.find((a) => a.offerValidUntil)?.offerValidUntil;
      toast({ title: `Admission offered to ${res.offered.length} ${res.offered.length === 1 ? "applicant" : "applicants"}`, message: `${names} · now under Offers & admission${until ? `, valid until ${formatDate(until)}` : ""}` });
    },
  });
  const offerError = offer.error instanceof ApiError ? (offer.error.isNetwork ? "Offer not sent — the connection dropped. It's safe to try again." : offer.error.message) : undefined;

  const save = useMutation({
    mutationFn: () => admissionsApi.saveMeritList(ctx, { classApplied: data!.classApplied, ...(testId ? { testId } : {}), ...(gender ? { gender } : {}), seats: data!.seats, title: title.trim() }, saveKey),
    onSuccess: (l) => {
      setSaving(false);
      setSaveKey(newIdempotencyKey());
      void queryClient.invalidateQueries({ queryKey: admissionsQueries.all() });
      toast({ title: `${l.title} saved`, message: `${l.selected.length} selected for ${l.seats} seats. Offer them their seats; the next list leaves out everyone offered.` });
    },
  });

  if (merit.isLoading || !data) {
    if (merit.isError) {
      return (
        <div className="mtb-card">
          <EmptyState icon="alertCircle" title="Couldn't load the merit list" description={merit.error instanceof ApiError ? merit.error.message : "Try again."} action={<Button size="sm" onClick={() => merit.refetch()}>Try again</Button>} />
        </div>
      );
    }
    return <Skeleton height={360} style={{ borderRadius: "var(--radius-lg)" }} />;
  }

  if (data.classes.length === 0) {
    return (
      <div className="mtb-card">
        <EmptyState icon="listChecks" title="No merit lists yet" description="A merit list appears here once an entrance test has been marked for this campus and session." />
      </div>
    );
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allChosen = eligible.length > 0 && eligible.every((r) => selected.has(r.applicant.id));
  const someChosen = !allChosen && eligible.some((r) => selected.has(r.applicant.id));
  const offeredCount = data.rows.filter((r) => r.applicant.stage === "OFFERED" || r.applicant.stage === "ADMITTED").length;
  const papers = data.subjects;
  const cols = (canAct ? 1 : 0) + 6 + papers.length;
  const resetFilters = () => {
    setSelected(new Set());
    offer.reset();
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1.5">
          <span className="mtb-label">Class</span>
          <Segmented
            aria-label="Merit list class"
            value={data.classApplied}
            onChange={(c) => {
              resetFilters();
              setTestId("");
              setSeatsText("");
              onClassChange(c);
            }}
            options={data.classes}
          />
        </div>
        <Button size="sm" icon="printer" onClick={() => setPrinting(true)}>
          Print merit list
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Select
            label="Test sitting"
            value={testId}
            onChange={(e) => {
              resetFilters();
              setTestId(e.target.value);
            }}
            options={[{ value: "", label: "Every sitting of the class" }, ...data.tests.map((t) => ({ value: t.id, label: `${t.name} · ${formatDate(t.date)}` }))]}
          />
        </div>
        <div className="w-40">
          <Select
            label="Boys or girls"
            value={gender}
            onChange={(e) => {
              resetFilters();
              setGender(e.target.value as "" | "F" | "M");
            }}
            options={[
              { value: "", label: "Both" },
              { value: "F", label: "Girls" },
              { value: "M", label: "Boys" },
            ]}
          />
        </div>
        <div className="w-40">
          <Input
            label="Seats on this list"
            inputMode="numeric"
            amount
            value={seatsText}
            placeholder={String(data.seats)}
            onChange={(e) => {
              resetFilters();
              setSeatsText(e.target.value.replace(/\D/g, ""));
            }}
            {...(seatsText && !seatsOk.success ? { error: seatsOk.error.issues[0]?.message } : {})}
          />
        </div>
        <div className="w-56">
          <Input label="List title" value={title} onChange={(e) => setTitle(e.target.value)} {...(titleError ? { error: titleError } : { help: data.saved.length ? `Last saved: ${data.saved[0]!.title}, ${formatDate(data.saved[0]!.savedOn)}` : "Shown on the printed list." })} />
        </div>
        {canAct && (
          <Button
            icon="check"
            onClick={() => {
              const t = titleSchema.safeParse(title);
              if (!t.success) {
                setTitleError(t.error.issues[0]?.message ?? "Enter a title.");
                return;
              }
              setTitleError(null);
              save.reset();
              setSaving(true);
            }}
            disabled={data.rows.length === 0}
          >
            Save as {roundTitle(data.round)}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Counts">
        <StatusBadge status="neutral">Appeared {data.counts.appeared}</StatusBadge>
        <StatusBadge status="cancelled">Absent {data.counts.absent}</StatusBadge>
        <StatusBadge status="pending">Inside the seats {data.counts.inside}</StatusBadge>
        <StatusBadge status="warning">Waiting list {data.counts.waiting}</StatusBadge>
        <StatusBadge status="neutral">Not selected {data.counts.notSelected}</StatusBadge>
        <span className="text-small text-ink-muted">
          {data.testName}
          {data.testDate ? (
            <>
              {" "}· <span className="mtb-num">{formatDate(data.testDate)}</span>
            </>
          ) : (
            " · no sitting held yet"
          )}{" "}
          · {data.seats} seats
          {data.cutoffScore !== null && (
            <>
              {" "}· cut-off <b className="mtb-num text-ink">{data.cutoffScore}</b>
            </>
          )}
          {data.saved.length > 0 ? ` · ${data.saved.length} ${data.saved.length === 1 ? "list" : "lists"} saved; candidates already offered are left out of this one` : ""}
        </span>
      </div>

      {readOnly && <Banner tone="info">Merit lists from past sessions can be viewed but not changed.</Banner>}
      {!canManage && !readOnly && <Banner tone="neutral">Your role can view the merit list but not offer admission.</Banner>}

      <div className="mtb-table-wrap" style={{ opacity: merit.isFetching ? 0.7 : 1, transition: "opacity 160ms ease" }}>
        {canAct && (
          <div className="mtb-table-toolbar">
            <span className="text-small text-ink-muted" aria-live="polite">
              {chosen.length > 0 ? `${chosen.length} selected` : eligible.length > 0 ? `${eligible.length} inside the seats can be offered admission` : "Every seat on this list has been offered."}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={eligible.length === 0 || allChosen} onClick={() => setSelected(new Set(eligible.map((r) => r.applicant.id)))}>
                Select all above cut-off
              </Button>
              <Button size="sm" variant="primary" icon="send" disabled={chosen.length === 0} onClick={() => setConfirming(true)}>
                Offer admission{chosen.length > 0 ? ` · ${chosen.length}` : ""}
              </Button>
            </div>
          </div>
        )}
        <div className="mtb-table-scroll">
          {data.rows.length === 0 ? (
            <EmptyState icon="listChecks" title="Nobody on this list" description={data.saved.length ? "Everyone ranked has been offered a seat in an earlier list, or no candidate matches these filters." : "No marked candidate matches these filters."} />
          ) : (
            <table className="mtb-table mtb-table-roomy">
              <caption className="mtb-sr-only">
                {data.classApplied} merit list, ranked by test score, {data.seats} seats
              </caption>
              <thead>
                <tr>
                  {canAct && (
                    <th className="mtb-td-check" style={{ position: "static" }}>
                      <Checkbox aria-label="Select everyone above the cut-off" checked={allChosen} indeterminate={someChosen} disabled={eligible.length === 0} onChange={() => setSelected(allChosen ? new Set() : new Set(eligible.map((r) => r.applicant.id)))} />
                    </th>
                  )}
                  <th scope="col" className="mtb-th-num" style={{ position: "static", width: 64 }}>
                    Rank
                  </th>
                  <th scope="col" style={{ position: "static" }}>
                    Applicant
                  </th>
                  <th scope="col" style={{ position: "static", width: 110 }}>
                    Seat no.
                  </th>
                  {papers.map((p) => (
                    <th key={p.subject} scope="col" className="mtb-th-num" style={{ position: "static", width: 92 }} title={p.stream ? `${p.subject}: ${p.stream} only` : p.subject}>
                      {p.subject}
                      <span className="block text-caption font-normal">/ {p.max}</span>
                    </th>
                  ))}
                  <th scope="col" className="mtb-th-num" style={{ position: "static", width: 100 }}>
                    Total
                  </th>
                  <th scope="col" className="mtb-th-num" style={{ position: "static", width: 80 }}>
                    %
                  </th>
                  <th scope="col" style={{ position: "static", width: 180 }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const inside = r.rank <= data.seats;
                  const offered = r.applicant.stage === "OFFERED" || r.applicant.stage === "ADMITTED";
                  const isSel = selected.has(r.applicant.id);
                  const remark = meritRemark(r.rank, data.seats);
                  return (
                    <Fragment key={r.applicant.id}>
                      <tr className={cx(isSel && "is-selected", !inside && "is-muted")}>
                        {canAct && (
                          <td className="mtb-td-check">
                            <Checkbox aria-label={`Select ${r.applicant.name}`} checked={isSel} disabled={!inside || offered} onChange={() => toggle(r.applicant.id)} />
                          </td>
                        )}
                        <td className="mtb-td-num font-semibold">{r.rank}</td>
                        <td>
                          <span className="grid">
                            <span className="mtb-cell-primary flex flex-wrap items-center gap-2" style={!inside ? { color: "var(--ink-muted)" } : undefined}>
                              {r.applicant.name} {r.applicant.diamondMinds && <DiamondMindsBadge />}
                            </span>
                            <span className="mtb-cell-secondary">
                              {relationName(r.applicant)}
                              {r.applicant.stream ? ` · ${r.applicant.stream}` : ""}
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className="mtb-mono">{r.applicant.testRollNo ?? "—"}</span>
                        </td>
                        {papers.map((p) => {
                          const v = r.applicant.marks?.[p.subject];
                          return (
                            <td key={p.subject} className="mtb-td-num">
                              {v === undefined || v === null ? <span className="text-ink-subtle">—</span> : v}
                            </td>
                          );
                        })}
                        <td className="mtb-td-num font-medium">{scoreOf(r.applicant)}</td>
                        <td className="mtb-td-num">{(() => {
                          const v = pct(r);
                          return v === null ? <span className="text-ink-subtle">—</span> : formatPercent(v);
                        })()}</td>
                        <td>
                          {offered ? (
                            r.applicant.stage === "ADMITTED" ? (
                              <StatusBadge status="success">Admitted · {r.applicant.grNo}</StatusBadge>
                            ) : (
                              <StatusBadge status="warning">Offer sent {r.applicant.offeredOn ? formatDate(r.applicant.offeredOn) : ""}</StatusBadge>
                            )
                          ) : inside ? (
                            <StatusBadge status="pending">Inside the seats</StatusBadge>
                          ) : (
                            <StatusBadge status="neutral">{remark}</StatusBadge>
                          )}
                        </td>
                      </tr>
                      {r.rank === data.seats && data.rows.length > data.seats && (
                        <tr aria-label={`Cut-off after rank ${data.seats}`}>
                          <td colSpan={cols} style={{ padding: 0, borderBottom: "2px solid var(--ink)" }}>
                            <span className="flex items-center gap-2 bg-surface-sunken px-3 py-1.5 text-caption uppercase text-ink">
                              <Icon name="minus" size={16} />
                              Cut-off · {data.seats} seats · {data.cutoffScore} and above are inside · the next {data.seats} are the waiting list
                            </span>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="mtb-table-footer">
          <span>
            {data.rows.length} ranked · {offeredCount} offered · ties go to the older applicant
          </span>
        </div>
      </div>

      <Modal
        open={printing}
        onClose={() => setPrinting(false)}
        size="lg"
        title={`${title.trim() || "Merit list"} · ${data.classApplied}`}
        footer={
          <>
            <Button onClick={() => setPrinting(false)}>Close</Button>
            <Button variant="primary" icon="printer" onClick={printNow}>
              Print
            </Button>
          </>
        }
      >
        <PrintSheet paper="A4" label="Merit list" zoom={0.55}>
          <MeritListPrint m={data} campus={ctx.campus} campusName={data.rows[0]?.applicant.campusName ?? ctx.campus} title={title.trim() || undefined} />
        </PrintSheet>
      </Modal>
      <ConfirmDialog
        open={saving}
        onClose={() => {
          setSaving(false);
          save.reset();
        }}
        onConfirm={() => save.mutate()}
        icon="listChecks"
        title={`Save the ${title.trim()} for ${data.classApplied}?`}
        message={`The list is kept as round ${data.round}: ${Math.min(data.seats, data.rows.length)} inside ${data.seats} seats. Offer them their seats from here. The next list ranks only candidates not yet offered.`}
        confirmLabel={`Save ${roundTitle(data.round)}`}
        loading={save.isPending}
        loadingLabel="Saving…"
        error={save.error ? (save.error instanceof ApiError ? save.error.message : "Not saved. Try again.") : undefined}
      />
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          offer.reset();
        }}
        onConfirm={() => offer.mutate()}
        title={`Offer admission to ${chosen.length} ${chosen.length === 1 ? "applicant" : "applicants"}?`}
        message={`They move to Offers & admission for ${data.classApplied}. Each offer has an expiry date (seven days unless the office changes it); tell the families to complete the admission before then.`}
        details={chosen.map((r) => [`${r.rank}. ${r.applicant.name}`, scoreOf(r.applicant)])}
        confirmLabel={`Offer admission · ${chosen.length}`}
        loading={offer.isPending}
        loadingLabel="Sending offers…"
        error={offerError}
      />
    </div>
  );
}
