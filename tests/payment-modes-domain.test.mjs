import { test } from "node:test";
import assert from "node:assert/strict";
import { feeStanding } from "../packages/domain/src/registration.ts";
import {
  blankSession,
  InputError,
  normalizeSession,
} from "../packages/domain/src/session.ts";

const session = (fee) => ({
  title: "Mode fixture",
  activity: "Pickleball",
  location: "Synthetic court",
  startLocal: "2027-05-09T10:00",
  endLocal: "2027-05-09T12:00",
  timeZone: "Asia/Manila",
  openLocal: "2027-05-01T09:00",
  cutoffLocal: "2027-05-08T10:00",
  capacity: "12",
  instructions: "",
  fee,
  currency: "PHP",
  guests: false,
});

test("a missing paymentMode stays Pay the organizer", () => {
  const details = normalizeSession(session("200.00"), true);
  assert.equal(details.paymentMode, "organizer");
  assert.equal(details.releaseUnpaid, false);
  assert.equal(details.feeMinor, 20000);
});

test("Not tracked here keeps no fee", () => {
  const details = normalizeSession(
    { ...session("200.00"), paymentMode: "untracked", feeMode: "split" },
    true,
  );
  assert.equal(details.paymentMode, "untracked");
  assert.equal(details.feeMode, undefined);
  assert.equal(details.feeMinor, undefined);
  assert.equal(details.totalMinor, undefined);
  assert.equal(details.releaseUnpaid, false);
});

test("release needs a fixed fee above zero", () => {
  for (const extra of [
    { fee: "0.00" },
    { feeMode: "split" },
    { paymentMode: "untracked" },
  ]) {
    assert.throws(
      () =>
        normalizeSession(
          { ...session("200.00"), ...extra, releaseUnpaid: true },
          true,
        ),
      InputError,
    );
  }
  const details = normalizeSession(
    { ...session("200.00"), feeMode: "fixed", releaseUnpaid: true },
    true,
  );
  assert.equal(details.releaseUnpaid, true);
});

test("release needs a cutoff before the start", () => {
  const atStart = { ...session("200.00"), cutoffLocal: "2027-05-09T10:00" };
  assert.throws(
    () => normalizeSession({ ...atStart, releaseUnpaid: true }, true),
    (error) =>
      error instanceof InputError &&
      error.message ===
        "Set the cutoff before the start so unpaid spots can go to the waitlist.",
  );
  // The same cutoff is fine while release is off, and a draft is not checked.
  assert.equal(
    normalizeSession(atStart, true).cutoffAt,
    "2027-05-09T02:00:00Z",
  );
  assert.equal(
    normalizeSession({ ...atStart, releaseUnpaid: true }, false).releaseUnpaid,
    true,
  );
  // A cutoff a minute before the start leaves a window.
  const details = normalizeSession(
    {
      ...session("200.00"),
      cutoffLocal: "2027-05-09T09:59",
      releaseUnpaid: true,
    },
    true,
  );
  assert.equal(details.releaseUnpaid, true);
});

test("unknown payment modes are refused", () => {
  assert.throws(
    () =>
      normalizeSession({ ...session("200.00"), paymentMode: "in_app" }, true),
    InputError,
  );
});

test("a non-boolean releaseUnpaid is refused", () => {
  assert.throws(
    () =>
      normalizeSession({ ...session("200.00"), releaseUnpaid: "yes" }, false),
    InputError,
  );
});

test("drafts keep the mode and the release switch", () => {
  const draft = normalizeSession(
    { ...session("200.00"), paymentMode: "untracked" },
    false,
  );
  assert.equal(draft.paymentMode, "untracked");
  assert.equal(draft.releaseUnpaid, false);
});

test("new sessions start as Not tracked here", () => {
  assert.equal(blankSession().paymentMode, "untracked");
});

test("feeStanding says Released for a released fee", () => {
  const fee = {
    currency: "PHP",
    unitMinor: 20000,
    chargedSeats: 1,
    totalMinor: 20000,
    liabilityState: "released_unpaid",
    removedAt: "2027-05-08T10:00:00Z",
    markedPaid: false,
  };
  assert.equal(feeStanding(fee), "Released");
  assert.equal(feeStanding({ ...fee, liabilityState: "due" }), "Unpaid");
  assert.equal(
    feeStanding({ ...fee, liabilityState: "removed_before_cutoff" }),
    "Removed",
  );
});
