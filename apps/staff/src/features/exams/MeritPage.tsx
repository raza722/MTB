import { examsApi, examsQueries, type ExamsMeritList, type ExamsMeritRow } from "@mtb/api";
import { formatDateTime, formatPercent, formatSession } from "@mtb/domain";
import { Banner, Button, Checkbox, DataTable, EmptyState, Input, Panel, Segmented, Select, SidePanel, Skeleton, useToast, type Column } from "@mtb/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { DocHead, printedOn } from "./print/docs";
import { PrintSheet, printNow } from "./print/PrintSheet";
import { errorText, ExamsNav, examTitle, LoadError } from "./shared";

const saveSchema = z.object({
  title: z.string().trim().min(5, "Give the list a title, for example “Talent scholarship 2026–27 · Class 7”."),
  purpose: z.string().trim().max(200, "Keep the purpose under 200 characters."),
});

const columns: Array<Column<ExamsMeritRow>> = [
  { key: "rank", header: "Rank", align: "right", width: 70, render: (r) => <span className="mtb-num font-semibold">{r.rank}</span> },
  { key: "name", header: "Student", render: (r) => <span className="grid"><span className="mtb-cell-primary">{r.name}</span><span className="mtb-cell-secondary"><span className="mtb-mono">{r.id}</span>{r.father ? ` · ${r.father}` : ""}</span></span> },
  { key: "cs", header: "Section", width: 90, render: (r) => r.classSection },
  { key: "total", header: "Total", align: "right", width: 110, render: (r) => `${r.obtained} / ${r.max}` },
  { key: "pct", header: "%", align: "right", width: 90, render: (r) => <span className="mtb-num">{formatPercent(r.percent)}</span> },
  { key: "grade", header: "Grade", width: 70, render: (r) => r.grade ?? "—" },
];

