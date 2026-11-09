import { feeSetupApi, feeSetupQueries, newIdempotencyKey, smsRender, smsSegments, type FeeDefaulter } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatMobile, formatRs, formatSession } from "@mtb/domain";
import {
  AmountInput,
  AnimatedNumber,
  Banner,
  Button,
  buttonClassName,
  DataTable,
  DatePicker,
  EmptyState,
  Icon,
  Input,
  KeyValue,
  Menu,
  MenuItem,
  MenuLabel,
  Modal,
  Pagination,
  Segmented,
  Select,
  SidePanel,
  StatCard,
  StatusBadge,
  Switch,
  Textarea,
  Urdu,
  useToast,
  type Column,
} from "@mtb/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { campusLabel } from "../../../app/shell/campus";
import { Page, PageHeader, RequirePermission } from "../../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../../app/session";
import { addDaysIso, errorText, feeToday, FeesNav, HeadPicker, LoadError, PaperSize, sessionMonthList, useFeeClasses, type FeeClasses } from "../shared";

/** Variables a fee reminder can carry (each family's own figures). */
const ALLOWED_VARS = ["student_name", "class", "amount_due", "due_date", "campus"];

/** The months of the session so far ("2026-04" … "2026-11"), for the Month filter. */
function monthsSoFar(session: number, today: string): string[] {
  return sessionMonthList(session).filter((m) => m <= today.slice(0, 7));
}
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthText = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** Several sections at once, from one class or from several (the old Arrears SMS class and section lists). */
function SectionsPicker({ cls, value, onChange, classList }: { cls: string; value: string[]; onChange: (next: string[]) => void; classList: FeeClasses }) {
  const classes = cls ? [cls] : classList.classes.map((c) => c.short);
  const { nameOf, sectionsOf } = classList;
  const text = value.length === 0 ? (cls ? "Every section" : "Sections: all") : value.length <= 2 ? value.join(", ") : `Sections: ${value.length}`;
  const toggle = (cs: string) => onChange(value.includes(cs) ? value.filter((x) => x !== cs) : [...value, cs]);
  return (
    <Menu
      label="Sections"
      trigger={
        <Button icon="filter" aria-label={`Sections. ${text}`}>
          {text}
        </Button>
      }
    >
      <MenuItem checked={value.length === 0} onSelect={() => onChange([])}>
        {cls ? `Every section of ${nameOf(cls)}` : "Every class and section"}
      </MenuItem>
      {classes.map((c) => (
        <div key={c}>
          {!cls && <MenuLabel>{nameOf(c)}</MenuLabel>}
          {sectionsOf(c).map((x) => {
            const cs = `${c}-${x}`;
            return (
              <MenuItem
                key={cs}
                checked={value.includes(cs)}
                onSelect={(e?: Event) => {
                  e?.preventDefault();
                  toggle(cs);
                }}
              >
                {cs}
              </MenuItem>
            );
          })}
        </div>
      ))}
    </Menu>
  );
}

