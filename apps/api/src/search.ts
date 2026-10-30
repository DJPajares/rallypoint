import { Hono } from "hono";
import { z } from "zod";
import { ApiError, json, parse } from "./http";
import type { ApiEnv } from "./identity";
import { notAvailable, requireUser } from "./identity";

// Universal search (owner, 2026-10-30), opened from the menu. It finds groups
// by name, as group search did (P-37), and the person's own sessions by title.
// Other people's sessions are never searchable and people can't be looked up.
const query = z.object({ q: z.string().trim().min(2).max(40) });

type MySession = { title: string; startsAt: string | null };
const SESSION_LIMIT = 20;

export const search = new Hono<ApiEnv>()
  .get("/search", requireUser, async (c) => {
    const { q } = parse(
      query,
      { q: c.req.query("q") },
      "invalid_input",
      "Type 2 to 40 characters to search.",
    );
    const [groups, mine] = await Promise.all([
      c.var.db.rpc("search_groups", {
        p_actor_id: c.var.user.id,
        p_query: q,
      }),
      // The same sessions, statuses and links as the Sessions tab.
      c.var.db.rpc("list_my_sessions", { p_actor_id: c.var.user.id }),
    ]);
    if (groups.error || mine.error)
      throw new ApiError(
        503,
        "service_unavailable",
        "Search didn't finish. Please try again.",
      );
    const wanted = q.toLowerCase();
    const matches = (rows: MySession[] = []) =>
      rows.filter((row) => (row.title ?? "").toLowerCase().includes(wanted));
    const lists = mine.data as { upcoming?: MySession[]; past?: MySession[] };
    // Coming up first, soonest first; then past ones, latest first.
    const sessions = [
      ...matches(lists.upcoming),
      ...matches(lists.past),
    ].slice(0, SESSION_LIMIT);
    return json({ groups: groups.data, sessions });
  })
  .all("/search", requireUser, () => notAvailable());
