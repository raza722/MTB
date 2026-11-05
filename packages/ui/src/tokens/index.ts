import alternativesJson from "./alternatives.json";
import tokensJson from "./tokens.json";

export interface ColorToken {
  name: string;
  value: string | Record<string, string>;
  usage: string;
}

export const tokens = tokensJson as unknown as {
  name: string;
  color: { note: string; themes: Array<{ id: string; name: string }>; tokens: ColorToken[] };
  type: {
    note: string;
    families: Record<string, string>;
    groups: Array<{
      name: string;
      family: string;
      styles: Array<{ name: string; fontSize: string; lineHeight: string; fontWeight: number; letterSpacing?: string; sample: string; usage: string }>;
    }>;
  };
  spacing: { note: string; tokens: Array<{ name: string; value: string; usage: string }> };
  radius: { tokens: Array<{ name: string; value: string; usage: string }> };
  shadow: { note: string; tokens: Array<{ name: string; value: Record<string, string>; usage: string }> };
};

export type ThemeId = "light" | "dark";
export type AccentId = "green" | "navy";

/** Navy brand offered for management's choice (not part of the design system). */
export const accentAlternatives = alternativesJson as {
  note: string;
  navy: Record<ThemeId, Record<string, string>>;
};

const byName = new Map(tokens.color.tokens.map((t) => [t.name, t]));

/** Resolve a colour token (following {aliases}) to its literal value in a theme. */
export function resolveColor(name: string, theme: ThemeId, accent: AccentId = "green", seen = new Set<string>()): string {
  const override = accent === "navy" ? accentAlternatives.navy[theme][name] : undefined;
  if (override) return override;
  const token = byName.get(name);
  if (!token) throw new Error(`Unknown colour token: ${name}`);
  if (seen.has(name)) throw new Error(`Alias loop at ${name}`);
  seen.add(name);
  const raw = typeof token.value === "string" ? token.value : (token.value[theme] ?? token.value.light ?? "");
  const alias = /^\{(.+)\}$/.exec(raw);
  return alias?.[1] ? resolveColor(alias[1], theme, accent, seen) : raw;
}

export type ContrastKind = "text" | "non-text";

export interface ContrastPair {
  fg: string;
  bg: string;
  kind: ContrastKind;
  /** Why this pair must pass, in design-system terms. */
  why: string;
}

/** Minimum ratio: 4.5:1 for text, 3:1 for control borders, focus rings, icons and chart marks. */
export const CONTRAST_MINIMUM: Record<ContrastKind, number> = { text: 4.5, "non-text": 3 };

const text = (fg: string, bg: string, why: string): ContrastPair => ({ fg, bg, kind: "text", why });
const ui = (fg: string, bg: string, why: string): ContrastPair => ({ fg, bg, kind: "non-text", why });

const grounds = ["surface", "surface-raised", "surface-sunken"] as const;
const signals = ["success", "warning", "danger", "info", "neutral", "slate"] as const;

/** Every pairing the design system's usage notes promise. */
export const CONTRAST_PAIRS: ContrastPair[] = [
  ...grounds.map((g) => text("ink", g, "Body text and headings")),
  text("ink", "surface-hover", "Body text on a hovered row"),
  text("ink", "surface-selected", "Body text on a selected row"),
  ...grounds.map((g) => text("ink-muted", g, "Labels and secondary text (4.5:1 on every ground)")),
  text("ink-muted", "surface-hover", "Secondary text on a hovered row"),
  text("ink-subtle", "surface-raised", "Placeholder text"),
  text("on-brand", "brand", "Primary button label"),
  text("on-brand", "brand-hover", "Primary button label, hover"),
  text("on-brand", "brand-active", "Primary button label, pressed"),
  text("ink-inverse", "brand", "Text on brand"),
  text("brand-ink", "surface", "Links on the page"),
  text("brand-ink", "surface-raised", "Links on cards"),
  text("brand-ink", "brand-tint", "Active nav label, campus pill"),
  text("brand-ink", "surface-selected", "Selected row accent text"),
  text("on-danger", "danger", "Destructive button label"),
  text("on-danger", "danger-hover", "Destructive button label, hover"),
  ...signals.flatMap((s) => [text(`${s}-ink`, `${s}-tint`, `${s} badge / banner text`), text(`${s}-ink`, "surface-raised", `${s} text on a card`)]),
  ui("border-strong", "surface-raised", "Input border at rest"),
  ui("border-strong", "surface", "Control border on the page"),
  ...grounds.map((g) => ui("focus-ring", g, "Focus ring (≥3:1 on every surface)")),
  ui("brand", "surface-raised", "Primary button edge"),
  ...(["success", "warning", "danger", "info"] as const).map((s) => ui(s, "surface-raised", s === "danger" ? "Validation error border, danger icon or dot" : `${s} icon or status dot`)),
  ...(["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const).map((c) => ui(c, "surface-raised", "Chart series mark")),
  ui("chart-1", "chart-track", "Progress meter fill against its track"),
];