function ReminderModal({ rows, template, paused, onClose, onSent }: { rows: FeeDefaulter[]; template: { en: string; ur: string }; paused: boolean; onClose: () => void; onSent: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [lang, setLang] = useState<"en" | "ur">("en");
  // "Edit wording for this send": the legacy text before/after and note, as one message with the same variables.
  const [own, setOwn] = useState(false);
  const [enText, setEnText] = useState(template.en);
  const [urText, setUrText] = useState(template.ur);
  const [tried, setTried] = useState(false);
  const key = useMemo(() => newIdempotencyKey(), [rows, lang, own, enText, urText]);
  const first = rows[0];
  const body = own ? (lang === "ur" ? urText : enText) : lang === "ur" ? template.ur : template.en;
  const message = first ? smsRender(body, { amount_due: formatCount(first.total), student_name: first.studentName, class: first.classSection, due_date: formatDate(first.oldestDue), campus: first.campusName }) : "";
  const parts = smsSegments(message);
  const notAllowed = [...body.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1] ?? "").filter((v) => v && !ALLOWED_VARS.includes(v));
  const wordingError = !own ? undefined : !body.trim() ? (lang === "ur" ? "Write the Urdu message, or switch to English." : "Write the English message, or switch to Urdu.") : notAllowed.length ? `{${notAllowed[0]!}} can't be used here. Use ${ALLOWED_VARS.map((v) => `{${v}}`).join(", ")}.` : undefined;
  const send = useMutation({
    mutationFn: () => feeSetupApi.remind({ campus: ctx.campus, session: ctx.session, grNos: rows.map((r) => r.grNo), language: lang, ...(own ? { customText: { en: enText, ur: urText } } : {}) }, key),
    onSuccess: (r) => {
      toast({ title: `${formatCount(r.queued)} reminder SMS queued`, message: r.skipped.length ? `${formatCount(r.skipped.length)} skipped: ${r.skipped.map((s) => `${s.name} (${s.reason.toLowerCase()})`).join(", ")}` : "They go out within a few minutes; see the SMS centre for delivery." });
      void queryClient.invalidateQueries({ queryKey: ["fees", "setup"] });
      onSent();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Send a reminder to ${formatCount(rows.length)} ${rows.length === 1 ? "family" : "families"}?`}
      description={own ? "Each guardian gets your wording with their own child's figures. It goes through the SMS centre." : "Each guardian gets the fee-overdue message from the SMS centre with their own child's figures."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="send"
            disabled={paused}
            loading={send.isPending}
            loadingLabel="Sending…"
            onClick={() => {
              setTried(true);
              if (!wordingError) send.mutate();
            }}
          >
            Send {formatCount(rows.length)} SMS
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {paused && (
          <Banner tone="warning" title="All SMS are paused by the admin.">
            Nothing can be sent until an admin resumes SMS in the SMS centre.
          </Banner>
        )}
        <Segmented aria-label="Language" value={lang} onChange={(v) => setLang(v as "en" | "ur")} options={[{ value: "en", label: "English" }, { value: "ur", label: "اردو" }]} />
        <Switch label="Edit wording for this send" checked={own} onChange={(e) => setOwn(e.target.checked)} />
        {own && (
          <div className="grid gap-3">
            {lang === "en" ? (
              <Textarea label="Message (English)" rows={4} value={enText} onChange={(e) => setEnText(e.target.value)} help={`Use ${ALLOWED_VARS.map((v) => `{${v}}`).join(", ")} for each family's own figures. The saved template doesn't change.`} {...(tried && wordingError ? { error: wordingError } : {})} />
            ) : (
              <Textarea label="Message (Urdu)" urdu rows={3} value={urText} onChange={(e) => setUrText(e.target.value)} help={`Use ${ALLOWED_VARS.map((v) => `{${v}}`).join(", ")} for each family's own figures. The saved template doesn't change.`} {...(tried && wordingError ? { error: wordingError } : {})} />
            )}
            <div>
              <Button size="sm" variant="ghost" onClick={() => (lang === "ur" ? setUrText(template.ur) : setEnText(template.en))}>
                Start again from the saved template
              </Button>
            </div>
          </div>
        )}
        {first && (
          <div className="grid gap-1">
            <span className="text-small text-ink-muted">
              To {first.father} · {formatMobile(first.mobile)}
            </span>
            <div className="max-w-[420px] rounded-[18px_18px_18px_4px] bg-surface-sunken px-4 py-3 text-[14px] leading-5">{lang === "ur" ? <Urdu>{message}</Urdu> : message}</div>
            <span className="text-small text-ink-muted">
              {parts.parts} SMS {parts.parts === 1 ? "part" : "parts"} each · {formatCount(rows.length * parts.parts)} in all
            </span>
          </div>
        )}
        <KeyValue
          items={[
            ["Families", formatCount(rows.length)],
            ["Overdue in all", formatRs(rows.reduce((a, r) => a + r.total, 0))],
            ["Reminded in the last 7 days", formatCount(rows.filter((r) => r.lastReminderAt && r.lastReminderAt.slice(0, 10) >= addDaysIso(feeToday(), -7)).length)],
          ]}
        />
        {send.error && <Banner tone="danger">{errorText(send.error)}</Banner>}
      </div>
    </Modal>
  );
}

function DefaulterPanel({ r, onClose }: { r: FeeDefaulter; onClose: () => void }) {
  const canCollect = useCan("fees.collect");
  return (
    <SidePanel
      open
      onClose={onClose}
      title={r.studentName}
      description={`${r.grNo} · ${r.classSection} · ${r.campusName}`}
      footer={
        <>
          <Link to="/students/$grNo" params={{ grNo: r.grNo }} className={buttonClassName({})}>
            <Icon name="students" size={16} />
            Student profile
          </Link>
          {canCollect && (
            <Link to="/fees/counter" search={{ gr: r.grNo }} className={buttonClassName({ variant: "primary" })}>
              <Icon name="fees" size={16} />
              Collect fee
            </Link>
          )}
        </>
      }
    >
      <div className="grid gap-5">
        {r.enrolment !== "ACTIVE" && <Banner tone="warning">This student is no longer enrolled. Dues stay until they are paid or written off by management.</Banner>}
        <KeyValue
          items={[
            ["Overdue fees", formatRs(r.outstanding)],
            ["Late fine to today", formatRs(r.fine)],
            ["Total to pay today", <span className="font-semibold">{formatRs(r.total)}</span>],
            ["Overdue since", `${formatDate(r.oldestDue)} (${r.daysOverdue} days)`],
            ["Overdue charges", formatCount(r.overdueCharges)],
            ["Due soon (not overdue)", formatRs(r.upcoming)],
            ["Charged this session", formatRs(r.sessionTotal)],
            ...(r.previousSessionArrears > 0 ? ([["From last session", formatRs(r.previousSessionArrears)]] as Array<[string, string]>) : []),
            ["Guardian", `${r.father} · ${formatMobile(r.mobile)}`],
            ["Reminders sent", r.reminders ? `${r.reminders}, last ${formatDateTime(r.lastReminderAt!)}` : "None yet"],
          ]}
        />
        {r.installments.length > 0 && (
          <div className="grid gap-1.5">
            <span className="text-small font-medium">Overdue charges</span>
            <KeyValue items={r.installments.map((i): [string, string] => [`${i.label} · due ${formatDate(i.dueDate)}`, formatRs(i.amount)])} />
          </div>
        )}
        <p className="m-0 text-small text-ink-muted">Figures are worked out from the fee ledger with today's late fine. They are never typed in.</p>
      </div>
    </SidePanel>
  );
}

export function DefaultersPage() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canSms = useCan("sms.send");
  const classList = useFeeClasses(ctx.campus);
  const [cls, setCls] = useState("");
  const [sections, setSections] = useState<string[]>([]);
  const [heads, setHeads] = useState<string[]>([]);
  const [dueFrom, setDueFrom] = useState<string | null>(null);
  const [dueTo, setDueTo] = useState<string | null>(null);
  const [months, setMonths] = useState("0");
  const [minAmount, setMinAmount] = useState<number | null>(null);
  const [includeLeft, setIncludeLeft] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [selected, setSelected] = useState<Set<unknown>>(new Set());
  const [reminding, setReminding] = useState(false);
  const [open, setOpen] = useState<FeeDefaulter | null>(null);
  const dueError = dueFrom && dueTo && dueFrom > dueTo ? "The first date must be on or before the second." : undefined;
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  // The list is paged on the server (contract C8); the stat cards and `total` cover every matching student.
  const q = useQuery({
    ...feeSetupQueries.defaulters(ctx, { classShort: cls, sections: sections.join(","), minMonths: Number(months), minAmount: minAmount ?? 0, includeLeft, heads: heads.join(","), dueFrom: dueFrom ?? "", dueTo: dueTo ?? "", q: search, page, pageSize }),
    enabled: !dueError,
    placeholderData: keepPreviousData,
  });
  useEffect(() => setSelected(new Set()), [cls, sections, heads, dueFrom, dueTo, months, minAmount, includeLeft, search, ctx.campus, ctx.session]);
  useEffect(() => setPage(1), [cls, sections, heads, dueFrom, dueTo, months, minAmount, includeLeft, search, pageSize, ctx.campus, ctx.session]);
  const filtered = Boolean(cls || sections.length || heads.length || dueFrom || dueTo || months !== "0" || minAmount || search);
  // Month: charges falling due in that month (sets the due dates).
  const today = feeToday();
  const monthOptions = monthsSoFar(ctx.session, today);
  const month = monthOptions.find((m) => dueFrom === `${m}-01` && dueTo === (monthEnd(m) > today ? today : monthEnd(m))) ?? "";
  const headText = heads.map((h) => d?.heads.find((x) => x.code === h)?.title ?? h).join(", ");
  const d = q.data;
  const rows = d?.rows ?? [];
  // Families ticked on any page are remembered (the reminder needs their figures).
  const seen = useRef(new Map<string, FeeDefaulter>());
  for (const r of rows) seen.current.set(r.grNo, r);
  const chosen = [...selected].map((k) => seen.current.get(String(k))).filter((r): r is FeeDefaulter => Boolean(r));
  const canSend = canSms && !readOnly;

  const columns: Array<Column<FeeDefaulter>> = [
    {
      key: "student",
      header: "Student",
      render: (r) => (
        <span className="grid">
          <span className="flex items-center gap-2 font-medium">
            {r.studentName}
            {r.enrolment !== "ACTIVE" && (
              <StatusBadge status="neutral" dot={false}>
                Left
              </StatusBadge>
            )}
          </span>
          <span className="text-small text-ink-muted">
            {r.grNo} · {r.father}
            {ctx.campus === "ALL" ? ` · ${r.campusName}` : ""}
          </span>
        </span>
      ),
    },
    { key: "class", header: "Class", width: 72, render: (r) => r.classSection },
    { key: "mobile", header: "Mobile", width: 130, render: (r) => <span className="mtb-num">{formatMobile(r.mobile)}</span> },
    {
      key: "since",
      header: "Overdue since",
      width: 150,
      render: (r) => (
        <span className="grid">
          <span className="mtb-num">{formatDate(r.oldestDue)}</span>
          <span className={`text-small ${r.monthsOverdue >= 3 ? "text-status-overdue-ink" : "text-ink-muted"}`}>
            {r.daysOverdue} days · {r.monthsOverdue} {r.monthsOverdue === 1 ? "month" : "months"}
          </span>
        </span>
      ),
    },
    { key: "session", header: "This session", align: "right", render: (r) => <span className="mtb-num text-ink-muted">{formatRs(r.sessionTotal)}</span> },
    { key: "fees", header: "Overdue fees", align: "right", render: (r) => <span className="grid justify-items-end"><span className="mtb-num">{formatRs(r.outstanding)}</span>{r.previousSessionArrears > 0 && <span className="text-small text-ink-muted">{formatRs(r.previousSessionArrears)} last session</span>}</span> },
    { key: "fine", header: "Late fine", align: "right", render: (r) => <span className="mtb-num">{formatRs(r.fine)}</span> },
    { key: "total", header: "Total today", align: "right", render: (r) => <span className="mtb-num font-semibold">{formatRs(r.total)}</span> },
    { key: "rem", header: "Last reminder", render: (r) => (r.lastReminderAt ? <span className="text-small">{formatDate(r.lastReminderAt)}</span> : <span className="text-small text-ink-subtle">None</span>) },
  ];

  return (
    <RequirePermission permission="fees.reports" page="the defaulters list">
      <Page>
        <PageHeader
          title="Defaulters"
          context={`${campusLabel(ctx.campus)} · Session ${formatSession(ctx.session)} · as of ${formatDate(d?.today ?? today)}`}
          actions={
            <>
              <Button icon="printer" onClick={() => window.print()} disabled={rows.length === 0}>
                {d && d.total > rows.length ? "Print this page" : "Print list"}
              </Button>
              {canSend && (
                <Button variant="primary" icon="send" disabled={chosen.length === 0} onClick={() => setReminding(true)}>
                  {chosen.length ? `Send reminder SMS (${formatCount(chosen.length)})` : "Send reminder SMS"}
                </Button>
              )}
            </>
          }
        />
        <FeesNav />
        {d?.smsPaused && (
          <Banner tone="warning" title="All SMS are paused." actions={<Link to="/sms" className={buttonClassName({ size: "sm" })}>SMS centre</Link>}>
            Reminders can't be sent until an admin resumes SMS. The list is still up to date.
          </Banner>
        )}
        {q.isError && <LoadError what="The defaulters list" error={q.error} onRetry={() => void q.refetch()} />}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Students with overdue fees" icon="students" tone="warning" loading={q.isLoading} value={<AnimatedNumber value={d?.summary.students ?? 0} format={formatCount} />} foot="Matching the filters" />
          <StatCard label="Overdue fees" icon="fees" loading={q.isLoading} value={<AnimatedNumber value={d?.summary.outstanding ?? 0} format={formatRs} />} foot="Not counting late fine" />
          <StatCard label="Late fine to today" icon="clock" loading={q.isLoading} value={<AnimatedNumber value={d?.summary.fine ?? 0} format={formatRs} />} foot="By each campus's rule" />
          <StatCard label="Three months or more" icon="alertCircle" tone={(d?.summary.threePlus ?? 0) > 0 ? "danger" : "neutral"} loading={q.isLoading} value={<AnimatedNumber value={d?.summary.threePlus ?? 0} format={formatCount} />} foot="Call the family" onClick={() => setMonths("3")} />
        </div>

        <DataTable
          caption={`Defaulters, ${campusLabel(ctx.campus)}`}
          columns={columns}
          rows={rows}
          rowKey="grNo"
          loading={q.isLoading}
          selectable={canSend}
          selected={selected}
          onSelectedChange={setSelected}
          isRowSelectable={(r) => Boolean(r.mobile)}
          onRowClick={setOpen}
          toolbar={
            <div className="flex w-full flex-wrap items-end gap-3">
              <div className="w-56">
                <Input aria-label="Search" placeholder="Student, G.R. or father" icon="search" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="w-36">
                <Select
                  aria-label="Class"
                  value={cls}
                  onChange={(e) => {
                    setCls(e.target.value);
                    setSections([]);
                  }}
                  options={[{ value: "", label: "Every class" }, ...classList.options]}
                />
              </div>
              <SectionsPicker cls={cls} value={sections} onChange={setSections} classList={classList} />
              <HeadPicker heads={d?.heads ?? []} value={heads} onChange={setHeads} />
              <div className="w-40">
                <Select
                  aria-label="Month"
                  value={month}
                  onChange={(e) => {
                    const m = e.target.value;
                    if (!m) {
                      setDueFrom(null);
                      setDueTo(null);
                      return;
                    }
                    setDueFrom(`${m}-01`);
                    setDueTo(monthEnd(m) > today ? today : monthEnd(m));
                  }}
                  options={[{ value: "", label: "Any month" }, ...monthOptions.map((m) => ({ value: m, label: monthText(m) }))]}
                />
              </div>
              <div className="w-40">
                <DatePicker aria-label="Due from" placeholder="Due from" value={dueFrom} onValueChange={setDueFrom} today={feeToday()} maxDate={feeToday()} />
              </div>
              <div className="w-40">
                <DatePicker aria-label="Due to" placeholder="Due to" value={dueTo} onValueChange={setDueTo} today={feeToday()} maxDate={feeToday()} error={dueError} />
              </div>
              <Segmented aria-label="Months overdue" value={months} onChange={setMonths} options={[{ value: "0", label: "Any" }, { value: "1", label: "1+ month" }, { value: "2", label: "2+" }, { value: "3", label: "3+" }]} />
              <div className="w-44">
                <AmountInput aria-label="Owing at least" placeholder="Owing at least" value={minAmount} onValueChange={setMinAmount} />
              </div>
              <Switch label="Include students who have left" checked={includeLeft} onChange={(e) => setIncludeLeft(e.target.checked)} />
            </div>
          }
          pagination={d && d.total > 100 ? <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPageChange={setPage} pageSizes={[100, 250, 500]} onPageSizeChange={setPageSize} /> : undefined}
          footer={rows.length ? { student: d && d.total > rows.length ? `${formatCount(rows.length)} on this page` : `${formatCount(rows.length)} students`, session: formatRs(rows.reduce((a, r) => a + r.sessionTotal, 0)), fees: formatRs(rows.reduce((a, r) => a + r.outstanding, 0)), fine: formatRs(rows.reduce((a, r) => a + r.fine, 0)), total: formatRs(rows.reduce((a, r) => a + r.total, 0)) } : undefined}
          empty={<EmptyState icon="checkCircle" title={filtered ? "Nobody matches these filters" : "No overdue fees"} description={filtered ? "Loosen the filters to see more students." : "Every student is up to date. Nice."} />}
        />

        <div className="fees-print-only mtb-print-area fees-print-a4">
          <PaperSize size="A4" />
          <div className="fees-doc" data-theme="light">
            <div className="fees-doc-head">
              <div>
                <h1>Defaulters</h1>
                <p>
                  {campusLabel(ctx.campus)} · Session {formatSession(ctx.session)}
                  {cls && !sections.length ? ` · ${classList.nameOf(cls)}` : ""}
                  {sections.length ? ` · ${sections.join(", ")}` : ""}
                  {headText ? ` · ${headText}` : ""}
                  {dueFrom || dueTo ? ` · due ${dueFrom ? formatDate(dueFrom) : "…"} to ${dueTo ? formatDate(dueTo) : "today"}` : ""}
                  {months !== "0" ? ` · ${months}+ months overdue` : ""}
                  {d && d.total > rows.length ? ` · ${formatCount(rows.length)} of ${formatCount(d.total)} students (page ${d.page})` : ""}
                </p>
              </div>
              <p>As of {formatDate(d?.today ?? today)}</p>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th>G.R. no.</th>
                  <th>Student</th>
                  <th>Father · mobile</th>
                  <th>Since</th>
                  <th className="n">Session</th>
                  <th className="n">Last session</th>
                  <th className="n">Fees</th>
                  <th className="n">Fine</th>
                  <th className="n">Total</th>
                </tr>
              </thead>
              <tbody>
                {[...rows]
                  .sort((a, b) => a.classSection.localeCompare(b.classSection, "en", { numeric: true }))
                  .map((r) => (
                    <tr key={r.grNo}>
                      <td>{r.classSection}</td>
                      <td>{r.grNo}</td>
                      <td>{r.studentName}</td>
                      <td>
                        {r.father} · {formatMobile(r.mobile)}
                      </td>
                      <td>{formatDate(r.oldestDue)}</td>
                      <td className="n">{formatRs(r.sessionTotal)}</td>
                      <td className="n">{r.previousSessionArrears ? formatRs(r.previousSessionArrears) : ""}</td>
                      <td className="n">{formatRs(r.outstanding)}</td>
                      <td className="n">{formatRs(r.fine)}</td>
                      <td className="n">{formatRs(r.total)}</td>
                    </tr>
                  ))}
                <tr>
                  <td colSpan={5}>
                    <strong>{formatCount(rows.length)} students</strong>
                  </td>
                  <td className="n">
                    <strong>{formatRs(rows.reduce((a, r) => a + r.sessionTotal, 0))}</strong>
                  </td>
                  <td className="n">
                    <strong>{formatRs(rows.reduce((a, r) => a + r.previousSessionArrears, 0))}</strong>
                  </td>
                  <td className="n">
                    <strong>{formatRs(rows.reduce((a, r) => a + r.outstanding, 0))}</strong>
                  </td>
                  <td className="n">
                    <strong>{formatRs(rows.reduce((a, r) => a + r.fine, 0))}</strong>
                  </td>
                  <td className="n">
                    <strong>{formatRs(rows.reduce((a, r) => a + r.total, 0))}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {reminding && d && <ReminderModal rows={chosen} template={d.template} paused={d.smsPaused} onClose={() => setReminding(false)} onSent={() => { setReminding(false); setSelected(new Set()); }} />}
        {open && <DefaulterPanel r={open} onClose={() => setOpen(null)} />}
      </Page>
    </RequirePermission>
  );
}
