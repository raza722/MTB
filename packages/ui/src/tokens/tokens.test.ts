import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, formatRatio } from "../lib/contrast";
import { CONTRAST_MINIMUM, CONTRAST_PAIRS, resolveColor, tokens, type AccentId, type ThemeId } from "./index";

const THEMES: ThemeId[] = ["light", "dark"];
const ACCENTS: AccentId[] = ["green", "navy"];

describe("MTB Campus tokens — WCAG 2.2 AA", () => {
  for (const theme of THEMES) for (const accent of ACCENTS) {
    it(`every promised pair passes in ${theme} / ${accent}`, () => {
      const failures = CONTRAST_PAIRS.flatMap((p) => {
        const ratio = contrastRatio(resolveColor(p.fg, theme, accent), resolveColor(p.bg, theme, accent));
        if (ratio === null) return [`${p.fg} on ${p.bg}: not an opaque hex colour`];
        return ratio < CONTRAST_MINIMUM[p.kind] ? [`${p.fg} on ${p.bg} = ${formatRatio(ratio)} (needs ${CONTRAST_MINIMUM[p.kind]}:1 — ${p.why})`] : [];
      });
      expect(failures).toEqual([]);
    });
  }

  it("lists each pair once", () => {
    const keys = CONTRAST_PAIRS.map((p) => `${p.fg} on ${p.bg}`);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it("every alias points at a token that exists", () => {
    for (const t of tokens.color.tokens) {
      for (const theme of THEMES) expect(() => resolveColor(t.name, theme)).not.toThrow();
    }
  });

  it("generated tokens.css is in sync with tokens.json", () => {
    const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
    for (const t of tokens.color.tokens) expect(css).toContain(`--${t.name}:`);
  });
});
