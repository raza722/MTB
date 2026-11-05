import { setupApi, setupQueries, type SetupSectionStaffing, type SetupStaffing, type SetupTeacher } from "@mtb/api";
import { formatSession } from "@mtb/domain";
import { Banner, Button, cx, DataTable, EmptyState, Icon, Input, Panel, Segmented, Select, Skeleton, StatusBadge, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { RequireSingleCampus } from "../../app/shell/page";
import { ConflictBanner, conflictOf, errorText, QueryError, SetupPage, type Conflict } from "./shared";

const gapsOf = (s: SetupSectionStaffing) => (s.classTeacherId ? 0 : 1) + s.subjects.filter((x) => !x.teacherId).length;

function teacherOptions(teachers: SetupTeacher[], subjectId: string | null, subjectName: string) {
  const qualified = subjectId ? teachers.filter((t) => t.subjectIds.includes(subjectId)) : [];
  const others = subjectId ? teachers.filter((t) => !t.subjectIds.includes(subjectId)) : teachers;
  return (
    <>
      <option value="">Not assigned</option>
      {qualified.length > 0 && (
        <optgroup label={`Teaches ${subjectName}`}>
          {qualified.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.periodsPerWeek} periods
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={subjectId ? "Other teachers" : "Teachers"}>
        {others.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.classTeacherOf ? ` · class teacher of ${t.classTeacherOf}` : ""}
          </option>
        ))}
      </optgroup>
    </>
  );
}

