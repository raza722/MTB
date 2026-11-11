// The operations module (library, the shared people search, warehouse with the book shop, transport) is real since
// module 11: every /api/library/*, /api/operations/people, /api/warehouse/* and /api/transport/* request falls through
// to the backend. The fictional stores the report centre still reads live in library-model.ts, warehouse-model.ts and
// transport-model.ts (no routes). The export stays for handlers/index.ts until module 13.
import type { HttpHandler } from "msw";

export const operationsHandlers: HttpHandler[] = [];
