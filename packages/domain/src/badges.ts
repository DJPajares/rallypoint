// Badges recognise showing up, meeting people and hosting (PRD D-16). The
// database decides what is earned from recorded check-ins; this catalog only
// names and draws them. Nothing here reads payments, no-shows or reliability.
export type BadgeKey =
  | "first-rally"
  | "regular"
  | "sessions-10"
  | "sessions-25"
  | "sessions-50"
  | "sessions-100"
  | "off-the-bench"
  | "plus-one"
  | "new-faces-10"
  | "new-faces-25"
  | "new-faces-50"
  | "host"
  | "hosted-10"
  | "full-house"
  | "founder";
export type BadgeFamily = "playing" | "people" | "hosting";
export type BadgeGlyph =
  | "rally"
  | "regular"
  | "number"
  | "bench"
  | "plus"
  | "faces"
  | "host"
  | "full"
  | "founder";
export interface BadgeDefinition {
  key: BadgeKey;
  name: string;
  family: BadgeFamily;
  /** Earned once per group; its id carries the group (`regular:<uuid>`). */
  perGroup: boolean;
  glyph: BadgeGlyph;
  /** The figure drawn by a "number" glyph. */
  label?: string;
  /** Medallion gradient, light stop first. */
  colors: [string, string];
  /** Navy glyph on light medallions, white otherwise. */
  darkGlyph: boolean;
  /** One plain sentence; `{group}` is the group's name. */
  sentence: string;
}
export interface EarnedBadge {
  id: string;
  key: BadgeKey;
  groupId: string | null;
  groupName: string | null;
  earnedAt: string;
  seen: boolean;
}
export interface BadgeProgress {
  key: BadgeKey;
  groupId: string | null;
  groupName: string | null;
  current: number;
  target: number;
}
export interface RosterTitle {
  key: BadgeKey;
  groupName: string | null;
}
export interface BadgesView {
  earned: EarnedBadge[];
  progress: BadgeProgress[];
  title: (RosterTitle & { id: string }) | null;
  stats: { played: number; hosted: number; groups: number };
}

const neon: [string, string] = ["#E4FF6E", "#5DBA2C"];
const gold: [string, string] = ["#FFD15A", "#D96A0C"];
export const badgeCatalog: readonly BadgeDefinition[] = [
  {
    key: "first-rally",
    name: "First Rally",
    family: "playing",
    perGroup: false,
    glyph: "rally",
    colors: ["#5CCBFF", "#2459E6"],
    darkGlyph: false,
    sentence: "Your first session, checked in.",
  },
  {
    key: "regular",
    name: "Regular",
    family: "playing",
    perGroup: true,
    glyph: "regular",
    colors: ["#9A8BFF", "#4330C9"],
    darkGlyph: false,
    sentence: "Five sessions with {group}.",
  },
  {
    key: "sessions-10",
    name: "Ten",
    family: "playing",
    perGroup: false,
    glyph: "number",
    label: "10",
    colors: ["#4FE0C8", "#0E8F8A"],
    darkGlyph: false,
    sentence: "Ten sessions, checked in.",
  },
  {
    key: "sessions-25",
    name: "Twenty-Five",
    family: "playing",
    perGroup: false,
    glyph: "number",
    label: "25",
    colors: ["#C08BFF", "#7A2BD6"],
    darkGlyph: false,
    sentence: "Twenty-five sessions, checked in.",
  },
  {
    key: "sessions-50",
    name: "Fifty",
    family: "playing",
    perGroup: false,
    glyph: "number",
    label: "50",
    colors: ["#4B6BD6", "#13235B"],
    darkGlyph: false,
    sentence: "Fifty sessions, checked in.",
  },
  {
    key: "sessions-100",
    name: "Century",
    family: "playing",
    perGroup: false,
    glyph: "number",
    label: "100",
    colors: gold,
    darkGlyph: false,
    sentence: "One hundred sessions, checked in.",
  },
  {
    key: "off-the-bench",
    name: "Off the Bench",
    family: "playing",
    perGroup: false,
    glyph: "bench",
    colors: neon,
    darkGlyph: true,
    sentence: "Moved up from the waitlist and showed up.",
  },
  {
    key: "plus-one",
    name: "Plus One",
    family: "people",
    perGroup: false,
    glyph: "plus",
    colors: ["#FF86B6", "#BE2470"],
    darkGlyph: false,
    sentence: "You brought a guest who showed up.",
  },
  {
    key: "new-faces-10",
    name: "New Faces",
    family: "people",
    perGroup: false,
    glyph: "faces",
    colors: ["#FF9A7A", "#E2483A"],
    darkGlyph: false,
    sentence: "You’ve played alongside 10 different people.",
  },
  {
    key: "new-faces-25",
    name: "Mixer",
    family: "people",
    perGroup: false,
    glyph: "faces",
    colors: ["#FF8FA8", "#D23A63"],
    darkGlyph: false,
    sentence: "You’ve played alongside 25 different people.",
  },
  {
    key: "new-faces-50",
    name: "Connector",
    family: "people",
    perGroup: false,
    glyph: "faces",
    colors: ["#F37BE0", "#A8238F"],
    darkGlyph: false,
    sentence: "You’ve played alongside 50 different people.",
  },
  {
    key: "host",
    name: "Host",
    family: "hosting",
    perGroup: false,
    glyph: "host",
    colors: ["#FFAE52", "#E5402A"],
    darkGlyph: false,
    sentence: "You ran check-in at a session.",
  },
  {
    key: "hosted-10",
    name: "Seasoned Host",
    family: "hosting",
    perGroup: false,
    glyph: "host",
    colors: ["#FF8A4C", "#B8331C"],
    darkGlyph: false,
    sentence: "You’ve run check-in at 10 sessions.",
  },
  {
    key: "full-house",
    name: "Full House",
    family: "hosting",
    perGroup: false,
    glyph: "full",
    colors: neon,
    darkGlyph: true,
    sentence: "You ran a session where every seat was taken.",
  },
  {
    key: "founder",
    name: "Founder",
    family: "hosting",
    perGroup: true,
    glyph: "founder",
    colors: gold,
    darkGlyph: false,
    sentence: "You started {group}.",
  },
];

