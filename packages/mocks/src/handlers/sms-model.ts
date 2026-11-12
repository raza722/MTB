import type { SmsBatch, SmsBatchCounts } from "@mtb/api";
import { createStore } from "../db";
import { seedBatches, seedReportRows, type MockBatch, type MockSmsRow } from "../fixtures/sms";

// Fictional Messages model (no routes). Messages itself is real (/api/sms/*, /api/notices: module 10); this model only
// keeps a snapshot of the fictional outbox as the reference for the Messages reports (module 13c); the rosters and
// genders the student, attendance and exam reports read are real since module 13b. Library reminders are real since
// module 11 and use the real outbox. Nothing here is the real outbox.

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
