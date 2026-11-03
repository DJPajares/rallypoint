// Ranked searches (D-26, WDL-421). A player searches for a ranked pickleball
// match by format, 1 to 3 areas, and optionally up to 5 courts in those areas
// and some broad times. Doubles players search with a partner they choose
// from people they've played with, or by sharing a link; the search starts
// once the partner accepts. One search at a time; a search lasts 7 days.

export const searchFormats = ["singles", "doubles"] as const;
export type SearchFormat = (typeof searchFormats)[number];

/** Broad times, in Singapore local time; matching reads them later. */
export const searchWindows = [
  { key: "weekday-mornings", label: "Weekday mornings" },
  { key: "weekday-afternoons", label: "Weekday afternoons" },
  { key: "weekday-evenings", label: "Weekday evenings" },
  { key: "weekend-mornings", label: "Weekend mornings" },
  { key: "weekend-afternoons", label: "Weekend afternoons" },
  { key: "weekend-evenings", label: "Weekend evenings" },
] as const;
export type SearchWindow = (typeof searchWindows)[number]["key"];

export const maxSearchAreas = 3;
export const maxSearchCourts = 5;
/** Days a search keeps looking. */
export const searchDays = 7;

export type SearchPartner = { profileId: string } | { link: true } | null;

export interface SearchInput {
  format: string;
  areas: string[];
  courts: string[];
  windows: string[];
  partner: SearchPartner;
}

export interface SearchError {
  field: "format" | "areas" | "courts" | "windows" | "partner";
  message: string;
}

/** A search as one of its searchers sees it. */
export interface SearchView {
  id: string;
  format: SearchFormat;
  state: "waiting_partner" | "searching" | "matched" | "ended";
  endReason:
    | "expired"
    | "unanswered"
    | "cancelled"
    | "declined"
    | "declined_match"
    | "partner_declined_match"
    | "match_lapsed"
    | "withdrew_match"
    | "partner_withdrew_match"
    | "match_won"
    | "match_lost"
    | "match_missed"
    | "match_void"
    | null;
  /** Searching again after a match fell through, for a day afterwards. */
  returned: "declined" | "lapsed" | "unbooked" | "withdrawn" | null;
  /** When a waiting invite lapses, or when searching stops. */
  endsAt: string;
  role: "starter" | "partner";
  areas: Array<{ key: string; label: string }>;
  courts: Array<{ id: string; name: string }>;
  windows: SearchWindow[];
  /** The other searcher, or the person invited; null for an unused link. */
  partner: { profileId: string | null; name: string } | null;
  /** The starter's shareable invite, while it can still be used. */
  inviteToken: string | null;
  /** Looking across the whole region of the chosen areas. */
  wide: boolean;
  /** Unmatched for 3 days: the player may widen to `regions`. */
  canWiden: boolean;
  regions: string[];
}

/** A proposed or confirmed match as one of its players sees it (WDL-422). */
export interface MatchView {
  id: string;
  format: SearchFormat;
  /** "expired": the 48 hours ran out; the queue settles it within a minute. */
  state: "proposed" | "confirmed" | "expired";
  area: { key: string; label: string };
  court: { id: string; name: string; mapsUrl: string | null } | null;
  /** Null means any time. */
  window: SearchWindow | null;
  respondBy: string;
  /** Your side first, you first within it. */
  players: Array<{
    profileId: string | null;
    name: string;
    side: "yours" | "theirs";
    accepted: boolean;
    you: boolean;
    /** Checked themselves in to the booked session (WDL-424). */
    checkedIn: boolean;
  }>;
  myAnswer: "accepted" | null;
  /** Once everyone has accepted: booking the court (WDL-424). */
  booking: MatchBooking | null;
  /** Once booked: reporting who won (WDL-425). */
  result: MatchResult | null;
  /** Once booked: when players can check themselves in. */
  checkIn: { opensAt: string; closesAt: string; you: boolean } | null;
}

export interface MatchResult {
  /** "waiting" until check-in closes, 30 minutes after the start. */
  state: "waiting" | "report" | "reported";
  reportedBy: "yours" | "theirs" | null;
  reportedWinner: "yours" | "theirs" | null;
  /** No report by then and the match doesn't count. */
  reportBy: string;
  /** No answer by then and the report stands. */
  confirmBy: string | null;
  /** You checked in and it's your turn: report, or answer their report. */
  canAct: boolean;
}

export interface MatchBooking {
  state: "open" | "claimed" | "booked";
  bookerName: string | null;
  /** You are the one booking (or who booked). */
  you: boolean;
  /** While claimed: when the booker's 48 hours end. */
  claimUntil: string | null;
  /** The match is let go if nobody books by then. */
  bookBy: string;
  session: {
    slug: string;
    startsAt: string;
    location: string;
    /** Withdrawing is free until then; after it, it counts as not showing up. */
    cutoffAt: string;
    currency: string;
    totalMinor: number;
    /** An equal share of the court cost, before the organizer finalizes. */
    shareMinor: number;
  } | null;
}

/** What the Ranked page reads. */
export interface MySearch {
  search: SearchView | null;
  invites: SearchInvite[];
  match: MatchView | null;
}

/** A doubles invite as the invited person sees it. */
export interface SearchInvite {
  token: string;
  starterName: string;
  format: SearchFormat;
  areas: Array<{ key: string; label: string }>;
  endsAt: string;
}

const distinct = (values: string[]) => new Set(values).size === values.length;
const isWindow = (value: string): value is SearchWindow =>
  searchWindows.some((w) => w.key === value);

/** Checks a new search before it is sent; the server rechecks everything. */
export function normalizeSearch(input: SearchInput):
  | {
      ok: true;
      value: Omit<SearchInput, "format"> & { format: SearchFormat };
    }
  | { ok: false; errors: SearchError[] } {
  const errors: SearchError[] = [];
  const format = searchFormats.find((f) => f === input.format);
  if (!format)
    errors.push({ field: "format", message: "Choose singles or doubles." });
  const areas = input.areas.filter(Boolean);
  if (!areas.length)
    errors.push({ field: "areas", message: "Choose at least one area." });
  else if (areas.length > maxSearchAreas || !distinct(areas))
    errors.push({
      field: "areas",
      message: `Choose up to ${maxSearchAreas} different areas.`,
    });
  if (input.courts.length > maxSearchCourts || !distinct(input.courts))
    errors.push({
      field: "courts",
      message: `Choose up to ${maxSearchCourts} courts.`,
    });
  if (!input.windows.every(isWindow) || !distinct(input.windows))
    errors.push({ field: "windows", message: "Choose from the listed times." });
  if (format === "doubles" && !input.partner)
    errors.push({
      field: "partner",
      message: "Choose your partner or invite them with a link.",
    });
  if (format === "singles" && input.partner)
    errors.push({ field: "partner", message: "Singles is just you." });
  return errors.length || !format
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          format,
          areas,
          courts: input.courts,
          windows: input.windows,
          partner: input.partner,
        },
      };
}
