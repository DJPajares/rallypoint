import { test } from "node:test";
import assert from "node:assert/strict";
import { rankedAlerts } from "../packages/domain/src/ranked-alerts.ts";

const now = Date.parse("2026-11-03T12:00:00Z");
const at = (hours) => new Date(now + hours * 3600000).toISOString();
const search = (over = {}) => ({
  id: "s1",
  format: "singles",
  state: "searching",
  endReason: null,
  returned: null,
  endsAt: at(100),
  role: "starter",
  areas: [{ key: "tampines", label: "Tampines" }],
  courts: [],
  windows: [],
  partner: null,
  inviteToken: null,
  wide: false,
  canWiden: false,
  regions: ["East"],
  ...over,
});
const match = (over = {}) => ({
  id: "m1",
  format: "singles",
  state: "proposed",
  area: { key: "tampines", label: "Tampines" },
  court: null,
  window: null,
  respondBy: at(40),
  players: [],
  myAnswer: null,
  ...over,
});
const invite = (token, hours) => ({
  token,
  starterName: "Sam",
  format: "doubles",
  areas: [],
  endsAt: at(hours),
});

test("nothing waiting gives an empty list", () => {
  assert.deepEqual(rankedAlerts(null, now), []);
  assert.deepEqual(
    rankedAlerts({ search: null, invites: [], match: null }, now),
    [],
  );
  assert.deepEqual(
    rankedAlerts({ search: search(), invites: [], match: null }, now),
    [],
  );
});

test("an unanswered proposed match is waiting until its deadline", () => {
  const mine = { search: search({ state: "matched" }), invites: [] };
  assert.deepEqual(rankedAlerts({ ...mine, match: match() }, now), [
    {
      kind: "match",
      key: "match:m1",
      matchId: "m1",
      format: "singles",
      deadline: at(40),
    },
  ]);
  for (const over of [
    { myAnswer: "accepted" },
    { respondBy: at(-1) },
    { state: "confirmed" },
    { state: "expired" },
  ])
    assert.deepEqual(rankedAlerts({ ...mine, match: match(over) }, now), []);
});

test("each live direct invite is waiting", () => {
  const alerts = rankedAlerts(
    {
      search: null,
      invites: [invite("t1", 10), invite("t2", 20), invite("t3", -1)],
      match: null,
    },
    now,
  );
  assert.deepEqual(
    alerts.map((a) => [a.kind, a.key, a.deadline]),
    [
      ["invite", "invite:t1", at(10)],
      ["invite", "invite:t2", at(20)],
    ],
  );
  assert.equal(alerts[0].starterName, "Sam");
  assert.equal(alerts[0].format, "doubles");
  assert.equal(alerts[0].token, "t1");
});

test("the widen prompt waits while the search runs", () => {
  assert.deepEqual(
    rankedAlerts(
      { search: search({ canWiden: true }), invites: [], match: null },
      now,
    ),
    [
      {
        kind: "widen",
        key: "widen:s1",
        searchId: "s1",
        regions: ["East"],
        deadline: at(100),
      },
    ],
  );
  assert.deepEqual(
    rankedAlerts(
      {
        search: search({ canWiden: true, endsAt: at(-1) }),
        invites: [],
        match: null,
      },
      now,
    ),
    [],
  );
});

test("items are ordered by deadline and keys are unique", () => {
  const alerts = rankedAlerts(
    {
      search: search({ canWiden: true, endsAt: at(5) }),
      invites: [invite("t1", 30)],
      match: match({ respondBy: at(10) }),
    },
    now,
  );
  assert.deepEqual(
    alerts.map((a) => a.kind),
    ["widen", "match", "invite"],
  );
  assert.equal(new Set(alerts.map((a) => a.key)).size, alerts.length);
});