const byKey = new Map(badgeCatalog.map((badge) => [badge.key, badge]));
const order = new Map(badgeCatalog.map((badge, i) => [badge.key, i]));
const groupId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

export function badgeDefinition(key: BadgeKey): BadgeDefinition {
  const badge = byKey.get(key);
  if (!badge) throw new Error(`Unknown badge ${key}`);
  return badge;
}

/** `key` for personal badges, `key:<lowercase uuid>` for per-group ones. */
export function parseBadgeId(
  id: string,
): { key: BadgeKey; groupId: string | null } | null {
  if (id.length > 80) return null;
  const [key, group, extra] = id.split(":");
  const badge = byKey.get(key as BadgeKey);
  if (!badge || extra !== undefined) return null;
  if (badge.perGroup)
    return group && groupId.test(group)
      ? { key: badge.key, groupId: group }
      : null;
  return group === undefined ? { key: badge.key, groupId: null } : null;
}

export const titleLabel = (title: RosterTitle) =>
  badgeDefinition(title.key).name +
  (title.groupName ? ` · ${title.groupName}` : "");

export const earnedSentence = (badge: RosterTitle) =>
  badgeDefinition(badge.key).sentence.replace(
    "{group}",
    badge.groupName ?? "your group",
  );

/** The newest badge not yet shown, and how many others wait behind it. */
export function newestUnseen(
  earned: EarnedBadge[],
): { badge: EarnedBadge; more: number } | null {
  const unseen = earned
    .filter((badge) => !badge.seen)
    .sort(
      (a, b) =>
        Date.parse(b.earnedAt) - Date.parse(a.earnedAt) ||
        order.get(a.key)! - order.get(b.key)!,
    );
  return unseen.length ? { badge: unseen[0], more: unseen.length - 1 } : null;
}

/** The started badge closest to done; nothing when none is under way. */
export function nextBadge(progress: BadgeProgress[]): BadgeProgress | null {
  const open = progress
    .filter((p) => p.current > 0 && p.current < p.target)
    .sort(
      (a, b) =>
        b.current / b.target - a.current / a.target ||
        a.target - a.current - (b.target - b.current) ||
        order.get(a.key)! - order.get(b.key)!,
    );
  return open[0] ?? null;
}

export function progressLabel(progress: BadgeProgress): string {
  const left = progress.target - progress.current;
  const family = badgeDefinition(progress.key).family;
  if (family === "people")
    return `${left} more ${left === 1 ? "new person" : "new people"}`;
  const sessions = `${left} more ${left === 1 ? "session" : "sessions"}`;
  if (family === "hosting") return `${sessions} to run`;
  return progress.groupName ? `${sessions} at ${progress.groupName}` : sessions;
}
