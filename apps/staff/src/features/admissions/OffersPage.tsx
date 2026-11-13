import { admissionsQueries, type AdmissionsApplicant } from "@mtb/api";
import { formatCount, formatDate, formatMobile } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, DataTable, DatePicker, EmptyState, Modal, Panel, Select, StatCard, StatusBadge, type Column } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AdmissionSlipsPanel } from "../students/documents/BatchPanels";
import { PrintSheet, printNow } from "../students/documents/print";
import { Page, PageHeader, RequireSingleCampus } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { IssueDocumentPanel } from "../students/documents/IssueDocumentPanel";
import { LoadError, stagger } from "../students/shared";
import { AdmitPanel } from "./AdmitPanel";
import { ApplicantPanel } from "./ApplicantPanel";
import { MeritListView } from "./MeritListView";
import { DuplicatesView } from "./DuplicatesView";
import { AdmissionsSubNav, DiamondMindsBadge, downloadCsv, mobileOrDash, offerDeadline, relationName, scoreOf, scoreShare, scoreText } from "./shared";
import { AdmittedListPrint } from "./slips";

/** The class part of the admitted class-section ("7" of "7-B"); the class applied for when there is no placement. */
const classOfCs = (a: AdmissionsApplicant) => (a.admittedClassSection ? (a.admittedClassSection.split("-")[0] ?? a.classApplied) : a.classApplied);

/** "Test 88/100" or "Interview". */
const basisOf = (a: AdmissionsApplicant) => (scoreShare(a) === null ? "Interview" : `Test ${scoreOf(a, "/")}`);

