import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// The look is decided in packages/ui/src/tokens.css (and tokens.ts for the
// few values JavaScript needs). Everywhere else must use
// its tokens, so a restyle stays a one-file change.
const roots = ["packages/ui/src", "apps/web/src", "apps/web/app"];
const files = roots.flatMap(function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(css|tsx?)$/.test(entry.name) &&
      !/packages\/ui\/src\/tokens\.(css|ts)$/.test(path)
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
