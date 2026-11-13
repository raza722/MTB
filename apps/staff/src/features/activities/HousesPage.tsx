import {
  activitiesApi,
  activitiesQueries,
  ACTIVITIES_EVENT_KIND_LABEL,
  ACTIVITIES_EVENT_KINDS,
  ACTIVITIES_POINTS_CATEGORY_LABEL,
  type ActivitiesEventKind,
  type ActivitiesHouse,
  type ActivitiesHouseMember,
  type ActivitiesHouseTone,
  type ActivitiesPointsCategory,
  type ActivitiesPointsEntry,
  type ActivitiesSportsList,
} from "@mtb/api";
import { formatCount, formatDate, formatSession } from "@mtb/domain";
import {
  AnimatedNumber,
  Banner,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  DatePicker,
  EmptyState,
  Input,
  Modal,
  Pagination,
  Panel,
  Segmented,
  Select,
  SidePanel,
  Skeleton,
  Sparkline,
  StatusBadge,
  Switch,
  TabPanel,
  Tabs,
  Textarea,
  Urdu,
  useToast,
  type Column,
} from "@mtb/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState, type CSSProperties } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader, RequireSingleCampus } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { SportsListDoc } from "./print";
import { ActivitiesNav, BarList, dateLimits, DocPreview, errorField, errorText, HouseTag, houseColor, LoadError, plural, PrintLayer, stagger, useRefresh, useSessionDays, useToday, ViewToggle } from "./shared";

export type HousesTab = "standings" | "members";
const CATEGORIES = Object.keys(ACTIVITIES_POINTS_CATEGORY_LABEL) as ActivitiesPointsCategory[];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Houses belong to one campus: with "All campuses" selected, ask for a campus first. */
export function HousesScreen(props: { tab: HousesTab; onTab: (t: HousesTab) => void }) {
  const { campus } = useCtx();
  if (campus === "ALL")
    return (
      <Page>
        <PageHeader title="Houses" />
        <ActivitiesNav />
        <RequireSingleCampus action="houses">{null}</RequireSingleCampus>
      </Page>
    );
  return <HousesPage {...props} />;
}

