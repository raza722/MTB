import type { IsoDateTime } from "@mtb/domain";
import { PORTAL_PARENTS } from "../fixtures/portal";

// Fictional portal families (no routes). The parent and student portal is real now (/api/portal/*: module 12,
// backend/docs/modules/12_portal.md): sign-in with a one-time code, sessions, the children's pages and notice reads all
// fall through to the backend. This model served the report centre's mock "Parent portal accounts" report, which is
// real since module 13b (rpt.usp_R_PortalAccounts): nothing imports it any more; nothing here signs anyone in.

/** Families with a portal account and their latest sign-in (for the staff report; never a password or code). */
export function portalFamilies(): Array<{ id: string; children: string[]; lastSignInAt?: IsoDateTime }> {
  return PORTAL_PARENTS.map((p) => ({ id: p.id, children: p.children, ...(p.lastSignInAt ? { lastSignInAt: p.lastSignInAt } : {}) }));
}
