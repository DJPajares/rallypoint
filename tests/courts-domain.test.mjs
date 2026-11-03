import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCourt } from "../packages/domain/src/courts.ts";

const fields = (r) => (r.ok ? [] : r.errors.map((e) => e.field));

test("a court needs an area and a name of 1 to 60 characters", () => {
  assert.deepEqual(
    normalizeCourt({
      area: "pasir-ris",
      name: "  Pasir Ris Sports Centre ",
      mapsLink: "",
    }),
    {
      ok: true,
      value: {
        area: "pasir-ris",
        name: "Pasir Ris Sports Centre",
        mapsUrl: null,
      },
    },
  );
  assert.deepEqual(
    fields(normalizeCourt({ area: "", name: "   ", mapsLink: "" })),
    ["area", "name"],
  );
  assert.deepEqual(
    fields(
      normalizeCourt({ area: "tampines", name: "x".repeat(61), mapsLink: "" }),
    ),
    ["name"],
  );
  assert.ok(
    normalizeCourt({ area: "tampines", name: "x".repeat(60), mapsLink: "" }).ok,
  );
  assert.deepEqual(
    fields(normalizeCourt({ area: "tampines", name: "Hall\nB", mapsLink: "" })),
    ["name"],
  );
  assert.deepEqual(
    fields(normalizeCourt({ area: "tampines", name: "---", mapsLink: "" })),
    ["name"],
  );
});

test("a Maps link is optional but must be an https address", () => {
  const ok = normalizeCourt({
    area: "pasir-ris",
    name: "Court",
    mapsLink: " https://maps.app.goo.gl/abc ",
  });
  assert.equal(ok.ok && ok.value.mapsUrl, "https://maps.app.goo.gl/abc");
  for (const link of [
    "http://maps.google.com/x",
    "maps.google.com",
    "javascript:alert(1)",
    `https://example.com/${"a".repeat(500)}`,
  ]) {
    const r = normalizeCourt({
      area: "pasir-ris",
      name: "Court",
      mapsLink: link,
    });
    assert.deepEqual(fields(r), ["mapsLink"], link);
    assert.equal(r.errors[0].message, "Use a link that starts with https://.");
  }
});
