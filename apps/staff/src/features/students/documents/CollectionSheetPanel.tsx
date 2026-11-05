import { metaQueries, studentDocsQueries, type StudentDocsCollectionQuery } from "@mtb/api";
import { formatDateTime, formatSession } from "@mtb/domain";
import { Banner, Button, EmptyState, Segmented, Select, SidePanel, Skeleton } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useCtx, useSessionUser } from "../../../app/session";
import { LoadError, nowIso } from "../shared";
import { PrintSheet } from "./print";
import { CollectionSheet } from "./templates";

/**
 * The board-document collection sheet (legacy "Documents Issuance" print): students of a class or group sign as
 * they collect roll no. slips, result cards and certificates. Board roll numbers come from the student records;
 * dates of hand-overs already in the register are filled in.
 */
export function CollectionSheetPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useCtx();
  const user = useSessionUser();
  const classes = useQuery(metaQueries.classes(ctx.campus));
  // Board documents belong to the classes that sit board exams: the ones with groups (9 and 10).
  const boardClasses = (classes.data ?? []).filter((c) => (c.groups?.length ?? 0) > 0);
  const [q, setQ] = useState<StudentDocsCollectionQuery>({ className: "" });
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setQ({ className: boardClasses[0]?.short ?? "" });
      setTried(false);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const cls = classes.data?.find((c) => c.short === q.className);
  const sheet = useQuery({ ...studentDocsQueries.collectionSheet(ctx, q), enabled: open && Boolean(q.className) });
  const printedAt = formatDateTime(nowIso());
  const footer = `Printed ${printedAt}${user ? ` by ${user.name}` : ""}`;
  const rows = sheet.data?.rows ?? [];

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      wide
      title="Collection sheet"
      description={`Roll no. slips, result cards and certificates · Session ${formatSession(ctx.session)} · A4 landscape`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button
            variant="primary"
            icon="printer"
            disabled={Boolean(q.className) && !rows.length}
            onClick={() => {
              setTried(true);
              if (q.className && rows.length) window.print();
            }}
          >
            Print sheet
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Class"
            required
            value={q.className}
            error={tried && !q.className ? "Choose the class." : undefined}
            onChange={(e) => setQ((x) => ({ className: e.target.value, ...(x.gender ? { gender: x.gender } : {}) }))}
            options={[{ value: "", label: "Choose…" }, ...boardClasses.map((c) => ({ value: c.short, label: c.name }))]}
          />
          <Select label="Section" value={q.section ?? ""} disabled={!cls} onChange={(e) => setQ((x) => ({ ...x, section: e.target.value || undefined }))} options={[{ value: "", label: "All sections" }, ...(cls?.sections ?? []).map((s) => ({ value: s, label: `${cls!.short}-${s}` }))]} />
          {(cls?.groups?.length ?? 0) > 0 && (
            <Select label="Group" value={q.stream ?? ""} onChange={(e) => setQ((x) => ({ ...x, stream: e.target.value || undefined }))} options={[{ value: "", label: "All groups" }, ...(cls?.groups ?? [])]} />
          )}
          <div className="grid gap-1.5">
            <span className="mtb-label">Boys or girls</span>
            <Segmented
              aria-label="Boys or girls"
              value={q.gender ?? ""}
              onChange={(v) => setQ((x) => ({ ...x, gender: v as "" | "F" | "M" }))}
              options={[
                { value: "", label: "Everyone" },
                { value: "F", label: "Girls" },
                { value: "M", label: "Boys" },
              ]}
            />
          </div>
        </div>
        <p className="m-0 text-small text-ink-muted">Board roll numbers come from each student's record (Edit on the profile). Dates of hand-overs already recorded are filled in; signature boxes stay empty.</p>
        {boardClasses.length === 0 && classes.data && <Banner tone="info">No class at this campus has board groups set up. Groups are added in Setup → Subjects.</Banner>}
        {sheet.isError && <LoadError what="collection sheet" error={sheet.error} onRetry={() => void sheet.refetch()} />}
        {q.className && sheet.isLoading && <Skeleton height={360} />}
        {sheet.data && rows.length === 0 && <EmptyState icon="students" title="No students" description="Nobody enrolled matches these choices. Try all sections, all groups or everyone." />}
        {sheet.data && rows.length > 0 && (
          <div className="grid gap-2">
            <span className="mtb-label">
              Preview · {rows.length} {rows.length === 1 ? "student" : "students"} · {rows.filter((r) => r.rollPartI || r.rollPartII).length} with a board roll no.
            </span>
            <PrintSheet paper="A4_LANDSCAPE" label="Collection sheet preview" zoom={0.48} footer={footer}>
              <CollectionSheet sheet={sheet.data} printedAt={footer.replace(/^Printed /, "")} />
            </PrintSheet>
          </div>
        )}
      </div>
    </SidePanel>
  );
}
