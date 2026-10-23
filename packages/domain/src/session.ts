import { Temporal } from "@js-temporal/polyfill";
import type { FeeMode, SplitSummary } from "./fees.ts";

export const currencies = {
  PHP: 2,
  SGD: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
} as const;
export type Currency = keyof typeof currencies;

// Where the organizer is, read from the device: its time zone first (it
// follows the phone's location), then the language's region. Never asked.
const zoneCurrency: Record<string, Currency> = {
  "Asia/Manila": "PHP",
  "Asia/Singapore": "SGD",
  "Asia/Tokyo": "JPY",
  "Asia/Kuwait": "KWD",
  "Europe/London": "GBP",
};
const usZones = [
  "New_York",
  "Chicago",
  "Denver",
  "Phoenix",
  "Los_Angeles",
  "Anchorage",
  "Detroit",
];
const euroZones = [
  "Amsterdam",
  "Athens",
  "Berlin",
  "Brussels",
  "Dublin",
  "Helsinki",
  "Lisbon",
  "Luxembourg",
  "Madrid",
  "Paris",
  "Rome",
  "Vienna",
];
const regionCurrency: Record<string, Currency> = {
  PH: "PHP",
  SG: "SGD",
  US: "USD",
  GB: "GBP",
  JP: "JPY",
  KW: "KWD",
};
const euroRegions = [
  "AT",
  "BE",
  "DE",
  "ES",
  "FI",
  "FR",
  "GR",
  "IE",
  "IT",
  "LU",
  "NL",
  "PT",
];
export function defaultCurrency(timeZone: string, locale?: string): Currency {
  const [area, city] = timeZone.split("/");
  if (zoneCurrency[timeZone]) return zoneCurrency[timeZone];
  if (area === "America" && usZones.includes(city)) return "USD";
  if (timeZone === "Pacific/Honolulu") return "USD";
  if (area === "Europe" && euroZones.includes(city)) return "EUR";
  let region: string | undefined;
  try {
    region = locale ? new Intl.Locale(locale).maximize().region : undefined;
  } catch {
    region = undefined;
  }
  if (region && regionCurrency[region]) return regionCurrency[region];
  if (region && euroRegions.includes(region)) return "EUR";
  return "SGD";
}
export type PaymentMode = "untracked" | "organizer";
export interface SessionForm {
  title: string;
  activity: string;
  startLocal: string;
  endLocal: string;
  timeZone: string;
  location: string;
  instructions: string;
  capacity: string;
  openLocal: string;
  cutoffLocal: string;
  fee: string;
  currency: string;
  guests: boolean;
  feeMode?: FeeMode;
  paymentMode?: PaymentMode;
  releaseUnpaid?: boolean;
}
export interface SessionDetails extends SessionForm {
  startsAt?: string;
  endsAt?: string;
  opensAt?: string;
  cutoffAt?: string;
  feeMinor?: number;
  totalMinor?: number;
}
export interface SessionRecord {
  id: string;
  groupId: string;
  slug: string;
  state: "draft" | "published" | "completed" | "cancelled";
  version: number;
  details: SessionDetails;
  bookingsStarted: boolean;
  cancelledFrom?: "draft" | "published" | null;
}
export interface SharedSession {
  slug: string;
  groupName: string;
  version: number;
  details: SessionDetails;
  state: "published" | "cancelled" | "completed";
  registrationWindow: "open" | "not_open" | "closed";
  counts: { confirmedSeats: number; waitingParties: number };
  split?: SplitSummary;
}
export const blankSession = (): SessionForm => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    title: "",
    activity: "",
    startLocal: "",
    endLocal: "",
    timeZone,
    location: "",
    instructions: "",
    capacity: "12",
    openLocal: "",
    cutoffLocal: "",
    fee: "0.00",
    currency: defaultCurrency(
      timeZone,
      typeof navigator === "undefined" ? undefined : navigator.language,
    ),
    guests: false,
    paymentMode: "untracked",
    releaseUnpaid: false,
  };
};
export class InputError extends Error {}
export function normalizeSession(
  value: unknown,
  publish: boolean,
): SessionDetails {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InputError("Enter the session details.");
  const raw = value as Record<string, unknown>;
  const result: Record<string, string | boolean> = {};
  const limits: Record<string, number> = {
    title: 120,
    activity: 80,
    startLocal: 16,
    endLocal: 16,
    timeZone: 100,
    location: 300,
    instructions: 2000,
    capacity: 10,
    openLocal: 16,
    cutoffLocal: 16,
    fee: 22,
    currency: 3,
  };
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof raw[key] !== "string" || raw[key].length > limit)
      throw new InputError(`Check the ${key} field.`);
    result[key] = raw[key].trim();
  }
  if (typeof raw.guests !== "boolean")
    throw new InputError("Choose whether a guest is allowed.");
  const form = { ...result, guests: raw.guests } as unknown as SessionForm;
  if (raw.feeMode !== undefined) {
    if (raw.feeMode !== "fixed" && raw.feeMode !== "split")
      throw new InputError("Choose a fee per seat or a total to split.");
    form.feeMode = raw.feeMode;
  }
  if (raw.paymentMode !== undefined) {
    if (raw.paymentMode !== "untracked" && raw.paymentMode !== "organizer")
      throw new InputError("Choose Not tracked here or Pay the organizer.");
  }
  form.paymentMode =
    (raw.paymentMode as PaymentMode | undefined) ?? "organizer";
  if (raw.releaseUnpaid !== undefined && typeof raw.releaseUnpaid !== "boolean")
    throw new InputError("Choose whether unpaid spots can be released.");
  form.releaseUnpaid = raw.releaseUnpaid === true;
  if (!publish) return form;
  if (!form.title || !form.activity || !form.location)
    throw new InputError(
      "Add a title, activity and location before publishing.",
    );
  if (!/^[1-9]\d*$/.test(form.capacity) || Number(form.capacity) > 2147483647)
    throw new InputError(
      "Capacity must be a positive whole number within the supported integer range.",
    );
  const precision = currencies[form.currency as keyof typeof currencies];
  if (precision === undefined)
    throw new InputError("Choose a supported currency.");
  const untracked = form.paymentMode === "untracked";
  if (untracked) delete form.feeMode;
  let feeMinor = 0;
  if (!untracked) {
    const feePattern = new RegExp(`^\\d+(?:\\.\\d{1,${precision || 1}})?$`);
    if (
      !feePattern.test(form.fee) ||
      (precision === 0 && form.fee.includes("."))
    )
      throw new InputError(
        `Use at most ${precision} decimal places for ${form.currency}.`,
      );
    const [whole, fraction = ""] = form.fee.split(".");
    feeMinor = Number(whole + fraction.padEnd(precision, "0"));
    if (!Number.isSafeInteger(feeMinor))
      throw new InputError("The fee is too large to store precisely.");
    if (feeMinor === 0 && form.feeMode === "split") form.feeMode = "fixed";
  }
  if (
    form.releaseUnpaid &&
    (untracked || form.feeMode === "split" || feeMinor === 0)
  )
    throw new InputError("Releasing unpaid spots needs a fixed fee per seat.");
  if (!form.timeZone || /^[+-]/.test(form.timeZone))
    throw new InputError("Use a named IANA timezone.");
  const instant = (local: string, label: string) => {
    try {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw Error();
      return Temporal.PlainDateTime.from(local, { overflow: "reject" })
        .toZonedDateTime(form.timeZone, { disambiguation: "reject" })
        .toInstant();
    } catch {
      throw new InputError(
        `Check the ${label} time. Pick a time that happens once on that day; clock changes can skip or repeat an hour.`,
      );
    }
  };
  const start = instant(form.startLocal, "start"),
    end = instant(form.endLocal, "end");
  const open = instant(form.openLocal, "registration opening"),
    cutoff = instant(form.cutoffLocal, "cancellation cutoff");
  if (Temporal.Instant.compare(end, start) <= 0)
    throw new InputError("End must be after start.");
  if (Temporal.Instant.compare(open, start) >= 0)
    throw new InputError("Registration must open before start.");
  if (
    Temporal.Instant.compare(cutoff, open) < 0 ||
    Temporal.Instant.compare(cutoff, start) > 0
  )
    throw new InputError(
      "Cancellation cutoff must fall between opening and start.",
    );
  // Release runs from the cutoff until the start, so a cutoff at the start
  // leaves no window to give an unpaid spot away in.
  if (form.releaseUnpaid && Temporal.Instant.compare(cutoff, start) >= 0)
    throw new InputError(
      "Set the cutoff before the start so unpaid spots can go to the waitlist.",
    );
  return {
    ...form,
    startsAt: start.toString(),
    endsAt: end.toString(),
    opensAt: open.toString(),
    cutoffAt: cutoff.toString(),
    ...(untracked
      ? {}
      : form.feeMode === "split"
        ? { totalMinor: feeMinor }
        : { feeMinor }),
  };
}
export function feeLabel(d: Pick<SessionDetails, "currency" | "feeMinor">) {
  const precision = currencies[d.currency as keyof typeof currencies] ?? 2;
  const minor = BigInt(d.feeMinor ?? 0),
    scale = BigInt(10 ** precision);
  const fraction = (minor % scale).toString().padStart(precision, "0");
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: d.currency,
  })
    .formatToParts(minor / scale)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
}

/** Compare normalized instants, never the editor/device's presentation strings. */
export function hasMaterialSessionChange(
  before: SessionDetails,
  after: SessionDetails,
) {
  const sameInstant = (a?: string, b?: string) =>
    a === b || (!!a && !!b && Temporal.Instant.compare(a, b) === 0);
  return (
    !sameInstant(before.startsAt, after.startsAt) ||
    !sameInstant(before.endsAt, after.endsAt) ||
    before.location !== after.location
  );
}

/** A first booking may arrive after load without changing the session version. */
export function sessionEditNeedsConfirmation(
  record: Pick<SessionRecord, "state" | "details">,
  details: SessionDetails,
) {
  return (
    record.state === "published" &&
    hasMaterialSessionChange(record.details, details)
  );
}
