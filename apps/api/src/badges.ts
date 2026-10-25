import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { isBadgeKey, parseLevelId } from "@rallypoint/domain/badges";
import { ApiError, json, parse, readBody } from "./http";
import type { ApiEnv } from "./identity";
import { notAvailable, requireUser } from "./identity";

// Badges are the signed-in person's own; there is no route to read anyone else's.
async function call(
  c: Context<ApiEnv>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await c.var.db.rpc(name, {
    p_actor_id: c.var.user.id,
    ...args,
  });
  if (error?.message === "title_not_earned")
    throw new ApiError(
      422,
      "title_not_earned",
      "You can show a badge once you’ve earned it.",
    );
  if (error?.message === "invalid_badges")
    throw new ApiError(422, "invalid_badges", "Choose badges to mark as seen.");
  if (error)
    throw new ApiError(
      503,
      "service_unavailable",
      "Your badges could not be loaded. Please try again.",
    );
  return json(data);
}

// Seen markers name a badge level (`rally:3`); a title names a badge (`rally`).
const levelId = z.string().refine((id) => parseLevelId(id) !== null);
const titleId = z.string().refine(isBadgeKey);
const seen = z.object({ ids: z.array(levelId).min(1).max(50) });
const title = z.object({ badgeId: titleId.nullable() });

export const badges = new Hono<ApiEnv>()
  .get("/me/badges", requireUser, (c) => call(c, "read_my_badges"))
  .all("/me/badges", requireUser, () => notAvailable())
  .post("/me/badges/seen", requireUser, async (c) => {
    const { ids } = parse(
      seen,
      await readBody(c.req.raw),
      "invalid_badges",
      "Choose badges to mark as seen.",
    );
    return call(c, "mark_badges_seen", { p_ids: ids });
  })
  .all("/me/badges/seen", requireUser, () => notAvailable())
  .post("/me/title", requireUser, async (c) => {
    const { badgeId } = parse(
      title,
      await readBody(c.req.raw),
      "invalid_title",
      "Choose one of your badges.",
    );
    return call(c, "set_my_title", { p_badge_id: badgeId });
  })
  .all("/me/title", requireUser, () => notAvailable());
