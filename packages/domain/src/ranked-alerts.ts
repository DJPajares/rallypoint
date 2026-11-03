// What ranked play is waiting on the player (D-26, WDL-423), worked out from
// their ranked read. In-app only: Home lists these and the menu counts them.
// A deadline that has passed drops the item; nothing is shown as missed.
// Booking (WDL-424) and results (WDL-425) add their own kinds here.
import type { MySearch, SearchFormat } from "./ranked-search.ts";

export type RankedAlert =
  | {
      kind: "match";
      key: string;
      matchId: string;
      format: SearchFormat;
      deadline: string;
    }
  | {
      kind: "invite";
      key: string;
      token: string;
      starterName: string;
      format: SearchFormat;
      deadline: string;
    }
  | {
      kind: "widen";
      key: string;
      searchId: string;
      regions: string[];
      deadline: string;
    };

const open = (deadline: string, now: number) => Date.parse(deadline) > now;

/** The items waiting on the player, soonest deadline first. */
export function rankedAlerts(
  mine: MySearch | null,
  now = Date.now(),
): RankedAlert[] {
  if (!mine) return [];
  const alerts: RankedAlert[] = [];
  const { match, search } = mine;
  if (
    match &&
    match.state === "proposed" &&
    !match.myAnswer &&
    open(match.respondBy, now)
  )
    alerts.push({
      kind: "match",
      key: `match:${match.id}`,
      matchId: match.id,
      format: match.format,
      deadline: match.respondBy,
    });
  for (const invite of mine.invites)
    if (open(invite.endsAt, now))
      alerts.push({
        kind: "invite",
        key: `invite:${invite.token}`,
        token: invite.token,
        starterName: invite.starterName,
        format: invite.format,
        deadline: invite.endsAt,
      });
  if (search?.canWiden && open(search.endsAt, now))
    alerts.push({
      kind: "widen",
      key: `widen:${search.id}`,
      searchId: search.id,
      regions: search.regions,
      deadline: search.endsAt,
    });
  return alerts.sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
}
