import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { ApiError, json, parse, readBody, uuid, uuidParam } from "./http";
import type { ApiEnv } from "./identity";
import { displayName, notAvailable, requireUser } from "./identity";

type Action = "read" | "join" | "withdraw" | "payment" | "attendance";
const conflicts: Record<string, string> = {
  split_undo_requires_review: "Review a new split before restoring this share.",
  split_not_finalized:
    "This is still an estimate. Finalize the split before recording payment.",
  stale_payment:
    "This fee changed since you loaded it. Refresh to see the latest record, then try again.",
  payment_transition_invalid:
    "That change doesn’t apply to this fee any more. Refresh to see the latest record.",
  fee_not_found: "There is no fee for that registration in this session.",
  stale_attendance:
    "This attendance changed since you loaded it. Refresh to see the latest record, then try again.",
  attendance_unchanged:
    "Attendance is already recorded that way. Refresh to see the latest record.",
  attendance_not_eligible:
    "Only confirmed places in a session that isn’t cancelled can be checked in.",
  no_show_too_early: "A no-show can be recorded once the session has ended.",
  seat_not_found: "That place isn’t part of this session.",
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
const invalid = {
  payment: ["invalid_payment", "Choose a fee and a payment action."],
  attendance: ["invalid_attendance", "Choose a seat and an attendance state."],
} as const;

async function call(
  c: Context<ApiEnv>,
  action: Action,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await c.var.db.rpc(name, {
    p_actor_id: c.var.user.id,
    p_slug: c.req.param("slug"),
    ...args,
  });
  if (error) {
    const managing =
      action === "payment" || action === "attendance" ? action : null;
    if (error.code === "42501" && managing)
      throw new ApiError(
        403,
        "group_access_denied",
        `Only this session’s organizers can update ${action === "payment" ? "payments" : "attendance"}.`,
      );
    if (error.code === "42501")
      throw new ApiError(
        403,
        "session_unavailable",
        "That session is not available for registration.",
      );
    if (conflicts[error.message])
      throw new ApiError(409, error.message, conflicts[error.message]);
    if (error.code === "23514" && managing) {
      const [code, message] = invalid[managing];
      throw new ApiError(422, code, message);
    }
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
  return json(action === "read" ? { registration: data } : data);
}

const key = z.string().regex(uuid);
const join = z.object({
  operationKey: key,
  version: z.number().int().min(1),
  seats: z.union([z.literal(1), z.literal(2)]),
  consent: z.literal(true),
  guestName: z.string().max(80),
});
const withdraw = z.object({ operationKey: key, partyId: key });
const payment = z.object({
  operationKey: key,
  partyId: key,
  action: z.enum(["mark_paid", "mark_unpaid", "waive", "undo_waiver"]),
  revision: z.number().int().min(1),
});
const attendance = z.object({
  operationKey: key,
  partyId: key,
  seat: z.union([z.literal(1), z.literal(2)]),
  state: z.enum(["unrecorded", "checked_in", "no_show"]),
  revision: z.number().int().min(0),
});

const base = `/registrations/:slug{${uuidParam}}`;
const action = "Use the action button.";
export const registrations = new Hono<ApiEnv>()
  .get(base, requireUser, (c) => call(c, "read", "read_registration"))
  .post(base, requireUser, async (c) => {
    const b = parse(
      join,
      await readBody(c.req.raw),
      "invalid_registration",
      "Choose one or two seats and explicitly accept the current joining and waitlist terms.",
    );
    return call(c, "join", "join_session", {
      p_key: b.operationKey,
      p_version: b.version,
      p_seats: b.seats,
      p_guest_name: b.guestName.trim(),
      p_primary_name: displayName(c.var.user, "Participant"),
      p_consent: true,
    });
  })
  .all(base, requireUser, () => notAvailable())
  .post(`${base}/withdraw`, requireUser, async (c) => {
    const b = parse(
      withdraw,
      await readBody(c.req.raw),
      "invalid_withdrawal",
      "Choose your whole registration to withdraw.",
    );
    return call(c, "withdraw", "withdraw_party", {
      p_key: b.operationKey,
      p_party_id: b.partyId,
    });
  })
  .all(`${base}/withdraw`, requireUser, () => notAvailable(action))
  .post(`${base}/payments`, requireUser, async (c) => {
    const b = parse(payment, await readBody(c.req.raw), ...invalid.payment);
    return call(c, "payment", "update_payment", {
      p_actor_name: displayName(c.var.user, "Participant"),
      p_key: b.operationKey,
      p_party_id: b.partyId,
      p_action: b.action,
      p_revision: b.revision,
    });
  })
  .all(`${base}/payments`, requireUser, () => notAvailable(action))
  .post(`${base}/attendance`, requireUser, async (c) => {
    const b = parse(
      attendance,
      await readBody(c.req.raw),
      ...invalid.attendance,
    );
    return call(c, "attendance", "record_attendance", {
      p_actor_name: displayName(c.var.user, "Participant"),
      p_key: b.operationKey,
      p_party_id: b.partyId,
      p_seat: b.seat,
      p_state: b.state,
      p_revision: b.revision,
    });
  })
  .all(`${base}/attendance`, requireUser, () => notAvailable(action));
