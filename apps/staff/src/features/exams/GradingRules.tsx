import {
  ApiError,
  EXAMS_CATEGORY_LABEL,
  examsApi,
  examsGradeFor,
  examsQueries,
  examsValidateBands,
  examsValidatePassRules,
  EXAMS_DEFAULT_PASS_RULES,
  EXAMS_DEFAULT_SCALE,
  EXAMS_LEGACY_SCALE,
  EXAMS_UNI_GPA_SCALE,
  EXAMS_UNI_MIN_ATTENDANCE,
  EXAMS_UNI_PROBATION_CGPA,
  type ExamsCategory,
  type ExamsGradeBand,
  type ExamsGradeScale,
  type ExamsPassRules,
} from "@mtb/api";
import { formatDateTime } from "@mtb/domain";
import { Banner, Button, Card, Checkbox, IconButton, Input, Select, Skeleton, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { errorText, ExamsNav, LoadError } from "./shared";

/** /exams/grading — grade scales (Standard, and scales for some exam kinds or classes), pass rules and university grade points. */
export function GradingPage() {
  return (
    <Page>
      <PageHeader title="Grading rules" />
      <ExamsNav />
      <GradingRules />
    </Page>
  );
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Kinds a scale can apply to (university courses use grade points instead). */
const KINDS: ExamsCategory[] = ["TERM", "TEST", "BOARD", "ENTRANCE"];
const CLASSES = ["Prep", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const classLabel = (c: string) => (c === "Prep" ? "Prep" : `Class ${c}`);

/** Where a scale applies, in words. */
export function appliesText(s: Pick<ExamsGradeScale, "appliesTo" | "standard">): string {
  if (s.standard) return "Every exam no other scale covers";
  const kinds = s.appliesTo.categories.map((c) => EXAMS_CATEGORY_LABEL[c].toLowerCase() + "s");
  const classes = s.appliesTo.classes.map(classLabel);
  return `${kinds.length ? kinds.join(", ") : "every kind of exam"}${classes.length ? ` in ${classes.join(", ")}` : ""}`.replace(/^./, (x) => x.toUpperCase());
}

const NEW_ID = "__new";

/** Grading rules as data: one or more scales, each an editable table that flags overlaps and gaps as you type. */
export function GradingRules() {
  const scales = useQuery(examsQueries.grading());
  const [selected, setSelected] = useState<string>("");
  if (scales.isError) return <LoadError what="Grading rules" error={scales.error} onRetry={() => void scales.refetch()} />;
  if (scales.isLoading || !scales.data) {
    return (
      <div className="grid gap-3" aria-busy="true">
        <Skeleton height={40} />
        <Skeleton height={240} />
      </div>
    );
  }
  const list = scales.data;
  const standard = list.find((s) => s.standard) ?? list[0]!;
  const current = selected === NEW_ID ? null : (list.find((s) => s.id === selected) ?? standard);
  const draft: ExamsGradeScale | null =
    selected === NEW_ID
      ? { id: NEW_ID, name: "", appliesTo: { categories: [], classes: [] }, bands: standard.bands, passRules: standard.passRules ?? EXAMS_DEFAULT_PASS_RULES, updatedBy: "", updatedAt: "", rowVer: 0 }
      : null;
  const shown = current ?? draft!;
  // Re-mount the editor whenever the saved scale changes, so it starts from what the server has.
  return (
    <GradingEditor
      key={`${shown.id}:${shown.rowVer}`}
      saved={shown}
      scales={list}
      onPick={setSelected}
      onSaved={(id) => setSelected(id)}
    />
  );
}

function GradingEditor({ saved, scales, onPick, onSaved }: { saved: ExamsGradeScale; scales: ExamsGradeScale[]; onPick: (id: string) => void; onSaved: (id: string) => void }) {
  const ctx = useCtx();
  const canEdit = useCan("exams.manage");
  const readOnly = useReadOnly();
  const editable = canEdit && !readOnly;
  const toast = useToast();
  const queryClient = useQueryClient();
  const isNew = saved.id === NEW_ID;
  const savedRules = saved.passRules ?? EXAMS_DEFAULT_PASS_RULES;
  const asText = (r: ExamsPassRules) => ({ subjectPassPercent: String(r.subjectPassPercent), overallPassPercent: String(r.overallPassPercent), supplyMaxSubjects: String(r.supplyMaxSubjects) });
  const [name, setName] = useState(saved.name);
  const [kinds, setKinds] = useState<ExamsCategory[]>(saved.appliesTo.categories);
  const [classes, setClasses] = useState<string[]>(saved.appliesTo.classes);
  const [bands, setBands] = useState<ExamsGradeBand[]>(saved.bands);
  const [rules, setRules] = useState<Record<keyof ExamsPassRules, string>>(asText(savedRules));
  const [tried, setTried] = useState(false);
  const parsedRules: ExamsPassRules = { subjectPassPercent: Number(rules.subjectPassPercent), overallPassPercent: Number(rules.overallPassPercent), supplyMaxSubjects: Number(rules.supplyMaxSubjects) };
  const ruleProblems = Object.values(rules).some((v) => v.trim() === "") ? ["Fill in every pass rule."] : examsValidatePassRules(parsedRules);
  const [probe, setProbe] = useState("79.5");
  const issues = examsValidateBands(bands);
  const flagged = new Set(issues.flatMap((i) => i.rows));
  const rulesDirty = !same(parsedRules, savedRules);
  const dirty = isNew || !same(bands, saved.bands) || rulesDirty || name !== saved.name || !same([...kinds].sort(), [...saved.appliesTo.categories].sort()) || !same([...classes].sort(), [...saved.appliesTo.classes].sort());
  const headSchema = z.object({
    name: z.string().trim().min(3, "Give the scale a name, for example “Progress report”."),
    appliesTo: z.object({ categories: z.array(z.string()), classes: z.array(z.string()) }).refine((a) => saved.standard || a.categories.length + a.classes.length > 0, "Tick the exam kinds or classes this scale is for."),
  });
  const head = headSchema.safeParse({ name, appliesTo: { categories: kinds, classes } });
  const headErrors = head.success ? {} : Object.fromEntries(head.error.issues.map((i) => [String(i.path[0]), i.message]));

  const save = useMutation({
    mutationFn: () =>
      examsApi.saveGrading(ctx, { name: name.trim(), appliesTo: { categories: kinds, classes }, bands, passRules: parsedRules, ...(isNew ? {} : { rowVer: saved.rowVer }) }, isNew ? undefined : saved.id),
    onSuccess: (data) => {
      queryClient.setQueryData(examsQueries.grading().queryKey, (old: ExamsGradeScale[] | undefined) => (old ? (old.some((s) => s.id === data.id) ? old.map((s) => (s.id === data.id ? data : s)) : [...old, data]) : [data]));
      void queryClient.invalidateQueries({ queryKey: ["exams", "detail"] });
      toast({ title: isNew ? "Scale added" : "Grading rules saved", message: `${data.name}: draft results now use these grades. Declared results keep theirs.` });
      onSaved(data.id);
    },
  });
  const conflict = save.error instanceof ApiError && save.error.status === 409 && save.error.code === "CONFLICT";

  const setBand = (i: number, patch: Partial<ExamsGradeBand>) => setBands((list) => list.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const num = (v: string) => {
    const digits = v.replace(/\D/g, "");
    return digits === "" ? Number.NaN : Number(digits);
  };
  const probeValue = Number(probe);
  const probeGrade = probe.trim() !== "" && probeValue >= 0 && probeValue <= 100 ? examsGradeFor(probeValue, bands) : null;
  const trySave = () => {
    setTried(true);
    if (head.success && issues.length === 0 && ruleProblems.length === 0) save.mutate();
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-72">
            <Select
              label="Grade scale"
              value={saved.id}
              onChange={(e) => onPick(e.target.value)}
              options={[...scales.map((s) => ({ value: s.id, label: `${s.name}${s.standard ? " (standard)" : ""}` })), ...(isNew ? [{ value: NEW_ID, label: "New scale" }] : [])]}
              help={isNew ? "Not saved yet." : appliesText(saved)}
            />
          </div>
          {editable && !isNew && (
            <Button icon="plus" onClick={() => onPick(NEW_ID)}>
              Add scale
            </Button>
          )}
        </div>

        <Card
          title={isNew ? "New grade scale" : saved.name}
          actions={
            editable ? (
              <>
                <Button size="sm" variant="ghost" icon="refresh" disabled={same(bands, EXAMS_DEFAULT_SCALE)} onClick={() => setBands(EXAMS_DEFAULT_SCALE)}>
                  Use the standard grades
                </Button>
                {isNew ? (
                  <Button size="sm" onClick={() => onPick("")}>
                    Cancel
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!dirty}
                    onClick={() => {
                      setBands(saved.bands);
                      setRules(asText(savedRules));
                      setName(saved.name);
                      setKinds(saved.appliesTo.categories);
                      setClasses(saved.appliesTo.classes);
                    }}
                  >
                    Undo changes
                  </Button>
                )}
                <Button size="sm" variant="primary" disabled={!dirty || issues.length > 0 || ruleProblems.length > 0} loading={save.isPending} onClick={trySave}>
                  {isNew ? "Add scale" : "Save rules"}
                </Button>
              </>
            ) : undefined
          }
        >
          <div className="grid gap-4">
            <p className="m-0 text-small text-ink-muted">
              A grade covers its minimum up to just below the next grade: 70–79 means 70% up to 79.9%. An exam uses the most specific scale for its kind and class; draft results use the rules as they are now, declared results keep the grades they were declared with.
              {!isNew && (
                <>
                  {" "}
                  Last changed by {saved.updatedBy} on <span className="mtb-num">{formatDateTime(saved.updatedAt)}</span>.
                </>
              )}
            </p>
            {!editable && <Banner tone="neutral">{readOnly ? "Past sessions are read-only." : "Only the principal or an admin can change grading rules."}</Banner>}
            {conflict && (
              <Banner
                tone="warning"
                title="Changed by someone else."
                actions={
                  <Button size="sm" icon="refresh" onClick={() => void queryClient.invalidateQueries({ queryKey: examsQueries.grading().queryKey })}>
                    Reload
                  </Button>
                }
              >
                {errorText(save.error)}
              </Banner>
            )}

            <div className="grid gap-4 rounded-md border border-border p-4">
              <Input label="Scale name" required value={name} disabled={!editable || Boolean(saved.standard)} onChange={(e) => setName(e.target.value)} error={tried ? headErrors.name : undefined} help={saved.standard ? "The standard scale applies to every exam no other scale covers." : undefined} />
              {!saved.standard && (
                <>
                  <fieldset className="m-0 grid gap-2 border-0 p-0">
                    <legend className="mb-1 text-small font-medium">Applies to these kinds of exam</legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {KINDS.map((k) => (
                        <Checkbox key={k} label={EXAMS_CATEGORY_LABEL[k]} disabled={!editable} checked={kinds.includes(k)} onChange={(e) => setKinds((l) => (e.target.checked ? [...l, k] : l.filter((x) => x !== k)))} />
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="m-0 grid gap-2 border-0 p-0">
                    <legend className="mb-1 text-small font-medium">…and these classes (none ticked: every class)</legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {CLASSES.map((c) => (
                        <Checkbox key={c} label={classLabel(c)} disabled={!editable} checked={classes.includes(c)} onChange={(e) => setClasses((l) => (e.target.checked ? [...l, c] : l.filter((x) => x !== c)))} />
                      ))}
                    </div>
                  </fieldset>
                  {tried && headErrors.appliesTo && <p className="m-0 text-small text-danger-ink">{headErrors.appliesTo}</p>}
                </>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="mtb-table mtb-table-dense">
                <caption className="mtb-sr-only">Grades of {name || "the new scale"}</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ position: "static", width: 96 }}>
                      Grade
                    </th>
                    <th scope="col" className="mtb-th-num" style={{ position: "static", width: 110 }}>
                      Min %
                    </th>
                    <th scope="col" className="mtb-th-num" style={{ position: "static", width: 110 }}>
                      Max %
                    </th>
                    <th scope="col" style={{ position: "static" }}>
                      Remark
                    </th>
                    {editable && <th scope="col" style={{ position: "static", width: 48 }} aria-label="Remove" />}
                  </tr>
                </thead>
                <tbody>
                  {bands.map((b, i) => {
                    const bad = flagged.has(i);
                    return (
                      <tr key={i} className={bad ? "[&>td]:bg-warning-tint" : undefined}>
                        <td>
                          <Input aria-label={`Grade ${i + 1}`} value={b.grade} disabled={!editable} maxLength={3} onChange={(e) => setBand(i, { grade: e.target.value })} inputClassName={bad ? "is-invalid" : undefined} />
                        </td>
                        <td>
                          <Input
                            aria-label={`${b.grade || `Grade ${i + 1}`} minimum %`}
                            value={Number.isNaN(b.min) ? "" : String(b.min)}
                            disabled={!editable}
                            inputMode="numeric"
                            amount
                            onChange={(e) => setBand(i, { min: num(e.target.value) })}
                            inputClassName={bad ? "is-invalid" : undefined}
                          />
                        </td>
                        <td>
                          <Input
                            aria-label={`${b.grade || `Grade ${i + 1}`} maximum %`}
                            value={Number.isNaN(b.max) ? "" : String(b.max)}
                            disabled={!editable}
                            inputMode="numeric"
                            amount
                            onChange={(e) => setBand(i, { max: num(e.target.value) })}
                            inputClassName={bad ? "is-invalid" : undefined}
                          />
                        </td>
                        <td>
                          <Input aria-label={`${b.grade || `Grade ${i + 1}`} remark`} value={b.remark} disabled={!editable} onChange={(e) => setBand(i, { remark: e.target.value })} />
                        </td>
                        {editable && (
                          <td>
                            <IconButton icon="trash" label={`Remove grade ${b.grade || i + 1}`} size="sm" disabled={bands.length <= 2} onClick={() => setBands((list) => list.filter((_, j) => j !== i))} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {editable && (
              <div>
                <Button size="sm" icon="plus" onClick={() => setBands((list) => [...list, { grade: "", min: Number.NaN, max: Number.NaN, remark: "" }])}>
                  Add grade
                </Button>
              </div>
            )}

            {issues.length > 0 ? (
              <Banner tone="warning" title={`${issues.length} ${issues.length === 1 ? "problem" : "problems"} to fix before saving.`}>
                <ul className="m-0 mt-1 grid gap-0.5 ps-5">
                  {issues.map((i) => (
                    <li key={i.message}>{i.message}</li>
                  ))}
                </ul>
              </Banner>
            ) : (
              <Banner tone="success">Every percentage from 0 to 100 has exactly one grade.</Banner>
            )}
            <div className="grid gap-3 rounded-md border border-border p-4">
              <div>
                <h3 className="m-0 text-title-3">Pass rules</h3>
                <p className="m-0 text-small text-ink-muted">For exams on this scale. The old system left “Summer Pack” out of the fail list on result cards only; here optional subjects never count towards pass or fail, on screen or on paper.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input label="Pass mark in each subject" suffix="%" amount inputMode="numeric" disabled={!editable} value={rules.subjectPassPercent} onChange={(e) => setRules((r) => ({ ...r, subjectPassPercent: e.target.value.replace(/\D/g, "") }))} help="33% of 75 is 25 (rounded up)." />
                <Input label="Pass mark overall" suffix="%" amount inputMode="numeric" disabled={!editable} value={rules.overallPassPercent} onChange={(e) => setRules((r) => ({ ...r, overallPassPercent: e.target.value.replace(/\D/g, "") }))} />
                <Input label="Re-sit allowed for up to" suffix="subjects" amount inputMode="numeric" disabled={!editable} value={rules.supplyMaxSubjects} onChange={(e) => setRules((r) => ({ ...r, supplyMaxSubjects: e.target.value.replace(/\D/g, "") }))} help="More failed subjects than this is a fail." />
              </div>
              {ruleProblems.length > 0 && <Banner tone="warning">{ruleProblems[0]}</Banner>}
            </div>
            {save.isError && !conflict && <Banner tone="danger">The rules weren't saved: {errorText(save.error)}</Banner>}

            <div className="flex flex-wrap items-end gap-3">
              <div className="w-36">
                <Input label="Try a percentage" value={probe} inputMode="decimal" suffix="%" onChange={(e) => setProbe(e.target.value)} />
              </div>
              <span className="pb-2.5 text-ink-muted" aria-live="polite">
                {probeGrade ? (
                  <>
                    gets grade <b className="text-ink">{probeGrade}</b>
                    {probeGrade !== examsGradeFor(probeValue, EXAMS_LEGACY_SCALE) && (
                      <>
                        {" "}
                        (old system: <b className="text-ink">{examsGradeFor(probeValue, EXAMS_LEGACY_SCALE)}</b>)
                      </>
                    )}
                  </>
                ) : probe.trim() === "" ? (
                  "Type a % to see its grade."
                ) : (
                  "No grade covers this percentage."
                )}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid content-start gap-6">
        <ScaleList scales={scales} current={saved.id} onPick={onPick} />
        <LegacyScale bands={bands} />
        <UniversityScale />
      </div>
    </div>
  );
}

/** Every scale and where it applies. */
function ScaleList({ scales, current, onPick }: { scales: ExamsGradeScale[]; current: string; onPick: (id: string) => void }) {
  return (
    <Card title="Scales in use">
      <ul className="m-0 grid list-none gap-2 p-0">
        {scales.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onPick(s.id)}
              className={`grid w-full gap-0.5 rounded-md border px-3 py-2 text-left ${s.id === current ? "border-brand bg-brand-tint" : "border-border hover:bg-surface-hover"}`}
            >
              <span className="font-medium">
                {s.name}
                {s.standard ? " · standard" : ""}
              </span>
              <span className="text-small text-ink-muted">
                {appliesText(s)} · {s.bands.map((b) => b.grade).join(", ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Grade points for degree programmes (read-only here). */
function UniversityScale() {
  return (
    <Card
      title={
        <div className="grid gap-1">
          <h2 className="m-0 text-title-3">University grade points</h2>
          <span className="text-small font-normal text-ink-muted">Degree programmes · 4.0 scale</span>
        </div>
      }
    >
      <div className="grid gap-3">
        <table className="mtb-table mtb-table-dense">
          <caption className="mtb-sr-only">University grade points</caption>
          <thead>
            <tr>
              <th scope="col" style={{ position: "static" }}>
                Grade
              </th>
              <th scope="col" className="mtb-th-num" style={{ position: "static" }}>
                From
              </th>
              <th scope="col" className="mtb-th-num" style={{ position: "static" }}>
                Points
              </th>
            </tr>
          </thead>
          <tbody>
            {EXAMS_UNI_GPA_SCALE.map((b) => (
              <tr key={b.grade}>
                <td className="font-medium">{b.grade}</td>
                <td className="mtb-td-num">{b.min}%</td>
                <td className="mtb-td-num">{b.points.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="m-0 text-small text-ink-muted">
          GPA weights each course's points by its credit hours; CGPA does the same over every declared semester. Below {EXAMS_UNI_MIN_ATTENDANCE}% attendance a course is graded F. A CGPA under {EXAMS_UNI_PROBATION_CGPA.toFixed(1)} puts the student on probation.
        </p>
      </div>
    </Card>
  );
}

/** The old desktop system's scale, side by side — a labelled variant, not a decision. */
function LegacyScale({ bands }: { bands: ExamsGradeBand[] }) {
  const ft7 = useQuery({ ...examsQueries.detail("ex-ft-2627"), retry: false });
  const complete = (ft7.data?.rows ?? []).filter((r) => r.percent !== null);
  const changed = complete.filter((r) => examsGradeFor(r.percent!, bands) !== examsGradeFor(r.percent!, EXAMS_LEGACY_SCALE)).length;

  return (
    <Card
      title={
        <div className="grid gap-1">
          <h2 className="m-0 text-title-3">Old system scale</h2>
          <span className="text-small font-normal text-ink-muted">For comparison — not yet decided</span>
        </div>
      }
    >
      <div className="grid gap-4">
        <table className="mtb-table mtb-table-dense">
          <caption className="mtb-sr-only">Old system grading scale</caption>
          <thead>
            <tr>
              <th scope="col" style={{ position: "static" }}>
                Grade
              </th>
              <th scope="col" className="mtb-th-num" style={{ position: "static" }}>
                From
              </th>
              <th scope="col" className="mtb-th-num" style={{ position: "static" }}>
                To
              </th>
            </tr>
          </thead>
          <tbody>
            {EXAMS_LEGACY_SCALE.map((b) => (
              <tr key={b.grade}>
                <td className="font-medium">{b.grade}</td>
                <td className="mtb-td-num">{b.min}%</td>
                <td className="mtb-td-num">{b.max === 100 ? "100%" : `${b.max}.9%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="m-0 grid gap-1 ps-5 text-small text-ink-muted">
          <li>
            C starts at <b className="text-ink">45%</b>, not 50%, and there is <b className="text-ink">no D</b>: 33–44% is E.
          </li>
          <li>The old system worked grades out with ≥ but printed result cards with &gt;, so a student on exactly 80% was A+ in the database and A on the card.</li>
          {complete.length > 0 && (
            <li>
              In First Term 2026–27 (Class 7), <b className="text-ink">{changed}</b> of {complete.length} students would get a different grade under the old scale than under the scale on the left.
            </li>
          )}
        </ul>
        <Banner tone="info">MTB has to choose one standard scale before the new system goes live. Until then, results use the rules on the left.</Banner>
      </div>
    </Card>
  );
}
