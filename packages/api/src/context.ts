/** Campus and session travel in the URL and in every query key, so switching campus never shows another campus's cached data. */

export type CampusCode = "KC" | "SM" | "UC" | "MC" | "HC";
export type CampusScope = CampusCode | "ALL";

export interface Ctx {
  campus: CampusScope;
  /** Start year of the academic session: 2026 = 2026–27. */
  session: number;
}

export const CURRENT_SESSION = 2026;

export function ctxKey(ctx: Ctx) {
  return [ctx.campus, ctx.session] as const;
}

export function ctxQuery(ctx: Ctx) {
  return { campus: ctx.campus, session: ctx.session };
}
