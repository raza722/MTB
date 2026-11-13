import {
  ApiError,
  examsApi,
  examsGradeFor,
  examsGroupShort,
  examsPassMark,
  examsQueries,
  examsSits,
  EXAMS_DEFAULT_PASS_RULES,
  EXAMS_DEFAULT_SCALE,
  type ExamDetail,
  type ExamsParticipant,
  type ExamsParticipantInput,
  type ExamsProgramme,
  type ExamsProgrammeCentre,
  type ExamsResultRow,
  type ExamsSubject,
  type Ctx,
} from "@mtb/api";
import { formatCount, formatDate, formatPercent, formatSession, isValidCnic, normalizeCnic, normalizeMobile, type IsoDate } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, buttonClassName, Checkbox, DataTable, DatePicker, EmptyState, Input, Panel, Radio, Segmented, Select, SidePanel, Skeleton, StatCard, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useDeferredValue, useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { DocHead, printedOn } from "./print/docs";
import { PrintSheet, printNow, type ExamPaper } from "./print/PrintSheet";
import { errorText, ExamsNav, examsToday, LoadError, ordinal } from "./shared";

export interface ProgrammesSearch {
  programme?: string;
  tab?: "participants" | "print";
  doc?: "list" | "sheet" | "top";
  centre?: string;
}

const GENDER = { M: "Boy", F: "Girl" } as const;
/** Used only until the campus's classes have loaded. */
const CLASSES_FALLBACK = ["Class 6", "Class 7", "Class 8", "Class 9", "Class 10"];

/** "School name, City" (old centres have no city). */
const centreLabel = (c: ExamsProgrammeCentre) => (c.city ? `${c.name}, ${c.city}` : c.name);
/** Text that old records may not have: "—" instead of a blank. */
const orDash = (v: string | null | undefined) => (v ? v : "—");

/**
 * The campus's classes (for "class now" and "applying for") and groups (streams), from the classes of the session in
 * Setup: the same lists a new exam uses.
 */
function useCampusClasses(ctx: Ctx) {
  const templates = useQuery({ ...examsQueries.templates(ctx), enabled: ctx.campus !== "ALL" });
  const list = templates.data ?? [];
  return {
    classes: list.length ? list.map((t) => t.className) : CLASSES_FALLBACK,
    groups: [...new Set(list.flatMap((t) => t.groups ?? []))].sort(),
    templates: list,
    loading: templates.isLoading,
  };
}

/** Groups present among a programme's participants (old records keep theirs even if Setup renamed a group). */
const groupsOf = (list: ExamsParticipant[]) => [...new Set(list.map((p) => p.group).filter((g): g is string => Boolean(g)))].sort();

/**
 * /exams/programmes — assessment programmes for outside children: the Diamond Minds talent test. Participants
 * register at test centres (schools), sit the programme's test (marks are entered like any exam), and can be
 * turned into admission applicants.
 */
export function ProgrammesPage({ search, onSearch }: { search: ProgrammesSearch; onSearch: (next: ProgrammesSearch) => void }) {
  const ctx = useCtx();
  const programmes = useQuery(examsQueries.programmes(ctx));
  const list = programmes.data ?? [];
  const prog = list.find((p) => p.id === search.programme) ?? list[0];
  return (
    <Page>
      <PageHeader title="Programmes" />
      <ExamsNav />
      {programmes.isError ? (
        <LoadError what="Programmes" error={programmes.error} onRetry={() => void programmes.refetch()} />
      ) : programmes.isLoading ? (
        <Skeleton height={240} />
      ) : !prog ? (
        <div className="mtb-card">
          <EmptyState
            icon="award"
            title={`No programmes at ${campusLabel(ctx.campus)} in ${formatSession(ctx.session)}`}
            description="The Diamond Minds talent test runs at Khalid Campus. Switch campus or session to see it."
          />
        </div>
      ) : (
        <ProgrammeView key={prog.id} prog={prog} all={list} search={search} onSearch={onSearch} />
      )}
    </Page>
  );
}

