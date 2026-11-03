import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { ApiError, json, parse } from "./http";
import type { ApiEnv } from "./identity";
import { notAvailable, requireUser } from "./identity";

// Universal search (owner, 2026-10-30). /search finds groups by name (P-37)
// and the person's own sessions by title. D-27 (owner, 2026-11-03) adds public
// sessions by day, people with a public profile, and public clubs; each read
// returns public data only.
const query = z.object({ q: z.string().trim().min(2).max(40) });
const optionalQuery = z.object({
  q: z.string().trim().min(2).max(40).optional(),
});
const sessionsQuery = optionalQuery.extend({
  // A full ISO instant: JavaScript reads more shapes as dates than Postgres does.
  from: z
    .string()
    .max(40)
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/,
    ),
  tz: z.string().min(1).max(100),
});
const refused = "Type 2 to 40 characters to search.";

async function read(
  c: Context<ApiEnv>,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await c.var.db.rpc(name, {
    p_actor_id: c.var.user.id,
    ...args,
  });
  if (error && ["23514", "22007", "22008"].includes(error.code))
    throw new ApiError(422, "invalid_input", refused);
  if (error)
    throw new ApiError(
      503,
      "service_unavailable",
      "Search didn't finish. Please try again.",
    );
  return data;
}

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
    const sessions = [...matches(lists.upcoming), ...matches(lists.past)].slice(
      0,
      SESSION_LIMIT,
    );
    return json({ groups: groups.data, sessions });
  })
  .all("/search", requireUser, () => notAvailable())
  // Public sessions from the viewer's local midnight, for 14 days.
  .get("/search/sessions", requireUser, async (c) => {
    const p = parse(
      sessionsQuery,
      {
        from: c.req.query("from"),
        tz: c.req.query("tz"),
        q: c.req.query("q") || undefined,
      },
      "invalid_input",
      refused,
    );
    return json(
      await read(c, "search_sessions", {
        p_from: p.from,
        p_time_zone: p.tz,
        p_query: p.q ?? null,
      }),
    );
  })
  .all("/search/sessions", requireUser, () => notAvailable())
  .get("/search/people", requireUser, async (c) => {
    const { q } = parse(
      query,
      { q: c.req.query("q") },
      "invalid_input",
      refused,
    );
    return json(await read(c, "search_people", { p_query: q }));
  })
  .all("/search/people", requireUser, () => notAvailable())
  .get("/search/clubs", requireUser, async (c) => {
    const { q } = parse(
      optionalQuery,
      { q: c.req.query("q") || undefined },
      "invalid_input",
      refused,
    );
    return json(await read(c, "search_clubs", { p_query: q ?? null }));
  })
  .all("/search/clubs", requireUser, () => notAvailable());
