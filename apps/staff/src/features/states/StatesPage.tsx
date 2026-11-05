import { formatLongDate, formatSession } from "@mtb/domain";
import { AnimatedNumber, buttonClassName, Icon, Segmented, StatCard } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { useAppearance, type Theme } from "../../app/appearance";
import { GROUPS, STATES, statesIn, TEACHER_APP_URL } from "./catalogue";
import { TODAY } from "./demo";
import { stagger } from "./kit";
import { ConfirmSection } from "./sections/ConfirmSection";
import { ContextSection } from "./sections/ContextSection";
import { DarkSection } from "./sections/DarkSection";
import { DeniedSection } from "./sections/DeniedSection";
import { EmptySection } from "./sections/EmptySection";
import { IndexSection } from "./sections/IndexSection";
import { LoadingSection } from "./sections/LoadingSection";
import { NetworkSection } from "./sections/NetworkSection";
import { OfflineSection } from "./sections/OfflineSection";
import { ToastSection } from "./sections/ToastSection";
import { ValidationSection } from "./sections/ValidationSection";
import "./states.css";

const TOC = [...GROUPS.map((g) => ({ id: g.id as string, title: g.title, icon: g.icon, count: statesIn(g.id).length })), { id: "index", title: "At a glance", icon: "listChecks" as const, count: STATES.length }];

/** The section nearest the top of the screen (scroll-spy for the table of contents). */
function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const first = ids.find((id) => visible.get(id));
        if (first) setActive(first);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [ids]);
  return active;
}

const TOC_IDS = TOC.map((t) => t.id);

function Hero({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const fromBrief = STATES.filter((s) => s.source === "brief").length;
  const added = STATES.length - fromBrief;
  const screens = new Set(STATES.map((s) => (s.live.app === "staff" ? s.live.to : `teacher:${s.live.path}`))).size;
  return (
    <header className="mtb-states-hero mtb-rise" aria-labelledby="states-title">
      <div className="mtb-states-hero-art" aria-hidden="true" />
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="grid min-w-0 max-w-[68ch] gap-3">
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-small font-medium text-ink-muted">
            <span>Deliverable 4</span>
            <span aria-hidden="true">·</span>
            <span>Khalid Campus · Session {formatSession(2026)}</span>
            <span aria-hidden="true">·</span>
            <span>Demo date {formatLongDate(TODAY)}</span>
          </p>
          <h1 id="states-title" className="m-0 text-display mtb-states-title">
            States
          </h1>
          <p className="m-0 text-body-large text-ink-muted">
            Every state the screens can be in — empty, loading, wrong, done, blocked, offline — on the same components the app uses. Each one says where it appears and links to the live screen. The buttons work: fire the toasts, open the confirmations,
            take the teacher's phone offline.
          </p>
        </div>
        <div className="mtb-states-controls grid gap-3">
          <div className="grid gap-1.5">
            <span className="mtb-label">Theme for every specimen</span>
            <Segmented
              aria-label="Theme"
              value={theme}
              onChange={(v) => setTheme(v as Theme)}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/login" className={buttonClassName({ variant: "primary", size: "sm" })}>
              Sign in to the staff app
              <Icon name="arrowRight" size={16} />
            </Link>
            <a href={TEACHER_APP_URL} target="_blank" rel="noreferrer" className={buttonClassName({ size: "sm" })}>
              <Icon name="smartphone" size={16} />
              Teacher app
              <span className="mtb-sr-only"> (opens in a new tab)</span>
            </a>
            <Link to="/design-system" className={buttonClassName({ variant: "ghost", size: "sm" })}>
              Design system
            </Link>
          </div>
        </div>
      </div>
      <div className="mtb-states-stats">
        {[
          { label: "States on this page", value: STATES.length, icon: "layers" as const, foot: `In ${GROUPS.length} groups` },
          { label: "Asked for in the brief", value: fromBrief, icon: "listChecks" as const, foot: "Section 8, every one covered" },
          { label: "Added by the screens", value: added, icon: "plus" as const, foot: "States the real screens needed" },
          { label: "Live screens linked", value: screens, icon: "arrowRight" as const, foot: "Staff app and teacher app" },
        ].map((s, i) => (
          <div key={s.label} className="mtb-rise grid" style={stagger(i + 1)}>
            <StatCard label={s.label} icon={s.icon} value={<AnimatedNumber value={s.value} format={(v) => String(Math.round(v))} delay={200 + i * 80} />} foot={s.foot} />
          </div>
        ))}
      </div>
    </header>
  );
}

export function StatesPage() {
  const { theme, setTheme } = useAppearance();
  const active = useActiveSection(TOC_IDS);
  const at = Math.max(0, TOC_IDS.indexOf(active));

  useEffect(() => {
    document.title = "States · MTB";
  }, []);

  return (
    <div className="mtb-states mx-auto grid max-w-[1440px] gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="States on this page" className="hidden lg:block">
        <div className="mtb-states-toc">
          <span className="px-3 pb-2 text-title-2">MTB · States</span>
          {TOC.map((t) => (
            <a key={t.id} href={`#${t.id}`} aria-current={active === t.id ? "location" : undefined}>
              <Icon name={t.icon} size={16} />
              <span className="truncate">{t.title}</span>
              <span className="mtb-states-toc-count">{t.count}</span>
            </a>
          ))}
          <div className="mtb-states-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${(at + 1) / TOC_IDS.length})` } as CSSProperties} />
          </div>
          <p className="m-0 px-3 pt-3 text-caption font-normal text-ink-muted">
            Section {at + 1} of {TOC_IDS.length}
          </p>
        </div>
      </nav>

      <main className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-12">
        <Hero theme={theme} setTheme={setTheme} />

        <nav aria-label="States on this page" className="mtb-states-chips lg:hidden">
          {TOC.map((t) => (
            <a key={t.id} href={`#${t.id}`} aria-current={active === t.id ? "location" : undefined}>
              <Icon name={t.icon} size={14} />
              {t.title}
            </a>
          ))}
        </nav>

        <EmptySection />
        <LoadingSection />
        <ValidationSection />
        <ToastSection />
        <ConfirmSection />
        <DeniedSection />
        <NetworkSection />
        <OfflineSection />
        <ContextSection />
        <DarkSection />
        <IndexSection />

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-small text-ink-muted">
          <span>All names, numbers and CNICs on this page are fictional. Deliverable 4 of the MTB demo.</span>
          <Link to="/design-system" className="text-brand-ink underline underline-offset-2">
            Design system (deliverable 1)
          </Link>
        </footer>
      </main>
    </div>
  );
}
