import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { ApiError, json, parse, readBody, uuid, uuidParam } from "./http";
import type { ApiEnv } from "./identity";
import { actorName, notAvailable, requireUser } from "./identity";

type Action =
  | "read"
  | "join"
  | "withdraw"
  | "payment"
  | "attendance"
  | "release"
  | "remove"
  | "note"
  | "ask"
  | "request"
  | "answer";
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
  release_not_enabled:
    "This session doesn’t give unpaid spots to the waitlist.",
  release_too_early:
    "Unpaid spots can go to the waitlist once the cutoff passes.",
  release_closed: "Spots can’t be given away once the session starts.",
  release_not_eligible:
    "Only spots booked before the cutoff and still unpaid can go to the waitlist. Refresh to see the latest record.",
  removal_closed: "People can’t be removed once the session starts.",
  removal_not_eligible:
    "They’ve already left this session. Refresh to see the latest.",
  party_not_found: "That person isn’t in this session. Refresh the list.",
  removal_not_allowed:
    "Organizers and co-hosts can’t be removed. They can withdraw themselves.",
  removed_from_session:
    "The organizer removed you from this session, so you can’t join it again.",
  note_not_allowed:
    "You can only say you’ve paid for your own booking in a session paid to the organizer.",
  note_already_paid: "The organizer has already marked this paid.",
  note_changed:
    "The player’s payment note changed since you opened this. Review it, then try again.",
  withdrawal_closed:
    "Self-service withdrawal is closed at the session start or when the session ends or is cancelled. Refresh your record.",
  stale_terms:
    "The session details changed. Refresh and review the current terms before joining.",
  idempotency_conflict:
    "This request key was already used for different details.",
  request_required:
    "The organizer accepts each person for this session. Ask to join instead.",
  request_not_needed:
    "You can join this session directly. Refresh to see the current options.",
  request_declined:
    "The organizer didn’t accept your request for this session.",
  request_cancel_limit:
    "You’ve cancelled two requests for this session, so you can’t ask again.",
  request_limit:
    "You have 10 requests waiting. Cancel one or wait for an answer.",
  request_not_pending:
    "That request has already been answered or cancelled. Refresh to see the latest.",
  request_list_changed:
    "New requests arrived since you looked. Review them, then try again.",
  request_needs_confirm:
    "The details changed since they asked. They need to confirm the new details first.",
};
const invalid = {
  payment: ["invalid_payment", "Choose a fee and a payment action."],
  attendance: ["invalid_attendance", "Choose a seat and an attendance state."],
  release: ["invalid_release", "Choose a spot to give to the waitlist."],
  remove: ["invalid_removal", "Choose someone to remove."],
  note: [
    "invalid_payment_note",
    "Use a payment reference of up to 60 characters.",
  ],
} as const;
const managingWords = {
  payment: "update payments",
  attendance: "update attendance",
  release: "release spots",
  remove: "remove people",
  answer: "answer requests",
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
      action === "payment" ||
      action === "attendance" ||
      action === "release" ||
      action === "remove" ||
      action === "answer"
        ? action
        : null;
    if (error.code === "42501" && managing)
      throw new ApiError(
        403,
        "group_access_denied",
        `Only this session’s organizers can ${managingWords[managing]}.`,
      );
    if (error.code === "42501" && error.message === "session_private")
      throw new ApiError(403, "session_private", "This session is private.");
    if (error.code === "42501")
      throw new ApiError(
        403,
        "session_unavailable",
        "That session is not available for registration.",
      );
    if (conflicts[error.message])
      throw new ApiError(409, error.message, conflicts[error.message]);
    if (error.code === "23514" && managing && managing !== "answer") {
      const [code, message] = invalid[managing];
      throw new ApiError(422, code, message);
    }
    if (error.code === "23514" && action === "note") {
      const [code, message] = invalid.note;
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
const ownRequest = z.object({ operationKey: key, requestId: key });
const keepRequest = ownRequest.extend({ version: z.number().int().min(1) });
const answerRequest = z.object({ operationKey: key, requestId: key });
const answerRest = z.object({
  operationKey: key,
  expected: z.number().int().min(0),
});
const payment = z.object({
  operationKey: key,
  partyId: key,
  action: z.enum(["mark_paid", "mark_unpaid", "waive", "undo_waiver"]),
  revision: z.number().int().min(1),
});
const release = z.object({
  operationKey: key,
  partyId: key,
  revision: z.number().int().min(1),
  // The note's send time as the organizer last saw it, or null when they saw none.
  noteSentAt: z.union([z.iso.datetime({ offset: true }), z.null()]),
});
const removal = z.object({ operationKey: key, partyId: key });
const paymentNote = z.object({
  operationKey: key,
  partyId: key,
  action: z.enum(["mark", "undo"]),
  reference: z
    .string()
    .trim()
    .max(60)
    .transform((reference) => reference || null),
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
      p_primary_name: (await actorName(c, "Participant")).name,
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
  .post(`${base}/requests`, requireUser, async (c) => {
    const b = parse(
      join,
      await readBody(c.req.raw),
      "invalid_registration",
      "Choose one or two seats and explicitly accept the current joining and waitlist terms.",
    );
    return call(c, "ask", "ask_to_join", {
      p_key: b.operationKey,
      p_version: b.version,
      p_seats: b.seats,
      p_guest_name: b.guestName.trim(),
      p_primary_name: (await actorName(c, "Participant")).name,
      p_consent: true,
    });
  })
  .all(`${base}/requests`, requireUser, () => notAvailable(action))
  .post(`${base}/requests/cancel`, requireUser, async (c) => {
    const b = parse(
      ownRequest,
      await readBody(c.req.raw),
      "invalid_request",
      "Choose your request to cancel.",
    );
    return call(c, "request", "cancel_join_request", {
      p_key: b.operationKey,
      p_request_id: b.requestId,
    });
  })
  .all(`${base}/requests/cancel`, requireUser, () => notAvailable(action))
  .post(`${base}/requests/keep`, requireUser, async (c) => {
    const b = parse(
      keepRequest,
      await readBody(c.req.raw),
      "invalid_request",
      "Review the current details, then keep your request.",
    );
    return call(c, "request", "keep_join_request", {
      p_key: b.operationKey,
      p_request_id: b.requestId,
      p_version: b.version,
    });
  })
  .all(`${base}/requests/keep`, requireUser, () => notAvailable(action))
  .post(`${base}/requests/accept`, requireUser, async (c) => {
    const b = parse(
      answerRequest,
      await readBody(c.req.raw),
      "invalid_request",
      "Choose a request to accept.",
    );
    return call(c, "answer", "accept_join_request", {
      p_actor_name: (await actorName(c, "Participant")).name,
      p_key: b.operationKey,
      p_request_id: b.requestId,
    });
  })
  .all(`${base}/requests/accept`, requireUser, () => notAvailable(action))
  .post(`${base}/requests/decline`, requireUser, async (c) => {
    const b = parse(
      answerRequest,
      await readBody(c.req.raw),
      "invalid_request",
      "Choose a request to decline.",
    );
    return call(c, "answer", "decline_join_request", {
      p_actor_name: (await actorName(c, "Participant")).name,
      p_key: b.operationKey,
      p_request_id: b.requestId,
    });
  })
  .all(`${base}/requests/decline`, requireUser, () => notAvailable(action))
  .post(`${base}/requests/decline-rest`, requireUser, async (c) => {
    const b = parse(
      answerRest,
      await readBody(c.req.raw),
      "invalid_request",
      "Decline the requests still waiting.",
    );
    return call(c, "answer", "decline_pending_requests", {
      p_actor_name: (await actorName(c, "Participant")).name,
      p_key: b.operationKey,
      p_expected: b.expected,
    });
  })
  .all(`${base}/requests/decline-rest`, requireUser, () => notAvailable(action))
  .post(`${base}/payments`, requireUser, async (c) => {
    const b = parse(payment, await readBody(c.req.raw), ...invalid.payment);
    return call(c, "payment", "update_payment", {
      p_actor_name: (await actorName(c, "Participant")).name,
      p_key: b.operationKey,
      p_party_id: b.partyId,
      p_action: b.action,
      p_revision: b.revision,
    });
  })
  .all(`${base}/payments`, requireUser, () => notAvailable(action))
  .post(`${base}/release`, requireUser, async (c) => {
    const b = parse(release, await readBody(c.req.raw), ...invalid.release);
    return call(c, "release", "release_unpaid_party", {
      p_actor_name: (await actorName(c, "Participant")).name,
      p_key: b.operationKey,
      p_party_id: b.partyId,
      p_revision: b.revision,
      p_note_sent_at: b.noteSentAt,
    });
  })
  .all(`${base}/release`, requireUser, () => notAvailable(action))
  .post(`${base}/remove`, requireUser, async (c) => {
    const b = parse(removal, await readBody(c.req.raw), ...invalid.remove);
    return call(c, "remove", "remove_party", {
      p_actor_name: (await actorName(c, "Participant")).name,
      p_key: b.operationKey,
      p_party_id: b.partyId,
    });
  })
  .all(`${base}/remove`, requireUser, () => notAvailable(action))
  .post(`${base}/payment-note`, requireUser, async (c) => {
    const b = parse(paymentNote, await readBody(c.req.raw), ...invalid.note);
    return call(c, "note", "update_payment_note", {
      p_key: b.operationKey,
      p_party_id: b.partyId,
      p_action: b.action,
      p_reference: b.reference,
    });
  })
  .all(`${base}/payment-note`, requireUser, () => notAvailable(action))
  .post(`${base}/attendance`, requireUser, async (c) => {
    const b = parse(
      attendance,
      await readBody(c.req.raw),
      ...invalid.attendance,
    );
    return call(c, "attendance", "record_attendance", {
      p_actor_name: (await actorName(c, "Participant")).name,
      p_key: b.operationKey,
      p_party_id: b.partyId,
      p_seat: b.seat,
      p_state: b.state,
      p_revision: b.revision,
    });
  })
  .all(`${base}/attendance`, requireUser, () => notAvailable(action));
