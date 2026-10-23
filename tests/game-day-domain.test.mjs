import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterParties,
  gameDaySummary,
  noteWords,
  partyNoteWords,
  partyStanding,
  paymentWords,
  releaseRecord,
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

test("a released fee reads as Released, never as owed", () => {
  const released = party("R", {
    state: "removed",
    fee: fee({ liabilityState: "released_unpaid" }),
  });
  assert.equal(paymentWords(released, money), "Released");
});

test("a released party stays under Left with who released it, but not under to pay", () => {
  const at = "2026-10-23T10:00:00.000000+00:00";
  const released = party("Nia", {
    state: "removed",
    fee: fee({
      liabilityState: "released_unpaid",
      removedAt: at,
      history: [{ action: "released_unpaid", by: "Org", at }],
    }),
    attendance: undefined,
  });
  const list = [...roster, released];
  assert.deepEqual(names(filterParties(list, "everyone").left), ["Lee", "Nia"]);
  assert.deepEqual(names(filterParties(list, "to_pay").left), ["Lee"]);
  assert.deepEqual(releaseRecord(released), { by: "Org", at });
  assert.equal(releaseRecord(roster[0]), null);
});

test("note words: nothing, a bare note, and a note with its reference", () => {
  const sentAt = "2026-10-23T10:00:00.000Z";
  assert.equal(noteWords(null), "");
  assert.equal(noteWords(undefined), "");
  assert.equal(noteWords({ reference: null, sentAt }), "Says sent");
  assert.equal(
    noteWords({ reference: "ABC 123", sentAt }),
    "Says sent · ref ABC 123",
  );
});

test("a sent note shows only while the party's fee is still open", () => {
  const paymentNote = { reference: "ABC 123", sentAt: "2026-10-23T10:00:00Z" };
  const said = "Says sent · ref ABC 123";
  assert.equal(partyNoteWords(party("U", { paymentNote })), said);
  // A waiting party has no fee yet, but may still have said they sent it.
  assert.equal(
    partyNoteWords(party("W", { state: "waitlisted", fee: null, paymentNote })),
    said,
  );
  assert.equal(partyNoteWords(party("N")), "");
  // Once the organizer has settled the fee, the hint no longer matters.
  for (const over of [
    { markedPaid: true },
    { liabilityState: "waived" },
    { liabilityState: "released_unpaid" },
    { liabilityState: "removed_before_cutoff" },
  ])
    assert.equal(
      partyNoteWords(party("S", { fee: fee(over), paymentNote })),
      "",
      JSON.stringify(over),
    );
});