function ProgrammeView({ prog, all, search, onSearch }: { prog: ExamsProgramme; all: ExamsProgramme[]; search: ProgrammesSearch; onSearch: (next: ProgrammesSearch) => void }) {
  const ctx = useCtx();
  const canManage = useCan("exams.manage");
  const canAdmit = useCan("admissions.manage");
  const readOnly = useReadOnly();
  const editable = canManage && !readOnly;
  const tab = search.tab ?? "participants";
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q.trim());
  const [gender, setGender] = useState<"" | "M" | "F">("");
  const [group, setGroup] = useState("");
  const [school, setSchool] = useState("");
  const centre = search.centre && prog.centres.some((c) => c.id === search.centre) ? search.centre : "";
  const filters = { q: deferred, centre, gender: gender || undefined, group, school } as const;
  const people = useQuery(examsQueries.participants(ctx, prog.id, { ...filters, gender: filters.gender }));
  const everyone = useQuery(examsQueries.participants(ctx, prog.id));
  const exam = useQuery({ ...examsQueries.detail(prog.examId ?? ""), enabled: Boolean(prog.examId) });
  const [open, setOpen] = useState<ExamsParticipant | "new" | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const schools = [...new Set((everyone.data ?? []).map((p) => p.previousSchool).filter(Boolean))].sort();
  const groups = groupsOf(everyone.data ?? []);
  const centreName = (id: string) => prog.centres.find((c) => c.id === id)?.name ?? id;
  const resultCount = (everyone.data ?? []).filter((p) => p.result?.percent != null).length;

  const columns: Array<Column<ExamsParticipant>> = [
    { key: "regNo", header: "Reg. no.", width: 110, render: (p) => <span className="mtb-mono">{p.regNo}</span> },
    {
      key: "name",
      header: "Participant",
      width: 210,
      render: (p) => (
        <span className="grid">
          <span className="mtb-cell-primary">{p.name}</span>
          <span className="mtb-cell-secondary">
            {p.gender === "F" ? "d/o" : "s/o"} {p.father}
          </span>
        </span>
      ),
    },
    { key: "dob", header: "Date of birth", width: 120, render: (p) => (p.dob ? <span className="mtb-num">{formatDate(p.dob)}</span> : <span className="text-ink-muted">—</span>) },
    { key: "cnic", header: "B-form / CNIC", width: 150, render: (p) => (p.cnic ? <span className="mtb-mono">{p.cnic}</span> : <span className="text-ink-muted">—</span>) },
    { key: "gender", header: "Gender", width: 80, render: (p) => GENDER[p.gender] },
    { key: "address", header: "Address", width: 220, render: (p) => <span className="text-small">{orDash(p.address)}</span> },
    { key: "school", header: "Previous school", width: 190, render: (p) => <span className="text-small">{orDash(p.previousSchool)}</span> },
    { key: "city", header: "City", width: 110, render: (p) => orDash(p.city) },
    { key: "centre", header: "Centre", width: 180, render: (p) => <span className="text-small">{centreName(p.centreId)}</span> },
    { key: "group", header: "Group", width: 140, render: (p) => <span className="text-small">{p.group ?? "—"}</span> },
    {
      key: "result",
      header: "Test result",
      align: "right",
      width: 130,
      render: (p) =>
        p.result?.percent != null ? (
          <span className="grid justify-items-end">
            <span className="mtb-num font-medium">
              {p.result.obtained}/{p.result.max} · {formatPercent(p.result.percent)}
            </span>
            <span className="text-[12px] text-ink-muted">{p.result.position ? `${ordinal(p.result.position)} position` : ""}</span>
          </span>
        ) : (
          <span className="text-small text-ink-muted">{p.result ? "Marks missing" : "Not in the test"}</span>
        ),
    },
    {
      key: "admission",
      header: "Admission",
      width: 150,
      render: (p) =>
        p.applicantId ? (
          <Link to="/admissions" search={{ applicant: p.applicantId } as never} className="text-small font-medium text-brand-ink underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
            {p.applicationNo ?? "Application"}
          </Link>
        ) : (
          <span className="text-small text-ink-muted">—</span>
        ),
    },
  ];

  return (
    <>
      <Panel
        id="programme"
        title={prog.name}
        description={`${campusLabel(prog.campus)} · Session ${formatSession(prog.session)} · talent test for children from other schools`}
        rise={0}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {all.length > 1 && (
              <div className="w-64">
                <Select aria-label="Programme" value={prog.id} onChange={(e) => onSearch({ programme: e.target.value })} options={all.map((p) => ({ value: p.id, label: p.name }))} />
              </div>
            )}
            {prog.examId && (
              <Link to="/exams/$examId/marks" params={{ examId: prog.examId }} className={buttonClassName({ variant: "secondary" })}>
                Test marks entry
              </Link>
            )}
            {!prog.examId && editable && (
              <Button icon="exams" onClick={() => setSettingUp(true)}>
                Set up the test
              </Button>
            )}
            {editable && (
              <Button variant="primary" icon="plus" onClick={() => setOpen("new")}>
                Add participant
              </Button>
            )}
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Participants" icon="students" value={<AnimatedNumber value={prog.participants} format={formatCount} />} foot={`${prog.centres.length} test centres`} />
          <StatCard label="Results in" icon="checkSquare" value={<AnimatedNumber value={resultCount} format={formatCount} />} foot={prog.examId ? (prog.examStatus === "DECLARED" ? "Declared" : "Provisional until declared") : "The test isn't set up yet"} />
          <StatCard label="Girls · boys" icon="user" value={`${(everyone.data ?? []).filter((p) => p.gender === "F").length} · ${(everyone.data ?? []).filter((p) => p.gender === "M").length}`} foot="Registered so far" />
          <StatCard label="Applied for admission" icon="admissions" tone="info" value={(everyone.data ?? []).filter((p) => p.applicantId).length} foot="Started from this list" />
        </div>
        {prog.examId && exam.data && (
          <p className="m-0 mt-3 text-small text-ink-muted">
            Test:{" "}
            <Link to="/exams/$examId" params={{ examId: prog.examId }} className="font-medium text-brand-ink underline-offset-2 hover:underline">
              {exam.data.name}
            </Link>{" "}
            · {exam.data.subjects.map((s) => `${s.name} ${s.maxMarks}${s.groups?.length ? ` (${s.groups.map((g) => examsGroupShort(g)).join(", ")})` : ""}`).join(" · ")} · {exam.data.status === "DECLARED" ? "declared" : `draft, ${formatCount(exam.data.missingMarks)} marks missing`}
          </p>
        )}
      </Panel>

      <Segmented
        aria-label="View"
        value={tab}
        onChange={(v) => onSearch({ ...search, programme: prog.id, tab: v as ProgrammesSearch["tab"] })}
        options={[
          { value: "participants", label: "Participants" },
          { value: "print", label: "Lists and results" },
        ]}
      />

      {tab === "participants" ? (
        <>
          {people.isError && <LoadError what="Participants" error={people.error} onRetry={() => void people.refetch()} />}
          <DataTable
            caption={`${prog.name} participants`}
            columns={columns}
            rows={people.data ?? []}
            rowKey="regNo"
            loading={people.isLoading}
            density="dense"
            maxHeight={620}
            onRowClick={(p) => setOpen(p)}
            toolbar={
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-64">
                  <Input aria-label="Search participants" icon="search" placeholder="Name or registration no." value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <div className="w-56">
                  <Select aria-label="Centre" value={centre} onChange={(e) => onSearch({ ...search, programme: prog.id, centre: e.target.value || undefined })} options={[{ value: "", label: "Every centre" }, ...prog.centres.map((c) => ({ value: c.id, label: c.name }))]} />
                </div>
                <div className="w-36">
                  <Select aria-label="Gender" value={gender} onChange={(e) => setGender(e.target.value as "" | "M" | "F")} options={[{ value: "", label: "Girls and boys" }, { value: "F", label: "Girls" }, { value: "M", label: "Boys" }]} />
                </div>
                <div className="w-48">
                  <Select aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value)} options={[{ value: "", label: "Every group" }, ...groups.map((g) => ({ value: g, label: g }))]} />
                </div>
                <div className="w-56">
                  <Select aria-label="Present school" value={school} onChange={(e) => setSchool(e.target.value)} options={[{ value: "", label: "Every school" }, ...schools.map((s) => ({ value: s, label: s }))]} />
                </div>
              </div>
            }
            empty={<EmptyState icon="search" title="No participant matches" description="Clear the search or the filters." />}
          />
        </>
      ) : (
        <ProgrammePrints prog={prog} exam={exam.data} participants={everyone.data ?? []} loading={everyone.isLoading || exam.isLoading} search={search} onSearch={onSearch} />
      )}

      {open && <ParticipantPanel prog={prog} participant={open === "new" ? null : open} editable={editable} canAdmit={canAdmit && !readOnly} onClose={() => setOpen(null)} />}
      {settingUp && <TestSetupPanel prog={prog} onClose={() => setSettingUp(false)} />}
    </>
  );
}

