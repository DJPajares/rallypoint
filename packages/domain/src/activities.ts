// The shared activity catalog (D-23). The rows live in the database and reach
// every screen through GET /api/activities; these are the pure rules over
// them: matching typed text, filling a new session's defaults, and naming a
// limit in plain words. A session still stores its activity as text, so a
// typed activity stays valid and uses the hidden `general` row.
import { Temporal } from "@js-temporal/polyfill";
import type { SessionForm } from "./session.ts";

export const skillLevels = ["beginner", "intermediate", "advanced"] as const;
export type SkillLevel = (typeof skillLevels)[number];

export interface ActivityLimits {
  minCapacity: number;
  maxCapacity: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
}

export interface Activity {
  key: string;
  name: string;
  icon: string;
  sortOrder: number;
  /** False only for `general`, which is never offered as a choice. */
  listed: boolean;
  defaults: {
    capacity: number;
    durationMinutes: number;
    guests: boolean;
    cutoffHours: number;
    /** Null opens registration from the moment the session is set up. */
    opensDays: number | null;
  };
  /** The limits of the caller's plan; everyone is on the free plan today. */
  limits: ActivityLimits;
  /** One plain line per self-rated level. */
  levels: Record<SkillLevel, string>;
}

/** The session fields an activity can fill in. */
export type DefaultedField =
  "capacity" | "guests" | "endLocal" | "openLocal" | "cutoffLocal";

/** The form activities are compared in: case, spacing and composition aside. */
export function activityName(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** The activity a text names, by name or key. `general` is never named. */
export function matchActivity<T extends Pick<Activity, "key" | "name">>(
  catalog: readonly T[],
  text: string,
): T | null {
  const name = activityName(text);
  if (!name) return null;
  return (
    catalog.find(
      (a) =>
        a.key !== "general" &&
        (activityName(a.name) === name || a.key === name),
    ) ?? null
  );
}

/** The matched activity, else the common `general` row for typed text. */
export function activityFor(
  catalog: readonly Activity[],
  text: string,
): Activity {
  const general = catalog.find((a) => a.key === "general");
  const found = matchActivity(catalog, text) ?? general;
  if (!found) throw new Error("The activity catalog has no general row.");
  return found;
}

const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const at = (value: string) => Temporal.PlainDateTime.from(value);
const text = (value: Temporal.PlainDateTime) =>
  value.toString({ smallestUnit: "minute" });

/**
 * Fills a new session's untouched fields from its activity. Spots and guests
 * fill at once; end, opening and cutoff wait for a start and then follow it.
 * The cutoff never falls before the opening. Wall-clock arithmetic only: these
 * are the session's local times, so no timezone is involved.
 */
export function applyActivityDefaults(
  form: SessionForm,
  activity: Activity,
  touched: ReadonlySet<DefaultedField>,
  nowLocal: string,
): SessionForm {
  const d = activity.defaults;
  const next = { ...form };
  if (!touched.has("capacity")) next.capacity = String(d.capacity);
  if (!touched.has("guests")) next.guests = d.guests;
  if (!local.test(form.startLocal)) return next;
  const start = at(form.startLocal);
  if (!touched.has("endLocal"))
    next.endLocal = text(start.add({ minutes: d.durationMinutes }));
  if (!touched.has("openLocal"))
    next.openLocal =
      d.opensDays === null
        ? nowLocal
        : text(start.subtract({ days: d.opensDays }));
  if (!touched.has("cutoffLocal")) {
    const cutoff = start.subtract({ hours: d.cutoffHours });
    next.cutoffLocal =
      local.test(next.openLocal) &&
      Temporal.PlainDateTime.compare(cutoff, at(next.openLocal)) < 0
        ? next.openLocal
        : text(cutoff);
  }
  return next;
}

/** "30 minutes", "1 hour", "4 hours": whole hours read as hours. */
export function durationText(minutes: number) {
  if (minutes % 60 !== 0) return `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/**
 * What is outside this activity's limits, in words, or null. Only the values
 * being changed are checked, so an older session stays editable.
 */
export function limitProblem(
  activity: Activity,
  value: { capacity: number; durationMinutes: number | null },
  check: { capacity: boolean; duration: boolean },
): string | null {
  const l = activity.limits;
  const name = activity.key === "general" ? "These" : activity.name;
  if (
    check.capacity &&
    (value.capacity < l.minCapacity || value.capacity > l.maxCapacity)
  )
    return `${name} sessions can have ${l.minCapacity} to ${l.maxCapacity} spots.`;
  if (
    check.duration &&
    value.durationMinutes !== null &&
    (value.durationMinutes < l.minDurationMinutes ||
      value.durationMinutes > l.maxDurationMinutes)
  )
    return `${name} sessions can run ${durationText(l.minDurationMinutes)} to ${durationText(l.maxDurationMinutes)}.`;
  return null;
}

type Saved = {
  activity: string;
  capacity: number | string;
  startsAt?: string;
  endsAt?: string;
};

/**
 * The same rule the database applies on save, for an early message: against
 * the published details (null when nothing is published yet), only changed
 * values are checked (length, not position, so a moved session keeps its
 * length), and a new activity rechecks spots.
 */
const lengthOf = (s: Saved) =>
  s.startsAt && s.endsAt
    ? (Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60000
    : null;

export function sessionLimitProblem(
  catalog: readonly Activity[],
  published: Saved | null,
  next: Saved,
): string | null {
  const activity = activityFor(catalog, next.activity);
  const minutes = lengthOf(next);
  const check = published
    ? {
        capacity:
          activityFor(catalog, published.activity).key !== activity.key ||
          Number(published.capacity) !== Number(next.capacity),
        // Length, not position: moving a session keeps an older length valid.
        duration: lengthOf(published) !== minutes,
      }
    : { capacity: true, duration: true };
  return limitProblem(
    activity,
    { capacity: Number(next.capacity), durationMinutes: minutes },
    check,
  );
}
