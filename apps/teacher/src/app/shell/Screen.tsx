import { IconButton, cx } from "@mtb/ui";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { useContextLine } from "../session";
import { SyncIndicator } from "./SyncIndicator";

export interface ScreenProps {
  title: ReactNode;
  /** One line under the title: the date or the class. Defaults to the campus and session ("Khalid Campus · Session 2026–27"). */
  subtitle?: ReactNode;
  /** Shows a back arrow; goes back in history, or to this path when the screen was opened directly. */
  backTo?: string;
  backLabel?: string;
  /** Buttons on the right of the header (after the sync pill). */
  actions?: ReactNode;
  /** A bar pinned to the bottom edge (Submit, Save draft). Screens with one hide the bottom navigation. */
  bottom?: ReactNode;
  /** Sets document.title, e.g. "7-B register". */
  documentTitle: string;
  className?: string;
  children: ReactNode;
}

/**
 * One phone screen: a sticky header with the title and the sync indicator, the content in a single column (max
 * 560px, so a tablet still reads well) and an optional bottom action bar within thumb reach.
 */
export function Screen({ title, subtitle, backTo, backLabel = "Back", actions, bottom, documentTitle, className, children }: ScreenProps) {
  const router = useRouter();
  const navigate = useNavigate();
  const contextLine = useContextLine();
  const sub = subtitle ?? contextLine;
  useEffect(() => {
    document.title = `${documentTitle} · MTB Teacher`;
  }, [documentTitle]);

  const goBack = () => {
    // Back within the app when we came from another screen; otherwise (opened from a link) go to the parent screen.
    const index = (router.state.location.state as { __TSR_index?: number } | undefined)?.__TSR_index ?? 0;
    if (index > 0) router.history.back();
    else void navigate({ to: (backTo ?? "/today") as never });
  };

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-surface-raised/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex min-h-14 max-w-[560px] items-center gap-1 px-2">
          {backTo ? <IconButton icon="arrowLeft" label={backLabel} size="touch" onClick={goBack} /> : <span className="w-2 shrink-0" aria-hidden="true" />}
          <div className="min-w-0 flex-1 py-1.5">
            <h1 className="m-0 truncate text-title-2 text-ink">{title}</h1>
            {sub && <p className="m-0 truncate text-small text-ink-muted">{sub}</p>}
          </div>
          <SyncIndicator />
          {actions}
        </div>
      </header>
      <main id="main" className={cx("mx-auto w-full max-w-[560px] px-4 pt-4", bottom ? "pb-[calc(env(safe-area-inset-bottom)+112px)]" : "pb-[calc(env(safe-area-inset-bottom)+104px)]", className)}>
        {children}
      </main>
      {bottom && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-raised/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] backdrop-blur">
          <div className="mx-auto max-w-[560px]">{bottom}</div>
        </div>
      )}
    </>
  );
}

/** A titled group of rows inside a screen. */
export function Section({ title, action, children, className, rise }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; rise?: number }) {
  return (
    <section className={cx("grid gap-2", rise !== undefined && "mtb-rise", className)} style={rise !== undefined ? ({ "--i": rise } as CSSProperties) : undefined}>
      <div className="flex min-h-8 items-end justify-between gap-2 px-1">
        <h2 className="m-0 text-caption tracking-wide text-ink-muted uppercase">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
