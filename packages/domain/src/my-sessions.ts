// What a person sees about their own sessions on the Sessions tab and the
// game-day view. Pure helpers: they read rows the API already filtered and
// decide only how a status reads, where a row leads and when game day applies.

export type MySessionStatus =
  "in" | "waitlisted" | "organizing" | "draft" | "cancelled";

export interface MySessionRow {
  id: string | null; // drafts only
  slug: string;
  title: string;
  groupName: string;
  startLocal: string; // "" when undecided
  startsAt: string | null;
  endsAt: string | null;
  timeZone: string;
  state: "draft" | "published" | "completed" | "cancelled";
  status: MySessionStatus;
  waitPosition: number | null;
}

export interface MySessions {
  upcoming: MySessionRow[];
  past: MySessionRow[];
  pastTotal: number;
}

/** The status in words; colour, if any, only supports it. */
export function statusLabel(
  row: Pick<MySessionRow, "status" | "waitPosition">,
  past: boolean,
): string {
  switch (row.status) {
    case "in":
      return past ? "You were in" : "You're in";
    case "waitlisted":
      if (past) return "Waitlisted";
      return row.waitPosition === null
        ? "Waitlist"
        : `Waitlist #${row.waitPosition}`;
    case "organizing":
      return past ? "Organized" : "Organizing";
    case "draft":
      return "Draft";
    case "cancelled":
      return "Cancelled";
  }
}

/** A draft opens its editor; every other session opens its page. */
export function sessionHref(
  row: Pick<MySessionRow, "status" | "id" | "slug">,
): string {
  if (row.status === "draft" && row.id) return `/sessions/${row.id}/edit`;
  return `/s/${row.slug}`;
}

/** A search link for the venue text; null when there is no venue. */
export function mapsUrl(venue: string | undefined): string | null {
  const query = venue?.trim() ?? "";
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Game day is for a joined player (confirmed or waitlisted) on a published
 * session that has not ended. At `endsAt` itself it has ended. A missing or
 * unreadable end time counts as not ended.
 */
export function isGameDay(
  input: {
    state: string;
    endsAt?: string;
    canManage: boolean;
    ownState?: string;
  },
  now: number,
): boolean {
  if (input.canManage || input.state !== "published") return false;
  if (input.ownState !== "confirmed" && input.ownState !== "waitlisted")
    return false;
  const end = input.endsAt ? Date.parse(input.endsAt) : Number.NaN;
  return !(Number.isFinite(end) && now >= end);
}

/** The one line that says where the player stands on game day. */
export function gameDayHeadline(own: {
  state: string;
  seats: number;
  queuePosition?: number | null;
}): string {
  if (own.state === "confirmed") {
    if (own.seats <= 1) return "You're in";
    const guests = own.seats - 1;
    return `You're in, with ${guests} ${guests === 1 ? "guest" : "guests"}`;
  }
  return own.queuePosition == null
    ? "Waitlist"
    : `Waitlist #${own.queuePosition}`;
}

/** How many seats are taken against the capacity, in words. */
export function comingLine(confirmedSeats: number, capacity: number): string {
  return `${confirmedSeats} of ${capacity} coming`;
}
