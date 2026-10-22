import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// apps/api must run on any host that speaks fetch(request, env), so moving it
// out of the Next.js app later is a deployment change, not a rewrite.
const forbidden =
  /from\s+["'](next|next\/.*|react|react-dom|@opennextjs\/.*|server-only|@vercel\/.*)["']|import\s+["'](server-only|next\/.*)["']/;
test("apps/api stays free of web-framework and host-specific code", () => {
  const problems = [];
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (forbidden.test(line)) problems.push(`${path}:${i + 1}: ${line}`);
        });
    });
  walk("apps/api/src");
  const pkg = JSON.parse(readFileSync("apps/api/package.json", "utf8"));
  for (const name of Object.keys({
    ...pkg.dependencies,
    ...pkg.devDependencies,
  }))
    if (
      /^(next|react|react-dom|server-only|@opennextjs\/|@vercel\/)/.test(name)
    )
      problems.push(`apps/api/package.json depends on ${name}`);
  assert.deepEqual(problems, []);
});
