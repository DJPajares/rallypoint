import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { ApiError, json, parse, readBody, uuid, uuidParam } from "./http";
import type { ApiEnv } from "./identity";
import { actorName, notAvailable, requireUser } from "./identity";

// P-35: groups are member lists people ask to join; the admin answers.
const conflicts: Record<string, string> = {
  already_member: "You're already in this group.",
  invite_required: "This group is private. Ask the admin for an invite link.",
  request_declined: "The admin didn’t accept your request for this group.",
  request_cancel_limit:
    "You’ve cancelled two requests for this group, so you can’t ask again.",
  request_limit:
    "You have 10 group requests waiting. Cancel one or wait for an answer.",
  request_not_pending:
    "That request has already been answered or cancelled. Refresh to see the latest.",
  not_a_member: "That person isn’t a member of this group. Refresh the list.",
  admin_cannot_leave: "The admin can’t leave the group.",
  idempotency_conflict:
    "This request key was already used for different details.",
};

async function call(
  c: Context<ApiEnv>,
  name: string,
  args: Record<string, unknown> = {},
  wrap?: string,
) {
  const { data, error } = await c.var.db.rpc(name, {
    p_actor_id: c.var.user.id,
    p_group_id: c.req.param("id"),
    ...args,
  });
  if (!error) return json(wrap ? { [wrap]: data } : data);
  if (error.code === "42501")
    throw new ApiError(
      403,
      "group_access_denied",
      "Only the group’s admin can do that.",
    );
  if (error.message === "group_not_found")
    throw new ApiError(404, "not_found", "That group isn’t available.");
  if (conflicts[error.message])
    throw new ApiError(409, error.message, conflicts[error.message]);
  if (error.code === "23514")
    throw new ApiError(
      422,
      "invalid_input",
      "Check your choice and try again.",
    );
  throw new ApiError(
    503,
    "service_unavailable",
    "The action could not be confirmed. Check the result or retry the same request.",
  );
}

const key = z.string().regex(uuid);
const ask = z.object({ operationKey: key, invite: key.optional() });
const own = z.object({ operationKey: key, requestId: key });
const answer = own.extend({ action: z.enum(["accept", "decline"]) });
const remove = z.object({ operationKey: key, profileId: key });
const plain = z.object({ operationKey: key });
const visibility = z.object({
  operationKey: key,
  visibility: z.enum(["public", "private"]),
});
const body = async <T>(c: Context<ApiEnv>, schema: z.ZodType<T>) =>
  parse(
    schema,
    await readBody(c.req.raw),
    "invalid_input",
    "Refresh and try again.",
  );

const base = `/groups/:id{${uuidParam}}`;
const action = "Use the action button.";
export const groups = new Hono<ApiEnv>()
  .get(base, requireUser, async (c) => {
    const invite = c.req.query("invite");
    if (invite !== undefined && !uuid.test(invite))
      return call(c, "read_group", { p_invite: null }, "group");
    return call(c, "read_group", { p_invite: invite ?? null }, "group");
  })
  .post(`${base}/requests`, requireUser, async (c) => {
    const b = await body(c, ask);
    // The admin sees who is asking, so their profile exists before they ask.
    await actorName(c, "Participant");
    return call(c, "ask_to_join_group", {
      p_key: b.operationKey,
      p_invite: b.invite ?? null,
    });
  })
  .all(`${base}/requests`, requireUser, () => notAvailable(action))
  .post(`${base}/requests/cancel`, requireUser, async (c) => {
    const b = await body(c, own);
    return call(c, "cancel_group_request", {
      p_key: b.operationKey,
      p_request_id: b.requestId,
    });
  })
  .all(`${base}/requests/cancel`, requireUser, () => notAvailable(action))
  .post(`${base}/requests/answer`, requireUser, async (c) => {
    const b = await body(c, answer);
    return call(c, "answer_group_request", {
      p_key: b.operationKey,
      p_request_id: b.requestId,
      p_action: b.action,
    });
  })
  .all(`${base}/requests/answer`, requireUser, () => notAvailable(action))
  .post(`${base}/members/remove`, requireUser, async (c) => {
    const b = await body(c, remove);
    return call(c, "remove_group_member", {
      p_key: b.operationKey,
      p_profile_id: b.profileId,
    });
  })
  .all(`${base}/members/remove`, requireUser, () => notAvailable(action))
  .post(`${base}/leave`, requireUser, async (c) => {
    const b = await body(c, plain);
    return call(c, "leave_group", { p_key: b.operationKey });
  })
  .all(`${base}/leave`, requireUser, () => notAvailable(action))
  .post(`${base}/visibility`, requireUser, async (c) => {
    const b = await body(c, visibility);
    return call(c, "set_group_visibility", {
      p_key: b.operationKey,
      p_visibility: b.visibility,
    });
  })
  .all(`${base}/visibility`, requireUser, () => notAvailable(action));
