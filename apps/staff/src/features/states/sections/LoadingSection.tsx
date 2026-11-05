import { Button, Segmented, TabPanel, Tabs, Timeline } from "@mtb/ui";
import { useRef, useState } from "react";
import { AYESHA_TIMELINE } from "../../design-system/demo-data";
import { Specimen, StateGroupSection, useReplay, type LoadPhase } from "../kit";
import { DashboardKpis, ProfileHeader, TabSkeleton } from "../screens";

const PROFILE_TABS = [
  { id: "enrolment", label: "Enrolment history" },
  { id: "attendance", label: "Attendance" },
  { id: "results", label: "Results", count: 1 },
  { id: "ledger", label: "Fee ledger" },
  { id: "sms", label: "SMS history", count: 14 },
];

function PhaseControls({ phase, onHold, onReplay, label }: { phase: LoadPhase; onHold: (p: LoadPhase) => void; onReplay: () => void; label: string }) {
  return (
    <>
      <Segmented
        aria-label={`${label}: show`}
        value={phase}
        onChange={(v) => onHold(v as LoadPhase)}
        options={[
          { value: "loading", label: "Loading" },
          { value: "loaded", label: "Loaded" },
        ]}
      />
      <Button size="sm" variant="ghost" icon="refresh" onClick={onReplay}>
        Replay
      </Button>
    </>
  );
}

export function LoadingSection() {
  const dashRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const dash = useReplay(dashRef, 1800);
  const profile = useReplay(profileRef, 1600);
  const [tab, setTab] = useState("enrolment");

  return (
    <StateGroupSection id="loading" cols={1}>
      <Specimen id="dashboard-loading" rise={0} actions={<PhaseControls label="Dashboard cards" phase={dash.phase} onHold={dash.hold} onReplay={dash.replay} />}>
        <div ref={dashRef} aria-live="polite">
          {/* Keyed by run, so the cards rise and count up again on every replay. */}
          <DashboardKpis key={dash.run} loading={dash.phase === "loading"} />
        </div>
      </Specimen>

      <Specimen id="profile-loading" rise={1} actions={<PhaseControls label="Student profile" phase={profile.phase} onHold={profile.hold} onReplay={profile.replay} />}>
        <div ref={profileRef} key={profile.run} className="grid gap-4">
          <ProfileHeader loading={profile.phase === "loading"} />
          <div className="mtb-card px-5 pb-5">
            <Tabs aria-label="Student profile" idPrefix="st-load-" value={tab} onChange={setTab} tabs={PROFILE_TABS} />
            {PROFILE_TABS.map((t) => (
              <TabPanel key={t.id} id={t.id} idPrefix="st-load-" active={tab === t.id}>
                {profile.phase === "loading" ? (
                  <TabSkeleton />
                ) : t.id === "enrolment" ? (
                  <div className="mtb-rise pt-4">
                    <Timeline items={AYESHA_TIMELINE} label="Ayesha Khan enrolment history" />
                  </div>
                ) : (
                  <p className="mtb-rise m-0 pt-4 text-ink-muted">This tab loads on its own when opened, with the same skeleton while it does. Open the live screen to see it with real data.</p>
                )}
              </TabPanel>
            ))}
          </div>
        </div>
      </Specimen>
    </StateGroupSection>
  );
}
