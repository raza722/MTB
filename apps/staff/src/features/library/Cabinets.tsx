// Library › Cabinets and shelves: the cabinets of each library as compact cards or as a list.
// Shelves are small tiles; a cabinet with many shelves scrolls inside its card instead of stretching the page.
import type { LibraryCabinet, LibraryLibrary, LibraryShelf } from "@mtb/api";
import { formatCount } from "@mtb/domain";
import { Button, cx, EmptyState, Icon, StatusBadge } from "@mtb/ui";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { campusLabel } from "../../app/shell/campus";
import "./cabinets.css";

/** A cabinet this full gets the warning colour. */
const NEARLY_FULL = 90;

const pctFull = (copies: number, capacity: number) => Math.round((copies / Math.max(1, capacity)) * 100);
const count = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

interface Match {
  cabinet: LibraryCabinet;
  /** The shelves to show: all of them, or only those whose label matches the search. */
  shelves: LibraryShelf[];
  /** True when the search matched shelf labels rather than the cabinet: the shown shelves are highlighted. */
  filtered: boolean;
}

/** A search for "C-01" or "Urdu" shows the whole cabinet; one for "abc 25" shows that cabinet with only the shelves that match. */
function match(c: LibraryCabinet, needle: string): Match | null {
  if (!needle || `${c.code} ${c.title}`.toLowerCase().includes(needle)) return { cabinet: c, shelves: c.shelves, filtered: false };
  const shelves = c.shelves.filter((s) => s.label.toLowerCase().includes(needle));
  return shelves.length ? { cabinet: c, shelves, filtered: true } : null;
}

function shelfLine(m: Match) {
  const all = m.cabinet.shelves;
  if (m.filtered) return `${formatCount(m.shelves.length)} of ${count(all.length, "shelf", "shelves")} match`;
  const empty = all.filter((s) => !s.copies).length;
  return `${count(all.length, "shelf", "shelves")}${empty ? ` · ${formatCount(empty)} empty` : ""}`;
}

/** Whether the shelf list is taller than its box (tiles are as wide as their labels, so rows can't be counted). */
function useOverflows(tall: boolean) {
  const ref = useRef<HTMLUListElement>(null);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return setOver(false);
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tall]);
  return [ref, over] as const;
}

/**
 * The shelves as tiles in a box that scrolls: four rows, or a taller box after "Show more". The box never grows to
 * the whole list, because one cabinet can hold 500 shelves (user report, 25-Nov-2026: the page ran to that height).
 */
function ShelfTiles({ m, tall, id, onOverflow }: { m: Match; tall: boolean; id?: string; onOverflow?: (over: boolean) => void }) {
  const [ref, over] = useOverflows(tall);
  useEffect(() => onOverflow?.(over), [over, onOverflow]);
  if (!m.shelves.length) return <p className="lib-cab-none">No shelves yet.</p>;
  return (
    // A list that scrolls takes focus, so the keyboard can scroll it too.
    <ul ref={ref} id={id} className={cx("lib-shelves", tall && "is-tall")} aria-label={`Shelves of ${m.cabinet.code}`} tabIndex={over ? 0 : undefined}>
      {m.shelves.map((s) => (
        <li key={s.id} className={cx("lib-shelf", !s.copies && "is-empty", m.filtered && "is-hit")} title={`${s.label}: ${s.copies ? count(s.copies, "copy", "copies") : "empty"}`}>
          <span className="lib-shelf-name">{s.label}</span>
          <span className="lib-shelf-n">{s.copies ? formatCount(s.copies) : "Empty"}</span>
        </li>
      ))}
    </ul>
  );
}

