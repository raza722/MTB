import { portalQueries, type PortalAccount, type PortalChild } from "@mtb/api";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";

const LAST_CHILD = "mtb.portal.child";

function savedChild(): string | null {
  try {
    return localStorage.getItem(LAST_CHILD);
  } catch {
    return null;
  }
}

function saveChild(grNo: string) {
  try {
    localStorage.setItem(LAST_CHILD, grNo);
  } catch {
    /* this page only */
  }
}

/** The signed-in parent or student. The _app route loads it before any page renders. */
export function useAccount(): PortalAccount {
  return useSuspenseQuery(portalQueries.session()).data;
}

/**
 * The child every page shows: `?child=` in the URL (so a link or bookmark reopens the same child), else the child
 * chosen last on this device, else the first. Students only ever see themselves.
 */
export function useChild(): PortalChild | null {
  const account = useAccount();
  const search = useSearch({ strict: false }) as { child?: string };
  const list = account.children;
  return list.find((c) => c.grNo === search.child) ?? list.find((c) => c.grNo === savedChild()) ?? list[0] ?? null;
}

/** Switch to another child, staying on the same page. */
export function useSwitchChild() {
  const navigate = useNavigate();
  return (grNo: string) => {
    saveChild(grNo);
    void navigate({ to: ".", search: ((prev: Record<string, unknown>) => ({ ...prev, child: grNo })) as never });
  };
}
