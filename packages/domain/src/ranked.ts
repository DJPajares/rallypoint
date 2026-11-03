// Medals people can see (D-26). The skill and standing behind a medal never
// leave the database, not even to their owner; reads carry the medal and its
// stars for each calibrated category, and the owner's read also says how far
// through calibration they are.

export const medalNames = [
  "Rookie",
  "Contender",
  "Challenger",
  "Veteran",
  "Elite",
  "Master",
] as const;
export type MedalName = (typeof medalNames)[number];

/** Matches it takes to earn a first medal in a category. */
export const calibrationMatches = 5;

/** One calibrated category: an activity, one of its formats, and its medal. */
export interface RankedCategory {
  /** The catalog activity key, e.g. "pickleball". */
  activity: string;
  /** The activity's format key, e.g. "doubles". */
  format: string;
  medal: MedalName;
  /** 1 to 5; null for Master, which has none. */
  stars: number | null;
}

/** A category still calibrating, as only its owner sees it. */
export interface CalibratingCategory {
  activity: string;
  format: string;
  /** Matches played so far, 1 to 4. */
  calibrating: number;
}

type Shape = Record<string, unknown>;
const isShape = (
  c: unknown,
): c is Shape & { activity: string; format: string } =>
  !!c &&
  typeof c === "object" &&
  typeof (c as Shape).activity === "string" &&
  typeof (c as Shape).format === "string";
const isStars = (stars: unknown) =>
  typeof stars === "number" &&
  Number.isInteger(stars) &&
  stars >= 1 &&
  stars <= 5;

// The app and its database can ship minutes apart; anything that isn't a
// medal this app understands is left out rather than shown wrong.
export function rankedCategories(value: unknown): RankedCategory[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is RankedCategory =>
      isShape(c) &&
      medalNames.includes(c.medal as MedalName) &&
      (c.medal === "Master" ? c.stars === null : isStars(c.stars)),
  );
}

export function calibratingCategories(value: unknown): CalibratingCategory[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is CalibratingCategory =>
      isShape(c) &&
      typeof c.calibrating === "number" &&
      Number.isInteger(c.calibrating) &&
      c.calibrating >= 1 &&
      c.calibrating < calibrationMatches,
  );
}

/** "doubles" → "Doubles", "mixed-doubles" → "Mixed doubles". */
export const formatName = (format: string) => {
  const words = format.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The medal and its stars, e.g. "Veteran ★★★" or "Master". */
export const medalLabel = (c: RankedCategory) =>
  c.stars ? `${c.medal} ${"★".repeat(c.stars)}` : c.medal;

/** What a medal pill says, e.g. "Veteran ★★★ · Doubles". */
export const rankLabel = (c: RankedCategory) =>
  `${medalLabel(c)} · ${formatName(c.format)}`;

/** What a screen reader hears, e.g. "Doubles: Veteran, 3 of 5 stars". */
export const rankSpoken = (c: RankedCategory) =>
  `${formatName(c.format)}: ${c.medal}${c.stars ? `, ${c.stars} of 5 stars` : ""}`;

/** The owner's progress toward a first medal, e.g. "Calibrating · 3 of 5". */
export const calibratingLabel = (c: CalibratingCategory) =>
  `Calibrating · ${c.calibrating} of ${calibrationMatches}`;

/** What a screen reader hears, e.g. "Doubles: calibrating, 3 of 5 matches played". */
export const calibratingSpoken = (c: CalibratingCategory) =>
  `${formatName(c.format)}: calibrating, ${c.calibrating} of ${calibrationMatches} matches played`;