function CabinetCard({ m, i, open, onToggle, onEdit }: { m: Match; i: number; open: boolean; onToggle: () => void; onEdit?: (() => void) | undefined }) {
  const c = m.cabinet;
  const pct = pctFull(c.copies, c.capacity);
  const warn = pct >= NEARLY_FULL;
  const [over, setOver] = useState(false);
  const long = open || over;
  const listId = `cab-${c.id}-shelves`;
  return (
    <section id={`cab-${c.id}`} className={cx("mtb-card lib-cab mtb-rise", !c.active && "is-off")} style={{ "--i": i } as CSSProperties} aria-labelledby={`cab-${c.id}-title`}>
      <header className="lib-cab-head">
        <div className="lib-cab-name">
          <span className="lib-cab-code">{c.code}</span>
          <h4 id={`cab-${c.id}-title`}>{c.title}</h4>
          {!c.active && <StatusBadge status="neutral">Not in use</StatusBadge>}
        </div>
        {onEdit && (
          <Button size="sm" variant="quiet" icon="edit" onClick={onEdit} aria-label={`Edit cabinet ${c.code}`}>
            Edit
          </Button>
        )}
      </header>
      <div className="lib-cab-fill">
        <div className="lib-cab-fill-row">
          <span>
            <b>{formatCount(c.copies)}</b> of about {formatCount(c.capacity)} books
          </span>
          <span className={cx("lib-cab-pct", warn && "is-warn")}>{pct}% full</span>
        </div>
        <div className={cx("ops-meter", warn && "is-warn")} role="img" aria-label={`${pct}% full`}>
          <span style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </div>
      <div className="lib-cab-shelves">
        <div className="lib-cab-shelves-head">
          <span>{shelfLine(m)}</span>
          {long && (
            <button type="button" className="lib-cab-more" aria-expanded={open} aria-controls={listId} onClick={onToggle}>
              {open ? "Show less" : "Show more"}
              <Icon name="chevronDown" />
            </button>
          )}
        </div>
        <ShelfTiles m={m} tall={open} id={listId} onOverflow={setOver} />
      </div>
    </section>
  );
}