function SectionStaffingEditor({ section, data, readOnly }: { section: SetupSectionStaffing; data: SetupStaffing; readOnly: boolean }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [classTeacherId, setClassTeacherId] = useState<string | null>(section.classTeacherId);
  const [subjects, setSubjects] = useState<Record<string, string | null>>(() => Object.fromEntries(section.subjects.map((s) => [s.subjectId, s.teacherId])));
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = classTeacherId !== section.classTeacherId || section.subjects.some((s) => (subjects[s.subjectId] ?? null) !== s.teacherId);
  const save = useMutation({
    mutationFn: () => setupApi.saveStaffing(ctx, section.sectionId, { classTeacherId, subjects: section.subjects.map((s) => ({ subjectId: s.subjectId, teacherId: subjects[s.subjectId] ?? null })), rowVer: section.rowVer }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: `${s.label} teachers saved`, message: "Timetables and marks entry follow these teachers." });
    },
    onError: (e) => {
      const c = conflictOf(e);
      if (c) return setConflict(c);
      setError(errorText(e));
    },
  });
  const otherClassTeacher = data.teachers.find((t) => t.id === classTeacherId && t.classTeacherOf && t.classTeacherOf !== section.label);
  return (
    <Panel
      id="staffing-editor"
      title={`${section.label} · ${section.className}`}
      description={`${section.strength} students · ${campusLabel(ctx.campus)}, ${formatSession(ctx.session)}`}
      flush
      actions={gapsOf(section) ? <StatusBadge status="warning">{gapsOf(section)} to assign</StatusBadge> : <StatusBadge status="success">All assigned</StatusBadge>}
    >
      <div className="grid gap-4 px-5 pb-4">
        {conflict && <ConflictBanner conflict={conflict} onReload={() => void qc.invalidateQueries({ queryKey: ["setup"] })} />}
        {error && (
          <Banner tone="danger" title="Not saved.">
            {error}
          </Banner>
        )}
        <Select
          label="Class teacher"
          value={classTeacherId ?? ""}
          disabled={readOnly}
          onChange={(e) => {
            setClassTeacherId(e.target.value || null);
            setError(null);
          }}
          {...(otherClassTeacher ? { error: `${otherClassTeacher.name} is already class teacher of ${otherClassTeacher.classTeacherOf}. Change ${otherClassTeacher.classTeacherOf} first, or choose someone else.` } : { help: "Marks this section's attendance in the teacher app and signs its result cards." })}
        >
          {teacherOptions(data.teachers, null, "")}
        </Select>
      </div>
      {section.subjects.length === 0 ? (
        <EmptyState icon="book" title="This class has no subjects yet" description="Add its subjects under Subjects and marks first." />
      ) : (
        <div className="mtb-table-scroll">
          <table className="mtb-table mtb-table-dense">
            <caption className="mtb-sr-only">Subject teachers for {section.label}</caption>
            <thead>
              <tr>
                <th scope="col">Subject</th>
                <th scope="col" className="mtb-th-num" style={{ width: 120 }}>
                  Periods / week
                </th>
                <th scope="col" style={{ width: "50%" }}>
                  Teacher
                </th>
              </tr>
            </thead>
            <tbody>
              {section.subjects.map((s, i) => {
                const tid = subjects[s.subjectId] ?? null;
                const t = data.teachers.find((x) => x.id === tid);
                const unqualified = t && !t.subjectIds.includes(s.subjectId);
                return (
                  <tr key={s.subjectId} className="mtb-slide-in" style={{ ["--i" as string]: i }}>
                    <td>
                      <span className="flex items-center gap-2">
                        {s.subjectName}
                        {!tid && <StatusBadge status="warning">Not assigned</StatusBadge>}
                      </span>
                    </td>
                    <td className="mtb-td-num">{s.periodsPerWeek}</td>
                    <td>
                      <Select
                        aria-label={`${s.subjectName} teacher`}
                        value={tid ?? ""}
                        disabled={readOnly}
                        onChange={(e) => setSubjects((m) => ({ ...m, [s.subjectId]: e.target.value || null }))}
                        {...(unqualified ? { help: `${t.name} isn't listed as teaching ${s.subjectName}. That's allowed.` } : {})}
                      >
                        {teacherOptions(data.teachers, s.subjectId, s.subjectName)}
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!readOnly && (
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setClassTeacherId(section.classTeacherId);
              setSubjects(Object.fromEntries(section.subjects.map((s) => [s.subjectId, s.teacherId])));
            }}
          >
            Undo changes
          </Button>
          <Button variant="primary" icon="check" disabled={!dirty || Boolean(conflict) || Boolean(otherClassTeacher)} loading={save.isPending} loadingLabel="Saving…" onClick={() => save.mutate()}>
            Save teachers
          </Button>
        </div>
      )}
    </Panel>
  );
}

function BySection({ data }: { data: SetupStaffing }) {
  const readOnly = useReadOnly();
  const [selected, setSelected] = useState<string>(() => data.sections.find((s) => s.label === "7-B")?.sectionId ?? data.sections[0]?.sectionId ?? "");
  const [onlyGaps, setOnlyGaps] = useState(false);
  const section = data.sections.find((s) => s.sectionId === selected);
  const list = data.sections.filter((s) => !onlyGaps || gapsOf(s) > 0);
  return (
    <div className="setup-split">
      <div className="mtb-card">
        <div className="flex items-center justify-between gap-2 px-4 pt-4">
          <span className="text-small font-medium text-ink-muted">Sections</span>
          <button type="button" className="border-0 bg-transparent p-0 text-small text-brand-ink underline-offset-2 hover:underline" onClick={() => setOnlyGaps((v) => !v)} aria-pressed={onlyGaps}>
            {onlyGaps ? "Show all" : "Only gaps"}
          </button>
        </div>
        <ul className="setup-picker" aria-label="Choose a section">
          {list.map((s) => (
            <li key={s.sectionId}>
              <button type="button" aria-current={s.sectionId === selected ? "true" : undefined} onClick={() => setSelected(s.sectionId)}>
                <span className="grid">
                  <span>{s.label}</span>
                  <span className="text-small text-ink-muted">{s.classTeacherName ?? "No class teacher"}</span>
                </span>
                {gapsOf(s) > 0 ? <StatusBadge status="warning">{gapsOf(s)}</StatusBadge> : <Icon name="checkCircle" size={16} className="text-success" />}
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="p-3 text-small text-ink-muted">Every section has all its teachers.</li>}
        </ul>
      </div>
      {section ? <SectionStaffingEditor key={`${section.sectionId}:${section.rowVer}`} section={section} data={data} readOnly={readOnly} /> : <EmptyState icon="students" title="Choose a section" />}
    </div>
  );
}

function TeacherLoad({ data }: { data: SetupStaffing }) {
  const [search, setSearch] = useState("");
  const subjectNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of data.sections) for (const x of s.subjects) m.set(x.subjectId, x.subjectName);
    return m;
  }, [data.sections]);
  const rows = data.teachers.filter((t) => !search.trim() || t.name.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.periodsPerWeek - a.periodsPerWeek);
  const over = data.teachers.filter((t) => t.periodsPerWeek > data.maxPeriods).length;
  const idle = data.teachers.filter((t) => t.periodsPerWeek === 0).length;
  return (
    <Panel id="teacher-load" title="Teaching load" description={`Periods a week from subject allotments. Above ${data.maxPeriods} is flagged.${over ? ` ${over} teacher${over === 1 ? " is" : "s are"} over.` : ""}${idle ? ` ${idle} have no periods yet.` : ""}`} flush rise={0}>
      <DataTable
        rows={rows}
        caption="Teaching load"
        toolbar={
          <div className="w-64">
            <Input aria-label="Search teachers" icon="search" placeholder="Teacher name" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        }
        empty={<EmptyState icon="search" title="No teacher matches" />}
        columns={[
          { key: "name", header: "Teacher", render: (t) => <span className="font-medium">{t.name}</span> },
          { key: "subjects", header: "Can teach", render: (t) => <span className="text-small">{t.subjectIds.map((s) => subjectNames.get(s) ?? s.toUpperCase()).join(", ")}</span> },
          { key: "ct", header: "Class teacher of", render: (t) => t.classTeacherOf ?? <span className="text-ink-subtle">—</span> },
          {
            key: "load",
            header: "Periods a week",
            width: 260,
            render: (t) => {
              const pct = Math.min(100, (t.periodsPerWeek / data.maxPeriods) * 100);
              return (
                <span className="setup-bar">
                  <span className={cx("mtb-meter", t.periodsPerWeek > data.maxPeriods ? "tone-danger" : t.periodsPerWeek > data.maxPeriods - 6 && "tone-warning")} role="img" aria-label={`${t.periodsPerWeek} of ${data.maxPeriods} periods`}>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span className="w-10 text-right text-small tabular-nums">{t.periodsPerWeek}</span>
                </span>
              );
            },
          },
        ]}
      />
    </Panel>
  );
}

export function TeachersPage() {
  const ctx = useCtx();
  const [view, setView] = useState<"sections" | "load">("sections");
  const single = ctx.campus !== "ALL";
  const q = useQuery({ ...setupQueries.staffing(ctx), enabled: single });
  const gaps = q.data?.sections.reduce((a, s) => a + gapsOf(s), 0) ?? 0;
  return (
    <SetupPage
      title="Teacher allotment"
      actions={single && <Segmented aria-label="View" value={view} onChange={(v) => setView(v as "sections" | "load")} options={[{ value: "sections", label: "By section" }, { value: "load", label: "Teaching load" }]} />}
      meta={single && q.data ? gaps ? <StatusBadge status="warning">{gaps} still to assign</StatusBadge> : <StatusBadge status="success">Every section fully staffed</StatusBadge> : undefined}
    >
      <RequireSingleCampus action="teacher allotment">
        {q.isError && <QueryError what="Teacher allotment" error={q.error} onRetry={() => void q.refetch()} />}
        {q.isLoading ? (
          <div className="setup-split">
            <Skeleton height={420} />
            <Skeleton height={420} />
          </div>
        ) : q.data ? (
          q.data.sections.length === 0 ? (
            <div className="mtb-card">
              <EmptyState icon="layers" title="No sections in this session" description="Add sections under Classes and sections first." />
            </div>
          ) : view === "sections" ? (
            <BySection data={q.data} />
          ) : (
            <TeacherLoad data={q.data} />
          )
        ) : null}
        <p className="m-0 text-small text-ink-muted">In the old software the class-staff screen was hidden and every allotment had to be redone each year. Here it carries over to the next session in one step.</p>
      </RequireSingleCampus>
    </SetupPage>
  );
}
