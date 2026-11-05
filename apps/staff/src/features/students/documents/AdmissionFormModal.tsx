import { studentDocsQueries } from "@mtb/api";
import { Button, Modal, Skeleton } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { LoadError, today } from "../shared";
import { PrintSheet, printNow } from "./print";
import { StudentRecordForm } from "./templates";

/** One student's printed admission form (the full record on one A4 page), from the student's profile. */
export function AdmissionFormModal({ grNo, open, onClose }: { grNo: string; open: boolean; onClose: () => void }) {
  const q = useQuery({ ...studentDocsQueries.forStudent(grNo), enabled: open && Boolean(grNo) });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Admission form"
      description="The full record on one A4 page, for the file and the guardian's signature."
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon="printer" disabled={!q.data} onClick={printNow}>
            Print
          </Button>
        </>
      }
    >
      {q.isError ? (
        <LoadError what="student record" error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton height={420} />
      ) : (
        open && (
          <PrintSheet paper="A4" label="Admission form" zoom={0.55}>
            <StudentRecordForm s={q.data.snapshot} printedOn={today()} />
          </PrintSheet>
        )
      )}
    </Modal>
  );
}
