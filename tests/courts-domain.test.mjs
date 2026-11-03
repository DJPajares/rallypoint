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
    "data:text/html,hi",
    "//maps.google.com/x",
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

test("a Maps link is saved as the browser reads it", () => {
  const saved = (mapsLink) => {
    const r = normalizeCourt({ area: "bedok", name: "Court", mapsLink });
    return r.ok ? r.value.mapsUrl : r.errors[0].message;
  };
  assert.equal(
    saved("https://www.google.com/maps/search/?query=Bedok Hall"),
    "https://www.google.com/maps/search/?query=Bedok%20Hall",
  );
  assert.equal(saved("HTTPS://maps.app.goo.gl/x"), "https://maps.app.goo.gl/x");
  assert.equal(
    saved("https://maps.app.goo.gl/a\nb"),
    "https://maps.app.goo.gl/ab",
  );
  assert.equal(
    saved(`https://maps.app.goo.gl/${"a".repeat(480)}`),
    "Use a link of up to 500 characters.",
  );
});

test("a court name needs a letter or a plain digit", () => {
  for (const name of ["①", "²", "Ⅻ"])
    assert.equal(
      normalizeCourt({ area: "bedok", name, mapsLink: "" }).ok,
      false,
      name,
    );
  assert.ok(
    normalizeCourt({ area: "bedok", name: "Court 2", mapsLink: "" }).ok,
  );
});
