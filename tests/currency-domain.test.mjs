import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultCurrency,
  InputError,
  normalizeSession,
} from "../packages/domain/src/session.ts";

const session = (fee) => ({
  title: "Peso fixture",
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

test("defaultCurrency maps Manila to pesos and falls back to SGD", () => {
  assert.equal(defaultCurrency("Asia/Manila"), "PHP");
  assert.equal(defaultCurrency("Europe/Berlin"), "EUR");
  assert.equal(defaultCurrency("America/Chicago"), "USD");
  assert.equal(defaultCurrency("UTC", "en-PH"), "PHP");
  assert.equal(defaultCurrency("UTC", "fr-CA"), "SGD");
  assert.equal(defaultCurrency("UTC", "not a locale"), "SGD");
});

test("normalizeSession accepts PHP with two decimals and rejects three", () => {
  const details = normalizeSession(session("200.00"), true);
  assert.equal(details.currency, "PHP");
  assert.equal(details.feeMinor, 20000);
  assert.throws(() => normalizeSession(session("200.005"), true), InputError);
});
