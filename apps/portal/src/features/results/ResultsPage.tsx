import { portalQueries, type PortalChild, type PortalResult, type PortalResults } from "@mtb/api";
import { formatDate, formatPercent, formatSession } from "@mtb/domain";
import { Button, ColumnChart, EmptyState, Icon, Panel, Segmented, Skeleton, StatCard, StatusBadge } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";
import { DateL, Percent } from "../../app/format";
import { Ltr, useLang } from "../../app/i18n";
import { PageHeader, QueryState } from "../../app/shell/page";
import { useChild } from "../../app/session";

function SubjectList({ r }: { r: PortalResult }) {
  const { t, pick, lang } = useLang();
  return (
    <ul className="m-0 grid list-none gap-0 p-0">
      {r.subjects.map((s, i) => {
        const pct = s.obtained === null ? 0 : Math.round((s.obtained / s.max) * 100);
        return (
          <li key={s.subject} className="mtb-slide-in grid gap-1.5 border-b border-border py-2.5 last:border-b-0" style={{ "--i": i } as CSSProperties}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-ink">{pick(s.subject, s.subjectUr)}</span>
              <span className="flex items-baseline gap-3">
                {s.absent ? (
                  <StatusBadge status="absent" lang={lang}>
                    {t("res.absent")}
                  </StatusBadge>
                ) : (
                  <Ltr className="tabular-nums text-ink">
                    <span className="font-semibold">{s.obtained}</span>
                    <span className="text-ink-muted"> / {s.max}</span>
                  </Ltr>
                )}
                <Ltr className="w-8 text-end font-semibold text-ink">{s.grade}</Ltr>
              </span>
            </div>
            <div className="portal-bar" role="presentation">
              <span style={{ width: `${pct}%`, animationDelay: `${200 + i * 60}ms` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Figures({ r }: { r: PortalResult }) {
  const { t, rich } = useLang();
  const tiles = [
    { key: "marks", label: t("res.marks"), value: <Ltr className="tabular-nums">{`${r.obtained} / ${r.total}`}</Ltr> },
    { key: "pct", label: t("res.percent"), value: <Percent value={r.percent} animate /> },
    { key: "grade", label: t("res.grade"), value: <Ltr>{r.grade}</Ltr> },
    ...(r.position !== undefined ? [{ key: "pos", label: rich("res.position", { cls: <Ltr>{r.classSection}</Ltr> }), value: <Ltr className="tabular-nums">{r.position}</Ltr> }] : []),
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((x, i) => (
        <div key={x.key} className="mtb-rise" style={{ "--i": i + 1 } as CSSProperties}>
          <StatCard label={x.label} value={x.value} />
        </div>
      ))}
    </div>
  );
}

/** The A4 result card that prints (English, light theme), the same figures as on screen. */
function ResultCardDoc({ r, child }: { r: PortalResult; child: PortalChild }) {
  return (
    <div data-theme="light" lang="en" dir="ltr" className="portal-doc portal-resultcard">
      <header className="mb-4 flex items-end justify-between gap-4 border-b-2 border-ink pb-3">
        <div className="grid">
          <span className="text-[20px] leading-6 font-semibold text-brand-ink">MTB</span>
          <span className="font-medium">{child.campusName}</span>
        </div>
        <div className="grid justify-items-end text-right">
          <span className="text-[16px] font-semibold">Result card</span>
          <span>{r.exam}</span>
        </div>
      </header>
      <dl className="m-0 mb-4 grid grid-cols-[auto_1fr_auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-ink-muted">Student</dt>
        <dd className="m-0 font-semibold">
          {child.name}{" "}
          <span lang="ur" dir="rtl" className="urdu-small">
            {child.nameUr}
          </span>
        </dd>
        <dt className="text-ink-muted">G.R. no.</dt>
        <dd className="m-0 font-[family-name:var(--font-mono)]">{child.grNo}</dd>
        <dt className="text-ink-muted">Class</dt>
        <dd className="m-0">{r.classSection}</dd>
        <dt className="text-ink-muted">Session</dt>
        <dd className="m-0">{formatSession(r.session)}</dd>
      </dl>
      <table>
        <thead>
          <tr>
            <th>Subject</th>
            <th className="n">Maximum</th>
            <th className="n">Obtained</th>
            <th className="n">Grade</th>
          </tr>
        </thead>
        <tbody>
          {r.subjects.map((s) => (
            <tr key={s.subject}>
              <td>{s.subject}</td>
              <td className="n">{s.max}</td>
              <td className="n">{s.absent ? "Absent" : s.obtained}</td>
              <td className="n">{s.grade}</td>
            </tr>
          ))}
          <tr>
            <td className="font-semibold">Total</td>
            <td className="n font-semibold">{r.total}</td>
            <td className="n font-semibold">{r.obtained}</td>
            <td className="n font-semibold">{r.grade}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-4 mb-0">
        Percentage <b>{formatPercent(r.percent)}</b> · Grade <b>{r.grade}</b>
        {r.position !== undefined && (
          <>
            {" "}
            · Position <b>{r.position}</b> in {r.classSection}
          </>
        )}
      </p>
      <p className="mt-6 mb-0 text-[8.5pt] text-ink-muted">
        Declared on {formatDate(r.declaredOn)}. Computer-generated from the school's declared results; downloaded from the MTB parent portal.
      </p>
    </div>
  );
}

function Latest({ r, child }: { r: PortalResult; child: PortalChild }) {
  const { t, rich, pick, lang } = useLang();
  return (
    <Panel
      id="res-latest"
      title={t("res.latest")}
      rise={0}
      actions={
        <Button variant="secondary" size="touch" icon="download" onClick={() => window.print()}>
          {t("res.print")}
        </Button>
      }
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="m-0 text-title-2 text-ink">{pick(r.exam, r.examUr)}</h2>
          <StatusBadge status="declared" icon="lock" lang={lang} />
          <span className="text-small text-ink-muted">{rich("res.declaredOn", { date: <DateL value={r.declaredOn} /> })}</span>
        </div>
        <Figures r={r} />
        <SubjectList r={r} />
      </div>
      <div className="portal-print portal-print-a4 portal-print-only">
        <ResultCardDoc r={r} child={child} />
      </div>
    </Panel>
  );
}

function Progress({ all }: { all: PortalResult[] }) {
  const { t, pick } = useLang();
  const [view, setView] = useState<"chart" | "table">("chart");
  const terms = all.filter((r) => r.category === "TERM").sort((a, b) => a.declaredOn.localeCompare(b.declaredOn));
  if (terms.length < 2) return null;
  return (
    <Panel
      id="res-progress"
      title={t("res.progressTitle")}
      description={t("res.progressDesc")}
      rise={1}
      actions={
        <Segmented
          aria-label={t("common.view")}
          value={view}
          onChange={(v) => setView(v as "chart" | "table")}
          options={[
            { value: "chart", label: t("common.chart") },
            { value: "table", label: t("common.table") },
          ]}
        />
      }
    >
      {view === "chart" ? (
        <div dir="ltr">
          <ColumnChart
            data={terms}
            value={(r) => r.percent}
            axisLabel={(r) => `${r.exam.replace(/ \d{4}–\d{2}$/, "").replace("First Term", "1st term")} ${formatSession(r.session).slice(2)}`}
            formatAxis={(v) => `${v}%`}
            tooltip={(r) => (
              <span>
                {pick(r.exam, r.examUr)}: {formatPercent(r.percent)} · {r.grade}
              </span>
            )}
            describe={(r) => `${r.exam}: ${formatPercent(r.percent)}, grade ${r.grade}`}
            label={t("res.chartLabel")}
            height={220}
          />
        </div>
      ) : (
        <div className="mtb-table-wrap">
          <div className="mtb-table-scroll">
            <table className="mtb-table">
              <thead>
                <tr>
                  <th className="text-start">{t("res.colExam")}</th>
                  <th className="text-end">{t("res.percent")}</th>
                  <th className="text-end">{t("res.grade")}</th>
                </tr>
              </thead>
              <tbody>
                {terms.map((r) => (
                  <tr key={r.examId}>
                    <td>{pick(r.exam, r.examUr)}</td>
                    <td className="text-end">
                      <Percent value={r.percent} />
                    </td>
                    <td className="text-end">
                      <Ltr>{r.grade}</Ltr>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Earlier({ list }: { list: PortalResult[] }) {
  const { t, pick } = useLang();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel id="res-earlier" title={t("res.earlierTitle")} rise={2}>
      {list.length === 0 ? (
        <p className="m-0 text-ink-muted">{t("res.earlierNone")}</p>
      ) : (
        <ul className="m-0 grid list-none gap-0 p-0">
          {list.map((r, i) => {
            const expanded = open === r.examId;
            return (
              <li key={r.examId} className="mtb-slide-in border-b border-border py-2 last:border-b-0" style={{ "--i": i } as CSSProperties}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`res-${r.examId}`}
                  onClick={() => setOpen(expanded ? null : r.examId)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-1 text-start hover:bg-surface-hover"
                >
                  <span className="grid min-w-0">
                    <span className="font-medium text-ink">{pick(r.exam, r.examUr)}</span>
                    <span className="text-small text-ink-muted">
                      <DateL value={r.declaredOn} /> · <Ltr>{r.classSection}</Ltr>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <Percent value={r.percent} />
                    <Ltr className="w-8 text-end font-semibold">{r.grade}</Ltr>
                    <Icon name={expanded ? "chevronUp" : "chevronDown"} size={18} className="text-ink-muted" />
                    <span className="mtb-sr-only">{expanded ? t("res.hideSubjects") : t("res.showSubjects")}</span>
                  </span>
                </button>
                {expanded && (
                  <div id={`res-${r.examId}`} className="px-1 pt-1">
                    <SubjectList r={r} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function ResultsBody({ data }: { data: PortalResults }) {
  const { t } = useLang();
  if (!data.latest) {
    return (
      <div className="mtb-card">
        <EmptyState icon="exams" title={t("res.none")} description={t("res.noneDesc")} />
      </div>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6">
      <Latest r={data.latest} child={data.child} />
      <div className="grid content-start gap-4 lg:gap-6">
        <Progress all={[data.latest, ...data.earlier]} />
        <Earlier list={data.earlier} />
      </div>
    </div>
  );
}

/** Results: the latest declared result in full, progress across term exams, and earlier declared results. Drafts never appear. */
export function ResultsPage() {
  const child = useChild()!;
  const { t } = useLang();
  const results = useQuery(portalQueries.results(child.grNo));
  return (
    <div key={child.grNo}>
      <PageHeader title={t("res.title")} description={t("res.desc")} />
      <p className="portal-no-print m-0 mb-4 flex items-start gap-2 text-small text-ink-muted">
        <Icon name="lock" size={16} className="mt-1 shrink-0" />
        {t("res.onlyDeclared")}
      </p>
      <QueryState
        query={results}
        skeleton={
          <div className="mtb-card grid gap-3 p-5" aria-busy="true">
            <Skeleton width={200} />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <StatCard key={i} label="" loading />
              ))}
            </div>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} width="100%" height={28} />
            ))}
          </div>
        }
      >
        {(data) => <ResultsBody data={data} />}
      </QueryState>
    </div>
  );
}
