import "@mtb/ui/docs-states.css";
import { Banner, ICON_NAMES, Segmented, tokens } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAppearance, type Accent, type Theme } from "../../app/appearance";
import { ActionsSection } from "./sections/ActionsSection";
import { ColourSection } from "./sections/ColourSection";
import { DataSection } from "./sections/DataSection";
import { FeedbackSection } from "./sections/FeedbackSection";
import { InputsSection } from "./sections/InputsSection";
import { LayoutSection } from "./sections/LayoutSection";
import { NamingSection } from "./sections/NamingSection";
import { TypeSection } from "./sections/TypeSection";

const DESIGN_SYSTEM_URL = "https://claude.ai/artifact/JvLZ3QNmMk1yn8rgkwKTpc";
const DESIGN_SYSTEM_VERSION = "1793771637-233f";

const NAV = [
  ["colour", "Colour"],
  ["type", "Type"],
  ["layout", "Space and layout"],
  ["actions", "Actions"],
  ["inputs", "Inputs"],
  ["data", "Data"],
  ["feedback", "Layout and feedback"],
  ["naming", "Names in design and code"],
] as const;

export function DesignSystemPage() {
  const { theme, accent, setTheme, setAccent } = useAppearance();

  useEffect(() => {
    document.title = "Design system · MTB";
  }, []);

  return (
    <div className="mx-auto grid max-w-[1440px] gap-8 px-6 py-6 lg:grid-cols-[208px_minmax(0,1fr)]">
      <nav aria-label="Design system sections" className="hidden lg:block">
        <div className="sticky top-6 grid gap-1">
          <span className="px-3 pb-2 text-title-2">MTB</span>
          {NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-md px-3 py-2 font-medium text-ink-muted no-underline hover:bg-surface-hover hover:text-ink">
              {label}
            </a>
          ))}
        </div>
      </nav>

      <main className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-12">
        <header className="grid gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid gap-1">
              <h1 className="m-0 text-display">Design system</h1>
              <p className="m-0 text-ink-muted">
                {tokens.name} · staff app, teacher app and parent portal · {tokens.color.tokens.length} colour tokens · {ICON_NAMES.length} icons
              </p>
              <p className="m-0 text-small text-ink-muted">
                Tokens, styles and icons come unchanged from the{" "}
                <a href={DESIGN_SYSTEM_URL} target="_blank" rel="noreferrer" className="text-brand-ink underline underline-offset-2">
                  MTB Campus design system
                </a>{" "}
                (version <span className="mtb-mono">{DESIGN_SYSTEM_VERSION}</span>). Contrast ratios are checked by a test on every build.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="grid gap-1.5">
                <span className="mtb-label">Theme</span>
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
              <div className="grid gap-1.5">
                <span className="mtb-label">Brand</span>
                <Segmented
                  aria-label="Brand colour"
                  value={accent}
                  onChange={(v) => setAccent(v as Accent)}
                  options={[
                    { value: "green", label: "MTB green" },
                    { value: "navy", label: "Navy (alternative)" },
                  ]}
                />
              </div>
            </div>
          </div>
          {accent === "navy" && (
            <Banner tone="info" title="Previewing the navy alternative.">
              It is not part of the MTB Campus design system; it is here so management can compare. Status colours and the focus ring don't change.
            </Banner>
          )}
        </header>

        <ColourSection accent={accent} />
        <TypeSection />
        <LayoutSection />
        <ActionsSection />
        <InputsSection />
        <DataSection />
        <FeedbackSection />
        <NamingSection />

        <footer className="border-t border-border pt-6 text-small text-ink-muted">
          All names, numbers and CNICs on this page are fictional. Deliverable 1 of the MTB demo; every screen state is collected on the{" "}
          <Link to="/states" className="text-brand-ink underline underline-offset-2">
            States page
          </Link>
          .
        </footer>
      </main>
    </div>
  );
}
