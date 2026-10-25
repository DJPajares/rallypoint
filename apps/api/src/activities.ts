import { Hono } from "hono";
import type { Activity } from "@rallypoint/domain/activities";
import type { Database } from "@rallypoint/database";
import { ApiError } from "./http";
import type { ApiEnv } from "./identity";
import { connection, notAvailable } from "./identity";

/** The shared activity catalog (D-23), or null when it can't be read. */
export async function readActivities(db: Database): Promise<Activity[] | null> {
  const { data, error } = await db.rpc("read_activities", {});
  return error || !Array.isArray(data) ? null : (data as Activity[]);
}

// Public and the same for everyone (nothing personal), so browsers and
// proxies may keep it for a few minutes.
export const activities = new Hono<ApiEnv>()
  .get("/activities", async (c) => {
    connection(c.env);
    const catalog = await readActivities(c.var.db);
    if (!catalog)
      throw new ApiError(
        503,
        "service_unavailable",
        "Activities could not be loaded. Please try again.",
      );
    return Response.json(
      { activities: catalog },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  })
  .all("/activities", (c) => {
    connection(c.env);
    return notAvailable();
  });
