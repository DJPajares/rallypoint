import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const render = (...args) =>
  spawnSync(process.execPath, ["scripts/render-staging-schema.mjs", ...args], {
    encoding: "utf8",
  });
const source = readdirSync("supabase/migrations")
  .filter((n) => /^\d+_.+\.sql$/.test(n))
  .sort();
const expected = source.filter(
  (n) =>
    n > "20261022170000_badges.sql" &&
    n <= "20261023144000_email_attempting_is_ambiguous.sql",
);
const map = (s) =>
  s
    .replace(/\bapp\b/g, "rallypoint")
    .replace(/\bapi\b/g, "rallypoint_api")
    .replaceAll("'payment-qr'", "'rallypoint-payment-qr'");

test("staging upgrade selects only the exact missing reviewed source migrations", () => {
  const r = render("--upgrade");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(expected.length, 16);
  const included = [...r.stdout.matchAll(/^-- Source: (.+)$/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(included, expected);
  for (const file of expected)
    assert.ok(
      r.stdout.includes(
        map(readFileSync("supabase/migrations/" + file, "utf8")),
      ),
      file,
    );
  assert.match(r.stdout, /known bootstrap/i);
  assert.match(r.stdout, /already upgraded or partially upgraded/i);
  assert.ok(!/\b(?:app|api)\./.test(r.stdout));
});

test("initial installs retain their guard and invalid renderer modes emit no SQL", () => {
  const initial = render();
  assert.equal(initial.status, 0, initial.stderr);
  assert.match(initial.stdout, /RallyPoint namespace already exists/);
  assert.deepEqual(
    [...initial.stdout.matchAll(/^-- Source: (.+)$/gm)].map((m) => m[1]),
    source,
  );
  for (const args of [
    ["--unknown"],
    ["--upgrade", "--upgrade"],
    ["--after", "20261022170000"],
  ]) {
    const r = render(...args);
    assert.notEqual(r.status, 0);
    assert.equal(r.stdout, "");
  }
});

test("Sessions/Profile repair includes only the five missing migrations and refuses drift", () => {
  const r = render("--upgrade-sessions-profiles");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(
    [...r.stdout.matchAll(/^-- Source: (.+)$/gm)].map((m) => m[1]),
    source.filter(
      (n) =>
        n > "20261023144000_email_attempting_is_ambiguous.sql" &&
        n <= "20261024100000_profile_fixes.sql",
    ),
  );
  assert.match(r.stdout, /53b0a936b162b0555bf193e879cd1761/);
  assert.match(r.stdout, /pg_get_functiondef/);
  assert.match(r.stdout, /already upgraded or partially upgraded/);
  assert.ok(!/\b(?:app|api)\./.test(r.stdout));
});