// ------------------------------------------------------------------ Add / edit a participant, start an admission

const participantSchema = z.object({
  name: z.string().trim().min(3, "Enter the child's full name."),
  father: z.string().trim().min(3, "Enter the father's name."),
  dob: z.string().min(1, "Enter the date of birth."),
  gender: z.enum(["M", "F"], { error: "Choose girl or boy." }),
  cnic: z.string().refine((v) => v.trim() === "" || isValidCnic(normalizeCnic(v)), "A B-form or CNIC has 13 digits, for example 31303-1234567-1."),
  mobile: z.string().refine((v) => v.trim() === "" || Boolean(normalizeMobile(v)), "Enter a Pakistani mobile number, for example 0300-1234567."),
  address: z.string().trim().min(8, "Enter the home address: house, street and area."),
  previousSchool: z.string().trim().min(3, "Enter the school the child attends now."),
  city: z.string().trim().min(2, "Enter the city."),
  centreId: z.string().min(1, "Choose a test centre."),
});

function ParticipantPanel({ prog, participant, editable, canAdmit, onClose }: { prog: ExamsProgramme; participant: ExamsParticipant | null; editable: boolean; canAdmit: boolean; onClose: () => void }) {
  const ctx = useCtx();
  const campusClasses = useCampusClasses(ctx);
  const classOptions = campusClasses.classes;
  // The participant's own group stays choosable even if it is no longer a group in Setup.
  const groupOptions = [...new Set([...campusClasses.groups, ...(participant?.group ? [participant.group] : [])])];
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: participant?.name ?? "",
    father: participant?.father ?? "",
    dob: (participant?.dob ?? null) as IsoDate | null,
    gender: (participant?.gender ?? "") as "" | "M" | "F",
    cnic: participant?.cnic ?? "",
    mobile: participant?.mobile ?? "",
    address: participant?.address ?? "",
    previousSchool: participant?.previousSchool ?? "",
    currentClass: participant ? participant.currentClass : "Class 9",
    city: participant?.city ?? prog.centres[0]?.city ?? "",
    centreId: participant?.centreId ?? "",
    group: participant?.group ?? "",
  });
  const [tried, setTried] = useState(false);
  const [classApplied, setClassApplied] = useState(participant?.currentClass ? participant.currentClass : "Class 9");
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const parsed = participantSchema.safeParse({ ...form, dob: form.dob ?? "" });
  const errs: Record<string, string> = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ["exams"] });
  };
  const save = useMutation({
    mutationFn: () => {
      const body: ExamsParticipantInput & { rowVer?: number } = {
        name: form.name,
        father: form.father,
        dob: form.dob!,
        gender: form.gender as "M" | "F",
        ...(form.cnic.trim() ? { cnic: form.cnic } : {}),
        ...(form.mobile.trim() ? { mobile: form.mobile } : {}),
        address: form.address,
        previousSchool: form.previousSchool,
        currentClass: form.currentClass,
        city: form.city,
        centreId: form.centreId,
        ...(form.group ? { group: form.group } : {}),
        ...(participant ? { rowVer: participant.rowVer } : {}),
      };
      return examsApi.saveParticipant(prog.id, body, participant?.regNo);
    },
    onSuccess: (p) => {
      done();
      toast({ title: participant ? "Participant updated" : "Participant registered", message: `${p.regNo} · ${p.name}${prog.examStatus === "DRAFT" ? ". They are on the test's marks sheet." : "."}` });
      onClose();
    },
  });
  const admit = useMutation({
    mutationFn: () => examsApi.startAdmission(prog.id, participant!.regNo, classApplied),
    onSuccess: (p) => {
      done();
      void queryClient.invalidateQueries({ queryKey: ["admissions"] });
      toast({ title: "Admission started", message: `${p.name}: application ${p.applicationNo ?? ""} for ${classApplied}, marked Diamond Minds.` });
    },
  });
  const conflict = save.error instanceof ApiError && save.error.status === 409 && save.error.code === "CONCURRENCY";
  const fieldErr = (k: string) => (tried ? errs[k] : undefined) ?? (save.error instanceof ApiError && save.error.field === k ? save.error.message : undefined);
  const live = participant;

  return (
    <SidePanel
      open
      onClose={onClose}
      wide
      title={participant ? participant.name : "Add participant"}
      description={participant ? `${participant.regNo} · ${prog.name}` : `${prog.name} · a registration number is given on saving`}
      footer={
        editable ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              icon="check"
              loading={save.isPending}
              onClick={() => {
                setTried(true);
                if (parsed.success) save.mutate();
              }}
            >
              {participant ? "Save changes" : "Register participant"}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="grid gap-5">
        {conflict && (
          <Banner
            tone="warning"
            title="Changed by someone else."
            actions={
              <Button size="sm" icon="refresh" onClick={() => void queryClient.invalidateQueries({ queryKey: ["exams"] }).then(onClose)}>
                Reload
              </Button>
            }
          >
            {errorText(save.error)}
          </Banner>
        )}
        {save.isError && !conflict && !(save.error instanceof ApiError && save.error.field) && <Banner tone="danger">{errorText(save.error)}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Child's full name" required disabled={!editable} value={form.name} onChange={(e) => set({ name: e.target.value })} error={fieldErr("name")} />
          <Input label="Father's name" required disabled={!editable} value={form.father} onChange={(e) => set({ father: e.target.value })} error={fieldErr("father")} />
          <DatePicker label="Date of birth" required disabled={!editable} value={form.dob} onValueChange={(d) => set({ dob: d })} maxDate={examsToday()} error={fieldErr("dob")} help={participant && !participant.dob ? "Not recorded in the old system: add it to save changes." : undefined} />
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 text-small font-medium">Gender</legend>
            <div className="flex gap-5">
              <Radio name="dm-gender" label="Girl" disabled={!editable} checked={form.gender === "F"} onChange={() => set({ gender: "F" })} />
              <Radio name="dm-gender" label="Boy" disabled={!editable} checked={form.gender === "M"} onChange={() => set({ gender: "M" })} />
            </div>
            {fieldErr("gender") && <p className="m-0 text-small text-danger-ink">{fieldErr("gender")}</p>}
          </fieldset>
          <Input label="B-form or CNIC" mono disabled={!editable} value={form.cnic} onChange={(e) => set({ cnic: e.target.value })} placeholder="31303-1234567-1" error={fieldErr("cnic")} help="Optional." />
          <Input label="Family mobile" disabled={!editable} value={form.mobile} onChange={(e) => set({ mobile: e.target.value })} placeholder="0300-1234567" error={fieldErr("mobile")} help="Needed to start an admission." />
          <div className="sm:col-span-2">
            <Input label="Home address" required disabled={!editable} value={form.address} onChange={(e) => set({ address: e.target.value })} error={fieldErr("address")} />
          </div>
          <Input label="Present school" required disabled={!editable} value={form.previousSchool} onChange={(e) => set({ previousSchool: e.target.value })} error={fieldErr("previousSchool")} />
          <Select
            label="Class now"
            disabled={!editable}
            value={form.currentClass}
            onChange={(e) => set({ currentClass: e.target.value })}
            options={[...(form.currentClass === "" ? [{ value: "", label: "Not recorded" }] : []), ...[...new Set([...classOptions, ...(form.currentClass ? [form.currentClass] : [])])].map((c) => ({ value: c, label: c }))]}
          />
          <Input label="City" required disabled={!editable} value={form.city} onChange={(e) => set({ city: e.target.value })} error={fieldErr("city")} />
          <Select
            label="Test centre"
            required
            disabled={!editable}
            value={form.centreId}
            onChange={(e) => set({ centreId: e.target.value })}
            error={fieldErr("centreId")}
            options={[{ value: "", label: "Choose…" }, ...prog.centres.map((c) => ({ value: c.id, label: centreLabel(c) }))]}
          />
          <Select
            label="Group"
            disabled={!editable}
            value={form.group}
            onChange={(e) => set({ group: e.target.value })}
            help="Decides which group papers the child sits (for example Biology or Computer Science)."
            options={[{ value: "", label: "No group" }, ...groupOptions.map((g) => ({ value: g, label: g }))]}
          />
        </div>

        {live?.result && (
          <div className="rounded-md border border-border p-4">
            <h3 className="m-0 mb-1 text-title-3">Test result</h3>
            {live.result.percent != null ? (
              <p className="m-0">
                <b className="mtb-num">
                  {live.result.obtained} of {live.result.max}
                </b>{" "}
                · {formatPercent(live.result.percent)} · grade {live.result.grade ?? "—"}
                {live.result.position ? ` · ${ordinal(live.result.position)} position` : ""}
                {prog.examStatus === "DECLARED" ? "" : " (provisional)"}
              </p>
            ) : (
              <p className="m-0 text-ink-muted">Marks are still missing.</p>
            )}
          </div>
        )}

        {participant && (
          <div className="grid gap-3 rounded-md border border-border p-4">
            <h3 className="m-0 text-title-3">Admission</h3>
            {participant.applicantId ? (
              <p className="m-0">
                Application{" "}
                <Link to="/admissions" search={{ applicant: participant.applicantId } as never} className="font-medium text-brand-ink underline-offset-2 hover:underline">
                  {participant.applicationNo}
                </Link>{" "}
                is open in Admissions, marked Diamond Minds.
              </p>
            ) : canAdmit ? (
              <>
                <p className="m-0 text-small text-ink-muted">Starts an admission application filled in from this participant (name, father, date of birth, school, address, mobile), marked Diamond Minds.</p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-44">
                    <Select label="Applying for" value={classApplied} onChange={(e) => setClassApplied(e.target.value)} options={[...new Set([...classOptions, classApplied])].map((c) => ({ value: c, label: c }))} />
                  </div>
                  <Button icon="admissions" loading={admit.isPending} onClick={() => admit.mutate()}>
                    Start admission
                  </Button>
                </div>
                {admit.isError && <Banner tone="danger">{errorText(admit.error)}</Banner>}
              </>
            ) : (
              <p className="m-0 text-small text-ink-muted">Only the admissions office can start an admission.</p>
            )}
          </div>
        )}
      </div>
    </SidePanel>
  );
}

// ------------------------------------------------------------------ Set up the programme's test

const setupSchema = z.object({
  name: z.string().trim().min(3, "Give the test a name."),
  centres: z.array(z.string()).min(1, "Tick at least one test centre."),
  max: z.coerce.number({ error: "Type the marks per paper." }).int("Use whole marks.").min(5, "At least 5 marks.").max(100, "No more than 100 marks."),
  date: z.string({ error: "Choose the test date." }).min(1, "Choose the test date."),
  supervisor: z.string(),
});

/**
 * The test in the exam engine: papers and the centres that sit it. The papers are subjects from Setup: the subjects of
 * a class of this campus (Class 9 by default, the class most participants are in), each paper for one group or for
 * everyone (Biology for the Biology group, Computer Science for the Computer group).
 */
function TestSetupPanel({ prog, onClose }: { prog: ExamsProgramme; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { templates, loading } = useCampusClasses(ctx);
  const [form, setForm] = useState({ name: prog.name, centres: prog.centres.map((c) => c.id), max: "20", date: null as IsoDate | null, supervisor: "" });
  const [classPick, setClassPick] = useState("");
  const template = templates.find((t) => t.classShort === classPick) ?? templates.find((t) => t.classShort === "9") ?? templates.find((t) => t.groups?.length) ?? templates[0];
  const subjects: ExamsSubject[] = template?.subjects ?? [];
  // Unticked papers per class; everything else is ticked.
  const [off, setOff] = useState<string[]>([]);
  const papers = subjects.filter((s) => !off.includes(s.id)).map((s) => s.id);
  // A paper is for one group or for everyone (a subject in every group's list is for everyone).
  const multiGroup = subjects.filter((s) => papers.includes(s.id) && (s.groups?.length ?? 0) > 1);
  const [tried, setTried] = useState(false);
  const parsed = setupSchema.safeParse({ ...form, date: form.date ?? "" });
  const errs: Record<string, string> = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
  const create = useMutation({
    mutationFn: () =>
      examsApi.createProgrammeExam(ctx, prog.id, {
        name: form.name.trim(),
        centreIds: form.centres,
        subjects: subjects
          .filter((p) => papers.includes(p.id))
          .map((p) => ({ id: p.id, name: p.name, maxMarks: Number(form.max), date: form.date!, startTime: "10:00", durationMins: 120, ...(form.supervisor.trim() ? { supervisor: form.supervisor.trim() } : {}), ...(p.groups?.length === 1 ? { groups: p.groups } : {}) })),
      }),
    onSuccess: (e) => {
      void queryClient.invalidateQueries({ queryKey: ["exams"] });
      toast({ title: "Test set up", message: `${e.name} · ${e.students} participants at ${e.classes.length} centres. Enter marks from Test marks entry.` });
      onClose();
    },
  });
  return (
    <SidePanel
      open
      onClose={onClose}
      title="Set up the test"
      description={prog.name}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="check"
            loading={create.isPending}
            onClick={() => {
              setTried(true);
              if (parsed.success && papers.length > 0 && multiGroup.length === 0) create.mutate();
            }}
          >
            Set up the test
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Test name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} error={tried ? errs.name : undefined} />
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-1 text-small font-medium">Test centres</legend>
          <Checkbox label="Check all" checked={form.centres.length === prog.centres.length} onChange={(e) => setForm((f) => ({ ...f, centres: e.target.checked ? prog.centres.map((c) => c.id) : [] }))} />
          {prog.centres.map((c) => (
            <Checkbox key={c.id} label={centreLabel(c)} checked={form.centres.includes(c.id)} onChange={(e) => setForm((f) => ({ ...f, centres: e.target.checked ? [...f.centres, c.id] : f.centres.filter((x) => x !== c.id) }))} />
          ))}
          {tried && errs.centres && <p className="m-0 text-small text-danger-ink">{errs.centres}</p>}
        </fieldset>
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-1 text-small font-medium">Papers</legend>
          {templates.length > 1 && (
            <Select
              label="Subjects of"
              value={template?.classShort ?? ""}
              onChange={(e) => {
                setClassPick(e.target.value);
                setOff([]);
              }}
              help="The test's papers are subjects from Setup › Subjects. Untick the ones the test leaves out."
              options={templates.map((t) => ({ value: t.classShort, label: t.className }))}
            />
          )}
          {loading ? (
            <Skeleton height={80} />
          ) : subjects.length === 0 ? (
            <p className="m-0 text-small text-ink-muted">No class subjects at this campus yet. Add them in Setup › Subjects › Class subjects first.</p>
          ) : (
            subjects.map((p) => (
              <Checkbox key={p.id} label={`${p.name}${p.groups?.length ? ` (${p.groups.join(", ")} only)` : ""}`} checked={papers.includes(p.id)} onChange={(e) => setOff((l) => (e.target.checked ? l.filter((x) => x !== p.id) : [...l, p.id]))} />
            ))
          )}
          {tried && papers.length === 0 && <p className="m-0 text-small text-danger-ink">Tick at least one paper.</p>}
          {multiGroup.length > 0 && <p className="m-0 text-small text-danger-ink">{multiGroup.map((s) => s.name).join(", ")}: a paper is for one group or for everyone. Untick it, or ask head office to give it one group in Setup.</p>}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Marks per paper" required amount inputMode="numeric" value={form.max} onChange={(e) => setForm((f) => ({ ...f, max: e.target.value.replace(/\D/g, "") }))} error={tried ? errs.max : undefined} />
          <DatePicker label="Test date" required value={form.date} onValueChange={(d) => setForm((f) => ({ ...f, date: d }))} today={examsToday()} error={tried ? errs.date : undefined} />
        </div>
        <Input label="Exam supervisor" value={form.supervisor} onChange={(e) => setForm((f) => ({ ...f, supervisor: e.target.value }))} placeholder="Optional" />
        {create.isError && <Banner tone="danger">{errorText(create.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

// ------------------------------------------------------------------ Prints: participant list, result sheet, top ten

const PROGRAMME_DOCS: Array<{ id: NonNullable<ProgrammesSearch["doc"]>; label: string; detail: string; paper: ExamPaper }> = [
  { id: "list", label: "Participant list", detail: "By centre: registration no., name, father, school, city and test result.", paper: "A4" },
  { id: "sheet", label: "Result sheet", detail: "Every participant × paper with total, %, grade, position and failed subjects. A4 landscape.", paper: "A4L" },
  { id: "top", label: "Top ten", detail: "The first ten positions (equal marks share a position).", paper: "A4" },
];

interface Line {
  p: ExamsParticipant;
  row: ExamsResultRow | undefined;
  centre: string;
}

function ProgrammePrints({ prog, exam, participants, loading, search, onSearch }: { prog: ExamsProgramme; exam: ExamDetail | undefined; participants: ExamsParticipant[]; loading: boolean; search: ProgrammesSearch; onSearch: (next: ProgrammesSearch) => void }) {
  const doc = PROGRAMME_DOCS.find((d) => d.id === search.doc) ?? PROGRAMME_DOCS[0]!;
  const centre = search.centre && prog.centres.some((c) => c.id === search.centre) ? search.centre : "";
  const [gender, setGender] = useState("");
  const [group, setGroup] = useState("");
  const [school, setSchool] = useState("");
  const schools = [...new Set(participants.map((p) => p.previousSchool).filter(Boolean))].sort();
  const groups = groupsOf(participants);
  const rows = new Map((exam?.rows ?? []).map((r) => [r.id, r]));
  const centreName = (id: string) => prog.centres.find((c) => c.id === id)?.name ?? id;
  const lines: Line[] = participants
    .filter((p) => (!centre || p.centreId === centre) && (!gender || p.gender === gender) && (!group || p.group === group) && (!school || p.previousSchool === school))
    .map((p) => ({ p, row: rows.get(p.regNo), centre: centreName(p.centreId) }));
  const set = (patch: Partial<ProgrammesSearch>) => onSearch({ ...search, programme: prog.id, tab: "print", ...patch });

  let body = null;
  if (doc.id === "list") body = <ParticipantList prog={prog} exam={exam} lines={lines} centres={centre ? [centre] : prog.centres.map((c) => c.id)} />;
  else if (!exam) body = <p className="m-0 p-6">The test isn't set up yet, so there are no results to print.</p>;
  else if (doc.id === "sheet") body = <ResultSheet prog={prog} exam={exam} lines={lines} centre={centre ? centreName(centre) : "Every centre"} oneCentre={Boolean(centre)} />;
  else body = <TopTen prog={prog} exam={exam} lines={lines} centre={centre ? centreName(centre) : "Every centre"} />;

  return (
    <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <Panel id="dm-docs" title="Document" rise={0}>
          <div className="grid gap-2" role="radiogroup" aria-label="Document to print">
            {PROGRAMME_DOCS.map((d) => (
              <label key={d.id} className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2 ${d.id === doc.id ? "border-brand bg-brand-tint" : "border-border hover:bg-surface-hover"}`}>
                <input type="radio" className="mt-1 accent-[var(--brand)]" name="dm-doc" checked={d.id === doc.id} onChange={() => set({ doc: d.id })} />
                <span className="grid">
                  <span className="font-medium">{d.label}</span>
                  <span className="text-small text-ink-muted">{d.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </Panel>
        <Panel id="dm-options" title="Filters" rise={1}>
          <div className="grid gap-4">
            <Select label="Centre" value={centre} onChange={(e) => set({ centre: e.target.value || undefined })} options={[{ value: "", label: "Every centre" }, ...prog.centres.map((c) => ({ value: c.id, label: c.name }))]} />
            <Select label="Present school" value={school} onChange={(e) => setSchool(e.target.value)} options={[{ value: "", label: "Every school" }, ...schools.map((s) => ({ value: s, label: s }))]} />
            <Select label="Gender" value={gender} onChange={(e) => setGender(e.target.value)} options={[{ value: "", label: "Girls and boys" }, { value: "F", label: "Girls" }, { value: "M", label: "Boys" }]} />
            <Select label="Group" value={group} onChange={(e) => setGroup(e.target.value)} options={[{ value: "", label: "Every group" }, ...groups.map((g) => ({ value: g, label: g }))]} />
            <Button variant="primary" icon="printer" onClick={printNow} disabled={loading}>
              Print
            </Button>
          </div>
        </Panel>
      </div>
      <div className="grid content-start gap-3">
        {exam && exam.status !== "DECLARED" && doc.id !== "list" && (
          <Banner tone={exam.missingMarks > 0 ? "warning" : "info"} title={exam.missingMarks > 0 ? "Marks are still missing." : "Results aren't declared yet."}>
            This prints as PROVISIONAL. Declare the test's results for final copies.
          </Banner>
        )}
        {loading ? (
          <Skeleton height={400} />
        ) : (
          <PrintSheet paper={doc.paper} label={`${doc.label} preview`}>
            {body}
          </PrintSheet>
        )}
      </div>
    </div>
  );
}

const resultText = (r: ExamsResultRow | undefined) => (!r ? "Not in the test" : r.percent === null ? "Incomplete" : `${r.obtained}/${r.max} · ${r.percent.toFixed(1)}%`);

function ParticipantList({ prog, exam, lines, centres }: { prog: ExamsProgramme; exam: ExamDetail | undefined; lines: Line[]; centres: string[] }) {
  return (
    <>
      {centres.map((cid) => {
        const c = prog.centres.find((x) => x.id === cid)!;
        const list = lines.filter((l) => l.p.centreId === cid);
        if (!list.length) return null;
        return (
          <article key={cid} className="exams-doc exams-doc-a4" aria-label={`Participant list, ${c.name}`}>
            {exam && exam.status !== "DECLARED" && <span className="exams-doc-mark">PROVISIONAL</span>}
            <DocHead campus={prog.campus} title="Diamond Minds participants" sub={`${prog.name} · ${centreLabel(c)} · Session ${formatSession(prog.session)}`} />
            <table>
              <thead>
                <tr>
                  <th className="n">Sr.</th>
                  <th>Reg. no.</th>
                  <th>Name</th>
                  <th>Father's name</th>
                  <th>Present school</th>
                  <th>City</th>
                  <th>Grp</th>
                  <th className="n">Test result</th>
                  <th className="n">Pos.</th>
                </tr>
              </thead>
              <tbody>
                {list.map((l, i) => (
                  <tr key={l.p.regNo}>
                    <td className="n">{i + 1}</td>
                    <td className="mtb-mono">{l.p.regNo}</td>
                    <td>{l.p.name}</td>
                    <td>{l.p.father}</td>
                    <td>{l.p.previousSchool}</td>
                    <td>{l.p.city}</td>
                    <td>{examsGroupShort(l.p.group)}</td>
                    <td className="n">{resultText(l.row)}</td>
                    <td className="n">{l.row?.classPosition ? ordinal(l.row.classPosition) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="exams-doc-key">
              {list.length} {list.length === 1 ? "participant" : "participants"} at this centre. Position is across every centre; equal marks share a position. Printed {printedOn()}.
            </p>
            <div className="exams-doc-signs">
              <div>Centre in-charge</div>
              <div>Controller of examinations</div>
              <div>Principal</div>
            </div>
          </article>
        );
      })}
    </>
  );
}

function ResultSheet({ prog, exam, lines, centre, oneCentre }: { prog: ExamsProgramme; exam: ExamDetail; lines: Line[]; centre: string; oneCentre: boolean }) {
  // Position within the centre for one centre's sheet, across every centre otherwise.
  const pos = (r: ExamsResultRow | undefined) => (oneCentre ? r?.position : r?.classPosition) ?? null;
  const rules = exam.passRules ?? EXAMS_DEFAULT_PASS_RULES;
  const bands = exam.bands ?? EXAMS_DEFAULT_SCALE;
  const name = (id: string) => exam.subjects.find((s) => s.id === id)?.name ?? id;
  const sorted = [...lines].sort((a, b) => a.p.name.localeCompare(b.p.name));
  return (
    <article className="exams-doc exams-doc-land" aria-label="Diamond Minds result sheet">
      {exam.status !== "DECLARED" && <span className="exams-doc-mark">PROVISIONAL</span>}
      <DocHead campus={prog.campus} title="Diamond Minds result sheet" sub={`${exam.name} · ${centre} · Session ${formatSession(prog.session)}`} />
      <table>
        <thead>
          <tr>
            <th className="n">Sr.</th>
            <th>Reg. no.</th>
            <th>Name</th>
            <th>School name</th>
            <th>Grp</th>
            {exam.subjects.map((s) => (
              <th key={s.id} className="n">
                {s.name.length > 10 ? s.name.slice(0, 9) + "." : s.name}
              </th>
            ))}
            <th className="n">Obt.</th>
            <th className="n">%</th>
            <th className="c">Grd</th>
            <th className="n">Pos.</th>
            <th>Failed subjects</th>
          </tr>
          <tr>
            <th colSpan={5} className="n">
              Max. marks
            </th>
            {exam.subjects.map((s) => (
              <th key={s.id} className="n">
                {s.maxMarks}
              </th>
            ))}
            <th className="n">{exam.subjects.filter((s) => !s.groups?.length || s.groups.includes(exam.groups?.[0] ?? "")).reduce((a, s) => a + s.maxMarks, 0)}</th>
            <th colSpan={4} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((l, i) => {
            const r = l.row;
            return (
              <tr key={l.p.regNo}>
                <td className="n">{i + 1}</td>
                <td className="mtb-mono">{l.p.regNo}</td>
                <td>{l.p.name}</td>
                <td>{l.p.previousSchool}</td>
                <td>{examsGroupShort(l.p.group)}</td>
                {exam.subjects.map((s) => {
                  if (!examsSits(s, l.p.group)) return <td key={s.id} className="n" />;
                  const m = r?.marks[s.id];
                  const low = typeof m === "number" ? m < examsPassMark(s.maxMarks, rules) : m === "A" || m === "L";
                  return (
                    <td key={s.id} className={low ? "n fail" : "n"}>
                      {m === null || m === undefined ? "" : m}
                    </td>
                  );
                })}
                <td className="n">{r ? r.obtained : ""}</td>
                <td className="n">{!r ? "" : r.percent != null ? `${r.percent.toFixed(1)}` : "—"}</td>
                <td className="c">{!r ? "" : r.percent != null ? (r.grade ?? examsGradeFor(r.percent, bands) ?? "—") : "—"}</td>
                <td className="n">{!r ? "" : pos(r) ? ordinal(pos(r)!) : "—"}</td>
                <td style={{ fontSize: "7.5pt" }}>{(r?.failedSubjects ?? []).map(name).join(", ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="exams-doc-key">
        {(exam.groups?.length ? `Grp = group (${exam.groups.map((g) => `${examsGroupShort(g)} ${g}`).join(", ")}); ` : "")}a blank paper is one the group doesn't sit. Marks in red are below the pass mark ({rules.subjectPassPercent}%); A = absent. Position is {oneCentre ? "within the centre" : "across every centre"}; equal percentages share a position. Printed {printedOn()}.
      </p>
      <div className="exams-doc-signs" style={{ marginTop: "8mm" }}>
        <div>Prepared by</div>
        <div>Controller of examinations</div>
        <div>Principal</div>
      </div>
    </article>
  );
}

function TopTen({ prog, exam, lines, centre }: { prog: ExamsProgramme; exam: ExamDetail; lines: Line[]; centre: string }) {
  // Positions are dense (1, 1, 2 …) across every centre; the first ten positions are listed, ties kept.
  const ranked = lines.filter((l) => l.row?.percent != null && !l.row.withheld && (l.row.classPosition ?? 99) <= 10).sort((a, b) => (a.row!.classPosition ?? 0) - (b.row!.classPosition ?? 0) || a.p.name.localeCompare(b.p.name));
  return (
    <article className="exams-doc exams-doc-a4" aria-label="Diamond Minds top ten">
      {exam.status !== "DECLARED" && <span className="exams-doc-mark">PROVISIONAL</span>}
      <DocHead campus={prog.campus} title="Top ten positions" sub={`${exam.name} · ${centre} · Session ${formatSession(prog.session)}`} />
      {ranked.length === 0 ? (
        <p>No complete results match these filters.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Reg. no.</th>
              <th>Name</th>
              <th>Centre</th>
              <th>Previous school</th>
              <th>Group</th>
              <th className="n">Marks</th>
              <th className="n">%</th>
              <th className="n">Position</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((l) => (
              <tr key={l.p.regNo}>
                <td className="mtb-mono">{l.p.regNo}</td>
                <td>{l.p.name}</td>
                <td>{l.centre}</td>
                <td>{l.p.previousSchool}</td>
                <td>{examsGroupShort(l.p.group)}</td>
                <td className="n">
                  {l.row!.obtained} / {l.row!.max}
                </td>
                <td className="n">{formatPercent(l.row!.percent ?? 0)}</td>
                <td className="n">{ordinal(l.row!.classPosition ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="exams-doc-key">Equal percentages share a position, so more than ten participants can be listed. Printed {printedOn()}.</p>
      <div className="exams-doc-signs">
        <div>Controller of examinations</div>
        <div />
        <div>Principal</div>
      </div>
    </article>
  );
}