/** Merit lists from declared results — scholarships in Activities use the saved lists. */
export function MeritPage() {
  const ctx = useCtx();
  const canManage = useCan("exams.manage");
  const readOnly = useReadOnly();
  const toast = useToast();
  const queryClient = useQueryClient();
  // declared exams, newest first, 200 at a time (the server pages the list, contract change C9); the search narrows them
  const [examQuery, setExamQuery] = useState("");
  const examQ = useDeferredValue(examQuery.trim());
  const exams = useQuery({ ...examsQueries.list(ctx, { status: "DECLARED", q: examQ, pageSize: 200 }), placeholderData: keepPreviousData });
  const saved = useQuery(examsQueries.meritLists(ctx));
  const declared = (exams.data?.items ?? []).filter((e) => e.category !== "ENTRANCE");
  const [examId, setExamId] = useState("");
  const exam = declared.find((e) => e.id === examId) ?? declared[0];
  const [sections, setSections] = useState<string[]>([]);
  const [top, setTop] = useState("10");
  const classes = exam ? sections.filter((s) => exam.classes.includes(s)) : [];
  const merit = useQuery(examsQueries.merit(ctx, { examId: exam?.id ?? "", classes, top: Number(top) }));
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [tried, setTried] = useState(false);
  const [viewing, setViewing] = useState<ExamsMeritList | null>(null);
  const [printList, setPrintList] = useState<ExamsMeritList | null>(null);

  const check = saveSchema.safeParse({ title, purpose });
  const errs = check.success ? {} : Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message]));
  const save = useMutation({
    mutationFn: () => examsApi.saveMeritList(ctx, { examId: exam!.id, classes, top: Number(top), title: title.trim(), purpose: purpose.trim() }),
    onSuccess: (list) => {
      void queryClient.invalidateQueries({ queryKey: ["exams"] });
      toast({ title: `Merit list ${list.listNo} saved`, message: `${list.rows.length} students. Scholarships in Activities can now use it.` });
      setTitle("");
      setPurpose("");
      setTried(false);
    },
  });

  return (
    <Page>
      <PageHeader title="Merit lists" />
      <ExamsNav />
      {(exams.isError || saved.isError) && <LoadError what="Merit lists" error={exams.error ?? saved.error} onRetry={() => void Promise.all([exams.refetch(), saved.refetch()])} />}

      <Panel id="merit-draw" title="Draw a merit list" description="Ranked by percentage from declared results only. Equal percentages share a rank; students tied at the cut-off are all included." rise={0}>
        {exams.isLoading ? (
          <Skeleton height={140} />
        ) : !exam && !examQ ? (
          <EmptyState icon="award" title={`No declared results in ${formatSession(ctx.session)}`} description="Merit lists can be drawn once an exam's results are declared." />
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-64">
                <Input label="Find an exam" icon="search" value={examQuery} onChange={(e) => setExamQuery(e.target.value)} placeholder="Name, type or section" />
              </div>
              <div className="w-80">
                <Select
                  label="Declared exam"
                  value={exam?.id ?? ""}
                  onChange={(e) => {
                    setExamId(e.target.value);
                    setSections([]);
                  }}
                  options={declared.length ? declared.map((e) => ({ value: e.id, label: `${examTitle(e)}${ctx.campus === "ALL" ? ` · ${campusLabel(e.campus)}` : ""}` })) : [{ value: "", label: "No declared exam matches" }]}
                />
              </div>
              <Segmented aria-label="How many" value={top} onChange={setTop} options={[{ value: "5", label: "Top 5" }, { value: "10", label: "Top 10" }, { value: "20", label: "Top 20" }, { value: "50", label: "Top 50" }]} />
            </div>
            {exam && exam.classes.length > 1 && (
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-small text-ink-muted">Sections (none ticked = whole class):</span>
                {exam.classes.map((cs) => (
                  <Checkbox key={cs} label={cs} checked={sections.includes(cs)} onChange={(e) => setSections((s) => (e.target.checked ? [...s, cs] : s.filter((x) => x !== cs)))} />
                ))}
              </div>
            )}
            {merit.isError ? (
              <LoadError what="The merit list" error={merit.error} onRetry={() => void merit.refetch()} />
            ) : (
              <DataTable caption="Merit list preview" columns={columns} rows={merit.data?.rows ?? []} loading={merit.isLoading} density="dense" maxHeight={460} empty={<EmptyState icon="award" title="No complete results" description="No student in these sections has a complete, released result." />} />
            )}
            {merit.data && merit.data.tiedAtCutOff > 0 && (
              <Banner tone="info">
                {merit.data.tiedAtCutOff} more {merit.data.tiedAtCutOff === 1 ? "student is" : "students are"} included because of a tie at rank {merit.data.rows[Number(top) - 1]?.rank}.
              </Banner>
            )}
            {canManage && !readOnly && merit.data && merit.data.rows.length > 0 && (
              <div className="grid gap-3 rounded-md border border-border p-4">
                <span className="font-medium">Save this list</span>
                <div className="grid gap-3 md:grid-cols-2">
                  <Input label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Talent scholarship 2026–27 · Class 7" error={tried ? errs.title : undefined} />
                  <Input label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Optional, for example 50% tuition concession for the top five" error={tried ? errs.purpose : undefined} />
                </div>
                {save.isError && <Banner tone="danger">{errorText(save.error)}</Banner>}
                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    icon="award"
                    loading={save.isPending}
                    onClick={() => {
                      setTried(true);
                      if (check.success) save.mutate();
                    }}
                  >
                    Save merit list
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel id="merit-saved" title="Saved merit lists" description="Frozen exactly as saved, with a list number. Activities reads these lists when awarding scholarships." rise={1} flush>
        <DataTable<ExamsMeritList & { id: string }>
          caption="Saved merit lists"
          rows={(saved.data ?? []).map((l) => ({ ...l, id: l.id ?? l.listNo ?? l.title }))}
          loading={saved.isLoading}
          density="dense"
          onRowClick={(l) => setViewing(l)}
          columns={[
            { key: "no", header: "List", width: 160, render: (l) => <span className="mtb-mono">{l.listNo}</span> },
            { key: "title", header: "Title", render: (l) => <span className="grid"><span className="mtb-cell-primary">{l.title}</span><span className="mtb-cell-secondary">{l.examName}</span></span> },
            { key: "n", header: "Students", align: "right", width: 100, render: (l) => l.rows.length },
            { key: "by", header: "Saved", width: 230, render: (l) => (l.createdAt ? `${l.createdBy} · ${formatDateTime(l.createdAt)}` : "—") },
          ]}
          empty={<EmptyState icon="award" title="No merit lists saved yet" description="Draw a list above and save it to share it with Activities." />}
        />
      </Panel>

      {viewing && (
        <SidePanel
          open
          wide
          onClose={() => setViewing(null)}
          title={viewing.title}
          description={`${viewing.listNo} · ${viewing.examName}`}
          footer={
            <>
              <Button onClick={() => setViewing(null)}>Close</Button>
              <Button
                variant="primary"
                icon="printer"
                onClick={() => {
                  setPrintList(viewing);
                  setViewing(null);
                }}
              >
                Print preview
              </Button>
            </>
          }
        >
          <div className="grid gap-3">
            {viewing.purpose && <p className="m-0 text-ink-muted">{viewing.purpose}</p>}
            <DataTable caption={viewing.title} columns={columns} rows={viewing.rows} density="dense" />
          </div>
        </SidePanel>
      )}
      {printList && (
        <div className="grid gap-3">
          <div className="flex gap-2">
            <Button variant="primary" icon="printer" onClick={printNow}>
              Print {printList.listNo}
            </Button>
            <Button onClick={() => setPrintList(null)}>Close preview</Button>
          </div>
          <PrintSheet paper="A4" label="Merit list preview">
            <article className="exams-doc exams-doc-a4" aria-label="Merit list">
              <DocHead campus={printList.campus} title="Merit list" sub={`${printList.listNo} · Session ${formatSession(printList.session)}`} />
              <p style={{ margin: "0 0 3mm" }}>
                <b>{printList.title}</b> — {printList.examName}
                {printList.purpose ? `. ${printList.purpose}` : ""}
              </p>
              <table>
                <thead>
                  <tr>
                    <th className="n">Rank</th>
                    <th>Student</th>
                    <th>Father's name</th>
                    <th>Section</th>
                    <th className="n">Total</th>
                    <th className="n">%</th>
                  </tr>
                </thead>
                <tbody>
                  {printList.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="n">{r.rank}</td>
                      <td>
                        {r.name} <span className="mtb-mono">{r.id}</span>
                      </td>
                      <td>{r.father ?? ""}</td>
                      <td>{r.classSection}</td>
                      <td className="n">
                        {r.obtained}/{r.max}
                      </td>
                      <td className="n">{formatPercent(r.percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="exams-doc-key">
                Saved by {printList.createdBy} on {printList.createdAt ? formatDateTime(printList.createdAt) : "—"}. Printed {printedOn()}.
              </p>
              <div className="exams-doc-signs">
                <div>Controller of examinations</div>
                <div>Scholarship committee</div>
                <div>Principal</div>
              </div>
            </article>
          </PrintSheet>
        </div>
      )}
    </Page>
  );
}
