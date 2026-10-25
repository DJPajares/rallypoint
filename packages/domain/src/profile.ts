// What a person's profile may hold: a name they choose to show instead of
// their account name, and the activities they play with an optional
// self-rated level. Pure rules; the API and screens import these names.

import { presetFor } from "./activities.ts";

export const skillLevels = ["beginner", "intermediate", "advanced"] as const;
export type SkillLevel = (typeof skillLevels)[number];

export const levelLabel: Record<SkillLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export interface ProfileActivity {
  name: string;
  level: SkillLevel | null;
}

export interface ProfileInput {
  name: string;
  activities: ProfileActivity[];
}

/** One message per field; the first problem found in that field. */
export interface ProfileError {
  field: "name" | "activities";
  message: string;
}

export interface PublicProfile {
  profileId: string;
  name: string;
  /** The badge shown as a title, at its level. */
  title: { key: string; level: number } | null;
  /** Started badges at their highest level, catalog order. */
  badges: Array<{ key: string; level: number }>;
  stats: { played: number; hosted: number; groups: number };
  activities: ProfileActivity[];
}

export interface MyProfile {
  profileId: string;
  name: string;
  nameIsCustom: boolean;
  activities: ProfileActivity[];
}

const maxNameLength = 80;
const maxActivityLength = 40;
const maxCustomActivities = 3;
const maxActivities = 10;

function isSkillLevel(value: unknown): value is SkillLevel {
  return (skillLevels as readonly unknown[]).includes(value);
}

/** Length in code points, so an emoji or accented letter counts once. */
function codePoints(text: string): number {
  return [...text].length;
}

/**
 * Checks and tidies a profile before it is saved. A blank name means "no
 * override" and is stored as null. A blank activity row is ignored. A preset
 * keeps its preset spelling and does not count toward the custom limit.
 */
export function normalizeProfile(
  input: ProfileInput,
):
  | { ok: true; value: { name: string | null; activities: ProfileActivity[] } }
  | { ok: false; errors: ProfileError[] } {
  const errors: ProfileError[] = [];

  const typed = input.name.trim();
  // Invisible format characters (zero-width, direction overrides) are removed;
  // control characters such as line breaks are refused.
  const name = typed.replace(/\p{Cf}/gu, "").trim();
  if (/\p{Cc}/u.test(typed) || (name !== "" && !/[\p{L}\p{N}]/u.test(name))) {
    errors.push({
      field: "name",
      message: "Use letters or numbers in your name.",
    });
  } else if (codePoints(name) > maxNameLength) {
    errors.push({
      field: "name",
      message: "Use a name of up to 80 characters.",
    });
  }

  let activityError: string | null = null;
  const fail = (message: string) => {
    activityError ??= message;
  };

  const seen = new Set<string>();
  const activities: ProfileActivity[] = [];
  let custom = 0;

  for (const entry of input.activities) {
    const text = entry.name.trim();
    if (text === "") continue;

    if (entry.level !== null && !isSkillLevel(entry.level)) {
      fail("Choose a listed level.");
    }

    // Same activity whatever the case, spacing or accent composition.
    const key = text.normalize("NFC").replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) fail("Each activity can be added once.");
    seen.add(key);

    const preset = presetFor(text);
    if (preset) {
      activities.push({ name: preset, level: entry.level });
      continue;
    }

    if (codePoints(text) > maxActivityLength) {
      fail("Use up to 40 characters for an activity.");
    }
    custom += 1;
    activities.push({ name: text, level: entry.level });
  }

  if (custom > maxCustomActivities) {
    fail("Add up to 3 of your own activities.");
  }
  if (activities.length > maxActivities) {
    fail("Add up to 10 activities.");
  }
  if (activityError !== null) {
    errors.push({ field: "activities", message: activityError });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name: name === "" ? null : name, activities },
  };
}

/** The "Plays:" line shown on a profile; "" when there are no activities. */
export function playsLine(activities: ProfileActivity[]): string {
  if (activities.length === 0) return "";
  const items = activities.map((activity) =>
    activity.level
      ? `${activity.name} (${levelLabel[activity.level]})`
      : activity.name,
  );
  return `Plays: ${items.join(", ")}`;
}
