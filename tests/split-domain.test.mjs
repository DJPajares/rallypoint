import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateSplit,
  estimateNextParty,
  feeModeOf,
} from "../packages/domain/src/fees.ts";
import {
  InputError,
  normalizeSession,
} from "../packages/domain/src/session.ts";

const parties = [
  { partyId: "a", queueSequence: "9007199254740993", seats: 2 },
  { partyId: "b", queueSequence: "9007199254740994", seats: 1 },
];
const valid = () => ({
  title: "Split fixture",
  activity: "Workshop",
  location: "Synthetic room",
  startLocal: "2027-05-09T10:00",
  endLocal: "2027-05-09T12:00",
  timeZone: "Asia/Singapore",
  openLocal: "2027-05-01T09:00",
  cutoffLocal: "2027-05-08T10:00",
  capacity: "12",
  instructions: "",
  fee: "100.00",
  currency: "SGD",
  guests: true,
});

test("split allocation sums exact seat amounts into a guest party", () => {
  const result = allocateSplit(10000, parties);
  assert.deepEqual(
    result.seats.map((s) => s.amountMinor),
    [3334, 3333, 3333],
  );
  assert.deepEqual(
    result.parties.map((p) => p.totalMinor),
    [6667, 3333],
  );
  assert.equal(result.payingSeats, 3);
  assert.equal(result.unallocatedMinor, 0);
  assert.equal(result.state, "allocated");
  assert.deepEqual(allocateSplit(10000, [...parties].reverse()), result);
  assert.equal(parties[0].partyId, "a");
  const large = allocateSplit(Number.MAX_SAFE_INTEGER, parties);
  assert.deepEqual(
    large.seats.map((s) => s.amountMinor),
    [3002399751580331, 3002399751580330, 3002399751580330],
  );
  assert.equal(
    large.parties.reduce((sum, p) => sum + BigInt(p.totalMinor), 0n),
    9007199254740991n,
  );
});

test("small, zero and unallocated totals never invent a payment or lose minor units", () => {
  const three = [1, 2, 3].map((n) => ({
    partyId: String(n),
    queueSequence: String(n),
    seats: 1,
  }));
  assert.deepEqual(
    allocateSplit(1, three).seats.map((s) => s.amountMinor),
    [1, 0, 0],
  );
  assert.deepEqual(
    allocateSplit(0, three).seats.map((s) => s.amountMinor),
    [0, 0, 0],
  );
  assert.deepEqual(allocateSplit(12000, []), {
    state: "unallocated",
    totalMinor: 12000,
    payingSeats: 0,
    unallocatedMinor: 12000,
    seats: [],
    parties: [],
  });
  assert.deepEqual(allocateSplit(0, []).seats, []);
  const tied = [
    { partyId: "b", queueSequence: "2", seats: 1 },
    { partyId: "a", queueSequence: "2", seats: 1 },
  ];
  assert.equal(allocateSplit(1, tied).seats[0].partyId, "a");
});

test("split arithmetic refuses unsafe values and malformed or duplicate parties", () => {
  for (const total of [
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "100",
  ])
    assert.throws(() => allocateSplit(total, parties), InputError);
  for (const rows of [
    [parties[0], parties[0]],
    [{ ...parties[0], seats: 0 }],
    [{ ...parties[0], seats: 3 }],
    [{ ...parties[0], seats: "1" }],
    [{ ...parties[0], queueSequence: "-1" }],
    [{ ...parties[0], queueSequence: "1.5" }],
    [{ ...parties[0], queueSequence: 2 }],
    [{ ...parties[0], partyId: "" }],
  ])
    assert.throws(() => allocateSplit(100, rows), InputError);
});

test("a prospective party estimate includes its seats at the end of the paying order", () => {
  assert.equal(estimateNextParty(12000, 5, 1), 2000);
  assert.equal(estimateNextParty(10000, 1, 2), 6666);
  assert.equal(estimateNextParty(12000, 0, 2), 12000);
  assert.equal(estimateNextParty(1, 2, 1), 0);
  for (const args of [
    [-1, 0, 1],
    [1, -1, 1],
    [1, 0, 3],
    [1, Number.MAX_SAFE_INTEGER, 2],
    [1, 0.5, 1],
  ])
    assert.throws(() => estimateNextParty(...args), InputError);
});

test("session normalization distinguishes a split total from a fixed per-seat price", () => {
  const split = normalizeSession({ ...valid(), feeMode: "split" }, true);
  assert.equal(split.totalMinor, 10000);
  assert.equal(split.feeMode, "split");
  assert.equal(split.feeMinor, undefined);
  const legacy = normalizeSession({ ...valid(), fee: "12.50" }, true);
  assert.equal(legacy.feeMinor, 1250);
  assert.equal(Object.hasOwn(legacy, "feeMode"), false);
  assert.equal(Object.hasOwn(legacy, "totalMinor"), false);
  assert.equal(feeModeOf(legacy), "fixed");
  const free = normalizeSession(
    { ...valid(), feeMode: "split", fee: "0.00" },
    true,
  );
  assert.equal(free.feeMode, "fixed");
  assert.equal(free.feeMinor, 0);
  assert.equal(free.totalMinor, undefined);
  assert.equal(
    normalizeSession(
      { ...valid(), feeMode: "split", currency: "KWD", fee: "1.234" },
      true,
    ).totalMinor,
    1234,
  );
  const draft = normalizeSession(
    { ...valid(), feeMode: "split", fee: "not ready" },
    false,
  );
  assert.equal(draft.feeMode, "split");
  assert.equal(draft.fee, "not ready");
  assert.equal(draft.totalMinor, undefined);
  for (const patch of [
    { feeMode: "other" },
    { feeMode: null },
    { feeMode: "split", currency: "JPY", fee: "1.1" },
    { feeMode: "split", fee: "-1" },
  ])
    assert.throws(
      () => normalizeSession({ ...valid(), ...patch }, true),
      InputError,
    );
});
