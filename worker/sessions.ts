import type { SupabaseClient } from "@supabase/supabase-js";
import { InputError, normalizeSession } from "../src/shared/session";
import { ApiError, json } from "./http";
const uuid = "[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}";
const patterns = [
  new RegExp(`^/api/groups/${uuid}/sessions$`, "i"),
  new RegExp(`^/api/sessions/${uuid}$`, "i"),
  new RegExp(`^/api/shared/${uuid}$`, "i"),
  new RegExp(`^/api/operations/${uuid}$`, "i"),
];
export const sessionRoute = (path: string) =>
  path === "/api/groups" || patterns.some((p) => p.test(path));
async function body(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new ApiError(415, "json_required", "Send JSON details.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_input", "Enter the details.");
  let text = "",
    size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new ApiError(413, "too_large", "The details are too long.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const result = JSON.parse(text);
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw Error();
    return result as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_input", "Check the submitted details.");
  }
}
export async function sessionRequest(
  request: Request,
  client: SupabaseClient,
  actor: string | null,
) {
  const path = new URL(request.url).pathname,
    id = path.split("/")[3],
    db = client.schema("api");
  async function rpc(name: string, args: Record<string, unknown>) {
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
  if (path.startsWith("/api/shared/") && request.method === "GET") {
    const session = await rpc("read_shared_session", { p_slug: id });
    if (!session)
      throw new ApiError(404, "not_found", "That session is not available.");
    return json({ session });
  }
  if (!actor)
    throw new ApiError(
      405,
      "method_not_allowed",
      "This action is not available.",
    );
  if (request.method === "GET") {
    if (path.endsWith("/sessions"))
      return json({
        sessions: await rpc("list_group_sessions", {
          p_actor_id: actor,
          p_group_id: id,
        }),
      });
    if (path.startsWith("/api/sessions/"))
      return json({
        session: await rpc("read_managed_session", {
          p_actor_id: actor,
          p_session_id: id,
        }),
      });
    if (path.startsWith("/api/operations/")) {
      const result = await rpc("read_operation", {
        p_actor_id: actor,
        p_key: id,
      });
      if (!result)
        throw new ApiError(
          404,
          "operation_unresolved",
          "No committed result was found for this request. Retry the original request with the same key.",
        );
      return json(result);
    }
  }
  if (
    request.method !== "POST" ||
    !(
      path === "/api/groups" ||
      path.endsWith("/sessions") ||
      path.startsWith("/api/sessions/")
    )
  )
    throw new ApiError(
      405,
      "method_not_allowed",
      "This action is not available.",
    );
  const b = await body(request),
    key = b.operationKey;
  if (typeof key !== "string" || !new RegExp(`^${uuid}$`, "i").test(key))
    throw new ApiError(
      422,
      "invalid_input",
      "A valid request key is required.",
    );
  if (path === "/api/groups") {
    if (
      typeof b.name !== "string" ||
      !b.name.trim() ||
      b.name.trim().length > 100
    )
      throw new ApiError(
        422,
        "invalid_input",
        "Use a group name of 1 to 100 characters.",
      );
    return json(
      await rpc("create_group", {
        p_actor_id: actor,
        p_key: key,
        p_name: b.name.trim(),
      }),
    );
  }
  if (!["draft", "publish", "update"].includes(String(b.intent)))
    throw new ApiError(
      422,
      "invalid_input",
      "Choose save draft, publish or update.",
    );
  let details;
  try {
    details = normalizeSession(b.details, b.intent !== "draft");
  } catch (e) {
    if (e instanceof InputError)
      throw new ApiError(422, "invalid_input", e.message);
    throw e;
  }
  const editing = path.startsWith("/api/sessions/");
  if (editing && (!Number.isInteger(b.version) || Number(b.version) < 1))
    throw new ApiError(
      422,
      "invalid_input",
      "Reload the session version before saving.",
    );
  if (
    typeof b.groupId !== "string" ||
    !new RegExp(`^${uuid}$`, "i").test(b.groupId)
  )
    throw new ApiError(422, "invalid_input", "Select a group.");
  if (!editing && b.groupId !== id)
    throw new ApiError(
      422,
      "invalid_input",
      "The group does not match this request.",
    );
  return json(
    await rpc("save_session", {
      p_actor_id: actor,
      p_key: key,
      p_group_id: b.groupId,
      p_session_id: editing ? id : null,
      p_intent: b.intent,
      p_version: editing ? b.version : null,
      p_details: details,
    }),
  );
}
