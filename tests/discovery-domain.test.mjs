import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeFilterCount,
  dayStrip,
  filterSessions,
  noFilters,
  priceLabel,
  spotsLabel,
  startOfDay,
  timeOfDay,
} from "../packages/domain/src/discovery.ts";

const now = new Date("2026-11-03T04:00:00Z"); // 12:00 Tuesday in Singapore
const row = (over = {}) => ({
  slug: "s",
  title: "Morning hit",
  activity: "Pickleball",
  startsAt: "2026-11-03T01:00:00Z", // 09:00 in Singapore
  endsAt: "2026-11-03T02:30:00Z",
  timeZone: "Asia/Singapore",
  location: "Court",
  hostName: "Sam",
  capacity: 8,
  takenSeats: 3,
  joinMode: "direct",
  currency: "SGD",
  feeMinor: 0,
  totalMinor: null,
  feeMode: "fixed",
  paymentMode: "organizer",
  day: "2026-11-03",
  happeningNow: false,
  ...over,
});
// Singapore local hh:mm on 3 Nov as an instant.
const at = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 3, h - 8, m)).toISOString();
};

test("the strip starts today and names the next days plainly", () => {
  const strip = dayStrip(now, "Asia/Singapore");
  assert.equal(strip.length, 14);
  assert.deepEqual(
    strip.slice(0, 3).map((d) => [d.key, d.label]),
    [
      ["2026-11-03", "Today"],
      ["2026-11-04", "Tomorrow"],
      ["2026-11-05", "Thu 5"],
    ],
  );
  assert.equal(strip[2].short, "Thu");
  assert.equal(strip[13].key, "2026-11-16");
});

test("the day starts at local midnight", () => {
  assert.equal(startOfDay(now, "Asia/Singapore"), "2026-11-02T16:00:00Z");
  assert.equal(
    startOfDay(new Date("2026-11-03T16:30:00Z"), "Asia/Singapore"),
    "2026-11-03T16:00:00Z",
  );
});

test("time of day follows the session's own clock, with plain boundaries", () => {
  assert.equal(timeOfDay(row({ startsAt: at("11:59") })), "morning");
  assert.equal(timeOfDay(row({ startsAt: at("12:00") })), "afternoon");
  assert.equal(timeOfDay(row({ startsAt: at("16:59") })), "afternoon");
  assert.equal(timeOfDay(row({ startsAt: at("17:00") })), "evening");
  assert.equal(timeOfDay(row({ startsAt: at("23:30") })), "evening");
});

test("each filter narrows on its own and together", () => {
  const rows = [
    row({
      slug: "a",
      activity: "Pickleball",
      startsAt: at("09:00"),
      feeMinor: 0,
    }),
    row({
      slug: "b",
      activity: "Badminton",
      startsAt: at("19:00"),
      feeMinor: 800,
    }),
    row({
      slug: "c",
      activity: "Pickleball",
      startsAt: at("13:00"),
      takenSeats: 8,
    }),
    row({
      slug: "d",
      activity: "Pickleball",
      startsAt: at("18:00"),
      joinMode: "request",
    }),
    row({
      slug: "e",
      activity: "Tennis",
      startsAt: at("10:00"),
      feeMinor: null,
      feeMode: "split",
      totalMinor: 2400,
    }),
  ];
  const slugs = (f) =>
    filterSessions(rows, { ...noFilters, ...f }).map((r) => r.slug);
  assert.deepEqual(slugs({}), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(slugs({ activities: ["Pickleball"] }), ["a", "c", "d"]);
  assert.deepEqual(slugs({ times: ["evening"] }), ["b", "d"]);
  assert.deepEqual(slugs({ times: ["morning", "afternoon"] }), ["a", "c", "e"]);
  assert.deepEqual(slugs({ price: "free" }), ["a", "c", "d"]);
  // A fee the app doesn't track is neither free nor known to be paid.
  const untracked = [
    row({ slug: "u", paymentMode: "untracked", feeMinor: null }),
  ];
  assert.deepEqual(
    filterSessions(untracked, { ...noFilters, price: "free" }),
    [],
  );
  assert.deepEqual(
    filterSessions(untracked, { ...noFilters, price: "paid" }),
    [],
  );
  assert.deepEqual(slugs({ price: "paid" }), ["b", "e"]);
  assert.deepEqual(slugs({ spotsLeft: true }), ["a", "b", "d", "e"]);
  assert.deepEqual(slugs({ joining: "request" }), ["d"]);
  assert.deepEqual(slugs({ joining: "direct" }), ["a", "b", "c", "e"]);
  assert.deepEqual(
    slugs({ activities: ["Pickleball"], spotsLeft: true, times: ["evening"] }),
    ["d"],
  );
  assert.equal(activeFilterCount(noFilters), 0);
  assert.equal(
    activeFilterCount({
      ...noFilters,
      activities: ["A", "B"],
      price: "free",
      spotsLeft: true,
    }),
    4,
  );
});

test("spots and price read plainly", () => {
  assert.equal(spotsLabel(row({ takenSeats: 5 })), "3 spots left");
  assert.equal(spotsLabel(row({ takenSeats: 7 })), "1 spot left");
  assert.equal(spotsLabel(row({ takenSeats: 8 })), "Full · waitlist");
  assert.equal(spotsLabel(row({ joinMode: "request" })), "Ask to join");
  assert.equal(priceLabel(row()), "Free");
  assert.match(priceLabel(row({ feeMinor: 800 })), /^SGD\s8\.00$/u);
  assert.match(
    priceLabel(row({ feeMode: "split", feeMinor: null, totalMinor: 2400 })),
    /^≈ SGD\s3\.00 each$/u,
  );
  assert.equal(
    priceLabel(row({ paymentMode: "untracked", feeMinor: null })),
    "Fee set by the host",
  );
});
