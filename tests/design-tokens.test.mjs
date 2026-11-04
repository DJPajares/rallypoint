import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// The look is decided in packages/ui/src/styles/globals.css (and tokens.ts for
// the few values JavaScript needs). Everywhere else must use
// its tokens, so a restyle stays a one-file change.
const roots = ["packages/ui/src", "apps/web/src", "apps/web/app"];
const files = roots.flatMap(function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(css|tsx?)$/.test(entry.name) &&
      !/packages\/ui\/src\/(styles\/globals\.css|tokens\.ts)$/.test(path)
      ? [path]
      : [];
  });
});
const rules = [
  ["a raw hex colour", /#[0-9a-f]{3,8}\b(?![^"]*<\/svg>)/i],
  ["a raw rgb()/hsl() colour", /\b(?:rgba?|hsla?|oklch)\(/],
  ["a literal font-size", /font-size:(?!\s*(?:var\(|inherit))/],
  ["a literal border-radius", /border-radius:(?![^;]*var\(|\s*(?:0|inherit);)/],
  ["a literal box-shadow", /box-shadow:(?!\s*(?:var\(|none))/],
  // Tailwind (D-24): theme utilities only, never one-off values.
  ["an arbitrary colour class", /-\[(?:#|rgba?\(|hsla?\(|oklch\()/],
  ["an arbitrary font size class", /\btext-\[\d/],
  ["an arbitrary radius class", /\brounded(?:-[a-z]+)?-\[\d/],
  // Colours use shadcn's names (bg-card, text-muted-foreground, bg-primary);
  // the old RallyPoint names no longer exist and would render nothing.
  [
    "a retired colour name",
    /(?<![\w-])(?:bg|text|border|ring|outline|fill|stroke|decoration)-(?:surface(?:-sunken)?|text(?:-muted)?|border-strong|on-(?:action|chrome|stub|brand)|action(?:-hover)?|(?:success|warning|neutral|danger)-bg|brand-graphite|focus)(?![\w-])/,
  ],
];
test("styles use design tokens instead of literal values", () => {
  const problems = [];
  for (const file of files) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        // Data-URI shapes (the bar's notch) carry geometry, not colour.
        if (line.includes("data:image/svg+xml")) return;
        for (const [what, pattern] of rules)
          if (pattern.test(line))
            problems.push(`${file}:${index + 1} uses ${what}: ${line.trim()}`);
      });
  }
  assert.deepEqual(problems, []);
});

// Brand colours (PRD D-28) and WCAG 2.2 AA contrast for every pair the
// screens put together, in light and dark.
const theme = readFileSync("packages/ui/src/styles/globals.css", "utf8");
function block(selector) {
  const start = theme.indexOf(`\n${selector} {`);
  const body = theme.slice(start, theme.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [
      m[1],
      m[2].toLowerCase(),
    ]),
  );
}
const light = block(":root");
const dark = { ...light, ...block(".dark") };
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("the brand colours are Mandarin Orange, Forest Green and Crest Yellow", () => {
  assert.equal(light.primary, "#fd550a");
  assert.equal(light.chrome, "#015d47");
  assert.equal(light.stub, "#015d47");
  assert.equal(light.brand, "#015d47");
  assert.equal(light["secondary-foreground"], "#015d47");
  assert.equal(light.tertiary, "#e0f354");
  assert.equal(dark.primary, "#fd550a");
  assert.equal(dark.tertiary, "#e0f354");
});

test("every colour pair meets WCAG AA in light and dark", () => {
  const text = [
    ["primary-foreground", "primary"],
    ["primary-foreground", "primary-hover"],
    ["secondary-foreground", "secondary"],
    ["tertiary-foreground", "tertiary"],
    ["chrome-foreground", "chrome"],
    ["stub-foreground", "stub"],
    ["brand-foreground", "brand"],
    ["link", "background"],
    ["link", "card"],
    ["foreground", "background"],
    ["muted-foreground", "card"],
    ["success-foreground", "success"],
    ["warning-foreground", "warning"],
    ["danger-foreground", "danger"],
  ];
  // Marks that carry meaning without words need 3:1 (WCAG 1.4.11).
  const marks = [
    ["chrome", "background"],
    ["chrome", "card"],
    ["ring", "background"],
  ];
  const problems = [];
  for (const [name, values] of [
    ["light", light],
    ["dark", dark],
  ]) {
    for (const [pairs, min] of [
      [text, 4.5],
      [marks, 3],
    ])
      for (const [fg, bg] of pairs) {
        const ratio = contrast(values[fg], values[bg]);
        if (!(ratio >= min))
          problems.push(`${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
      }
  }
  assert.deepEqual(problems, []);
});