function CabinetTable({ caption, matches, open, onToggle, onEdit }: { caption: string; matches: Match[]; open: (m: Match) => boolean; onToggle: (m: Match) => void; onEdit?: ((c: LibraryCabinet) => void) | undefined }) {
  const cols = onEdit ? 8 : 7;
  return (
    <div className="mtb-table-wrap">
      <div className="mtb-table-scroll">
        <table className="mtb-table lib-cab-table">
          <caption className="mtb-sr-only">{caption}</caption>
          <thead>
            <tr>
              <th className="lib-cab-disc">
                <span className="mtb-sr-only">Show shelves</span>
              </th>
              <th>Cabinet</th>
              <th className="mtb-th-mid">Shelves</th>
              <th className="mtb-th-mid">Empty</th>
              <th className="mtb-th-mid">Copies</th>
              <th className="mtb-th-mid">Holds about</th>
              <th>How full</th>
              {onEdit && (
                <th>
                  <span className="mtb-sr-only">Edit</span>
                </th>
              )}
            </tr>
          </thead>
          {matches.map((m) => {
            const c = m.cabinet;
            const isOpen = open(m);
            const pct = pctFull(c.copies, c.capacity);
            const warn = pct >= NEARLY_FULL;
            const detailId = `cab-${c.id}-row-shelves`;
            return (
              <tbody key={c.id}>
                <tr className={cx(isOpen && "is-open")}>
                  <td className="lib-cab-disc">
                    <button type="button" className="lib-cab-toggle" aria-expanded={isOpen} aria-controls={isOpen ? detailId : undefined} aria-label={`${isOpen ? "Hide" : "Show"} the ${count(c.shelves.length, "shelf", "shelves")} of ${c.code}`} onClick={() => onToggle(m)}>
                      <Icon name="chevronRight" />
                    </button>
                  </td>
                  <td>
                    <span className="lib-cab-cell">
                      <span className="lib-cab-code">{c.code}</span>
                      <b>{c.title}</b>
                      {!c.active && <StatusBadge status="neutral">Not in use</StatusBadge>}
                    </span>
                  </td>
                  <td className="mtb-td-mid">{formatCount(c.shelves.length)}</td>
                  <td className="mtb-td-mid">{formatCount(c.shelves.filter((s) => !s.copies).length)}</td>
                  <td className="mtb-td-mid">
                    <b className="font-medium">{formatCount(c.copies)}</b>
                  </td>
                  <td className="mtb-td-mid text-ink-muted">{formatCount(c.capacity)}</td>
                  <td>
                    <span className="lib-cab-meter">
                      <span className={cx("ops-meter", warn && "is-warn")} role="img" aria-label={`${pct}% full`}>
                        <span style={{ width: `${Math.min(100, pct)}%` }} />
                      </span>
                      <span className={cx("lib-cab-pct", warn && "is-warn")}>{pct}%</span>
                    </span>
                  </td>
                  {onEdit && (
                    <td className="lib-cab-edit">
                      <Button size="sm" variant="quiet" icon="edit" onClick={() => onEdit(c)} aria-label={`Edit cabinet ${c.code}`}>
                        Edit
                      </Button>
                    </td>
                  )}
                </tr>
                {isOpen && (
                  <tr className="lib-cab-detail">
                    <td colSpan={cols}>
                      <ShelfTiles m={m} tall id={detailId} />
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}

export interface CabinetsViewProps {
  libraries: LibraryLibrary[];
  /** The cabinets of the libraries shown (the library filter already applied). */
  cabinets: LibraryCabinet[];
  nextAccessionNo: string;
  query: string;
  view: string;
  /** Every campus at once: name the campus beside each library. */
  showCampus: boolean;
  onEdit?: ((c: LibraryCabinet) => void) | undefined;
}

export function CabinetsView({ libraries, cabinets, nextAccessionNo, query, view, showCampus, onEdit }: CabinetsViewProps) {
  // Open/closed by hand, per cabinet. A card starts at four rows of shelves; a list row starts closed, or open when
  // the search matched its shelves (so the matches show without a click).
  const [cardOpen, setCardOpen] = useState<Record<string, boolean>>({});
  const [rowOpen, setRowOpen] = useState<Record<string, boolean>>({});
  const needle = query.trim().toLowerCase();
  const groups = libraries
    .map((l) => ({
      l,
      matches: cabinets
        .filter((c) => c.libraryId === l.id)
        .map((c) => match(c, needle))
        .filter((m): m is Match => m !== null),
    }))
    .filter((g) => !needle || g.matches.length);
  const shown = groups.flatMap((g) => g.matches.map((m) => m.cabinet));
  const shelves = shown.reduce((a, c) => a + c.shelves.length, 0);
  const empty = shown.reduce((a, c) => a + c.shelves.filter((s) => !s.copies).length, 0);
  const copies = shown.reduce((a, c) => a + c.copies, 0);
  const capacity = shown.reduce((a, c) => a + c.capacity, 0);
  const cardIsOpen = (map: Record<string, boolean>, m: Match) => map[m.cabinet.id] ?? false;
  const rowIsOpen = (map: Record<string, boolean>, m: Match) => map[m.cabinet.id] ?? m.filtered;

  return (
    <>
      <dl className="lib-cab-stats">
        <div>
          <dt>Cabinets</dt>
          <dd>
            <b>{formatCount(shown.length)}</b> in {count(groups.length, "library", "libraries")}
          </dd>
        </div>
        <div>
          <dt>Shelves</dt>
          <dd>
            <b>{formatCount(shelves)}</b> {formatCount(empty)} empty
          </dd>
        </div>
        <div>
          <dt>Copies on shelves</dt>
          <dd>
            <b>{formatCount(copies)}</b> of about {formatCount(capacity)} · {capacity ? pctFull(copies, capacity) : 0}% full
          </dd>
        </div>
        <div>
          <dt>Next accession number</dt>
          <dd>
            <b className="is-mono">{nextAccessionNo}</b> given in order, never reused
          </dd>
        </div>
      </dl>

      {needle && !shown.length && <EmptyState icon="search" title={`No cabinet or shelf matches “${query.trim()}”`} description="Check the spelling, or clear the search to see every cabinet." />}

      {groups.map(({ l, matches }) => {
        const libCopies = matches.reduce((a, m) => a + m.cabinet.copies, 0);
        return (
          <section key={l.id} className="lib-cab-group" aria-labelledby={`lib-${l.id}-title`}>
            <h3 id={`lib-${l.id}-title`}>
              {l.name}
              <span>
                {count(matches.length, "cabinet", "cabinets")} · {count(libCopies, "copy", "copies")}
                {showCampus ? ` · ${campusLabel(l.campus)}` : ""}
                {l.active ? "" : " · not in use"}
              </span>
            </h3>
            {matches.length === 0 ? (
              <p>No cabinets in this library yet.</p>
            ) : view === "list" ? (
              <CabinetTable
                caption={`${l.name} cabinets`}
                matches={matches}
                open={(m) => rowIsOpen(rowOpen, m)}
                onToggle={(m) => setRowOpen((o) => ({ ...o, [m.cabinet.id]: !rowIsOpen(o, m) }))}
                onEdit={onEdit}
              />
            ) : (
              <div className="lib-cab-grid">
                {matches.map((m, i) => (
                  <CabinetCard
                    key={m.cabinet.id}
                    m={m}
                    i={i}
                    open={cardIsOpen(cardOpen, m)}
                    onToggle={() => setCardOpen((o) => ({ ...o, [m.cabinet.id]: !cardIsOpen(o, m) }))}
                    onEdit={onEdit ? () => onEdit(m.cabinet) : undefined}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
