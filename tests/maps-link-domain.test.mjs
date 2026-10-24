import test from "node:test";
import assert from "node:assert/strict";
import * as session from "../packages/domain/src/session.ts";
import { nextWeekForm } from "../packages/domain/src/run-again.ts";
const form = {
  title: "Evening practice",
  activity: "Badminton",
  location: "Court A",
  instructions: "",
  capacity: "8",
  currency: "SGD",
  fee: "12",
  guests: true,
  startLocal: "2027-05-09T19:00",
  endLocal: "2027-05-09T21:00",
  openLocal: "2027-05-01T09:00",
  cutoffLocal: "2027-05-08T19:00",
  timeZone: "Asia/Singapore",
};
const link = "https://maps.app.goo.gl/AbC123";

test("accepts each supported Google Maps link and stores the parsed href", () => {
  for (const input of [
    "https://www.google.com/maps/place/Synthetic+Court",
    "https://www.google.com/maps?q=1",
    "https://maps.google.com/?cid=1",
    "https://maps.app.goo.gl/AbC123",
    "https://goo.gl/maps/AbC123",
    "  https://MAPS.APP.GOO.GL/AbC123  ",
  ])
    for (const publish of [true, false])
      assert.equal(
        session.normalizeSession({ ...form, mapsLink: input }, publish)
          .mapsLink,
        new URL(input.trim()).href,
        input,
      );
});

test("blank or missing link is omitted", () => {
  for (const mapsLink of [undefined, "", "   "]) {
    const result = session.normalizeSession({ ...form, mapsLink }, true);
    assert.equal("mapsLink" in result, false, JSON.stringify(mapsLink));
  }
});

test("rejects unsafe or unrelated links with the field message", () => {
  assert.equal(session.mapsLinkError, "Use a link copied from Google Maps.");
  for (const mapsLink of [
    "javascript:alert(1)",
    "http://www.google.com/maps/place/x",
    "https://www.google.com.evil.example/maps/place/test",
    "https://www.google.com@evil.example/maps",
    "https://user:pw@www.google.com/maps",
    "https://www.google.com:444/maps",
    "https://www.google.com/mapsevil",
    "https://www.google.com/search?q=x",
    "https://maps.app.goo.gl/",
    "https://goo.gl/maps/",
    "https://goo.gl/abc",
    "https://example.com/",
    "not a url",
    42,
    "https://maps.app.goo.gl/" + "a".repeat(2030),
  ])
    for (const publish of [true, false])
      assert.throws(
        () => session.normalizeSession({ ...form, mapsLink }, publish),
        { message: session.mapsLinkError },
        String(mapsLink).slice(0, 60),
      );
});

test("a link-only change is material, an equal or both-missing link is not", () => {
  const without = session.normalizeSession(form, true);
  const withLink = session.normalizeSession({ ...form, mapsLink: link }, true);
  const other = session.normalizeSession(
    { ...form, mapsLink: "https://www.google.com/maps/place/Other" },
    true,
  );
  assert.equal(session.hasMaterialSessionChange(without, withLink), true);
  assert.equal(session.hasMaterialSessionChange(withLink, without), true);
  assert.equal(session.hasMaterialSessionChange(withLink, other), true);
  assert.equal(
    session.hasMaterialSessionChange(withLink, { ...withLink }),
    false,
  );
  assert.equal(
    session.hasMaterialSessionChange(without, { ...without }),
    false,
  );
});

test("run again copies the link", () => {
  const now = Date.parse("2027-05-01T00:00:00Z");
  const withLink = session.normalizeSession({ ...form, mapsLink: link }, true);
  assert.equal(nextWeekForm(withLink, now).mapsLink, link);
  assert.equal(
    nextWeekForm(session.normalizeSession(form, true), now).mapsLink,
    "",
  );
});
