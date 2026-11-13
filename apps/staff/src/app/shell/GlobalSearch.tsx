import { ADMISSIONS_STAGE_LABEL, studentsQueries } from "@mtb/api";
import { formatCnic, formatDate, formatRs } from "@mtb/domain";
import { Avatar, Icon, Kbd, StatusBadge } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import { useEffect, useState, type ReactNode } from "react";
import { useCtx } from "../session";

/** Highlights the matching part of a result (case-insensitive, ignores dashes in CNICs and numbers). */
function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const q = query.trim();
  if (q.length < 2) return text;
  const plain = (s: string) => s.toLowerCase().replace(/[-\s]/g, "");
  const target = plain(q);
  // Map positions in the plain string back to the original text.
  const map: number[] = [];
  let flat = "";
  [...text].forEach((ch, i) => {
    if (!/[-\s]/.test(ch)) {
      map.push(i);
      flat += ch.toLowerCase();
    }
  });
  const at = flat.indexOf(target);
  if (at < 0) return text;
  const start = map[at] ?? 0;
  const end = (map[at + target.length - 1] ?? start) + 1;
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-sm bg-warning-tint px-0.5 text-ink">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

const OPEN_SEARCH = "mtb:open-search";

/** Opens global search from anywhere (the dashboard's "Find a student" button). */
export function openGlobalSearch() {
  window.dispatchEvent(new Event(OPEN_SEARCH));
}

export function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH, onOpen);
    };
  }, [onOpen]);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-8 w-full items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-left text-ink-subtle hover:border-ink-muted"
      aria-keyshortcuts="Control+K"
    >
      <Icon name="search" size={16} />
      <span className="flex-1 truncate">Search name, G.R., father's CNIC or receipt</span>
      <Kbd>Ctrl</Kbd>
      <Kbd>K</Kbd>
    </button>
  );
}

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ctx = useCtx();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(t);
  }, [query]);
  const result = useQuery(studentsQueries.search(ctx, debounced));
  const data = result.data;

  const go = (fn: () => void) => {
    onOpenChange(false);
    setQuery("");
    fn();
  };
  const applicants = data?.applicants ?? [];
  const empty = debounced.trim().length >= 2 && data && data.students.length + data.families.length + data.receipts.length + applicants.length === 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="mtb-scrim" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-[51] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg" aria-describedby={undefined}>
          <Dialog.Title className="mtb-sr-only">Search</Dialog.Title>
          <Command shouldFilter={false} label="Search students, families, applicants and receipts" className="grid">
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Icon name="search" size={18} className="text-ink-muted" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Name, G.R. number, father's CNIC or receipt number"
                className="h-12 w-full border-0 bg-transparent text-body-large text-ink outline-none placeholder:text-ink-subtle"
                autoFocus
              />
              {result.isFetching && <span className="mtb-spinner text-ink-muted" aria-label="Searching" />}
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              {debounced.trim().length < 2 && (
                <p className="m-0 px-3 py-6 text-center text-small text-ink-muted">
                  Type a name, G.R. number, father's CNIC or receipt number.
                </p>
              )}
              {empty && <Command.Empty className="px-3 py-6 text-center text-small text-ink-muted">No students, families, applicants or receipts match "{debounced}". Check the spelling or try the G.R. number.</Command.Empty>}
              {data && data.students.length > 0 && (
                <Command.Group heading="Students" className="mtb-search-group">
                  {data.students.map((s) => (
                    <Command.Item key={s.grNo} value={`student-${s.grNo}`} onSelect={() => go(() => navigate({ to: "/students/$grNo", params: { grNo: s.grNo } }))} className="mtb-search-item">
                      <Avatar name={s.name} size="sm" />
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate font-medium">
                          <Highlight text={s.name} query={debounced} /> <span className="mtb-mono text-ink-muted"><Highlight text={s.grNo} query={debounced} /></span>
                        </span>
                        <span className="truncate text-small text-ink-muted">
                          {s.relation} {s.father} · {s.classSection} · {s.campusName}
                        </span>
                      </span>
                      <StatusBadge status={s.feeStatus} />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {data && data.families.length > 0 && (
                <Command.Group heading="Families" className="mtb-search-group">
                  {data.families.map((f) => (
                    <Command.Item key={f.fatherCnic} value={`family-${f.fatherCnic}`} onSelect={() => go(() => navigate({ to: "/students", search: (p: Record<string, unknown>) => ({ ...p, q: formatCnic(f.fatherCnic) }) } as never))} className="mtb-search-item">
                      <span className="grid h-7 w-7 place-content-center rounded-full bg-info-tint text-info-ink">
                        <Icon name="students" size={16} />
                      </span>
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate font-medium">
                          {f.fatherName} family · <span className="mtb-mono text-ink-muted"><Highlight text={formatCnic(f.fatherCnic)} query={debounced} /></span>
                        </span>
                        <span className="truncate text-small text-ink-muted">{f.members.map((m) => `${m.name} (${m.classSection}, ${m.campusName})`).join(" · ")}</span>
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {applicants.length > 0 && (
                <Command.Group heading="Admission applicants" className="mtb-search-group">
                  {applicants.map((a) => (
                    <Command.Item key={a.id} value={`applicant-${a.id}`} onSelect={() => go(() => navigate({ to: "/admissions", search: { applicant: a.id } } as never))} className="mtb-search-item">
                      <span className="grid h-7 w-7 place-content-center rounded-full bg-info-tint text-info-ink">
                        <Icon name="admissions" size={16} />
                      </span>
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate font-medium">
                          <Highlight text={a.name} query={debounced} /> <span className="mtb-mono text-ink-muted"><Highlight text={a.applicationNo} query={debounced} /></span>
                        </span>
                        <span className="truncate text-small text-ink-muted">
                          {a.relation} {a.father} · applied for {a.classApplied} · {a.campusName}
                        </span>
                      </span>
                      <StatusBadge status={a.stage === "WITHDRAWN" ? "cancelled" : "neutral"}>{ADMISSIONS_STAGE_LABEL[a.stage]}</StatusBadge>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {data && data.receipts.length > 0 && (
                <Command.Group heading="Receipts" className="mtb-search-group">
                  {data.receipts.map((r) => (
                    <Command.Item key={r.receiptNo} value={`receipt-${r.receiptNo}`} onSelect={() => go(() => navigate({ to: "/fees/receipts/$receiptNo", params: { receiptNo: r.receiptNo } }))} className="mtb-search-item">
                      <span className="grid h-7 w-7 place-content-center rounded-full bg-neutral-tint text-neutral-ink">
                        <Icon name="receipt" size={16} />
                      </span>
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate font-medium mtb-mono">
                          <Highlight text={r.receiptNo} query={debounced} />
                        </span>
                        <span className="truncate text-small text-ink-muted">
                          {r.studentName} · {formatRs(r.total)} · {formatDate(r.postedAt)}
                        </span>
                      </span>
                      {r.status !== "POSTED" && <StatusBadge status={r.status === "CANCELLED" ? "cancelled" : "pending"}>{r.status === "CANCELLED" ? "Cancelled" : "Cancellation pending"}</StatusBadge>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
            <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-small text-ink-muted">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> Move
              </span>
              <span className="flex items-center gap-1">
                <Kbd>Enter</Kbd> Open
              </span>
              <span className="flex items-center gap-1">
                <Kbd>Esc</Kbd> Close
              </span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
