// Ranks people can see (D-26). The rating behind a rank never leaves the
// database; reads carry the rank name for each ranked category only.

export const rankNames = [
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
] as const;
export type RankName = (typeof rankNames)[number];

/** One ranked category: an activity, one of its formats, and the rank. */
export interface RankedCategory {
  /** The catalog activity key, e.g. "pickleball". */
  activity: string;
  /** The activity's format key, e.g. "doubles". */
  format: string;
  rank: RankName;
}

const isRankName = (value: unknown): value is RankName =>
  rankNames.includes(value as RankName);

// The app and its database can ship minutes apart; anything that isn't a
// ranked category this app understands is left out rather than shown wrong.
export function rankedCategories(value: unknown): RankedCategory[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is RankedCategory =>
      !!c &&
      typeof c === "object" &&
      typeof c.activity === "string" &&
      typeof c.format === "string" &&
      isRankName(c.rank),
  );
}

/** "doubles" → "Doubles", "mixed-doubles" → "Mixed doubles". */
const formatName = (format: string) => {
  const words = format.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** What a rank pill says, e.g. "Gold · Doubles". */
export const rankLabel = (c: RankedCategory) =>
  `${c.rank} · ${formatName(c.format)}`;
