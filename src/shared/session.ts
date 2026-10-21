import { Temporal } from "@js-temporal/polyfill";

export const currencies = {
  SGD: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
} as const;
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
}
export interface SessionDetails extends SessionForm {
  startsAt?: string;
  endsAt?: string;
  opensAt?: string;
  cutoffAt?: string;
  feeMinor?: number;
}
export interface SessionRecord {
  id: string;
  groupId: string;
  slug: string;
  state: "draft" | "published";
  version: number;
  details: SessionDetails;
  bookingsStarted: boolean;
}
export interface SharedSession {
  slug: string;
  groupName: string;
  version: number;
  details: SessionDetails;
}
export const blankSession = (): SessionForm => ({
  title: "",
  activity: "",
  startLocal: "",
  endLocal: "",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  location: "",
  instructions: "",
  capacity: "12",
  openLocal: "",
  cutoffLocal: "",
  fee: "0.00",
  currency: "SGD",
  guests: false,
});
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
  const feePattern = new RegExp(`^\\d+(?:\\.\\d{1,${precision || 1}})?$`);
  if (!feePattern.test(form.fee) || (precision === 0 && form.fee.includes(".")))
    throw new InputError(
      `Use at most ${precision} decimal places for ${form.currency}.`,
    );
  const [whole, fraction = ""] = form.fee.split(".");
  const feeMinor = Number(whole + fraction.padEnd(precision, "0"));
  if (!Number.isSafeInteger(feeMinor))
    throw new InputError("The fee is too large to store precisely.");
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
        `Check ${label} and the timezone. Choose an unambiguous local time; daylight-saving gaps and repeated times are rejected.`,
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
  return {
    ...form,
    startsAt: start.toString(),
    endsAt: end.toString(),
    opensAt: open.toString(),
    cutoffAt: cutoff.toString(),
    feeMinor,
  };
}
export function feeLabel(d: SessionDetails) {
  const precision = currencies[d.currency as keyof typeof currencies] ?? 2;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: d.currency,
  }).format((d.feeMinor ?? 0) / 10 ** precision);
}
