import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHistory } from "../packages/database/migrations.mjs";

// Hosted databases get the migrations with the schema names rewritten as plain
// text (app -> rallypoint, api -> rallypoint_api). A pattern inside a string
// that happens to contain one of those words gets rewritten too, so what runs
// in production isn't what ran locally. This renders the real migrations for
// production and checks what is left.
const rendered = renderHistory("production");
const sqlOf = (name) => rendered.find((m) => m.name === name)?.sql ?? "";

test("the Maps link rule keeps its host patterns when rendered for production", () => {
  const sql = sqlOf("20261104100000_maps_link_rule_fix");
  assert.ok(sql, "the fix migration is part of the production history");
  const pattern = /details->>'mapsLink' ~ '([^']+)'/.exec(sql)?.[1];
  assert.ok(pattern, "the rule's pattern is in the rendered SQL");
  const rule = new RegExp(pattern);
  for (const link of [
    "https://maps.app.goo.gl/9B9beSYwRVWxfZhT6",
    "https://maps.google.com/?cid=1",
    "https://www.google.com/maps/place/Court",
    "https://goo.gl/maps/AbC123",
  ])
    assert.ok(rule.test(link), `${link} must be allowed`);
  for (const link of [
    "https://maps.rallypoint.goo.gl/x",
    "https://maps.appxgoo.gl/x",
    "http://maps.app.goo.gl/x",
    "https://evil.example/maps.app.goo.gl/x",
  ])
    assert.ok(!rule.test(link), `${link} must be refused`);
});

test("no migration after the maps rule keeps a bare schema word inside a pattern", () => {
  // A pattern is a quoted string with a regex escape in it; none of them may
  // contain app or api as a whole word, which the rewrite would change.
  // The earlier maps migrations were already applied rewritten; the fix replaces them.
  for (const m of rendered.filter((m) => m.name >= "20261104100000")) {
    const patterns = [...m.sql.matchAll(/~\s*'([^']*\\[^']*)'/g)].map(
      (x) => x[1],
    );
    for (const p of patterns)
      assert.doesNotMatch(
        p,
        /rallypoint/,
        `${m.name} has a rewritten pattern: ${p}`,
      );
  }
});
