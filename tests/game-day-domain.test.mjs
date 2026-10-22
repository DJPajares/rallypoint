import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterParties,
  gameDaySummary,
  partyStanding,
  paymentWords,
} from "../packages/domain/src/game-day.ts";

const fee = (over = {}) => ({
  currency: "PHP",
  unitMinor: 20000,
  chargedSeats: 1,
  totalMinor: 20000,
  liabilityState: "due",
  removedAt: null,
  markedPaid: false,
  revision: 1,
  history: [],
  ...over,
});
const seat = (n, state = "unrecorded") => ({
  seat: n,
  state,
  revision: state === "unrecorded" ? 0 : 1,
  by: null,
  at: null,
});
const party = (name, over = {}) => ({
  id: name,
  primaryName: name,
  guestName: "",
  seats: 1,
  state: "confirmed",
  fee: fee(),
  attendance: [seat(1)],
  ...over,
});
const money = (currency, minor) => `${currency} ${(minor / 100).toFixed(2)}`;
const names = (list) => list.map((p) => p.primaryName);

const roster = [
  party("Sam", {
    fee: fee({ markedPaid: true }),
    attendance: [seat(1, "checked_in")],
  }),
  party("Alex", {
    seats: 2,
    guestName: "Jo",
    fee: fee({ chargedSeats: 2, totalMinor: 40000 }),
    attendance: [seat(1, "checked_in"), seat(2)],
  }),
  party("Riley"),
  party("Wren", { state: "waitlisted", fee: null, attendance: undefined }),
  party("Lee", { state: "withdrawn", attendance: undefined }),
  party("Kai", {
    state: "withdrawn",
    fee: fee({ liabilityState: "removed_before_cutoff" }),
    attendance: undefined,
  }),
];

test("summary counts here, expected, to pay and waiting", () => {
  assert.deepEqual(gameDaySummary(roster), {
    here: 2,
    expected: 4,
    toPay: 3,
    waiting: 1,
  });
});

test("a guest-only arrival lists the primary as missing", () => {
  const p = party("Mo", {
    seats: 2,
    guestName: "",
    attendance: [seat(1), seat(2, "checked_in")],
  });
  assert.deepEqual(partyStanding(p), {
    seatsHere: 1,
    seats: 2,
    missing: ["Mo"],
  });
  assert.deepEqual(partyStanding(roster[1]).missing, ["Jo"]);
});

test("to pay keeps a withdrawn party that still owes", () => {
  const { confirmed, waiting, left } = filterParties(roster, "to_pay");
  assert.deepEqual(names(confirmed), ["Alex", "Riley"]);
  assert.deepEqual(names(waiting), []);
  assert.deepEqual(names(left), ["Lee"]);
});

test("everyone shows confirmed, the queue in order, and who left owing a record", () => {
  const { confirmed, waiting, left } = filterParties(roster, "everyone");
  assert.deepEqual(names(confirmed), ["Sam", "Alex", "Riley"]);
  assert.deepEqual(names(waiting), ["Wren"]);
  assert.deepEqual(names(left), ["Lee"]);
});

test("a late-withdrawn party with a pending split share stays under Left", () => {
  const pending = (over) =>
    party("P", {
      state: "withdrawn",
      fee: null,
      attendance: undefined,
      splitClaim: {
        eligible: true,
        waived: false,
        estimateMinor: 500,
        revision: 1,
        ...over,
      },
    });
  const late = { ...pending({}), primaryName: "Late" };
  const waived = {
    ...pending({ eligible: false, waived: true }),
    primaryName: "Waived",
  };
  const early = { ...pending({ eligible: false }), primaryName: "Early" };
  const { left } = filterParties([late, waived, early], "everyone");
  assert.deepEqual(names(left), ["Late", "Waived"]);
});

test("not here hides waiting and left parties", () => {
  const { confirmed, waiting, left } = filterParties(roster, "not_here");
  assert.deepEqual(names(confirmed), ["Alex", "Riley"]);
  assert.deepEqual(waiting, []);
  assert.deepEqual(left, []);
});

test("payment words", () => {
  assert.equal(paymentWords(roster[0], money), "Paid");
  assert.equal(paymentWords(roster[1], money), "PHP 400.00 to pay");
  assert.equal(
    paymentWords(party("W", { fee: fee({ liabilityState: "waived" }) }), money),
    "Waived",
  );
  assert.equal(
    paymentWords(party("F", { fee: fee({ totalMinor: 0 }) }), money),
    "",
  );
  assert.equal(paymentWords(party("N", { fee: null }), money), "");
  assert.equal(
    paymentWords(
      party("S", { fee: null, splitClaim: { estimateMinor: 500 } }),
      money,
    ),
    "Share pending",
  );
  assert.equal(paymentWords(roster[5], money), "Nothing due");
});
