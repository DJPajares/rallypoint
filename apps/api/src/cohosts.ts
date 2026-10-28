import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "@rallypoint/database";
import { ApiError, json, parse, readBody, uuid, uuidParam } from "./http";
import type { ApiEnv } from "./identity";
import { notAvailable, requireUser } from "./identity";

const change = z
  .object({
    operationKey: z.string().regex(uuid),
    profileId: z.string().regex(uuid),
    action: z.enum(["add", "remove"]),
    revision: z.string().regex(/^(0|[1-9][0-9]{0,18})$/),
  })
  .strict();

async function rpc(db: Database, name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (!error) return data;
  if (error.code === "42501")
    throw new ApiError(
      403,
      "group_owner_required",
      "Only the session's organizer can manage co-hosts.",
    );
  const conflicts: Record<string, string> = {
    stale_cohosts: "Co-hosts changed. Reload the list before trying again.",
    cohost_not_eligible:
      "This person cannot be changed here. Reload the list and choose a current co-host, someone who joined one of your sessions, or a member of a group you admin.",
    idempotency_conflict:
      "This request key was already used for different details.",
  };
  if (conflicts[error.message])
    throw new ApiError(409, error.message, conflicts[error.message]);
  if (["23514", "22P02"].includes(error.code))
    throw new ApiError(
      422,
      "invalid_input",
      "Choose a person and reload the co-host list before trying again.",
    );
  throw new ApiError(
    503,
    "service_unavailable",
    "The action could not be confirmed. Check the result or retry the same request.",
  );
}

const path = `/groups/:id{${uuidParam}}/cohosts`;
const sessionPath = `/sessions/:id{${uuidParam}}/cohosts`;
const readAfter = (after: string | undefined) => {
  if (after !== undefined)
    parse(
      z.string().regex(uuid),
      after,
      "invalid_input",
      "Reload the co-host list.",
    );
  return after ?? null;
};
export const cohosts = new Hono<ApiEnv>()
  // Co-hosts belong to each session (P-35).
  .get(sessionPath, requireUser, async (c) =>
    json({
      cohosts: await rpc(c.var.db, "read_session_cohosts", {
        p_actor_id: c.var.user.id,
        p_session_id: c.req.param("id"),
        p_after: readAfter(c.req.query("after")),
      }),
    }),
  )
  .post(sessionPath, requireUser, async (c) => {
    const input = parse(
      change,
      await readBody(c.req.raw),
      "invalid_input",
      "Choose a person and reload the co-host list before trying again.",
    );
    return json(
      await rpc(c.var.db, "update_session_cohost", {
        p_actor_id: c.var.user.id,
        p_key: input.operationKey,
        p_session_id: c.req.param("id"),
        p_profile_id: input.profileId,
        p_action: input.action,
        p_revision: input.revision,
      }),
    );
  })
  .all(sessionPath, requireUser, () => notAvailable())
  .get(path, requireUser, async (c) => {
    const after = c.req.query("after");
    if (after !== undefined)
      parse(
        z.string().regex(uuid),
        after,
        "invalid_input",
        "Reload the co-host list.",
      );
    return json({
      cohosts: await rpc(c.var.db, "read_group_cohosts", {
        p_actor_id: c.var.user.id,
        p_group_id: c.req.param("id"),
        p_after: after ?? null,
      }),
    });
  })
  .post(path, requireUser, async (c) => {
    const input = parse(
      change,
      await readBody(c.req.raw),
      "invalid_input",
      "Choose a person and reload the co-host list before trying again.",
    );
    return json(
      await rpc(c.var.db, "update_group_cohost", {
        p_actor_id: c.var.user.id,
        p_key: input.operationKey,
        p_group_id: c.req.param("id"),
        p_profile_id: input.profileId,
        p_action: input.action,
        p_revision: input.revision,
      }),
    );
  })
  .all(path, requireUser, () => notAvailable());
