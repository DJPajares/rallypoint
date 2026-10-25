import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { normalizeProfile, skillLevels } from "@rallypoint/domain/profile";
import { ApiError, json, readBody, uuidParam } from "./http";
import type { ApiEnv } from "./identity";
import { connection, displayName, notAvailable, requireUser } from "./identity";
import { readActivities } from "./activities";

const unavailable = () =>
  new ApiError(
    503,
    "service_unavailable",
    "Your profile could not be loaded. Please try again.",
  );

// Shape only; the limits live in the domain rules and are re-checked in SQL.
// An unknown field is refused rather than ignored.
const body = z
  .object({
    name: z.string(),
    activities: z.array(
      z
        .object({ name: z.string(), level: z.enum(skillLevels).nullable() })
        .strict(),
    ),
  })
  .strict();

// A profile is always the signed-in person's own: the person is the verified
// session, never a field of the request.
async function mineCall(
  c: Context<ApiEnv>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await c.var.db.rpc(name, {
    p_actor_id: c.var.user.id,
    p_account_name: displayName(c.var.user, "Participant"),
    ...args,
  });
  if (error?.message === "invalid_profile")
    throw new ApiError(
      400,
      "invalid_input",
      "Check your profile. Nothing was saved.",
    );
  if (error) throw unavailable();
  return data;
}

const id = `:profileId{${uuidParam}}`;
export const profiles = new Hono<ApiEnv>()
  .get("/me/profile", requireUser, async (c) =>
    json({ profile: await mineCall(c, "read_my_profile") }),
  )
  .post("/me/profile", requireUser, async (c) => {
    const parsed = body.safeParse(await readBody(c.req.raw));
    if (!parsed.success)
      throw new ApiError(
        400,
        "invalid_input",
        "Check your profile. Nothing was saved.",
      );
    // Catalog activities keep their spelling and are not "your own".
    const catalog = await readActivities(c.var.db);
    if (!catalog) throw unavailable();
    const result = normalizeProfile(parsed.data, catalog);
    if (!result.ok)
      return json(
        {
          error: {
            code: "invalid_input",
            message: "Check your profile. Nothing was saved.",
          },
          errors: result.errors,
        },
        400,
      );
    return json({
      profile: await mineCall(c, "save_my_profile", {
        p_name: result.value.name ?? "",
        p_activities: result.value.activities,
      }),
    });
  })
  .all("/me/profile", requireUser, () => notAvailable())
  // Public: anyone holding the link can read the page's own fields, nothing else.
  .get(`/people/${id}`, async (c) => {
    connection(c.env);
    const { data, error } = await c.var.db.rpc("read_profile", {
      p_profile_id: c.req.param("profileId"),
    });
    if (error?.message === "profile_not_found")
      throw new ApiError(404, "not_found", "Profile not found");
    if (error) throw unavailable();
    return json({ profile: data });
  })
  .all(`/people/${id}`, (c) => {
    connection(c.env);
    return notAvailable();
  })
  // A link that is not a profile id is simply a profile that is not there.
  .get("/people/:other", () => {
    throw new ApiError(404, "not_found", "Profile not found");
  });
