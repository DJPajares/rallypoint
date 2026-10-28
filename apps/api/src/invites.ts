import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { ApiError, json, parse, readBody, uuid, uuidParam } from "./http";
import type { ApiEnv } from "./identity";
import { actorName, notAvailable, requireUser } from "./identity";

// P-38: invite people you know to a group or session; they join or decline.
const conflicts: Record<string, string> = {
  invite_exists: "You’ve already invited this person.",
  invite_declined: "They declined an invite to this before.",
  invite_limit:
    "You have 20 invites waiting. Withdraw one or wait for answers.",
  already_in: "They’re already in.",
  not_known:
    "You can invite people who joined your sessions or share a group with you.",
  invite_not_pending:
    "That invite has already been answered or withdrawn. Refresh to see the latest.",
  registration_closed: "This session has started, so invites have closed.",
  idempotency_conflict:
    "This request key was already used for different details.",
};

async function call(
  c: Context<ApiEnv>,
  name: string,
  args: Record<string, unknown>,
  wrap?: string,
) {
  const { data, error } = await c.var.db.rpc(name, {
    p_actor_id: c.var.user.id,
    ...args,
  });
  if (!error) return json(wrap ? { [wrap]: data } : data);
  if (error.code === "42501")
    throw new ApiError(
      403,
      "invite_access_denied",
      "Only the group’s admin or the session’s organizers can do that.",
    );
  if (error.message === "group_not_found")
    throw new ApiError(404, "not_found", "That group isn’t available.");
  if (conflicts[error.message])
    throw new ApiError(409, error.message, conflicts[error.message]);
  if (error.code === "23514")
    throw new ApiError(422, "invalid_input", "Refresh and try again.");
  throw new ApiError(
    503,
    "service_unavailable",
    "The action could not be confirmed. Check the result or retry the same request.",
  );
}

const key = z.string().regex(uuid);
const kind = z.enum(["group", "session"]);
const send = z.object({
  operationKey: key,
  kind,
  target: key,
  profileId: key,
});
const plain = z.object({ operationKey: key });
const body = async <T>(c: Context<ApiEnv>, schema: z.ZodType<T>) =>
  parse(
    schema,
    await readBody(c.req.raw),
    "invalid_input",
    "Refresh and try again.",
  );

const one = `/invites/:invite{${uuidParam}}`;
const action = "Use the action button.";
const answer = (name: string) => async (c: Context<ApiEnv>) => {
  const b = await body(c, plain);
  return call(c, name, {
    p_key: b.operationKey,
    p_invite_id: c.req.param("invite"),
  });
};
export const invites = new Hono<ApiEnv>()
  .get("/invites/candidates", requireUser, async (c) => {
    const query = parse(
      z.object({
        kind,
        target: key,
        q: z.string().max(40).optional(),
        after: key.optional(),
      }),
      c.req.query(),
      "invalid_input",
      "Choose what to invite people to.",
    );
    return call(c, "invite_candidates", {
      p_kind: query.kind,
      p_target: query.target,
      p_query: query.q ?? null,
      p_after: query.after ?? null,
    });
  })
  .all("/invites/candidates", requireUser, () => notAvailable())
  .post("/invites", requireUser, async (c) => {
    const b = await body(c, send);
    return call(c, "send_invite", {
      p_actor_name: (await actorName(c, "Organizer")).name,
      p_key: b.operationKey,
      p_kind: b.kind,
      p_target: b.target,
      p_profile_id: b.profileId,
    });
  })
  .all("/invites", requireUser, () => notAvailable(action))
  .post(`${one}/withdraw`, requireUser, answer("withdraw_invite"))
  .all(`${one}/withdraw`, requireUser, () => notAvailable(action))
  .post(`${one}/decline`, requireUser, answer("decline_invite"))
  .all(`${one}/decline`, requireUser, () => notAvailable(action))
  .post(`${one}/accept`, requireUser, answer("accept_group_invite"))
  .all(`${one}/accept`, requireUser, () => notAvailable(action))
  .get("/me/invites", requireUser, (c) =>
    call(c, "list_my_invites", {}, "invites"),
  );
