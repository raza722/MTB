import { studentsQueries, type StudentLabelsQuery } from "@mtb/api";
import { Banner, Button, EmptyState, SidePanel, Skeleton } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useCtx } from "../../../app/session";
import { LoadError } from "../shared";
import { PrintSheet } from "./print";
import { AddressLabelSheets } from "./templates";

/**
 * Postal address labels (legacy "Address Post"): student name and G.R., father, class, section, address and
 * contact, eight to an A4 sheet with dashed cut lines. For ticked students, a whole list or one profile.
 */
export function AddressLabelsPanel({ open, onClose, query, title }: { open: boolean; onClose: () => void; query: StudentLabelsQuery; title: string }) {
  const ctx = useCtx();
  const labels = useQuery({ ...studentsQueries.labels(ctx, query), enabled: open && Boolean(query.className || query.grNos?.length) });
  const list = labels.data ?? [];
  const sheets = Math.ceil(list.length / 8);
  const noAddress = list.filter((l) => !l.address.trim()).length;
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      wide
      title="Address labels"
      description={`${title} · eight labels to an A4 sheet`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon="printer" disabled={!list.length} onClick={() => window.print()}>
            Print {list.length ? `${list.length} ${list.length === 1 ? "label" : "labels"}` : "labels"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {labels.isError && <LoadError what="addresses" error={labels.error} onRetry={() => void labels.refetch()} />}
        {labels.isLoading && <Skeleton height={420} />}
        {labels.data && list.length === 0 && <EmptyState icon="mapPin" title="No addresses to print" description="None of these students is enrolled at this campus." />}
        {noAddress > 0 && <Banner tone="warning">{`${noAddress} ${noAddress === 1 ? "student has" : "students have"} no address on record. Their labels print with a blank address line; correct it with Edit on the profile.`}</Banner>}
        {list.length > 0 && (
          <div className="grid gap-2">
            <span className="mtb-label">
              Preview · {list.length} {list.length === 1 ? "label" : "labels"} on {sheets} {sheets === 1 ? "sheet" : "sheets"}
            </span>
            <PrintSheet paper="A4_LABELS" label="Address labels preview" zoom={0.55}>
              <AddressLabelSheets labels={list} />
            </PrintSheet>
          </div>
        )}
      </div>
    </SidePanel>
  );
}
