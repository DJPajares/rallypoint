import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ApiError, json } from "./http";
import { readBody } from "./sessions";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const registrationRoute = (path: string) =>
  /^\/api\/registrations\//.test(path) &&
  uuid.test(path.split("/")[3] ?? "") &&
  (path.split("/").length === 4 ||
    (path.split("/").length === 5 && path.endsWith("/withdraw")));
export async function registrationRequest(
  request: Request,
  client: SupabaseClient,
  user: User,
) {
  const path = new URL(request.url).pathname;
  const slug = path.split("/")[3];
  const withdraw = path.endsWith("/withdraw");
  const db = client.schema("api");
  let name = "read_registration",
    args: Record<string, unknown> = { p_actor_id: user.id, p_slug: slug };
  if (withdraw && request.method !== "POST")
    throw new ApiError(405, "method_not_allowed", "Use the withdrawal action.");
  if (request.method === "POST" && withdraw) {
    const b = await readBody(request);
    if (
      typeof b.operationKey !== "string" ||
      !uuid.test(b.operationKey) ||
      typeof b.partyId !== "string" ||
      !uuid.test(b.partyId)
    )
      throw new ApiError(
        422,
        "invalid_withdrawal",
        "Choose your whole registration to withdraw.",
      );
    name = "withdraw_party";
    args = { ...args, p_key: b.operationKey, p_party_id: b.partyId };
  } else if (request.method === "POST") {
    const b = await readBody(request);
    if (
      typeof b.operationKey !== "string" ||
      !uuid.test(b.operationKey) ||
      !Number.isInteger(b.version) ||
      Number(b.version) < 1 ||
      ![1, 2].includes(Number(b.seats)) ||
      typeof b.seats !== "number" ||
      b.consent !== true ||
      typeof b.guestName !== "string" ||
      b.guestName.length > 80
    )
      throw new ApiError(
        422,
        "invalid_registration",
        "Choose one or two seats and explicitly accept the current joining and waitlist terms.",
      );
    name = "join_session";
    args = {
      ...args,
      p_key: b.operationKey,
      p_version: b.version,
      p_seats: b.seats,
      p_guest_name: b.guestName.trim(),
      p_primary_name:
        String(
          user.user_metadata.full_name ??
            user.email?.split("@")[0] ??
            "Participant",
        )
          .trim()
          .slice(0, 80) || "Participant",
      p_consent: true,
    };
  } else if (request.method !== "GET")
    throw new ApiError(
      405,
      "method_not_allowed",
      "This action is not available.",
    );
  const { data, error } = await db.rpc(name, args);
  if (error) {
    if (error.code === "42501")
      throw new ApiError(
        403,
        "session_unavailable",
        "That session is not available for registration.",
      );
    const conflicts: Record<string, string> = {
      registration_closed:
        "Registration is closed. New joins and waitlist entries stop at the session start.",
      registration_not_open: "Registration has not opened yet.",
      withdrawal_closed:
        "Self-service withdrawal is closed at the session start or when the session ends or is cancelled. Refresh your record.",
      stale_terms:
        "The session details changed. Refresh and review the current terms before joining.",
      idempotency_conflict:
        "This request key was already used for different details.",
    };
    if (conflicts[error.message])
      throw new ApiError(409, error.message, conflicts[error.message]);
    if (error.code === "23514")
      throw new ApiError(
        422,
        error.message,
        error.message === "guest_disabled"
          ? "This session does not allow guests."
          : error.message === "party_too_large"
            ? "The party is larger than this session’s total capacity."
            : error.message === "fee_out_of_range"
              ? "The party fee is too large to store precisely."
              : "Check the party and joining consent.",
      );
    throw new ApiError(
      503,
      "service_unavailable",
      "The action could not be confirmed. Check the result or retry the same request.",
    );
  }
  return json(request.method === "GET" ? { registration: data } : data);
}
