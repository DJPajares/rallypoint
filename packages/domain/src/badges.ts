// Badges recognise showing up, meeting people and hosting (PRD D-16, P-19).
// The database decides what is earned from recorded check-ins; this catalog
// only names and draws them. Nothing here reads payments, no-shows or
// reliability. Each badge has five levels, and a level has the same colour on
// every badge.
export type BadgeKey =
  "rally" | "steady" | "new-faces" | "plus-one" | "host" | "full-house";
export type BadgeFamily = "playing" | "people" | "hosting";
export type BadgeGlyph =
  "rally" | "calendar" | "faces" | "plus" | "host" | "full";
export type Level = 1 | 2 | 3 | 4 | 5;
export interface BadgeDefinition {
  key: BadgeKey;
  name: string;
  family: BadgeFamily;
  glyph: BadgeGlyph;
  /** What each level needs, level 1 first. Mirrors app.badge_thresholds. */
  thresholds: readonly [number, number, number, number, number];
  /** The title each level gives the person showing this badge (WDL-405). */
  titles: readonly [string, string, string, string, string];
}
export interface EarnedLevel {
  level: Level;
  earnedAt: string;
  seen: boolean;
}
export interface BadgeState {
  key: BadgeKey;
  current: number;
  levels: EarnedLevel[];
}

/**
 * A title is a badge you chose to show, at its current level; it reads that
 * level's title ("Mainstay"). It names no group, date or count.
 */
export interface RosterTitle {
  key: BadgeKey;
  level: Level;
}
export interface BadgesView {
  badges: BadgeState[];
  title: RosterTitle | null;
  stats: { played: number; hosted: number; groups: number };
}

// The app and its database can ship minutes apart; a response of the other
// shape reads as no badges rather than breaking the page.
export const badgeStates = (
  view: { badges?: unknown } | null | undefined,
): BadgeState[] =>
  Array.isArray(view?.badges) ? (view.badges as BadgeState[]) : [];
/** A title from any source, or null when it isn't a badge at level 1 to 5. */
export function rosterTitle(value: unknown): RosterTitle | null {
  if (!value || typeof value !== "object") return null;
  const { key, level } = value as { key?: unknown; level?: unknown };
  return isBadgeKey(key) &&
    typeof level === "number" &&
    Number.isInteger(level) &&
    level >= 1 &&
    level <= 5
    ? { key, level: level as Level }
    : null;
}

/** Disc gradients by level, light stop first; white icons read on all. */
export const levelColors: readonly (readonly [string, string])[] = [
  ["#3FA2F2", "#1E4FD6"],
  ["#33B8A2", "#0B6B66"],
  ["#C08BFF", "#7A2BD6"],
  ["#F7826A", "#BF3426"],
  ["#D3962C", "#984606"],
];

export const badgeCatalog: readonly BadgeDefinition[] = [
  {
    key: "rally",
    name: "Rally",
    family: "playing",
    glyph: "rally",
    thresholds: [1, 10, 25, 50, 100],
    titles: ["Rookie", "Regular", "Mainstay", "Veteran", "Rally Master"],
  },
  {
    key: "steady",
    name: "Steady",
    family: "playing",
    glyph: "calendar",
    thresholds: [2, 3, 6, 12, 24],
    titles: ["Returner", "Familiar Face", "Fixture", "Year-Rounder", "Lifer"],
  },
  {
    key: "new-faces",
    name: "New Faces",
    family: "people",
    glyph: "faces",
    thresholds: [5, 10, 25, 50, 100],
    titles: [
      "Friendly Face",
      "Mixer",
      "Connector",
      "Social Butterfly",
      "Super Connector",
    ],
  },
  {
    key: "plus-one",
    name: "Plus One",
    family: "people",
    glyph: "plus",
    thresholds: [1, 3, 5, 10, 20],
    titles: [
      "Good Company",
      "Recruiter",
      "Talent Scout",
      "Ambassador",
      "Grand Ambassador",
    ],
  },
  {
    key: "host",
    name: "Host",
    family: "hosting",
    glyph: "host",
    thresholds: [1, 5, 10, 25, 50],
    titles: [
      "Organizer",
      "Game Runner",
      "Ringleader",
      "Club Captain",
      "Community Pillar",
    ],
  },
  {
    key: "full-house",
    name: "Full House",
    family: "hosting",
    glyph: "full",
    thresholds: [1, 3, 10, 25, 50],
    titles: [
      "Crowd Puller",
      "Crowd Favourite",
      "Headliner",
      "Sell-Out Star",
      "Main Event",
    ],
  },
];

const byKey = new Map(badgeCatalog.map((badge) => [badge.key, badge]));
const order = new Map(badgeCatalog.map((badge, i) => [badge.key, i]));

export const isBadgeKey = (value: unknown): value is BadgeKey =>
  typeof value === "string" && byKey.has(value as BadgeKey);

export function badgeDefinition(key: BadgeKey): BadgeDefinition {
  const badge = byKey.get(key);
  if (!badge) throw new Error(`Unknown badge ${key}`);
  return badge;
}

export const levelId = (key: BadgeKey, level: Level) => `${key}:${level}`;

