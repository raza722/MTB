import { useToast } from "@mtb/ui";
import { Outlet, useMatches } from "@tanstack/react-router";
import { useEffect } from "react";
import { onRejected, onSent } from "../sync/outbox";
import { BottomNav } from "./BottomNav";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Task screens (taking a register, entering marks) use the whole height and hide the bottom navigation. */
    hideNav?: boolean;
  }
}

/** The signed-in frame: the current screen and the bottom navigation. */
export function AppShell() {
  const hideNav = useMatches({ select: (ms) => ms.some((m) => m.staticData?.hideNav === true) });
  const toast = useToast();

  // A waiting item the server turned down (e.g. the office already submitted the register) is reported once.
  useEffect(
    () =>
      onRejected((item, error) =>
        toast({ tone: "danger", title: `Not sent: ${item.label}`, message: `${error.message} It has been removed from this phone.`, duration: 0 }),
      ),
    [toast],
  );

  // Work saved offline that reaches the server later is confirmed once, whichever screen is open.
  useEffect(
    () =>
      onSent((item) =>
        toast(
          item.payload.kind === "register.submit"
            ? { title: "Attendance submitted", message: `${item.label} was saved on this phone and has now reached the school server.` }
            : { title: "Synced", message: `${item.label} has reached the school server.` },
        ),
      ),
    [toast],
  );

  return (
    <div className="min-h-dvh bg-surface" data-nav={hideNav ? "hidden" : "shown"}>
      <a href="#main" className="mtb-sr-only focus:not-sr-only">
        Skip to content
      </a>
      <Outlet />
      {!hideNav && <BottomNav />}
    </div>
  );
}
