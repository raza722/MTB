import { buttonClassName, cx, Icon, Panel, StatusBadge } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ACCOUNT_LABEL, GROUPS, statesIn, stateById, TEACHER_APP_URL, type GroupId, type LiveLink } from "./catalogue";

/** Building blocks for the States page only. */

export const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** A group of states (one entry in the table of contents). */
export function StateGroupSection({ id, children, cols = 2 }: { id: GroupId; children: ReactNode; cols?: 1 | 2 | 3 }) {
  const g = GROUPS.find((x) => x.id === id)!;
  const n = statesIn(id).length;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mtb-states-group grid grid-cols-[minmax(0,1fr)] gap-5" data-state-group>
      <header className="flex items-start gap-4">
        <span className="mtb-states-group-icon" aria-hidden="true">
          <Icon name={g.icon} size={20} />
        </span>
        <div className="grid min-w-0 gap-1">
          <h2 id={`${id}-title`} className="m-0 flex flex-wrap items-baseline gap-x-3 text-title-1">
            {g.title}
            <span className="text-small font-normal text-ink-muted">
              {n} {n === 1 ? "state" : "states"}
            </span>
          </h2>
          <p className="m-0 max-w-[72ch] text-ink-muted">{g.intro}</p>
        </div>
      </header>
      <div className={cx("mtb-states-grid", cols === 2 && "mtb-states-grid-2", cols === 3 && "mtb-states-grid-3")}>{children}</div>
    </section>
  );
}

/** The link to where a state happens in the real app. Staff screens open in this tab (the demo data carries over). */
export function LiveLinkButton({ live, label }: { live: LiveLink; label?: string }) {
  const cls = buttonClassName({ variant: "secondary", size: "sm" });
  if (live.app === "teacher") {
    return (
      <a href={`${TEACHER_APP_URL}${live.path}`} target="_blank" rel="noreferrer" className={cls}>
        <Icon name="smartphone" size={16} />
        {label ?? "Open in teacher app"}
        <span className="mtb-sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  // No hover preload: this page is public, and preloading a signed-in screen while signed out would bounce to sign-in.
  return (
    <Link to={live.to as never} search={(live.search ?? {}) as never} preload={false} className={cls}>
      {label ?? "Open live screen"}
      <Icon name="arrowRight" size={16} />
    </Link>
  );
}

/** "Sign in as usman.ali (Usman Ali, cashier) · Type any wrong code" under a specimen. */
export function SignInHint({ live }: { live: LiveLink }) {
  if (!live.signInAs && !live.hint) return null;
  return (
    <p className="mtb-states-foot m-0">
      {live.signInAs && (
        <span className="inline-flex items-center gap-1.5">
          <Icon name="user" size={14} />
          Sign in as <span className="mtb-mono text-ink">{live.signInAs}</span>
          {ACCOUNT_LABEL[live.signInAs] && <span>({ACCOUNT_LABEL[live.signInAs]})</span>}
        </span>
      )}
      {live.hint && (
        <span className="inline-flex items-center gap-1.5">
          <Icon name="info" size={14} />
          {live.hint}
        </span>
      )}
      {live.app === "teacher" && <span className="mtb-mono">{TEACHER_APP_URL.replace(/^https?:\/\//, "")}</span>}
    </p>
  );
}

/**
 * A labelled specimen: the state's name, one line on where it appears, a link to the live screen,
 * and the state itself on real components.
 */
export function Specimen({
  id,
  rise,
  wide,
  actions,
  plain,
  children,
  below,
}: {
  /** Catalogue id (catalogue.ts). */
  id: string;
  rise?: number;
  wide?: boolean;
  /** Extra controls beside the live link (Replay, Fire toast …). */
  actions?: ReactNode;
  /** A stage without the dotted background. */
  plain?: boolean;
  children: ReactNode;
  /** Notes under the stage. */
  below?: ReactNode;
}) {
  const s = stateById(id);
  return (
    <div id={`state-${s.id}`} className={cx("mtb-states-specimen", wide && "mtb-states-wide")}>
      <Panel
        id={`st-${s.id}`}
        {...(rise !== undefined ? { rise } : {})}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {s.title}
            {s.source === "added" && (
              <StatusBadge status="neutral" dot={false}>
                Added by the screens
              </StatusBadge>
            )}
          </span>
        }
        description={s.where}
        actions={
          <>
            {actions}
            <LiveLinkButton live={s.live} />
          </>
        }
      >
        <div className={cx("mtb-states-stage", plain && "mtb-states-stage-plain")}>{children}</div>
        {below}
        <SignInHint live={s.live} />
      </Panel>
    </div>
  );
}

/** A miniature staff-app window: page title and context line on top, the page body below. */
export function AppFrame({ title, context = "Khalid Campus · Session 2026–27", right, side, children, className }: { title: string; context?: ReactNode; right?: ReactNode; side?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx("mtb-states-frame", className)}>
      <div className="mtb-states-frame-bar">
        <span className="font-semibold text-ink">{title}</span>
        <span className="text-ink-muted">{context}</span>
        {right && <span className="ml-auto flex items-center gap-2">{right}</span>}
      </div>
      {side ? (
        <div className="mtb-states-frame-side">
          {side}
          <div className="mtb-states-frame-body">{children}</div>
        </div>
      ) : (
        <div className="mtb-states-frame-body">{children}</div>
      )}
    </div>
  );
}

/** A phone, for teacher-app states (the app is built for 390×844). */
export function PhoneFrame({ title, subtitle, right, bottom, children, label }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; bottom?: ReactNode; children: ReactNode; label: string }) {
  return (
    <figure className="mtb-states-phone m-0" aria-label={label}>
      <div className="mtb-states-phone-screen">
        <header className="mtb-states-phone-head">
          <div className="grid min-w-0 gap-0.5">
            <span className="truncate text-title-2 text-ink">{title}</span>
            {subtitle && <span className="truncate text-small text-ink-muted">{subtitle}</span>}
          </div>
          {right}
        </header>
        <div className="mtb-states-phone-body">{children}</div>
        {bottom && <div className="mtb-states-phone-bottom">{bottom}</div>}
      </div>
    </figure>
  );
}

/** Runs `onEnter` the first time the element is at least a third on screen. */
export function useInViewOnce(ref: RefObject<HTMLElement | null>, onEnter: () => void) {
  const done = useRef(false);
  const cb = useRef(onEnter);
  cb.current = onEnter;
  useEffect(() => {
    const el = ref.current;
    if (!el || done.current) return;
    if (typeof IntersectionObserver === "undefined") {
      done.current = true;
      cb.current();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !done.current) {
          done.current = true;
          cb.current();
          io.disconnect();
        }
      },
      { threshold: 0.33 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
}

export type LoadPhase = "loading" | "loaded";

/**
 * Loading → loaded, replayable. Starts the first time the specimen scrolls into view, so the skeleton is
 * actually seen; `hold` pins either phase for a side-by-side look.
 */
export function useReplay(ref: RefObject<HTMLElement | null>, ms = 1800) {
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [run, setRun] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replay = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setPhase("loading");
    setRun((r) => r + 1);
    timer.current = setTimeout(() => setPhase("loaded"), ms);
  }, [ms]);
  const hold = useCallback((p: LoadPhase) => {
    if (timer.current) clearTimeout(timer.current);
    setPhase(p);
    setRun((r) => r + 1);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  useInViewOnce(ref, replay);
  return { phase, run, replay, hold };
}

/** Waits, for buttons that pretend to talk to the server ("Posting…"). */
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
