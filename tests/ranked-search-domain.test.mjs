import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSearch } from "../packages/domain/src/ranked-search.ts";

const base = {
  format: "singles",
  areas: ["bedok"],
  courts: [],
  windows: [],
  partner: null,
};
const fields = (input) => {
  const r = normalizeSearch({ ...base, ...input });
  return r.ok ? [] : r.errors.map((e) => e.field);
};

test("a search needs a format and 1 to 3 different areas", () => {
  assert.deepEqual(fields({}), []);
  assert.deepEqual(fields({ format: "triples" }), ["format"]);
  assert.deepEqual(fields({ areas: [] }), ["areas"]);
  assert.deepEqual(fields({ areas: ["a", "b", "c", "d"] }), ["areas"]);
  assert.deepEqual(fields({ areas: ["bedok", "bedok"] }), ["areas"]);
});

test("courts, times and partner follow the format", () => {
  assert.deepEqual(fields({ courts: ["1", "2", "3", "4", "5", "6"] }), [
    "courts",
  ]);
  assert.deepEqual(fields({ windows: ["midnight"] }), ["windows"]);
  assert.deepEqual(fields({ windows: ["weekday-evenings"] }), []);
  assert.deepEqual(fields({ format: "doubles" }), ["partner"]);
  assert.deepEqual(fields({ format: "doubles", partner: { link: true } }), []);
  assert.deepEqual(fields({ partner: { link: true } }), ["partner"]);
});
