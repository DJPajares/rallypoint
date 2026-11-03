import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { normalizeCourt } from "@rallypoint/domain/courts";
import { ApiError, json, parse, readBody, uuid } from "./http";
import type { ApiEnv } from "./identity";
import { connection, notAvailable, requireUser } from "./identity";

// Areas and courts for ranked play (D-26, WDL-419).
const conflicts: Record<string, string> = {
  court_exists:
    "That court is already listed in this area. Pick it from the list.",
  court_limit:
    "You’ve added 20 courts, the most one person can. Pick one from the list.",
  idempotency_conflict:
    "This request key was already used for different details.",
};

// What the database refused, by field.
const refusals: Record<string, string> = {
  invalid_area: "Choose an area from the list.",
  invalid_name: "Name the court with letters or numbers.",
  invalid_link: "Use a link that starts with https://.",
};

async function call(
  c: Context<ApiEnv>,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await c.var.db.rpc(name, {
    p_actor_id: c.var.user.id,
    ...args,
  });
  if (!error) return data;
  if (conflicts[error.message])
    throw new ApiError(409, error.message, conflicts[error.message]);
  if (error.code === "23514")
    throw new ApiError(
      422,
      "invalid_input",
      refusals[error.message] ?? "Check the court’s details.",
    );
  throw new ApiError(
    503,
    "service_unavailable",
    "The action could not be confirmed. Check the result or retry the same request.",
  );
}

const area = z.string().max(40);
const addition = z.object({
  operationKey: z.string().regex(uuid),
  area,
  name: z.string().max(200),
  mapsLink: z.string().max(1000).optional(),
});

export const courts = new Hono<ApiEnv>()
  // Public and the same for everyone, so browsers may keep it a while.
  .get("/areas", async (c) => {
    connection(c.env);
    const { data, error } = await c.var.db.rpc("read_areas", {});
    if (error || !Array.isArray(data))
      throw new ApiError(
        503,
        "service_unavailable",
        "Areas could not be loaded. Please try again.",
      );
    return Response.json(
      { regions: data },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  })
  .all("/areas", (c) => {
    connection(c.env);
    return notAvailable();
  })
  .get("/courts", requireUser, async (c) => {
    const { area: key } = parse(
      z.object({ area }),
      { area: c.req.query("area") },
      "invalid_input",
      "Choose an area from the list.",
    );
    return json({ courts: await call(c, "list_courts", { p_area_key: key }) });
  })
  .post("/courts", requireUser, async (c) => {
    const b = parse(
      addition,
      await readBody(c.req.raw),
      "invalid_input",
      "Check the court’s details.",
    );
    const court = normalizeCourt({
      area: b.area,
      name: b.name,
      mapsLink: b.mapsLink ?? "",
    });
    if (!court.ok)
      throw new ApiError(422, "invalid_input", court.errors[0].message);
    return json(
      await call(c, "add_court", {
        p_key: b.operationKey,
        p_area_key: court.value.area,
        p_name: court.value.name,
        p_maps_url: court.value.mapsUrl,
      }),
    );
  })
  .all("/courts", requireUser, () => notAvailable());
