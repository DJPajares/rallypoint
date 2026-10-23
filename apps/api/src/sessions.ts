import { Hono } from "hono";
import { z } from "zod";
import { InputError, normalizeSession } from "@rallypoint/domain/session";
import { ApiError, json, parse, readBody, uuid, uuidParam } from "./http";
import type { ApiEnv } from "./identity";
import {
  client,
  connection,
  displayName,
  notAvailable,
  requireUser,
} from "./identity";

async function rpc(
  db: ReturnType<typeof client>,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    if (error.code === "42501")
      throw new ApiError(
        403,
        "group_access_denied",
        "You do not have organizer access to this group.",
      );
    const conflicts: Record<string, string> = {
      stale_version:
        "This session changed. Reload it before saving your edits.",
      idempotency_conflict:
        "This request key was already used for different details.",
      booked_event_locked:
        "People have booked this session. Changes are locked until the booked-event edit policy is defined.",
      already_published:
        "This session is already published. Reload it to edit.",
      session_closed:
        "This session is cancelled or completed and cannot be edited.",
    };
    if (conflicts[error.message])
      throw new ApiError(409, error.message, conflicts[error.message]);
    if (["23514", "22P02", "22007", "22008"].includes(error.code))
      throw new ApiError(
        422,
        "invalid_input",
        "Check the session details. Nothing was published.",
      );
    throw new ApiError(
      503,
      "service_unavailable",
      "The action could not be confirmed. Keep your details and retry the same request.",
    );
  }
  return data;
}

const key = z.object({ operationKey: z.string().regex(uuid) });
const groupName = z.object({
  name: z.string().trim().min(1).max(100),
});
const intent = z.object({ intent: z.enum(["draft", "publish", "update"]) });
const version = z.object({ version: z.number().int().min(1) });
const groupId = z.object({ groupId: z.string().regex(uuid) });

/** Shared checks for saving a session; the order decides which message wins. */
async function sessionSave(request: Request, editing: boolean) {
  const b = await readBody(request);
  const { operationKey } = parse(
    key,
    b,
    "invalid_input",
    "A valid request key is required.",
  );
  const { intent: chosen } = parse(
    intent,
    b,
    "invalid_input",
    "Choose save draft, publish or update.",
  );
  let details;
  try {
    details = normalizeSession(b.details, chosen !== "draft");
  } catch (e) {
    if (e instanceof InputError)
      throw new ApiError(422, "invalid_input", e.message);
    throw e;
  }
  const saved = editing
    ? parse(
        version,
        b,
        "invalid_input",
        "Reload the session version before saving.",
      ).version
    : null;
  const group = parse(groupId, b, "invalid_input", "Select a group.").groupId;
  return { operationKey, intent: chosen, details, version: saved, group };
}

const id = `:id{${uuidParam}}`;
export const sessions = new Hono<ApiEnv>()
  // Public projection of a published session; no identity involved.
  .get(`/shared/${id}`, async (c) => {
    const conn = connection(c.env);
    const session = await rpc(
      client(conn.url, conn.secret, c.env.SUPABASE_API_SCHEMA ?? "api"),
      "read_shared_session",
      {
        p_slug: c.req.param("id"),
      },
    );
    if (!session)
      throw new ApiError(404, "not_found", "That session is not available.");
    return json({ session });
  })
  .all(`/shared/${id}`, (c) => {
    connection(c.env);
    return notAvailable();
  })
  .post("/groups", requireUser, async (c) => {
    const b = await readBody(c.req.raw);
    const { operationKey } = parse(
      key,
      b,
      "invalid_input",
      "A valid request key is required.",
    );
    const { name } = parse(
      groupName,
      b,
      "invalid_input",
      "Use a group name of 1 to 100 characters.",
    );
    return json(
      await rpc(c.var.db, "create_group", {
        p_actor_id: c.var.user.id,
        p_key: operationKey,
        p_name: name,
      }),
    );
  })
  .all("/groups", requireUser, () => notAvailable())
  .get(`/groups/${id}/sessions`, requireUser, async (c) =>
    json({
      sessions: await rpc(c.var.db, "list_group_sessions", {
        p_actor_id: c.var.user.id,
        p_group_id: c.req.param("id"),
      }),
    }),
  )
  .post(`/groups/${id}/sessions`, requireUser, async (c) => {
    const s = await sessionSave(c.req.raw, false);
    if (s.group !== c.req.param("id"))
      throw new ApiError(
        422,
        "invalid_input",
        "The group does not match this request.",
      );
    return json(
      await rpc(c.var.db, "save_session", {
        p_actor_id: c.var.user.id,
        p_key: s.operationKey,
        p_group_id: s.group,
        p_session_id: null,
        p_intent: s.intent,
        p_version: null,
        p_details: s.details,
      }),
    );
  })
  .all(`/groups/${id}/sessions`, requireUser, () => notAvailable())
  .post(`/sessions/${id}/cancel`, requireUser, async (c) => {
    const { operationKey } = parse(
      key,
      await readBody(c.req.raw),
      "invalid_input",
      "A valid request key is required.",
    );
    return json(
      await rpc(c.var.db, "cancel_session", {
        p_actor_id: c.var.user.id,
        p_actor_name: displayName(c.var.user, "Organizer"),
        p_key: operationKey,
        p_session_id: c.req.param("id"),
      }),
    );
  })
  .all(`/sessions/${id}/cancel`, requireUser, () => notAvailable())
  .get(`/sessions/${id}`, requireUser, async (c) =>
    json({
      session: await rpc(c.var.db, "read_managed_session", {
        p_actor_id: c.var.user.id,
        p_session_id: c.req.param("id"),
      }),
    }),
  )
  .post(`/sessions/${id}`, requireUser, async (c) => {
    const s = await sessionSave(c.req.raw, true);
    return json(
      await rpc(c.var.db, "save_session", {
        p_actor_id: c.var.user.id,
        p_key: s.operationKey,
        p_group_id: s.group,
        p_session_id: c.req.param("id"),
        p_intent: s.intent,
        p_version: s.version,
        p_details: s.details,
      }),
    );
  })
  .all(`/sessions/${id}`, requireUser, () => notAvailable())
  // Recovery for an interrupted write: what did this request key commit?
  .get(`/operations/${id}`, requireUser, async (c) => {
    const result = await rpc(c.var.db, "read_operation", {
      p_actor_id: c.var.user.id,
      p_key: c.req.param("id"),
    });
    if (!result)
      throw new ApiError(
        404,
        "operation_unresolved",
        "No committed result was found for this request. Retry the original request with the same key.",
      );
    return json(result);
  })
  .all(`/operations/${id}`, requireUser, () => notAvailable());
