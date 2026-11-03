import { test } from "node:test";
import assert from "node:assert/strict";
import { rankedSessionForm } from "../packages/domain/src/ranked-booking.ts";
import { normalizeSession } from "../packages/domain/src/session.ts";

const now = new Date("2026-11-03T04:07:30Z"); // 12:07 in Singapore
const input = (over = {}) => ({
  format: "doubles",
  players: 4,
  location: "Tampines Hub court 3",
  mapsLink: "",
  startLocal: "2026-11-06T19:00",
  endLocal: "2026-11-06T20:30",
  cost: "24",
  timeZone: "Asia/Singapore",
  ...over,
});

test("a ranked session opens now and cuts off a day before the start", () => {
  const form = rankedSessionForm(input(), now);
  assert.equal(form.openLocal, "2026-11-03T12:07");
  assert.equal(form.cutoffLocal, "2026-11-05T19:00");
});

test("a same-day booking has its cutoff now", () => {
  const form = rankedSessionForm(
    input({ startLocal: "2026-11-03T17:00", endLocal: "2026-11-03T18:00" }),
    now,
  );
  assert.equal(form.cutoffLocal, form.openLocal);
});

test("the session is private, for exactly the players, with the cost split", () => {
  const form = rankedSessionForm(input(), now);
  assert.equal(form.title, "Ranked Doubles");
  assert.equal(form.activity, "Pickleball");
  assert.equal(form.capacity, "4");
  assert.equal(form.feeMode, "split");
  assert.equal(form.paymentMode, "organizer");
  assert.equal(form.access, "private");
  assert.equal(form.guests, false);
  assert.equal(form.currency, "SGD");
  assert.equal(form.location, "Tampines Hub court 3");
  assert.equal(
    rankedSessionForm(input({ format: "singles", players: 2 }), now).capacity,
    "2",
  );
});

test("the form passes the ordinary session checks", () => {
  const details = normalizeSession(rankedSessionForm(input(), now), true);
  assert.equal(details.totalMinor, 2400);
  assert.equal(details.cutoffAt, "2026-11-05T11:00:00Z");
  assert.equal(details.mapsLink, undefined);
  const linked = normalizeSession(
    rankedSessionForm(input({ mapsLink: "https://maps.app.goo.gl/abc" }), now),
    true,
  );
  assert.equal(linked.mapsLink, "https://maps.app.goo.gl/abc");
});
