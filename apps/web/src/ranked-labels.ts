import type { SearchView } from "@rallypoint/domain/ranked-search";

/** "the East region", or "the East and Central regions". */
export const regionLabel = (regions: string[]) =>
  regions.length > 1
    ? `the ${regions.join(" and ")} regions`
    : `the ${regions[0] ?? ""} region`;

/** Why a search is looking again after a match fell through. */
export const returnedLabel: Record<
  NonNullable<SearchView["returned"]>,
  string
> = {
  declined:
    "The other side declined your last match, so you’re searching again with your place kept.",
  lapsed:
    "Your last match ran out before everyone accepted, so you’re searching again with your place kept.",
  unbooked:
    "Your last match wasn’t booked within 4 days, so you’re searching again with your place kept.",
  withdrawn:
    "A player withdrew from your last match, so you’re searching again with your place kept. If that session is still on, you’re still in it: withdraw from it if you won’t play.",
};

/** How a search ended. */
export function endedLabel(
  search: Pick<SearchView, "endReason" | "partner">,
): string {
  const partner = search.partner?.name ?? "Your partner";
  switch (search.endReason) {
    case "declined":
      return `${partner} declined.`;
    case "cancelled":
      return "It was cancelled.";
    case "declined_match":
      return "You declined the match.";
    case "partner_declined_match":
      return `${partner} declined the match.`;
    case "withdrew_match":
      return "You withdrew from the match.";
    case "partner_withdrew_match":
      return `${partner} withdrew from the match.`;
    case "match_won":
      return "You won your last match.";
    case "match_lost":
      return "You lost your last match.";
    case "match_missed":
      return "You didn’t check in, so your last match counted as a loss.";
    case "match_void":
      return "Your last match didn’t count, so no ranks changed.";
    case "match_lapsed":
      return "The match ran out before everyone accepted.";
    case "unanswered":
      return `${partner} didn’t answer in time.`;
    default:
      return "It ran out without a match.";
  }
}
