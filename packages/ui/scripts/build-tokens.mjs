// Generates src/styles/tokens.css and src/styles/theme.css from src/tokens/tokens.json.
// tokens.json is copied verbatim from the "MTB Campus" design system artifact — never edit the CSS by hand.
// Run: pnpm --filter @mtb/ui tokens
import { readFileSync, writeFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const write = (p, text) => writeFileSync(new URL(`../${p}`, import.meta.url), text);

const tokens = JSON.parse(read("src/tokens/tokens.json"));
const themes = tokens.color.themes.map((t) => t.id); // ["light", "dark"]
const [firstTheme] = themes;

const HEADER = `/* ${tokens.name} — generated from tokens.json by scripts/build-tokens.mjs. Do not edit. */\n`;

function resolveValue(value, theme) {
  const raw = typeof value === "string" ? value : (value[theme] ?? value[firstTheme]);
  const alias = /^\{([A-Za-z0-9_.-]+)\}$/.exec(raw);
  return alias ? `var(--${alias[1]})` : raw;
}

// Self-hosted variable fonts (Fontsource) are listed first; the design system's own stacks follow unchanged.
const SELF_HOSTED = { sans: '"Inter Variable"', urdu: '"Noto Nastaliq Urdu Variable"', mono: '"JetBrains Mono Variable"' };
const families = Object.fromEntries(
  Object.entries(tokens.type.families).map(([k, stack]) => [k, SELF_HOSTED[k] ? `${SELF_HOSTED[k]}, ${stack}` : stack]),
);

function themeBlock(theme) {
  const lines = [];
  // Aliases are repeated in every theme block so a nested [data-theme] container recomputes them.
  for (const t of tokens.color.tokens) lines.push(`  --${t.name}: ${resolveValue(t.value, theme)};`);
  for (const t of tokens.shadow.tokens) lines.push(`  --${t.name}: ${resolveValue(t.value, theme)};`);
  return lines.join("\n");
}

const invariant = [
  ...Object.entries(families).map(([k, v]) => `  --font-${k}: ${v};`),
  ...tokens.spacing.tokens.map((t) => `  --${t.name}: ${t.value};`),
  ...tokens.radius.tokens.map((t) => `  --${t.name}: ${t.value};`),
].join("\n");

const tokensCss = `${HEADER}
:root {
${invariant}
}

:root,
[data-theme="${firstTheme}"] {
  color-scheme: light;
${themeBlock(firstTheme)}
}
${themes
  .slice(1)
  .map(
    (theme) => `
[data-theme="${theme}"] {
  color-scheme: ${theme === "dark" ? "dark" : "light"};
${themeBlock(theme)}
}
`,
  )
  .join("")}`;

// Tailwind v4 theme: utilities reference the design-system variables (inline), and Tailwind's own
// palettes, radii, shadows and font sizes are reset so only design-system values can be used.
const textStyles = tokens.type.groups
  .filter((g) => g.family === "sans")
  .flatMap((g) => g.styles)
  .map((s) =>
    [
      `  --text-${s.name}: ${s.fontSize};`,
      `  --text-${s.name}--line-height: ${s.lineHeight};`,
      `  --text-${s.name}--font-weight: ${s.fontWeight};`,
      s.letterSpacing ? `  --text-${s.name}--letter-spacing: ${s.letterSpacing};` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  )
  .join("\n");

const urduUtilities = tokens.type.groups
  .filter((g) => g.family === "urdu")
  .flatMap((g) => g.styles)
  .map(
    (s) => `@utility ${s.name} {
  font-family: var(--font-urdu);
  font-size: ${s.fontSize};
  line-height: ${s.lineHeight};
  font-weight: ${s.fontWeight};
  direction: rtl;
  unicode-bidi: isolate;
}`,
  )
  .join("\n\n");

// Type and shadow utilities are often picked by name at runtime (text-${name}, urdu-${size}), so Tailwind's
// scanner can't see them: generate them always.
const safelist = [
  ...tokens.type.groups.filter((g) => g.family === "sans").flatMap((g) => g.styles.map((s) => `text-${s.name}`)),
  ...tokens.type.groups.filter((g) => g.family === "urdu").flatMap((g) => g.styles.map((s) => s.name)),
  ...tokens.shadow.tokens.map((t) => t.name),
].join(" ");

const themeCss = `${HEADER}
@source inline("${safelist}");

@theme inline {
  --color-*: initial;
${tokens.color.tokens.map((t) => `  --color-${t.name}: var(--${t.name});`).join("\n")}

  --font-*: initial;
${Object.keys(families)
  .map((k) => `  --font-${k}: var(--font-${k});`)
  .join("\n")}

  --radius-*: initial;
${tokens.radius.tokens.map((t) => `  --${t.name}: var(--${t.name});`).join("\n")}
}

@theme {
  --shadow-*: initial;
  --text-*: initial;
${textStyles}
}

${tokens.shadow.tokens.map((t) => `@utility ${t.name} {\n  box-shadow: var(--${t.name});\n}`).join("\n\n")}

${urduUtilities}
`;

// Navy alternative (not in the design system): same structure, only brand-derived tokens.
const alternatives = JSON.parse(read("src/tokens/alternatives.json"));
const navy = alternatives.navy;
const navyBlock = (theme) => Object.entries(navy[theme]).map(([k, v]) => `  --${k}: ${v};`).join("\n");
const accentCss = `${HEADER}/* ${alternatives.note} */

:root[data-accent="navy"]:not([data-theme="dark"]),
[data-theme="light"][data-accent="navy"] {
${navyBlock("light")}
}

[data-theme="dark"][data-accent="navy"] {
${navyBlock("dark")}
}
`;

write("src/styles/tokens.css", tokensCss);
write("src/styles/accent-navy.css", accentCss);
write("src/styles/theme.css", themeCss);

// Names of the sans text styles, for tailwind-merge (so text-body is a size, not a colour).
const sizeNames = tokens.type.groups.filter((g) => g.family === "sans").flatMap((g) => g.styles.map((s) => s.name));
write(
  "src/tokens/text-styles.ts",
  `// Generated by scripts/build-tokens.mjs from tokens.json. Do not edit.\nexport const TEXT_STYLE_NAMES = ${JSON.stringify(sizeNames)} as const;\n`,
);

console.log(`tokens.css: ${tokens.color.tokens.length} colours × ${themes.length} themes, ${tokens.spacing.tokens.length} spacing, ${tokens.radius.tokens.length} radii, ${tokens.shadow.tokens.length} shadows`);
console.log(`theme.css: ${sizeNames.length} text styles`);
