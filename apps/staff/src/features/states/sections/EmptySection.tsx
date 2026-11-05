import { formatDate } from "@mtb/domain";
import { Avatar, Button, DataTable, EmptyState, Icon, KeyValue, StatusBadge, Urdu, type Column } from "@mtb/ui";
import { useState } from "react";
import { HAMZA } from "../demo";
import { AppFrame, PhoneFrame, Specimen, StateGroupSection } from "../kit";

interface OptOut {
  id: string;
  guardian: string;
  mobile: string;
  student: string;
  since: string;
}

const OPT_OUT_COLUMNS: Array<Column<OptOut>> = [
  { key: "guardian", header: "Guardian" },
  { key: "mobile", header: "Mobile" },
  { key: "student", header: "Children" },
  { key: "since", header: "Since" },
  { key: "x", header: <span className="mtb-sr-only">Actions</span>, align: "right" },
];

export function EmptySection() {
  const [hamzaCleared, setHamzaCleared] = useState(false);

  return (
    <StateGroupSection id="empty">
      <Specimen
        id="all-dues-cleared"
        rise={0}
        wide
        actions={
          hamzaCleared ? (
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => setHamzaCleared(false)}>
              Show Hamza again
            </Button>
          ) : undefined
        }
      >
        <AppFrame title="Fee counter">
          <div className="grid items-start gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
            <div className="mtb-card grid gap-3 p-4">
              {hamzaCleared ? (
                <p className="m-0 text-small text-ink-muted">No student loaded.</p>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <Avatar name={HAMZA.name} size="lg" />
                    <div className="grid min-w-0">
                      <span className="truncate font-semibold text-ink">{HAMZA.name}</span>
                      <Urdu size="small">{HAMZA.nameUr}</Urdu>
                    </div>
                  </div>
                  <KeyValue
                    items={[
                      ["G.R.", <span className="mtb-mono">{HAMZA.grNo}</span>],
                      ["Class", HAMZA.classSection],
                      ["Father", HAMZA.father],
                    ]}
                  />
                  <StatusBadge status="paid">Paid up</StatusBadge>
                </>
              )}
            </div>
            <div className="mtb-card">
              {hamzaCleared ? (
                <EmptyState key="start" className="mtb-rise" icon="fees" title="Find a student to start" description="Search by name, G.R. number or father's CNIC. Press F2 to jump to the search box from anywhere on this page." />
              ) : (
                <EmptyState
                  key="cleared"
                  icon="checkCircle"
                  title="All dues cleared"
                  description={`${HAMZA.name} (${HAMZA.grNo}, ${HAMZA.classSection}) has nothing to pay.`}
                  action={
                    <Button variant="primary" onClick={() => setHamzaCleared(true)} iconRight="arrowRight">
                      Next student
                    </Button>
                  }
                />
              )}
            </div>
          </div>
        </AppFrame>
      </Specimen>

      <Specimen id="no-duplicates" rise={1}>
        <AppFrame title="Possible duplicates" context="Admissions · Khalid Campus">
          <div className="mtb-card">
            <EmptyState icon="checkCircle" title="No possible duplicates to review" description="When a new application or record looks like someone already in the system, it appears here for a decision." />
          </div>
          <p className="m-0 flex items-center gap-2 text-small text-ink-muted">
            <Icon name="info" size={16} />
            Every merge and every “not the same person” is recorded.
          </p>
        </AppFrame>
      </Specimen>

      <Specimen id="no-opt-outs" rise={2}>
        <AppFrame title="SMS opt-outs" context="SMS · Khalid Campus">
          <DataTable<OptOut>
            caption="SMS opt-outs"
            columns={OPT_OUT_COLUMNS}
            rows={[]}
            empty={<EmptyState icon="checkCircle" title="No SMS opt-outs" description="Every guardian at Khalid Campus gets notices. When a guardian replies STOP or asks the office, they appear here." />}
          />
        </AppFrame>
      </Specimen>

      <Specimen id="holiday" rise={3} plain>
        <PhoneFrame label="Teacher app, 7-B register on a holiday" title="7-B register" subtitle={<bdi dir="ltr">Friday {formatDate("2026-12-25")} · 34 students</bdi>}>
          <div className="mtb-card mtb-rise p-2">
            <EmptyState
              icon="calendar"
              title="No attendance today — Quaid-e-Azam Day"
              description={
                <>
                  <Urdu size="small">یومِ قائدِ اعظم</Urdu>
                  <br />
                  Registers are closed for the day. Nothing needs marking.
                </>
              }
            />
          </div>
        </PhoneFrame>
      </Specimen>
    </StateGroupSection>
  );
}
