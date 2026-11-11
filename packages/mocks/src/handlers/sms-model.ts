import type { CampusCode, SmsBatch, SmsBatchCounts } from "@mtb/api";
import { daysBetween, type IsoDate } from "@mtb/domain";
import { DEMO_TODAY } from "../clock";
import { createStore } from "../db";
import { rosterFor } from "../fixtures/attendance";
import { tuitionFor } from "../fixtures/campuses";
import { rand01 } from "../fixtures/reports";
import { APP_ADOPTION, seedBatches, seedReportRows, type MockBatch, type MockSmsRow } from "../fixtures/sms";
import { findStudent } from "../fixtures/students";
import { chargesOf } from "./fees-state";

// Fictional Messages model (no routes). Messages itself is real (/api/sms/*, /api/notices: module 10); this model only
// serves the mocks of unfinished modules that still import it: the report centre (reports.ts, module 13) reads
// rosters and a snapshot of the fictional outbox (library reminders are real since module 11 and use the real outbox). Nothing here is the real outbox.

interface OutboxState {
  rows: MockSmsRow[];
  batches: MockBatch[];
}

const outboxStore = createStore<OutboxState>("sms-outbox-v2", () => {
  const rows = seedReportRows();
  return { rows, batches: seedBatches(rows) };
});

/** Read-only view of the outbox for the report centre (message log, cost by month). */
export function outboxSnapshot(): { batches: SmsBatch[]; rows: MockSmsRow[] } {
  const st = outboxStore.get();
  return { batches: st.batches.map((b) => toBatch(b, st.rows)), rows: st.rows };
}


// ---------------------------------------------------------------------------------------------------
// Batch figures
// ---------------------------------------------------------------------------------------------------

function countsOf(b: MockBatch, rows: MockSmsRow[]): SmsBatchCounts {
  const c: SmsBatchCounts = { ...b.extra };
  for (const r of rows) {
    if (r.batchId !== b.id) continue;
    if (r.channel === "APP") {
      if (r.status === "delivered") {
        c.app += 1;
        if (r.read) c.appRead += 1;
      }
      continue;
    }
    c[r.status] += 1;
  }
  return c;
}

function toBatch(b: MockBatch, rows: MockSmsRow[]): SmsBatch {
  const { request: _r, extra: _e, startedAtMs: _s, ...rest } = b;
  return { ...rest, counts: countsOf(b, rows) };
}

// ---------------------------------------------------------------------------------------------------
// Audiences
// ---------------------------------------------------------------------------------------------------

const GIRL_FIRST = new Set(["Hania", "Aiza", "Minahil", "Alishba", "Abeera", "Haleema", "Mishal", "Rameen", "Arfa", "Dua", "Sehar", "Javeria", "Maheen", "Iqra", "Komal", "Rabia", "Shiza", "Tayyaba", "Umaima", "Wajiha"]);

/** Fictional classmates are generated from these girls' names (attendance fixtures); the rest are boys. */
export const genderOfName = (name: string): "F" | "M" => (GIRL_FIRST.has(name.split(" ")[0] ?? "") ? "F" : "M");

export interface Person {
  /** Stable id for unticking on the preview (defaults to the G.R. no., else the number). */
  key?: string;
  /** Applicants: entry-test marks, "obtained/total", once marked. */
  testResult?: string;
  grNo: string;
  name: string;
  nameUr?: string;
  classSection: string;
  guardian: string;
  mobile: string;
  gender: "F" | "M";
  /** Open charges known (fixture students), else a fictional figure. */
  amountDue: number;
  overdueAmount: number;
  oldestDue?: IsoDate;
  daysOverdue: number;
  hasApp: boolean;
}

function feeOf(grNo: string): { due: number; overdue: number; oldest?: IsoDate; days: number; first?: IsoDate } {
  const open = chargesOf(grNo)
    .filter((c) => c.status === "OPEN")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const due = open.reduce((a, c) => a + c.amount - c.settledAmount, 0);
  const overdue = open.filter((c) => c.dueDate < DEMO_TODAY);
  const overdueAmount = overdue.reduce((a, c) => a + c.amount - c.settledAmount, 0);
  return { due, overdue: overdueAmount, ...(overdue[0] ? { oldest: overdue[0].dueDate } : {}), days: overdue[0] ? daysBetween(overdue[0].dueDate, DEMO_TODAY) : 0, ...(open[0] ? { first: open[0].dueDate } : {}) };
}

/** Everyone in some class-sections of a campus (full registers: fixture students plus their classmates). */
export function rosterPeople(campus: CampusCode, sections: string[]): Person[] {
  const out: Person[] = [];
  for (const cs of sections) {
    for (const e of rosterFor(campus, cs)) {
      const s = e.hasProfile ? findStudent(e.grNo) : undefined;
      if (s) {
        const f = feeOf(s.grNo);
        out.push({
          grNo: s.grNo,
          name: s.name,
          ...(s.nameUr ? { nameUr: s.nameUr } : {}),
          classSection: cs,
          guardian: s.guardian.name,
          mobile: s.guardian.mobile,
          gender: s.gender,
          amountDue: f.due,
          overdueAmount: f.overdue,
          ...(f.oldest ?? f.first ? { oldestDue: (f.oldest ?? f.first)! } : {}),
          daysOverdue: f.days,
          hasApp: rand01(`${s.guardian.mobile}:app`) < APP_ADOPTION[campus],
        });
        continue;
      }
      // Fictional dues for classmates without a fixture record: about 3 in 10 owe something, 1 in 5 is overdue.
      const owes = rand01(`${e.grNo}:fee`);
      const tuition = tuitionFor(cs.split("-")[0] ?? "");
      const months = owes < 0.05 ? 3 : owes < 0.1 ? 2 : owes < 0.18 ? 1 : 0;
      const overdue = months * tuition;
      const amount = owes < 0.3 ? overdue + tuition : 0;
      const oldest: IsoDate | undefined = months === 3 ? "2026-08-10" : months === 2 ? "2026-09-10" : months === 1 ? "2026-10-10" : amount ? "2026-11-10" : undefined;
      out.push({
        grNo: e.grNo,
        name: e.name,
        classSection: cs,
        guardian: e.father,
        mobile: e.mobile,
        gender: genderOfName(e.name),
        amountDue: amount,
        overdueAmount: overdue,
        ...(oldest ? { oldestDue: oldest } : {}),
        daysOverdue: overdue && oldest ? daysBetween(oldest, DEMO_TODAY) : 0,
        hasApp: rand01(`${e.mobile}:app`) < APP_ADOPTION[campus],
      });
    }
  }
  return out;
}