/** Offered applicants waiting to complete admission, and everyone admitted this session. */
export function OffersPage() {
  const ctx = useCtx();
  const canManage = useCan("admissions.manage");
  const canEdit = useCan("students.edit");
  const readOnly = useReadOnly();
  // Only the two stages this page lists, every page of each (the pipeline is paged, contract C8).
  const offeredQ = useQuery(admissionsQueries.pipelineAll(ctx, { stage: ["OFFERED"] }));
  const admittedQ = useQuery(admissionsQueries.pipelineAll(ctx, { stage: ["ADMITTED"] }));
  const pipeline = { data: offeredQ.data && admittedQ.data ? offeredQ.data : undefined, isError: offeredQ.isError || admittedQ.isError, error: offeredQ.error ?? admittedQ.error, isLoading: offeredQ.isLoading || admittedQ.isLoading, refetch: () => Promise.all([offeredQ.refetch(), admittedQ.refetch()]) };
  const [admitting, setAdmitting] = useState<AdmissionsApplicant | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [slipFor, setSlipFor] = useState<string | null>(null);
  const [cls, setCls] = useState("");
  const [section, setSection] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<unknown>>(new Set());
  const [bulkSlips, setBulkSlips] = useState<string[] | null>(null);
  const [printList, setPrintList] = useState(false);
  const all = [...(offeredQ.data?.applicants ?? []), ...(admittedQ.data?.applicants ?? [])];
  // Soonest expiry first; offers without an expiry (migrated from the old system) last.
  const offered = all.filter((a) => a.stage === "OFFERED").sort((a, b) => (a.offerValidUntil ?? "9999").localeCompare(b.offerValidUntil ?? "9999"));
  const admittedAll = all.filter((a) => a.stage === "ADMITTED").sort((a, b) => (b.admittedOn ?? "").localeCompare(a.admittedOn ?? ""));
  const classes = useMemo(() => [...new Set(admittedAll.map(classOfCs))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [admittedAll]);
  /** Class short name → the class's name as applied for ("7" → "Class 7"), from the rows themselves. */
  const className = useMemo(() => new Map(admittedAll.map((a) => [classOfCs(a), a.classApplied])), [admittedAll]);
  const classLabel = (c: string) => className.get(c) ?? c;
  const sections = useMemo(() => [...new Set(admittedAll.filter((a) => classOfCs(a) === cls).map((a) => (a.admittedClassSection ?? "").split("-")[1] ?? "").filter(Boolean))].sort(), [admittedAll, cls]);
  const rangeBad = Boolean(from && to && from > to);
  const admitted = admittedAll.filter((a) => (!cls || classOfCs(a) === cls) && (!section || (a.admittedClassSection ?? "").endsWith(`-${section}`)) && (!from || (a.admittedOn ?? "") >= from) && (!to || (a.admittedOn ?? "") <= to));
  const scope = `${cls ? classLabel(cls) : "Every class"}${section ? ` · section ${cls}-${section}` : ""} · ${from ? formatDate(from) : "session start"} to ${to ? formatDate(to) : "today"}`;
  const tickedGr = admitted.filter((a) => ticked.has(a.id) && a.grNo).map((a) => a.grNo!);
  const csv = () =>
    downloadCsv(
      "new-admissions.csv",
      ["G.R. no.", "Student", "Father", "Gender", "Class", "Group", "Admitted", "Previous school", "Mobile", "Basis"],
      admitted.map((a) => [a.grNo ?? "", a.name, a.father, a.gender === "F" ? "Girl" : "Boy", a.admittedClassSection ?? a.classApplied, a.stream ?? "", a.admittedOn ? formatDate(a.admittedOn) : "", a.previousSchool ?? "", a.mobile ? formatMobile(a.mobile) : "", basisOf(a)]),
    );
  const urgent = offered.filter((a) => offerDeadline(a.offerValidUntil)?.urgent).length;
  const editable = canManage && !readOnly;

  const offerCols: Array<Column<AdmissionsApplicant>> = [
    {
      key: "name",
      header: "Applicant",
      render: (a) => (
        <span className="grid">
          <span className="mtb-cell-primary flex items-center gap-2">
            {a.name} {a.diamondMinds && <DiamondMindsBadge />}
          </span>
          <span className="mtb-cell-secondary">{relationName(a) || "—"}</span>
        </span>
      ),
    },
    { key: "classApplied", header: "Class", width: 100 },
    { key: "score", header: "Basis", width: 170, render: (a) => (a.directAdmission ? "Interview" : scoreText(a)) },
    { key: "siblings", header: "Siblings at MTB", width: 150, render: (a) => (a.siblings?.length ? a.siblings.map((s) => s.name.split(" ")[0]).join(", ") : <span className="text-ink-subtle">—</span>) },
    { key: "offeredOn", header: "Offered", width: 120, render: (a) => <span className="tabular-nums">{a.offeredOn ? formatDate(a.offeredOn) : "—"}</span> },
    {
      key: "deadline",
      header: "Offer",
      width: 170,
      render: (a) => {
        const d = offerDeadline(a.offerValidUntil);
        return d ? <StatusBadge status={d.urgent ? "warning" : "neutral"}>{d.text}</StatusBadge> : "—";
      },
    },
    {
      key: "act",
      header: <span className="mtb-sr-only">Action</span>,
      width: 120,
      render: (a) =>
        editable ? (
          <Button
            size="sm"
            variant="primary"
            onClick={(e) => {
              e.stopPropagation();
              setAdmitting(a);
            }}
          >
            Admit
          </Button>
        ) : null,
    },
  ];

  const admittedCols: Array<Column<AdmissionsApplicant>> = [
    {
      key: "name",
      header: "Student",
      render: (a) => (
        <span className="grid">
          <span className="mtb-cell-primary">{a.name}</span>
          <span className="mtb-cell-secondary">{relationName(a) || "—"}</span>
        </span>
      ),
    },
    { key: "grNo", header: "G.R.", width: 120, render: (a) => (a.grNo ? <Link to="/students/$grNo" params={{ grNo: a.grNo }} className="mtb-mono text-brand-ink underline-offset-2 hover:underline">{a.grNo}</Link> : "—") },
    { key: "gender", header: "Gender", width: 80, render: (a) => (a.gender === "F" ? "Girl" : "Boy") },
    { key: "admittedClassSection", header: "Class", width: 110, render: (a) => <span className="grid"><span>{a.admittedClassSection ?? a.classApplied}</span>{a.stream && <span className="mtb-cell-secondary">{a.stream}</span>}</span> },
    { key: "admittedOn", header: "Admitted", width: 120, render: (a) => <span className="tabular-nums">{a.admittedOn ? formatDate(a.admittedOn) : "—"}</span> },
    { key: "previousSchool", header: "Previous school", width: 180, render: (a) => a.previousSchool ?? <span className="text-ink-subtle">—</span> },
    { key: "mobile", header: "Mobile", width: 130, render: (a) => <span className="tabular-nums">{mobileOrDash(a.mobile)}</span> },
    { key: "basis", header: "Basis", width: 120, render: basisOf },
    {
      key: "slip",
      header: <span className="mtb-sr-only">Admission slip</span>,
      width: 170,
      render: (a) =>
        a.grNo && canEdit && !readOnly ? (
          <Button
            size="sm"
            icon="printer"
            onClick={(e) => {
              e.stopPropagation();
              setSlipFor(a.grNo!);
            }}
          >
            Admission slip
          </Button>
        ) : null,
    },
  ];

  return (
    <Page>
      <PageHeader title="Offers & admission" />
      <AdmissionsSubNav />
      {pipeline.isError && <LoadError what="offers" error={pipeline.error} onRetry={() => void pipeline.refetch()} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="mtb-rise" style={stagger(1)}>
          <StatCard label="Offers waiting" icon="send" tone="warning" loading={!pipeline.data} value={pipeline.data ? <AnimatedNumber value={offered.length} format={formatCount} /> : undefined} foot={`${urgent} ending within two days`} />
        </div>
        <div className="mtb-rise" style={stagger(2)}>
          <StatCard label="Admitted through Admissions" icon="checkCircle" loading={!pipeline.data} value={pipeline.data ? <AnimatedNumber value={admittedAll.length} format={formatCount} /> : undefined} {...(pipeline.data?.admittedThisWeek ? { delta: pipeline.data.admittedThisWeek, deltaLabel: `+${pipeline.data.admittedThisWeek} this week` } : {})} foot="this session, on their student records" />
        </div>
        <div className="mtb-rise" style={stagger(3)}>
          <StatCard label="With siblings at MTB" icon="home" tone="info" loading={!pipeline.data} value={pipeline.data ? <AnimatedNumber value={[...offered, ...admittedAll].filter((a) => a.siblings?.length).length} format={formatCount} /> : undefined} foot="linked to their family on admission" />
        </div>
      </div>
      {urgent > 0 && <Banner tone="warning" title={`${urgent} ${urgent === 1 ? "offer ends" : "offers end"} within two days`}>Call these families today. An offer that lapses frees the seat for the next applicant on the merit list.</Banner>}
      <Panel id="offers" rise={4} title="Waiting to complete admission" description="Choose the section; the G.R. number and roll number follow in one step" flush>
        <DataTable caption="Offers waiting" columns={offerCols} rows={offered} loading={pipeline.isLoading} onRowClick={(a) => setViewing(a.id)} stickyHeader={false} empty={<EmptyState icon="checkCircle" title="No offers waiting" description="Offer seats from the merit list, or after an interview for classes without a test." />} />
      </Panel>
      <Panel
        id="admitted"
        rise={5}
        title="Admitted this session"
        description={`New students with their G.R. numbers · ${scope} · total ${admitted.length}`}
        flush
        actions={
          <div className="flex flex-wrap gap-2">
            {canEdit && !readOnly && (
              <Button size="sm" icon="receipt" disabled={tickedGr.length === 0} onClick={() => setBulkSlips(tickedGr)}>
                Print slips for selected{tickedGr.length ? ` · ${tickedGr.length}` : ""}
              </Button>
            )}
            <Button size="sm" icon="printer" disabled={admitted.length === 0} onClick={() => setPrintList(true)}>
              Print list
            </Button>
            <Button size="sm" icon="download" disabled={admitted.length === 0} onClick={csv}>
              CSV
            </Button>
          </div>
        }
      >
        <DataTable
          caption="Admitted"
          columns={admittedCols}
          rows={admitted}
          loading={pipeline.isLoading}
          onRowClick={(a) => setViewing(a.id)}
          stickyHeader={false}
          {...(canEdit && !readOnly ? { selectable: true, selected: ticked, onSelectedChange: setTicked, isRowSelectable: (a: AdmissionsApplicant) => Boolean(a.grNo) } : {})}
          toolbar={
            <div className="flex w-full flex-wrap items-end gap-3">
              <div className="w-40">
                <Select
                  label="Class"
                  value={cls}
                  onChange={(e) => {
                    setCls(e.target.value);
                    setSection("");
                  }}
                  options={[{ value: "", label: "Every class" }, ...classes.map((c) => ({ value: c, label: classLabel(c) }))]}
                />
              </div>
              <div className="w-36">
                <Select label="Section" value={section} disabled={!cls} onChange={(e) => setSection(e.target.value)} options={[{ value: "", label: "Every section" }, ...sections.map((s) => ({ value: s, label: `${cls}-${s}` }))]} />
              </div>
              <div className="w-44">
                <DatePicker label="Admitted from" value={from} onValueChange={setFrom} />
              </div>
              <div className="w-44">
                <DatePicker label="Admitted to" value={to} onValueChange={setTo} error={rangeBad ? "Must be on or after the first date." : undefined} />
              </div>
              <span className="pb-2 text-small text-ink-muted">Total students: {admitted.length}</span>
            </div>
          }
          empty={<EmptyState icon="admissions" title={admittedAll.length ? "Nobody admitted in this selection" : "Nobody admitted yet"} description={admittedAll.length ? "Change the class, section or dates." : "Students admitted this session appear here."} />}
        />
      </Panel>
      <Modal
        open={printList}
        onClose={() => setPrintList(false)}
        size="lg"
        title="New admission list"
        footer={
          <>
            <Button onClick={() => setPrintList(false)}>Close</Button>
            <Button variant="primary" icon="printer" onClick={printNow}>
              Print
            </Button>
          </>
        }
      >
        {printList && (
          <PrintSheet paper="A4_LANDSCAPE" label="New admission list" zoom={0.5}>
            <AdmittedListPrint rows={admitted} campus={ctx.campus} campusName={admitted[0]?.campusName ?? ctx.campus} scope={scope} />
          </PrintSheet>
        )}
      </Modal>
      <AdmissionSlipsPanel open={bulkSlips !== null} onClose={() => setBulkSlips(null)} {...(bulkSlips ? { grNos: bulkSlips } : {})} />
      <ApplicantPanel
        id={viewing}
        onClose={() => setViewing(null)}
        onAdmit={(a) => {
          setViewing(null);
          setAdmitting(a);
        }}
      />
      <AdmitPanel applicant={admitting} open={admitting !== null} onClose={() => setAdmitting(null)} />
      <IssueDocumentPanel open={slipFor !== null} onClose={() => setSlipFor(null)} grNo={slipFor ?? ""} initialType="ADMISSION_SLIP" />
    </Page>
  );
}

export function MeritPage({ cls, setCls }: { cls: string; setCls: (c: string) => void }) {
  const ctx = useCtx();
  return (
    <Page>
      <PageHeader title="Merit list" />
      <AdmissionsSubNav />
      <RequireSingleCampus action="merit lists">
        <MeritListView ctx={ctx} cls={cls} onClassChange={setCls} />
      </RequireSingleCampus>
      <p className="m-0 text-small text-ink-muted">
        Offers sent from here appear under{" "}
        <Link to="/admissions/offers" className="text-brand-ink underline-offset-2 hover:underline">
          Offers & admission
        </Link>
        , where the family's admission is completed.
      </p>
    </Page>
  );
}

export function DuplicatesPage() {
  const ctx = useCtx();
  const duplicates = useQuery(admissionsQueries.duplicates(ctx));
  return (
    <Page>
      <PageHeader title="Possible duplicates" />
      <AdmissionsSubNav />
      {duplicates.isError && <LoadError what="duplicate review queue" error={duplicates.error} onRetry={() => void duplicates.refetch()} />}
      <DuplicatesView data={duplicates.data} loading={duplicates.isLoading} />
      <p className="m-0 text-small text-ink-muted">
        Pairs come from new applications and from checks of student records across campuses. Merging keeps the history of both; the merged record points to the one that stays.
      </p>
    </Page>
  );
}