/** `key:level`, the id a seen marker is stored under. */
export function parseLevelId(
  id: string,
): { key: BadgeKey; level: Level } | null {
  const match = /^([a-z-]+):([1-5])$/.exec(id);
  if (!match || !byKey.has(match[1] as BadgeKey)) return null;
  return { key: match[1] as BadgeKey, level: Number(match[2]) as Level };
}

export const levelOf = (state: BadgeState): 0 | Level =>
  state.levels.reduce<0 | Level>(
    (top, l) => (l.level > top ? l.level : top),
    0,
  );

export const nextTarget = (key: BadgeKey, current: number): number | null =>
  badgeDefinition(key).thresholds.find((t) => t > current) ?? null;

const unseenTop = (state: BadgeState) =>
  state.levels
    .filter((l) => !l.seen)
    .reduce<EarnedLevel | null>(
      (top, l) => (!top || l.level > top.level ? l : top),
      null,
    );

/**
 * The newest new level, one per badge, and how many other badges have one.
 * The badge shown as your title goes first, so its change is never folded away.
 */
export function newestUnseen(
  badges: BadgeState[],
  prefer?: BadgeKey | null,
): { key: BadgeKey; level: Level; earnedAt: string; more: number } | null {
  const moments = badges
    .map((b) => ({ key: b.key, top: unseenTop(b) }))
    .filter((m): m is { key: BadgeKey; top: EarnedLevel } => m.top !== null)
    .sort(
      (a, b) =>
        Number(b.key === prefer) - Number(a.key === prefer) ||
        Date.parse(b.top.earnedAt) - Date.parse(a.top.earnedAt) ||
        order.get(a.key)! - order.get(b.key)!,
    );
  if (!moments.length) return null;
  const { key, top } = moments[0];
  return {
    key,
    level: top.level,
    earnedAt: top.earnedAt,
    more: moments.length - 1,
  };
}

export const unseenIds = (badges: BadgeState[]) =>
  badges.flatMap((b) =>
    b.levels.filter((l) => !l.seen).map((l) => levelId(b.key, l.level)),
  );

/** The started badge closest to its next level; nothing when none is under way. */
export function nextBadge(
  badges: BadgeState[],
): { key: BadgeKey; level: 0 | Level; current: number; target: number } | null {
  const open = badges
    .filter((b) => b.current > 0)
    .map((b) => ({
      key: b.key,
      level: levelOf(b),
      current: b.current,
      target: nextTarget(b.key, b.current),
    }))
    .filter(
      (
        b,
      ): b is {
        key: BadgeKey;
        level: 0 | Level;
        current: number;
        target: number;
      } => b.target !== null,
    )
    .sort(
      (a, b) =>
        b.current / b.target - a.current / a.target ||
        a.target - a.current - (b.target - b.current) ||
        order.get(a.key)! - order.get(b.key)!,
    );
  return open[0] ?? null;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** One plain sentence for the moment a level is earned. */
export function levelSentence(key: BadgeKey, level: Level): string {
  const n = badgeDefinition(key).thresholds[level - 1];
  switch (key) {
    case "rally":
      return level === 1
        ? "Your first session, checked in."
        : `${n} sessions, checked in.`;
    case "steady":
      return `Played in ${n} different months.`;
    case "new-faces":
      return `Played alongside ${n} different people.`;
    case "plus-one":
      return level === 1
        ? "You brought a guest who showed up."
        : `Guests you brought showed up ${n} times.`;
    case "host":
      return level === 1
        ? "You ran check-in at a session."
        : `You’ve run check-in at ${n} sessions.`;
    case "full-house":
      return level === 1
        ? "You ran a session where every seat was taken."
        : `${n} sessions you ran were full.`;
  }
}

/** What is left before the next level, in plain words. */
export function progressLabel(key: BadgeKey, left: number): string {
  switch (key) {
    case "rally":
      return `${plural(left, "more session", "more sessions")}`;
    case "steady":
      return `${plural(left, "more month", "more months")}`;
    case "new-faces":
      return `${plural(left, "more new person", "more new people")}`;
    case "plus-one":
      return `${plural(left, "more session", "more sessions")} with a guest`;
    case "host":
      return `${plural(left, "more session", "more sessions")} to run`;
    case "full-house":
      return `${plural(left, "more full session", "more full sessions")} to run`;
  }
}

/** What one level needs, for the list of levels: "25 sessions". */
export function levelTarget(key: BadgeKey, level: Level): string {
  const n = badgeDefinition(key).thresholds[level - 1];
  switch (key) {
    case "rally":
      return plural(n, "session", "sessions");
    case "steady":
      return plural(n, "month", "months");
    case "new-faces":
      return plural(n, "person", "people");
    case "plus-one":
      return `${plural(n, "session", "sessions")} with a guest`;
    case "host":
      return `${plural(n, "session", "sessions")} run`;
    case "full-house":
      return plural(n, "full session", "full sessions");
  }
}

export const levelLabel = (level: 0 | Level) =>
  level === 0 ? "Not started" : level === 5 ? "Complete" : `Level ${level}`;

export const medallionLabel = (key: BadgeKey, level: 0 | Level) =>
  `${badgeDefinition(key).name}, ${level ? `level ${level} of 5` : "not started"}`;

export const levelTitle = (key: BadgeKey, level: Level) =>
  badgeDefinition(key).titles[level - 1];