/** Houses of one campus: standings and the points table, members, house masters and captains. */
export function HousesPage({ tab, onTab }: { tab: HousesTab; onTab: (t: HousesTab) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("activities.manage") && !readOnly;
  const view = useQuery(activitiesQueries.houses(ctx));
  const [points, setPoints] = useState(false);
  // null = closed, "new" = add a house.
  const [editing, setEditing] = useState<ActivitiesHouse | "new" | null>(null);
  const v = view.data;
  const all = v?.houses ?? [];
  // Retired houses keep their history but leave the standings, moves and sharing out.
  const houses = all.filter((h) => h.active !== false).sort((a, b) => a.rank - b.rank);
  const retired = all.filter((h) => h.active === false);

  return (
    <Page>
      <PageHeader
        title="Houses"
        actions={
          canManage ? (
            <>
              <Button icon="flag" onClick={() => setEditing("new")}>
                Add house
              </Button>
              <Button variant="primary" icon="plus" onClick={() => setPoints(true)} disabled={houses.length === 0}>
                Add or deduct points
              </Button>
            </>
          ) : undefined
        }
      />
      <ActivitiesNav />
      {view.isError && <LoadError what="Houses" error={view.error} onRetry={() => void view.refetch()} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {view.isLoading
          ? [0, 1, 2, 3].map((i) => <Skeleton key={i} height={210} />)
          : houses.map((h, i) => (
              <article key={h.id} className="act-house mtb-rise" style={{ ...stagger(i), "--house": houseColor(h.tone) } as CSSProperties} aria-label={`${h.name}, rank ${h.rank}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="grid">
                    <h2 className="m-0 text-title-3">{h.name}</h2>
                    <Urdu size="small">{h.nameUrdu}</Urdu>
                  </div>
                  <span className="act-house-rank" title={`Rank ${h.rank}`}>
                    {h.rank}
                  </span>
                </div>
                <div>
                  <span className="act-house-points">
                    <AnimatedNumber value={h.points} format={formatCount} />
                  </span>{" "}
                  <span className="text-small text-ink-muted">points</span>
                </div>
                {(v?.monthly.length ?? 0) > 1 && (
                  <Sparkline values={(v?.monthly ?? []).map((m) => m.totals[h.id] ?? 0)} label={`${h.name} points by month: ${(v?.monthly ?? []).map((m) => m.totals[h.id] ?? 0).join(", ")}`} height={36} />
                )}
                <p className="m-0 text-small text-ink-muted">
                  {formatCount(h.members)} students · {plural(h.eventWins, "first place")}
                </p>
                <dl className="m-0 grid gap-0.5 text-small">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-muted">House master</dt>
                    <dd className="m-0 text-right">{h.houseMaster || "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-muted">Captain</dt>
                    <dd className="m-0 truncate text-right">{h.captain ? `${h.captain.name} (${h.captain.classSection})` : "—"}</dd>
                  </div>
                </dl>
                {h.motto && <p className="m-0 text-small italic text-ink-muted">“{h.motto}”</p>}
                {canManage && (
                  <Button size="sm" variant="quiet" icon="edit" onClick={() => setEditing(h)}>
                    Edit house
                  </Button>
                )}
              </article>
            ))}
      </div>
      {!view.isLoading && houses.length === 0 && !view.isError && (
        <div className="mtb-card">
          <EmptyState icon="flag" title="No houses in use at this campus" description={canManage ? "Add a house to start sharing students out and keeping points." : "Ask the activities in-charge to add the houses."} {...(canManage ? { action: <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>Add house</Button> } : {})} />
        </div>
      )}
      {retired.length > 0 && (
        <p className="m-0 flex flex-wrap items-center gap-2 text-small text-ink-muted">
          Out of use (kept in the history):
          {retired.map((h) =>
            canManage ? (
              <Button key={h.id} size="sm" variant="ghost" onClick={() => setEditing(h)}>
                <HouseTag name={h.name} tone={h.tone} />
              </Button>
            ) : (
              <HouseTag key={h.id} name={h.name} tone={h.tone} />
            ),
          )}
        </p>
      )}

      <Tabs
        aria-label="Houses sections"
        idPrefix="houses-"
        value={tab}
        onChange={(t) => onTab(t as HousesTab)}
        tabs={[
          { id: "standings", label: "Standings and points", icon: "trendUp" },
          { id: "members", label: "Members", icon: "students", ...(v?.unassigned ? { count: v.unassigned } : {}) },
        ]}
      />
      <TabPanel id={tab} idPrefix="houses-" active>
        {tab === "standings" ? <Standings loading={view.isLoading} houses={houses} ledger={v?.ledger ?? []} monthly={v?.monthly ?? []} /> : <Members houses={houses} unassigned={v?.unassigned ?? 0} canManage={canManage} />}
      </TabPanel>

      {points && <PointsPanel houses={houses} onClose={() => setPoints(false)} />}
      {editing && <HousePanel house={editing === "new" ? null : editing} taken={all.map((h) => h.name)} onClose={() => setEditing(null)} />}
    </Page>
  );
}

// ------------------------------------------------------------------ Standings and ledger

function Standings({ loading, houses, ledger, monthly }: { loading: boolean; houses: ActivitiesHouse[]; ledger: ActivitiesPointsEntry[]; monthly: Array<{ month: string; totals: Record<string, number> }> }) {
  const ctx = useCtx();
  const [view, setView] = useState<"chart" | "table">("chart");
  const [house, setHouse] = useState("");
  const [cat, setCat] = useState("");
  const [page, setPage] = useState(1);
  const rows = ledger.filter((p) => (!house || p.houseId === house) && (!cat || p.category === cat));
  const pageSize = 15;
  const tone = (id: string) => houses.find((h) => h.id === id)?.tone;
  const columns: Array<Column<ActivitiesPointsEntry>> = [
    { key: "date", header: "Date", width: 120, render: (p) => <span className="mtb-num">{formatDate(p.date)}</span> },
    { key: "house", header: "House", width: 170, render: (p) => <HouseTag name={p.houseName} tone={tone(p.houseId)} /> },
    { key: "reason", header: "For", render: (p) => p.reason },
    { key: "cat", header: "Kind", width: 170, render: (p) => <span className="text-small text-ink-muted">{ACTIVITIES_POINTS_CATEGORY_LABEL[p.category]}</span> },
    { key: "by", header: "By", width: 160, render: (p) => <span className="text-small">{p.by}</span> },
    { key: "points", header: "Points", align: "right", width: 90, render: (p) => <span className={`mtb-num font-semibold ${p.points < 0 ? "text-danger-ink" : ""}`}>{p.points > 0 ? `+${p.points}` : p.points}</span> },
  ];
  return (
    <div className="grid gap-6">
      <Panel id="standings" title="Standings" description={`Points this session, ${campusLabel(ctx.campus)} · session ${formatSession(ctx.session)}`} rise={1} actions={<ViewToggle value={view} onChange={setView} label="Standings view" />}>
        {loading ? (
          <Skeleton height={160} />
        ) : houses.length === 0 ? (
          <EmptyState icon="flag" title="No houses at this campus" />
        ) : view === "chart" ? (
          <BarList label="House points" format={formatCount} rows={houses.map((h) => ({ key: h.id, label: `${h.rank}. ${h.name}`, value: h.points, color: houseColor(h.tone), note: plural(h.eventWins, "first place") }))} />
        ) : (
          <div className="overflow-auto">
            <table className="mtb-table mtb-table-dense">
              <caption className="mtb-sr-only">Running points total at the end of each month</caption>
              <thead>
                <tr>
                  <th>House</th>
                  {monthly.map((m) => (
                    <th key={m.month} className="mtb-th-num">
                      {MONTHS[Number(m.month.slice(5)) - 1]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {houses.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <HouseTag name={h.name} tone={h.tone} />
                    </td>
                    {monthly.map((m) => (
                      <td key={m.month} className="mtb-td-num">
                        <span className="mtb-num">{formatCount(m.totals[h.id] ?? 0)}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m-0 mt-2 text-small text-ink-muted">Running total at the end of each month.</p>
          </div>
        )}
      </Panel>
      <Panel id="ledger" title="Points table" description="Every addition and deduction, newest first. Event results post their points automatically." rise={2} flush>
        <DataTable
          caption="House points table"
          columns={columns}
          rows={rows.slice((page - 1) * pageSize, page * pageSize)}
          loading={loading}
          density="dense"
          toolbar={
            <div className="flex flex-wrap gap-3">
              <div className="w-52">
                <Select aria-label="House" value={house} onChange={(e) => (setHouse(e.target.value), setPage(1))} options={[{ value: "", label: "Every house" }, ...houses.map((h) => ({ value: h.id, label: h.name }))]} />
              </div>
              <div className="w-60">
                <Select aria-label="Kind" value={cat} onChange={(e) => (setCat(e.target.value), setPage(1))} options={[{ value: "", label: "Every kind" }, ...CATEGORIES.map((c) => ({ value: c, label: ACTIVITIES_POINTS_CATEGORY_LABEL[c] }))]} />
              </div>
            </div>
          }
          pagination={rows.length > pageSize ? <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} /> : undefined}
          empty={<EmptyState icon="trendUp" title="No points yet" description="Points appear here as events are held and the house masters add them." />}
        />
      </Panel>
    </div>
  );
}

const pointsSchema = z.object({
  houseId: z.string().min(1, "Choose the house."),
  points: z.number({ error: "Enter the points." }).int("Whole points only.").min(-50, "No more than 50 can be deducted at once.").max(100, "No more than 100 at once.").refine((v) => v !== 0, "Points can't be 0."),
  reason: z.string().trim().min(5, "Say what the points are for."),
  date: z.string({ error: "Choose the date." }).min(1, "Choose the date."),
});

function PointsPanel({ houses, onClose }: { houses: ActivitiesHouse[]; onClose: () => void }) {
  const ctx = useCtx();
  const today = useToday();
  const { starts } = useSessionDays();
  const toast = useToast();
  const refresh = useRefresh();
  const [f, setF] = useState({ houseId: houses[0]?.id ?? "", points: "", deduct: false, category: "CONDUCT" as ActivitiesPointsCategory, reason: "", date: today as string | null });
  const [tried, setTried] = useState(false);
  const signed = f.points === "" ? undefined : (f.deduct ? -1 : 1) * Number(f.points);
  const check = pointsSchema.safeParse({ houseId: f.houseId, points: signed, reason: f.reason, date: f.date ?? "" });
  const errs: Record<string, string> = check.success ? {} : Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message]));
  const save = useMutation({
    mutationFn: () => activitiesApi.addPoints(ctx, { houseId: f.houseId, points: signed!, category: f.category, reason: f.reason.trim(), date: f.date! }),
    onSuccess: (p) => {
      refresh();
      toast({ title: p.points > 0 ? "Points added" : "Points deducted", message: `${p.houseName}: ${p.points > 0 ? "+" : ""}${p.points} · ${p.reason}` });
      onClose();
    },
  });
  const sf = save.isError ? errorField(save.error) : undefined;
  const err = (k: string) => (tried ? errs[k] : undefined) ?? (sf === k ? errorText(save.error) : undefined);
  return (
    <SidePanel
      open
      onClose={onClose}
      title="Add or deduct house points"
      description="For conduct, cleanliness, academics or discipline. Event results add their own points."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (check.success) save.mutate();
            }}
          >
            {f.deduct ? "Deduct points" : "Add points"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1">
          <span className="mtb-label">House</span>
          <Segmented aria-label="House" value={f.houseId} onChange={(v) => setF({ ...f, houseId: v })} options={houses.map((h) => ({ value: h.id, label: h.name.replace(" House", "") }))} />
        </div>
        <Segmented
          aria-label="Add or deduct"
          value={f.deduct ? "deduct" : "add"}
          onChange={(v) => setF({ ...f, deduct: v === "deduct", category: v === "deduct" ? "DISCIPLINE" : f.category })}
          options={[
            { value: "add", label: "Add" },
            { value: "deduct", label: "Deduct" },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Points" required inputMode="numeric" amount value={f.points} onChange={(e) => setF({ ...f, points: e.target.value.replace(/\D/g, "") })} error={err("points")} />
          <DatePicker label="Date" required value={f.date} onValueChange={(d) => setF({ ...f, date: d })} {...dateLimits(starts, today)} today={today} error={err("date")} />
        </div>
        <Select label="Kind" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ActivitiesPointsCategory })} options={CATEGORIES.filter((c) => c !== "EVENT").map((c) => ({ value: c, label: ACTIVITIES_POINTS_CATEGORY_LABEL[c] }))} />
        <Textarea label="What for" required rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} error={err("reason")} placeholder={f.deduct ? "For example: late arrivals at assembly, week of 2-Nov." : "For example: cleanest classrooms, October."} />
        {save.isError && !sf && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

const TONES: ActivitiesHouseTone[] = [1, 2, 3, 4];

const houseSchema = z.object({
  name: z.string().trim().min(3, "Give the house a name of at least 3 characters.").max(40, "Keep the name under 40 characters."),
  nameUrdu: z.string().trim().max(40, "Keep the Urdu name under 40 characters."),
  houseMaster: z.string().trim().min(3, "Name the house master."),
  motto: z.string().max(60, "Keep the motto under 60 characters."),
});

/** Add a house, or edit one: its name and Urdu name, colour, masters and captains, and whether it is in use. */
function HousePanel({ house, taken, onClose }: { house: ActivitiesHouse | null; taken: string[]; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const refresh = useRefresh();
  const isNew = house === null;
  const members = useQuery({ ...activitiesQueries.members(ctx, { houseId: house?.id ?? "" }), enabled: !isNew });
  const seniors = (members.data ?? []).filter((m) => Number(m.classSection.split("-")[0]) >= 8).sort((a, b) => b.classSection.localeCompare(a.classSection) || a.name.localeCompare(b.name));
  const [f, setF] = useState({
    name: house?.name ?? "",
    nameUrdu: house?.nameUrdu ?? "",
    tone: (house?.tone ?? 1) as ActivitiesHouseTone,
    active: house?.active !== false,
    // Migrated houses have no house master ("—"): one is named when the house is first edited.
    houseMaster: house && house.houseMaster !== "—" ? house.houseMaster : "",
    assistantMaster: house?.assistantMaster ?? "",
    captainId: house?.captain?.id ?? "",
    viceCaptainId: house?.viceCaptain?.id ?? "",
    motto: house?.motto ?? "",
  });
  const [tried, setTried] = useState(false);
  const parsed = houseSchema.safeParse(f);
  const errs: Record<string, string> = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
  if (!errs.name && taken.some((n) => n.toLowerCase() === f.name.trim().toLowerCase() && n.toLowerCase() !== (house?.name ?? "").toLowerCase())) errs.name = "Another house at this campus has this name.";
  if (f.captainId && f.captainId === f.viceCaptainId) errs.viceCaptainId = "Choose a different student from the captain.";
  const retiring = !isNew && house.active !== false && !f.active;
  if (retiring && (house?.members ?? 0) > 0) errs.active = `Move its ${plural(house!.members, "student")} to other houses first.`;
  const save = useMutation({
    mutationFn: () =>
      isNew
        ? activitiesApi.createHouse(ctx, { name: f.name.trim(), nameUrdu: f.nameUrdu.trim(), tone: f.tone, motto: f.motto.trim(), houseMaster: f.houseMaster.trim(), assistantMaster: f.assistantMaster.trim() || null })
        : activitiesApi.saveHouse(house.id, {
            name: f.name.trim(),
            nameUrdu: f.nameUrdu.trim(),
            tone: f.tone,
            active: f.active,
            houseMaster: f.houseMaster.trim(),
            assistantMaster: f.assistantMaster.trim() || null,
            captainId: f.active ? f.captainId || null : null,
            viceCaptainId: f.active ? f.viceCaptainId || null : null,
            motto: f.motto.trim(),
          }),
    onSuccess: (h) => {
      refresh();
      toast(isNew ? { title: `${h.name} added`, message: "Move students into it from the Members tab, or share out new students." } : { title: `${h.name} saved`, ...(retiring ? { message: "It is out of use now. Its points stay in the history." } : {}) });
      onClose();
    },
  });
  const options = [{ value: "", label: "None" }, ...seniors.map((m) => ({ value: m.id, label: `${m.name} · ${m.classSection}` }))];
  const sf = save.isError ? errorField(save.error) : undefined;
  const err = (k: string) => (tried ? errs[k] : undefined) ?? (sf === k ? errorText(save.error) : undefined);
  return (
    <SidePanel
      open
      onClose={onClose}
      title={isNew ? "Add a house" : `Edit ${house.name}`}
      description={isNew ? `A new house at ${campusLabel(ctx.campus)}. Students are moved into it from the Members tab.` : "Name, colour, house masters and captains. The captain and vice-captain are chosen from the house's students in Classes 8–10."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (Object.keys(errs).length === 0) save.mutate();
            }}
          >
            {isNew ? "Add house" : "Save"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="For example: Quaid House" error={err("name")} />
          <Input label="Urdu name" urdu value={f.nameUrdu} onChange={(e) => setF({ ...f, nameUrdu: e.target.value })} error={err("nameUrdu")} />
        </div>
        <div className="grid gap-1">
          <span className="mtb-label">Colour</span>
          <Segmented
            aria-label="Colour"
            value={String(f.tone)}
            onChange={(v) => setF({ ...f, tone: Number(v) as ActivitiesHouseTone })}
            options={TONES.map((t) => ({ value: String(t), label: <span className="inline-flex items-center gap-1.5"><span className="mtb-chart-key" style={{ background: houseColor(t) }} aria-hidden="true" />{`Colour ${t}`}</span> }))}
          />
          <span className="text-small text-ink-muted">Used in charts and tags. The house name is always shown with it.</span>
        </div>
        <Input label="House master" required value={f.houseMaster} onChange={(e) => setF({ ...f, houseMaster: e.target.value })} error={err("houseMaster")} />
        <Input label="Assistant house master" value={f.assistantMaster} onChange={(e) => setF({ ...f, assistantMaster: e.target.value })} />
        {!isNew && f.active && (
          <>
            <Select label="Captain" value={f.captainId} onChange={(e) => setF({ ...f, captainId: e.target.value })} options={members.isLoading ? [{ value: f.captainId, label: house.captain?.name ?? "Loading…" }] : options} error={err("captainId")} />
            <Select label="Vice-captain" value={f.viceCaptainId} onChange={(e) => setF({ ...f, viceCaptainId: e.target.value })} options={members.isLoading ? [{ value: f.viceCaptainId, label: house.viceCaptain?.name ?? "Loading…" }] : options} error={err("viceCaptainId")} />
          </>
        )}
        <Input label="Motto" value={f.motto} onChange={(e) => setF({ ...f, motto: e.target.value })} error={err("motto")} />
        {!isNew && (
          <div className="grid gap-1">
            <Switch label="In use" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            <span className={`text-small ${err("active") ? "text-danger-ink" : "text-ink-muted"}`}>{err("active") ?? (f.active ? "Shown in the standings and open for points and moves." : "Out of use: left out of the standings, points and moves. Its history stays.")}</span>
          </div>
        )}
        {save.isError && !sf && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

// ------------------------------------------------------------------ Members

function Members({ houses, unassigned, canManage }: { houses: ActivitiesHouse[]; unassigned: number; canManage: boolean }) {
  const ctx = useCtx();
  const today = useToday();
  const { starts } = useSessionDays();
  const toast = useToast();
  const refresh = useRefresh();
  const [house, setHouse] = useState("");
  const [cls, setCls] = useState("");
  const [q, setQ] = useState("");
  const term = useDeferredValue(q.trim());
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<unknown>>(new Set());
  const [move, setMove] = useState<{ to: string; reason: string; since: string | null } | null>(null);
  const [removing, setRemoving] = useState<{ leftOn: string | null; reason: string } | null>(null);
  const [removeTried, setRemoveTried] = useState(false);
  const [auto, setAuto] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const all = useQuery(activitiesQueries.members(ctx, {}));
  const list = (all.data ?? []).filter((m) => (house === "" || (house === "NONE" ? m.houseId === null : m.houseId === house)) && (!cls || m.classSection === cls) && (!term || `${m.name} ${m.id} ${m.father}`.toLowerCase().includes(term.toLowerCase())));
  const sections = [...new Set((all.data ?? []).map((m) => m.classSection))];
  const pageSize = 25;
  const tone = (id: string | null) => houses.find((h) => h.id === id)?.tone;

  const moveMut = useMutation({
    mutationFn: () => activitiesApi.assignHouse(ctx, { studentIds: [...selected] as string[], houseId: move!.to, reason: move!.reason, ...(move!.since ? { since: move!.since } : {}) }),
    onSuccess: (r) => {
      refresh();
      setMove(null);
      setSelected(new Set());
      toast({ title: `${plural(r.moved, "student")} moved`, message: `Now in ${houses.find((h) => h.id === move?.to)?.name ?? "the house"}. Their house history keeps the old house.` });
    },
  });
  const removeMut = useMutation({
    mutationFn: () => activitiesApi.removeFromHouse(ctx, { studentIds: [...selected] as string[], leftOn: removing!.leftOn!, reason: removing!.reason.trim() }),
    onSuccess: (r) => {
      refresh();
      setRemoving(null);
      setSelected(new Set());
      toast({ title: `${plural(r.removed, "student")} taken out of their house`, message: "Their house history keeps the dates. Put them in a house again at any time." });
    },
  });
  const removeErr = removing && (!removing.leftOn ? "Choose the date they left the house." : removing.reason.trim().length < 3 ? "Say why, in a few words." : null);
  const autoMut = useMutation({
    mutationFn: () => activitiesApi.autoAssign(ctx),
    onSuccess: (r) => {
      refresh();
      setAuto(false);
      toast({ title: `${plural(r.assigned, "student")} put in houses`, message: Object.entries(r.byHouse).map(([k, v]) => `${k} ${v}`).join(" · ") });
    },
  });

  const columns: Array<Column<ActivitiesHouseMember>> = [
    {
      key: "name",
      header: "Student",
      render: (m) => (
        <span className="grid">
          <span className="mtb-cell-primary">{m.name}</span>
          <span className="mtb-cell-secondary">
            <span className="mtb-num">{m.id}</span> · {m.father}
          </span>
        </span>
      ),
    },
    { key: "class", header: "Class", width: 100, render: (m) => m.classSection },
    { key: "house", header: "House", width: 200, render: (m) => <HouseTag name={m.houseName} tone={tone(m.houseId)} /> },
    { key: "since", header: "Since", width: 130, render: (m) => (m.since ? <span className="mtb-num">{formatDate(m.since)}</span> : "—") },
    { key: "role", header: "Role", width: 140, render: (m) => (m.role ? <StatusBadge status="brand" dot={false}>{m.role === "CAPTAIN" ? "Captain" : "Vice-captain"}</StatusBadge> : null) },
  ];

  return (
    <div className="grid gap-4">
      {unassigned > 0 && (
        <Banner
          tone="warning"
          title={`${plural(unassigned, "student")} not in a house`}
          actions={
            canManage ? (
              <Button size="sm" variant="primary" onClick={() => setAuto(true)}>
                Put them in houses
              </Button>
            ) : undefined
          }
        >
          Mostly this session's new admissions. The system shares them out so each house gets a fair number from every class.
        </Banner>
      )}
      <DataTable
        caption="House members"
        columns={columns}
        rows={list.slice((page - 1) * pageSize, page * pageSize)}
        loading={all.isLoading}
        density="dense"
        selectable={canManage}
        selected={selected}
        onSelectedChange={setSelected}
        toolbar={
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-56">
                <Input aria-label="Search students" icon="search" placeholder="Name or G.R. number" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
              </div>
              <div className="w-48">
                <Select aria-label="House" value={house} onChange={(e) => (setHouse(e.target.value), setPage(1))} options={[{ value: "", label: "Every house" }, ...houses.map((h) => ({ value: h.id, label: h.name })), { value: "NONE", label: "Not in a house" }]} />
              </div>
              <div className="w-36">
                <Select aria-label="Class" value={cls} onChange={(e) => (setCls(e.target.value), setPage(1))} options={[{ value: "", label: "Every class" }, ...sections.map((s) => ({ value: s, label: s }))]} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button icon="printer" onClick={() => setListOpen(true)} disabled={houses.length === 0}>
                Print sports list
              </Button>
              {canManage && (
                <>
                  <Button icon="x" disabled={selected.size === 0} onClick={() => {
                      setRemoveTried(false);
                      setRemoving({ leftOn: today, reason: "" });
                    }}>
                    Remove from house
                  </Button>
                  <Button icon="arrowRight" disabled={selected.size === 0 || houses.length === 0} onClick={() => setMove({ to: houses[0]?.id ?? "", reason: "", since: today })}>
                    Move {selected.size || ""} to a house
                  </Button>
                </>
              )}
            </div>
          </>
        }
        pagination={list.length > pageSize ? <Pagination page={page} pageSize={pageSize} total={list.length} onPageChange={setPage} /> : undefined}
        empty={<EmptyState icon="students" title="No students match" description="Clear the search or choose another house or class." />}
      />
      <ConfirmDialog
        open={move !== null}
        onClose={() => setMove(null)}
        onConfirm={() => move && move.to && moveMut.mutate()}
        title={`Move ${plural(selected.size, "student")}?`}
        message="Their house history keeps the old house up to the day before the move, so past points stay with it."
        confirmLabel="Move students"
        loading={moveMut.isPending}
        error={moveMut.isError ? errorText(moveMut.error) : undefined}
      >
        <div className="grid gap-3">
          <Select label="To house" value={move?.to ?? ""} onChange={(e) => setMove((m) => (m ? { ...m, to: e.target.value } : m))} options={houses.map((h) => ({ value: h.id, label: h.name }))} />
          <DatePicker label="From" value={move?.since ?? null} onValueChange={(d) => setMove((m) => (m ? { ...m, since: d } : m))} {...dateLimits(starts, today)} today={today} help="The day the move counts from. Not before the session started." />
          <Input label="Reason" value={move?.reason ?? ""} onChange={(e) => setMove((m) => (m ? { ...m, reason: e.target.value } : m))} placeholder="Optional: section change, sibling in the same house…" />
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          setRemoveTried(true);
          if (!removeErr) removeMut.mutate();
        }}
        tone="danger"
        title={`Take ${plural(selected.size, "student")} out of their house?`}
        message="They will have no house until they are put in one again. Their house history keeps the dates."
        confirmLabel="Remove from house"
        loading={removeMut.isPending}
        error={removeMut.isError ? errorText(removeMut.error) : undefined}
      >
        <div className="grid gap-3">
          <DatePicker label="Left the house on" value={removing?.leftOn ?? null} onValueChange={(d) => setRemoving((r) => (r ? { ...r, leftOn: d } : r))} {...dateLimits(starts, today)} today={today} {...(removeTried && removing && !removing.leftOn ? { error: "Choose the date they left the house." } : {})} />
          <Input label="Reason" required value={removing?.reason ?? ""} onChange={(e) => setRemoving((r) => (r ? { ...r, reason: e.target.value } : r))} placeholder="For example: left the school, medical exemption" {...(removeTried && removing && removing.reason.trim().length < 3 ? { error: "Say why, in a few words." } : {})} />
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={auto}
        onClose={() => setAuto(false)}
        onConfirm={() => autoMut.mutate()}
        title={`Put ${plural(unassigned, "student")} in houses?`}
        message="Each student goes to the house with the fewest members from their class, so the houses stay balanced. You can move anyone afterwards."
        confirmLabel="Share them out"
        loading={autoMut.isPending}
        error={autoMut.isError ? errorText(autoMut.error) : undefined}
      />
      {listOpen && <SportsListDialog houses={houses} sections={sections} initialHouse={house} initialClass={cls} onClose={() => setListOpen(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------ Sports list (print)

const listTitle = (kind: ActivitiesEventKind | ""): [string, string] =>
  kind === "SPORTS" ? ["Sports list", "کھیلوں کی فہرست"] : kind === "" ? ["Activities list", "ہم نصابی سرگرمیوں کی فہرست"] : [`${ACTIVITIES_EVENT_KIND_LABEL[kind]} list`, "شرکاء کی فہرست"];

/**
 * The session's sports list (legacy Reports_SportsList): pick a house (or every house), a class and the kind of event,
 * check the preview, then print it on A4 — names by house, then by event item, with the part played and the place.
 * "Whole house" adds the students who took no part, as the legacy list (a full house roster) did.
 */
function SportsListDialog({
  houses,
  sections,
  initialHouse,
  initialClass,
  onClose,
}: {
  houses: ActivitiesHouse[];
  sections: string[];
  initialHouse: string;
  initialClass: string;
  onClose: () => void;
}) {
  const ctx = useCtx();
  const toast = useToast();
  const [houseId, setHouseId] = useState(initialHouse);
  // Several classes at once (the old list took one); none ticked means every class.
  const [classSections, setClassSections] = useState<string[]>(initialClass ? [initialClass] : []);
  const [kind, setKind] = useState<ActivitiesEventKind | "">("");
  const [everyone, setEveryone] = useState(false);
  const [printing, setPrinting] = useState<ActivitiesSportsList | null>(null);
  const list = useQuery(activitiesQueries.sportsList(ctx, { houseId, kind, classSections, everyone }));
  const toggleClass = (cs: string) => setClassSections((x) => (x.includes(cs) ? x.filter((y) => y !== cs) : [...x, cs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))));
  const classText = classSections.length === 0 ? "" : classSections.length === 1 ? `Class ${classSections[0]}` : `Classes ${classSections.join(", ")}`;
  const data = list.data;
  const [title, titleUr] = listTitle(kind);
  const houseLabel = houseId === "" ? "Every house" : houseId === "NONE" ? "Students not in a house" : (houses.find((h) => h.id === houseId)?.name ?? "House");
  const kindLabel = kind === "" ? "every activity" : ACTIVITIES_EVENT_KIND_LABEL[kind].toLowerCase();
  const heading = `${houseLabel}${classText ? ` · ${classText}` : ""} · ${kindLabel} · ${campusLabel(ctx.campus)}`;
  const note = data
    ? `From ${plural(data.events, "event")} this session, in date order. Cancelled events are left out. A blank place means no place was won, or the result is not recorded yet.${everyone ? " Students who took no part are listed at the end of each house." : ""}`
    : undefined;
  const took = new Set((data?.rows ?? []).map((r) => r.studentId)).size;
  const empty = !data || data.rows.length + data.idle.length === 0;
  const doc = (d: ActivitiesSportsList) =>
    ctx.campus === "ALL" ? null : (
      <SportsListDoc
        campus={ctx.campus}
        session={d.session}
        title={title}
        titleUr={titleUr}
        heading={heading}
        {...(note ? { note } : {})}
        rows={d.rows}
        idle={d.idle}
        signs={["Sports in charge", "House masters", "Principal"]}
      />
    );

  return (
    <>
      <Modal
        open={printing === null}
        onClose={onClose}
        size="lg"
        title="Print the sports list"
        description={`Who took part in the session's events, house by house, with the item and the place won. Session ${formatSession(ctx.session)}.`}
        footerSplit
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              icon="printer"
              disabled={empty}
              loading={list.isFetching && !data}
              onClick={() => {
                if (!data) return;
                setPrinting(data);
                toast({ tone: "info", title: `${title} sent to the printer`, message: `${heading} · ${plural(took + data.idle.length, "student")}` });
              }}
            >
              Print list
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="House"
              value={houseId}
              onChange={(e) => setHouseId(e.target.value)}
              options={[{ value: "", label: "Every house" }, ...houses.map((h) => ({ value: h.id, label: h.name })), { value: "NONE", label: "Not in a house" }]}
            />
            <Select
              label="Events"
              value={kind}
              onChange={(e) => setKind(e.target.value as ActivitiesEventKind | "")}
              options={[{ value: "", label: "Every activity" }, ...ACTIVITIES_EVENT_KINDS.map((k) => ({ value: k, label: ACTIVITIES_EVENT_KIND_LABEL[k] }))]}
            />
          </div>
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mtb-label mb-1 flex w-full items-center justify-between gap-2">
              <span>Classes {classSections.length ? `(${classSections.length} ticked)` : "(every class)"}</span>
              {classSections.length > 0 && (
                <Button size="sm" variant="quiet" onClick={() => setClassSections([])}>
                  Every class
                </Button>
              )}
            </legend>
            <div className="act-chips">
              {sections.map((s) => (
                <button key={s} type="button" className="act-chip" aria-pressed={classSections.includes(s)} onClick={() => toggleClass(s)}>
                  {s}
                </button>
              ))}
            </div>
          </fieldset>
          <Checkbox label="Whole house: also list students who took no part" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />
          {list.isError ? (
            <LoadError what="The sports list" error={list.error} onRetry={() => void list.refetch()} />
          ) : !data ? (
            <Skeleton height={260} />
          ) : empty ? (
            <div className="mtb-card">
              <EmptyState
                icon="flag"
                title="No names to print"
                description={`Nobody from ${houseId === "" ? "any house" : houseLabel}${classText ? ` in ${classText}` : ""} has been entered for ${kindLabel} this session. Choose another house or class, or every activity.`}
              />
            </div>
          ) : (
            <>
              <p className="m-0 text-small text-ink-muted" aria-live="polite">
                {plural(took, "student")} took part · {plural(data.rows.length, "entry", "entries")} from {plural(data.events, "event")}
                {everyone ? ` · ${plural(data.idle.length, "student")} took no part` : ""}
              </p>
              <div className="max-h-[380px] overflow-auto rounded-lg">
                <DocPreview zoom={0.42} label={`${title} preview`}>
                  {doc(data)}
                </DocPreview>
              </div>
            </>
          )}
        </div>
      </Modal>
      {printing && (
        <PrintLayer
          paper="A4"
          onDone={() => {
            setPrinting(null);
            onClose();
          }}
        >
          {doc(printing)}
        </PrintLayer>
      )}
    </>
  );
}
