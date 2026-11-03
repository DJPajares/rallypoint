import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rankedAlerts,
  readFor,
  settleRead,
} from "../packages/domain/src/ranked-alerts.ts";

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

test("an action's own answer removes its item at once", () => {
  const before = settleRead(null, "u1", {
    search: search({ state: "matched" }),
    invites: [],
    match: match(),
  });
  assert.equal(rankedAlerts(readFor(before, "u1"), now).length, 1);
  const after = settleRead(before, "u1", {
    operationKey: "k1",
    search: search({ state: "matched" }),
    invites: [],
    match: match({ myAnswer: "accepted" }),
  });
  assert.deepEqual(rankedAlerts(readFor(after, "u1"), now), []);
  assert.equal("operationKey" in readFor(after, "u1"), false);
});

test("what's known survives a token refresh but never another person", () => {
  const known = settleRead(null, "u1", {
    search: null,
    invites: [invite("t1", 10)],
    match: null,
  });
  assert.equal(readFor(known, "u1").invites.length, 1);
  assert.equal(readFor(known, "u2"), null);
  assert.equal(readFor(null, "u1"), null);
});

test("the version moves only when what's known changes", () => {
  const read = { search: null, invites: [invite("t1", 10)], match: null };
  const first = settleRead(null, "u1", read);
  const same = settleRead(first, "u1", { ...read, operationKey: "k" });
  assert.equal(same.version, first.version);
  const changed = settleRead(same, "u1", { ...read, invites: [] });
  assert.equal(changed.version, first.version + 1);
  const other = settleRead(changed, "u2", read);
  assert.equal(other.version, changed.version + 1);
});

test("a court to book waits on everyone until someone claims it", () => {
  const booking = (over = {}) => ({
    state: "open",
    bookerName: null,
    you: false,
    claimUntil: null,
    bookBy: at(90),
    session: null,
    ...over,
  });
  const read = (over) => ({
    search: search({ state: "matched" }),
    invites: [],
    match: match({
      state: "confirmed",
      myAnswer: "accepted",
      booking: booking(over),
      checkIn: null,
    }),
  });
  assert.deepEqual(rankedAlerts(read({}), now), [
    {
      kind: "book",
      key: "book:m1",
      matchId: "m1",
      claimed: false,
      deadline: at(90),
    },
  ]);
  assert.deepEqual(
    rankedAlerts(
      read({
        state: "claimed",
        you: true,
        bookerName: "Me",
        claimUntil: at(30),
      }),
      now,
    ),
    [
      {
        kind: "book",
        key: "book:m1",
        matchId: "m1",
        claimed: true,
        deadline: at(30),
      },
    ],
  );
  assert.deepEqual(
    rankedAlerts(
      read({ state: "claimed", bookerName: "Sam", claimUntil: at(30) }),
      now,
    ),
    [],
  );
  assert.deepEqual(
    rankedAlerts(read({ state: "booked", you: true, bookerName: "Me" }), now),
    [],
  );
  assert.deepEqual(rankedAlerts(read({ bookBy: at(-1) }), now), []);
});

test("a result waits on whoever can report or answer it", () => {
  const read = (result) => ({
    search: search({ state: "matched" }),
    invites: [],
    match: match({
      state: "confirmed",
      myAnswer: "accepted",
      booking: {
        state: "booked",
        bookerName: "Me",
        you: true,
        claimUntil: null,
        bookBy: at(90),
        session: null,
      },
      checkIn: null,
      result: {
        state: "report",
        reportedBy: null,
        reportedWinner: null,
        reportBy: at(48),
        confirmBy: null,
        canAct: true,
        ...result,
      },
    }),
  });
  assert.deepEqual(rankedAlerts(read({}), now), [
    {
      kind: "result",
      key: "result:m1",
      matchId: "m1",
      confirm: false,
      deadline: at(48),
    },
  ]);
  assert.deepEqual(
    rankedAlerts(
      read({
        state: "reported",
        reportedBy: "theirs",
        reportedWinner: "theirs",
        confirmBy: at(20),
      }),
      now,
    ),
    [
      {
        kind: "result",
        key: "result:m1",
        matchId: "m1",
        confirm: true,
        deadline: at(20),
      },
    ],
  );
  for (const over of [
    { canAct: false },
    { state: "waiting" },
    {
      state: "reported",
      reportedBy: "yours",
      reportedWinner: "yours",
      confirmBy: at(20),
      canAct: false,
    },
    { reportBy: at(-1) },
  ])
    assert.deepEqual(rankedAlerts(read(over), now), [], JSON.stringify(over));
});
