import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cancellationEmailWords,
  emailKindLabel,
  emailWords,
  filterParties,
  gameDaySummary,
  instructionsEmailWords,
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

test("emailWords says only what the organizer can know", () => {
  const w = (status, reason = null, kind = "joined_confirmed") =>
    emailWords({ status, reason, kind });
  assert.equal(w("queued"), "Queued");
  assert.equal(w("queued", "daily_limit"), "Queued · daily email limit");
  assert.equal(w("queued", "monthly_limit"), "Queued · monthly email limit");
  // Only the two limits are ever worth saying on a waiting email.
  assert.equal(w("queued", "attempting"), "Queued");
  assert.equal(w("queued", "rate_limited"), "Queued");
  assert.equal(w("sent"), "Sent to email service");
  assert.equal(w("not_confirmed"), "Not confirmed");
  assert.equal(w("not_confirmed", "rejected"), "Not confirmed");
  const notSent = {
    superseded: "no longer applies",
    expired: "too late",
    rejected: "email service refused it",
    attempts_exhausted: "email service didn’t accept it",
    delivery_disabled: "email is off",
    queue_capacity: "too many emails waiting",
    no_verified_email: "no verified email",
    destination_changed: "email address changed",
  };
  for (const [reason, words] of Object.entries(notSent))
    assert.equal(w("not_sent", reason), `Not sent · ${words}`);
  assert.equal(w("not_sent"), "Not sent");
  assert.equal(w("not_sent", "something_internal"), "Not sent");
  // Never "Delivered".
  for (const status of ["queued", "sent", "not_confirmed", "not_sent"])
    assert.ok(!/deliver/i.test(w(status)));
});

test("emailKindLabel names each kind for the organizer", () => {
  assert.deepEqual(
    [
      "joined_confirmed",
      "joined_waitlisted",
      "promoted",
      "released",
      "cancelled",
      "instructions_changed",
      "reminder",
    ].map(emailKindLabel),
    [
      "Booking",
      "Waitlist",
      "Moved up",
      "Spot released",
      "Cancellation",
      "Payment details",
      "Reminder",
    ],
  );
});

test("cancellationEmailWords gives one line and omits zero counts", () => {
  const tally = (queued, sent, notConfirmed, notSent) => ({
    suppressed: [],
    cancellation: { queued, sent, notConfirmed, notSent },
  });
  assert.equal(cancellationEmailWords(undefined), "");
  assert.equal(
    cancellationEmailWords({ suppressed: [], cancellation: null }),
    "",
  );
  assert.equal(
    cancellationEmailWords(tally(2, 3, 1, 4)),
    "Cancellation emails: 3 sent to email service · 2 queued · 1 not confirmed · 4 not sent",
  );
  assert.equal(
    cancellationEmailWords(tally(0, 5, 0, 0)),
    "Cancellation emails: 5 sent to email service",
  );
  assert.equal(
    cancellationEmailWords(tally(1, 0, 0, 2)),
    "Cancellation emails: 1 queued · 2 not sent",
  );
  // A withheld update says so instead of counting anything.
  assert.equal(
    cancellationEmailWords({
      suppressed: [
        {
          kind: "cancelled",
          reason: "audience_limit",
          recipients: 51,
          at: "2026-10-23T10:00:00Z",
        },
      ],
      cancellation: null,
    }),
    "Cancellation emails weren’t sent: more than 50 people.",
  );
  // A withheld payment-details update is not a cancellation.
  assert.equal(
    cancellationEmailWords({
      suppressed: [
        {
          kind: "instructions_changed",
          reason: "audience_limit",
          recipients: 51,
          at: "2026-10-23T10:00:00Z",
        },
      ],
      cancellation: null,
    }),
    "",
  );
});

test("instructionsEmailWords speaks once, and only for withheld payment details", () => {
  const held = (kind, at) => ({
    kind,
    reason: "audience_limit",
    recipients: 51,
    at,
  });
  const line = "Payment-details emails weren’t sent: more than 50 people.";
  assert.equal(instructionsEmailWords(undefined), "");
  assert.equal(
    instructionsEmailWords({ suppressed: [], cancellation: null }),
    "",
  );
  // A withheld cancellation is the cancellation line's business.
  assert.equal(
    instructionsEmailWords({
      suppressed: [held("cancelled", "2026-10-23T10:00:00Z")],
      cancellation: null,
    }),
    "",
  );
  // Several withheld updates still give one line.
  assert.equal(
    instructionsEmailWords({
      suppressed: [
        held("instructions_changed", "2026-10-23T09:00:00Z"),
        held("cancelled", "2026-10-23T09:30:00Z"),
        held("instructions_changed", "2026-10-23T11:00:00Z"),
      ],
      cancellation: null,
    }),
    line,
  );
});
