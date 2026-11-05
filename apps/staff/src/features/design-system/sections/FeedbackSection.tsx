import { calculateLateFine, formatRs } from "@mtb/domain";
import {
  AttendanceCalendar,
  Avatar,
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  KeyValue,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Modal,
  PermissionDenied,
  ShortcutHints,
  SidePanel,
  Skeleton,
  StatusBadge,
  Stepper,
  TabPanel,
  Tabs,
  Timeline,
  Tooltip,
  Urdu,
  useToast,
  Select,
  Textarea,
} from "@mtb/ui";
import { useState } from "react";
import { useAppearance } from "../../../app/appearance";
import { Section, Specimen, StateCell } from "../ds-kit";
import { AYESHA_OCTOBER, AYESHA_OCTOBER_HOLIDAYS, AYESHA_TIMELINE, DEMO_TODAY } from "../demo-data";

type Dialog = null | "post" | "declare" | "pause" | "modal" | "panel";

export function FeedbackSection() {
  const toast = useToast();
  const { theme, setTheme } = useAppearance();
  const [tab, setTab] = useState("enrolment");
  const [open, setOpen] = useState<Dialog>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState(false);
  const [failNext, setFailNext] = useState(true);
  const annualFine = calculateLateFine("2026-09-15", DEMO_TODAY);

  const post = () => {
    setPosting(true);
    setPostError(false);
    setTimeout(() => {
      setPosting(false);
      if (failNext) {
        setFailNext(false);
        setPostError(true);
        return;
      }
      setOpen(null);
      setFailNext(true);
      toast({ title: "Receipt KC-2627-004821 posted", message: "Ayesha Khan · Rs 12,250 · Cash" });
    }, 1400);
  };

  return (
    <Section id="feedback" title="Layout and feedback" intro="A banner describes the state a page is in; a toast describes an event. Irreversible actions always restate the figures before they happen.">
      <Specimen title="Tabs" note="Student profile tabs. Arrow keys, Home and End move between them." bodyClassName="grid gap-0">
        <Tabs
          aria-label="Student profile"
          idPrefix="ds-"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "enrolment", label: "Enrolment history" },
            { id: "attendance", label: "Attendance" },
            { id: "results", label: "Results", count: 1 },
            { id: "ledger", label: "Fee ledger" },
            { id: "sms", label: "SMS history", count: 14 },
          ]}
        />
        <TabPanel id="enrolment" idPrefix="ds-" active={tab === "enrolment"}>
          <Timeline items={AYESHA_TIMELINE} label="Ayesha Khan enrolment history" />
        </TabPanel>
        <TabPanel id="attendance" idPrefix="ds-" active={tab === "attendance"}>
          <div className="max-w-xl">
            <AttendanceCalendar year={2026} month={9} days={AYESHA_OCTOBER} holidayNames={AYESHA_OCTOBER_HOLIDAYS} today={DEMO_TODAY} />
          </div>
        </TabPanel>
        <TabPanel id="results" idPrefix="ds-" active={tab === "results"}>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-title-3">First Term 2026–27</span>
            <span className="mtb-num">512 / 600 · 85.3%</span>
            <StatusBadge status="success">A+</StatusBadge>
            <StatusBadge status="declared" icon="lock" />
          </div>
        </TabPanel>
        <TabPanel id="ledger" idPrefix="ds-" active={tab === "ledger"}>
          <EmptyState icon="receipt" title="The ledger is built in the screens deliverable" description="It shows charges, late fines, receipts and cancellations with calculated balances." />
        </TabPanel>
        <TabPanel id="sms" idPrefix="ds-" active={tab === "sms"}>
          <EmptyState icon="sms" title="No SMS opt-outs" description="When a guardian opts out of notices, they appear here. Fee and attendance messages can't be opted out of." />
        </TabPanel>
      </Specimen>

      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen title="Overlays" note="Modal for focused tasks; SidePanel when the page should stay in view; ConfirmDialog before anything irreversible. Focus is trapped inside and returns on close.">
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setOpen("post")}>
                Review and post receipt
              </Button>
              <Button onClick={() => setOpen("declare")}>Declare results</Button>
              <Button variant="danger" icon="pause" onClick={() => setOpen("pause")}>
                Pause all SMS
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setOpen("panel")} icon="attendance">
                Attendance correction (side panel)
              </Button>
              <Button onClick={() => setOpen("modal")} icon="send">
                Send SMS (modal)
              </Button>
            </div>
            <p className="m-0 text-small text-ink-muted">The receipt review fails once on purpose to show the network error, then posts on the retry.</p>
          </div>
        </Specimen>

        <Specimen title="Toasts" note="Carry the record number; never block the next action.">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => toast({ title: "Receipt KC-2627-004821 posted", message: "Ayesha Khan · Rs 12,250 · Cash" })}>Receipt posted</Button>
            <Button onClick={() => toast({ title: "Attendance submitted · 7-B", message: "31 P · 2 A · 1 L · 0 LT — parents of 2 absent students will get an SMS." })}>Attendance submitted</Button>
            <Button onClick={() => toast({ title: "Results declared", message: "First Term 2026–27 · 3 classes · now visible in the parent portal." })}>Results declared</Button>
            <Button onClick={() => toast({ tone: "danger", title: "Receipt not posted — safe to try again", message: "The connection dropped before the server replied. Nothing was saved." })}>Network error</Button>
            <Button onClick={() => toast({ tone: "warning", title: "Offline — saved on this phone", message: "The register will sync when the connection is back." })}>Offline</Button>
          </div>
        </Specimen>
      </div>

      <Specimen title="Banners" bodyClassName="grid gap-3">
        <Banner tone="info" title="Viewing 2025–26 — read-only." actions={<Button size="sm">Switch to 2026–27</Button>}>
          Editing is off for past sessions.
        </Banner>
        <Banner tone="warning" title="Out of balance by Rs 1,500.">
          Debits must equal credits before the voucher can be posted.
        </Banner>
        <Banner tone="danger" title="All SMS paused by Admin at 10:41 AM." actions={<Button size="sm" variant="secondary">Resume</Button>}>
          No messages will be sent until SMS is resumed.
        </Banner>
        <Banner tone="success" title="All dues cleared.">
          Hamza Khan has no unpaid charges.
        </Banner>
        <Banner tone="neutral" title="Partial payment — not yet decided.">
          This variant is shown for review only.
        </Banner>
      </Specimen>

      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen title="Stepper and keyboard hints" note="The fee counter is fully keyboard-operable; hints stay on screen.">
          <div className="grid gap-5">
            <Stepper steps={["Select charges", "Payment", "Review", "Receipt"]} current={2} label="Fee counter steps" />
            <ShortcutHints
              items={[
                { keys: ["F2"], label: "Search" },
                { keys: ["↑", "↓"], label: "Move" },
                { keys: ["Space"], label: "Select" },
                { keys: ["Enter"], label: "Continue" },
                { keys: ["Esc"], label: "Back" },
                { keys: ["Ctrl", "K"], label: "Global search" },
              ]}
            />
            <div className="flex items-center gap-3">
              <span>Late fine on Annual charges:</span>
              <Tooltip content={annualFine.explanation}>
                <button type="button" className="mtb-num cursor-help font-medium text-status-overdue-ink underline decoration-dotted underline-offset-4">
                  {formatRs(annualFine.fine)}
                </button>
              </Tooltip>
              <span className="text-small text-ink-muted">(hover or focus)</span>
            </div>
          </div>
        </Specimen>

        <Specimen title="Avatar and menu" note="Initials when there is no photo. The user menu shows the active role and campus.">
          <div className="grid gap-5">
            <div className="flex flex-wrap items-end gap-4">
              <Avatar name="Ayesha Khan" size="xl" />
              <Avatar name="Hamza Khan" size="lg" />
              <Avatar name="Mariam Khan" />
              <Avatar name="Usman Ali" size="sm" />
            </div>
            <div className="flex items-center gap-4">
              <Menu
                label="User menu"
                align="start"
                trigger={
                  <Button variant="ghost" iconRight="chevronDown">
                    <Avatar name="Usman Ali" size="sm" /> Usman Ali
                  </Button>
                }
              >
                <MenuLabel>Cashier — Khalid Campus</MenuLabel>
                <MenuItem icon="user">My profile</MenuItem>
                <MenuItem icon={theme === "dark" ? "sun" : "moon"} onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}>
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon="logout">Sign out</MenuItem>
              </Menu>
            </div>
          </div>
        </Specimen>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Specimen title="Empty state" flush>
          <EmptyState icon="checkCircle" title="All dues cleared" description="Hamza Khan (KC-15102, 4-A) has nothing to pay." action={<Button size="sm">Next student</Button>} />
        </Specimen>
        <Specimen title="Loading skeleton" note="In the shape of what will appear.">
          <div className="grid gap-4" aria-busy="true" aria-label="Loading student profile">
            <div className="flex items-center gap-4">
              <Skeleton width={80} height={80} style={{ borderRadius: "var(--radius-lg)" }} />
              <div className="grid flex-1 gap-2">
                <Skeleton width="60%" height={22} />
                <Skeleton width="40%" />
                <Skeleton width="50%" />
              </div>
            </div>
            <Skeleton height={40} />
            <Skeleton width="90%" />
            <Skeleton width="75%" />
          </div>
        </Specimen>
        <Specimen title="Permission denied" note="A teacher opening Accounts by link." flush>
          <PermissionDenied role="Teacher — Khalid Campus" page="Accounts" action={<Button size="sm">Go to dashboard</Button>} />
        </Specimen>
      </div>

      <Specimen title="Attendance calendar and Urdu name" note="Ayesha Khan, October 2026. Every cell has its letter, so colour is never the only signal; holidays are hatched." bodyClassName="grid gap-6 lg:grid-cols-[1fr_320px]">
        <AttendanceCalendar year={2026} month={9} days={AYESHA_OCTOBER} holidayNames={AYESHA_OCTOBER_HOLIDAYS} />
        <div className="grid content-start gap-3">
          <StateCell label="Profile header">
            <div className="flex items-center gap-4">
              <Avatar name="Ayesha Khan" size="lg" />
              <div className="grid">
                <span className="text-title-2">Ayesha Khan</span>
                <Urdu size="title">عائشہ خان</Urdu>
              </div>
            </div>
          </StateCell>
          <KeyValue
            items={[
              ["G.R.", <span className="mtb-mono">KC-14823</span>],
              ["Class", "7-B · Session 2026–27"],
              ["Status", <StatusBadge status="present">Enrolled</StatusBadge>],
            ]}
          />
        </div>
      </Specimen>

      <ConfirmDialog
        open={open === "post"}
        onClose={() => {
          setOpen(null);
          setPostError(false);
        }}
        onConfirm={post}
        title="Post this receipt?"
        message="Ayesha Khan (KC-14823) · 7-B · Khalid Campus"
        details={[
          ["Annual charges 2026–27 + late fine", formatRs(3000 + 500)],
          ["Tuition fee – Oct 2026 + late fine", formatRs(8500 + 250)],
          ["Payment", "Cash · received Rs 13,000 · change Rs 750"],
          ["Total", formatRs(12250)],
        ]}
        confirmLabel={`Post receipt · ${formatRs(12250)}`}
        loading={posting}
        loadingLabel="Posting…"
        warning="Posting can't be undone. To reverse it, cancel the receipt — this needs approval."
        error={postError ? "Receipt not posted — safe to try again. The connection dropped before the server replied; nothing was saved." : undefined}
      />
      <ConfirmDialog
        open={open === "declare"}
        onClose={() => setOpen(null)}
        onConfirm={() => {
          setOpen(null);
          toast({ title: "Results declared", message: "First Term 2026–27 · now visible in the parent portal." });
        }}
        title="Declare First Term 2026–27 results?"
        message="Results become read-only and appear in the parent portal. Reopening needs admin approval and is logged."
        details={[
          ["Classes", "7-A, 7-B, 7-C"],
          ["Students", "102"],
          ["Missing marks", "0"],
        ]}
        confirmLabel="Declare results"
        requireText="DECLARE"
      />
      <ConfirmDialog
        open={open === "pause"}
        onClose={() => setOpen(null)}
        onConfirm={() => {
          setOpen(null);
          toast({ tone: "warning", title: "All SMS paused", message: "Every staff page now shows the paused banner." });
        }}
        tone="danger"
        title="Pause all SMS?"
        message="No SMS will be sent from any campus until someone resumes it. Messages already queued stay queued."
        confirmLabel="Pause all SMS"
        requireText="PAUSE"
      >
        <div className="mt-4">
          <Select label="Reason" required options={["Wrong message sent", "Gateway problem", "Cost limit reached", "Other"]} />
        </div>
      </ConfirmDialog>
      <SidePanel
        open={open === "panel"}
        onClose={() => setOpen(null)}
        title="Attendance correction"
        description="Requested by Ms Hina Javed · 7-B · 04-Nov-2026"
        footer={
          <>
            <Button onClick={() => setOpen(null)}>Reject</Button>
            <Button
              variant="primary"
              onClick={() => {
                setOpen(null);
                toast({ title: "Correction approved", message: "Muhammad Bilal · 04-Nov-2026 · Absent → Late" });
              }}
            >
              Approve
            </Button>
          </>
        }
      >
        <KeyValue
          items={[
            ["Student", "Muhammad Bilal (KC-14650)"],
            ["Date", "Wednesday 04-Nov-2026"],
            ["Change", <span className="flex items-center gap-2"><StatusBadge status="absent" /> → <StatusBadge status="late" /></span>],
            ["Reason", "Arrived at 08:20 AM with his father; marked absent before he reached class."],
            ["Status", <StatusBadge status="pending">Pending approval</StatusBadge>],
          ]}
        />
      </SidePanel>
      <Modal
        open={open === "modal"}
        onClose={() => setOpen(null)}
        title="Send SMS to guardian"
        description="Imran Khan · 0300-1234567"
        footer={
          <>
            <Button onClick={() => setOpen(null)}>Cancel</Button>
            <Button
              variant="primary"
              icon="send"
              onClick={() => {
                setOpen(null);
                toast({ title: "SMS queued", message: "1 recipient · 1 SMS" });
              }}
            >
              Send SMS
            </Button>
          </>
        }
      >
        <Textarea label="Message" rows={4} defaultValue="Dear Parent, the fee of Rs 8,500 for Ayesha Khan (7-B) is due on 10-Nov-2026. Please pay on time to avoid a late fine of Rs 10 per day. – MTB Khalid Campus" help="1 SMS · 160 characters per English SMS" />
      </Modal>
    </Section>
  );
}
