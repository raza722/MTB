import { studentDocsQueries } from "@mtb/api";
import { Button, Modal, Skeleton, Switch } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { LoadError, today } from "../shared";
import { PrintSheet, printNow } from "./print";
import { BlankAdmissionForm, StudentRecordForm } from "./templates";

/**
 * One student's printed admission form (the full record on one A4 page), from the student's profile; or, with the
 * switch, the blank four-page admission form of the student's campus, to fill in by hand.
 */
export function AdmissionFormModal({ grNo, open, onClose }: { grNo: string; open: boolean; onClose: () => void }) {
  const q = useQuery({ ...studentDocsQueries.forStudent(grNo), enabled: open && Boolean(grNo) });
  const [blank, setBlank] = useState(false);
  const s = q.data?.snapshot;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={blank ? "Blank admission form" : "Admission form"}
      description={blank ? "Four A4 pages, sections A to L, for a family to fill in by hand." : "The full record on one A4 page, for the file and the guardian's signature."}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon="printer" disabled={!s} onClick={printNow}>
            Print
          </Button>
        </>
      }
    >
      <div className="mb-3">
        <Switch label="Blank form, to fill in by hand" checked={blank} onChange={(e) => setBlank(e.target.checked)} />
      </div>
      {q.isError ? (
        <LoadError what="student record" error={q.error} onRetry={() => void q.refetch()} />
      ) : !s ? (
        <Skeleton height={420} />
      ) : (
        open && (
          <PrintSheet paper="A4" label={blank ? "Blank admission form" : "Admission form"} zoom={0.55}>
            {blank ? <BlankAdmissionForm campus={s.campus} campusName={s.campusName} session={s.session} /> : <StudentRecordForm s={s} printedOn={today()} />}
          </PrintSheet>
        )
      )}
    </Modal>
  );
}
