import { test } from "node:test";
import assert from "node:assert/strict";
import {
  comingLine,
  gameDayHeadline,
  isGameDay,
  mapsUrl,
  sessionHref,
  statusLabel,
} from "../packages/domain/src/my-sessions.ts";

test("labels say the status in words", () => {
  assert.equal(
    statusLabel({ status: "in", waitPosition: null }, false),
    "You're in",
  );
  assert.equal(
    statusLabel({ status: "waitlisted", waitPosition: 2 }, false),
    "Waitlist #2",
  );
  assert.equal(
    statusLabel({ status: "organizing", waitPosition: null }, false),
    "Organizing",
  );
  assert.equal(
    statusLabel({ status: "draft", waitPosition: null }, false),
    "Draft",
  );
  assert.equal(
    statusLabel({ status: "cancelled", waitPosition: null }, false),
    "Cancelled",
  );
});

test("past labels read in the past", () => {
  assert.equal(
    statusLabel({ status: "in", waitPosition: null }, true),
    "You were in",
  );
  assert.equal(
    statusLabel({ status: "waitlisted", waitPosition: 3 }, true),
    "Waitlisted",
  );
  assert.equal(
    statusLabel({ status: "organizing", waitPosition: null }, true),
    "Organized",
  );
  assert.equal(
    statusLabel({ status: "cancelled", waitPosition: null }, true),
    "Cancelled",
  );
});

test("drafts open their editor, everything else the session page", () => {
  assert.equal(
    sessionHref({ status: "draft", id: "d1", slug: "s1" }),
    "/sessions/d1/edit",
  );
  assert.equal(sessionHref({ status: "in", id: null, slug: "s1" }), "/s/s1");
  assert.equal(
    sessionHref({ status: "organizing", id: null, slug: "s1" }),
    "/s/s1",
  );
});

test("maps link searches the venue text and encodes it", () => {
  assert.equal(
    mapsUrl("  Synthetic Courts, Court 3 "),
    "https://www.google.com/maps/search/?api=1&query=Synthetic%20Courts%2C%20Court%203",
  );
  const tricky = new URL(mapsUrl("A&B #2 café 🏓 &api=2"));
  assert.equal(
    tricky.origin + tricky.pathname,
    "https://www.google.com/maps/search/",
  );
  assert.deepEqual([...tricky.searchParams.keys()], ["api", "query"]);
  assert.equal(tricky.searchParams.get("query"), "A&B #2 café 🏓 &api=2");
  assert.equal(mapsUrl(""), null);
  assert.equal(mapsUrl("   "), null);
  assert.equal(mapsUrl(undefined), null);
});

test("game day is for joined players before the end", () => {
  const end = "2026-10-31T03:00:00Z",
    t = Date.parse(end);
  const base = { state: "published", endsAt: end, canManage: false };
  assert.equal(isGameDay({ ...base, ownState: "confirmed" }, t - 1), true);
  assert.equal(isGameDay({ ...base, ownState: "waitlisted" }, t - 1), true);
  assert.equal(isGameDay({ ...base, ownState: "confirmed" }, t), false);
  assert.equal(isGameDay({ ...base, ownState: "withdrawn" }, t - 1), false);
  assert.equal(isGameDay({ ...base, ownState: undefined }, t - 1), false);
  assert.equal(
    isGameDay({ ...base, canManage: true, ownState: "confirmed" }, t - 1),
    false,
  );
  assert.equal(
    isGameDay({ ...base, state: "cancelled", ownState: "confirmed" }, t - 1),
    false,
  );
});

test("headline and coming line", () => {
  assert.equal(gameDayHeadline({ state: "confirmed", seats: 1 }), "You're in");
  assert.equal(
    gameDayHeadline({ state: "confirmed", seats: 2 }),
    "You're in, with 1 guest",
  );
  assert.equal(
    gameDayHeadline({ state: "waitlisted", seats: 2, queuePosition: 2 }),
    "Waitlist #2",
  );
  assert.equal(comingLine(12, 16), "12 of 16 coming");
  assert.equal(comingLine(1, 8), "1 of 8 coming");
});

test("Up next says how soon, plainly", async () => {
  const { startsIn } = await import("../packages/domain/src/my-sessions.ts");
  const now = Date.parse("2026-10-30T10:00:00Z");
  const at = (ms) => new Date(now + ms).toISOString();
  const min = 60_000, hour = 60 * min, day = 24 * hour;
  assert.equal(startsIn(at(-hour), at(hour), now), "Happening now");
  assert.equal(startsIn(at(30 * 1000), at(hour), now), "Starting now");
  assert.equal(startsIn(at(25 * min), at(2 * hour), now), "Starts in 25 minutes");
  assert.equal(startsIn(at(1 * min), at(2 * hour), now), "Starts in 1 minute");
  assert.equal(startsIn(at(3 * hour + 10 * min), at(5 * hour), now), "Starts in 3 hours");
  assert.equal(startsIn(at(1 * hour), at(5 * hour), now), "Starts in 1 hour");
  assert.equal(startsIn(at(30 * hour), at(32 * hour), now), "In 1 day");
  assert.equal(startsIn(at(5 * day), at(5 * day + hour), now), "In 5 days");
  assert.equal(startsIn(null, null, now), "");
});
