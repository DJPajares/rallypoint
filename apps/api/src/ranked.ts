import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { rankedSessionForm } from "@rallypoint/domain/ranked-booking";
import { normalizeSearch } from "@rallypoint/domain/ranked-search";
import type { MySearch } from "@rallypoint/domain/ranked-search";
import { InputError, normalizeSession } from "@rallypoint/domain/session";
import { ApiError, json, parse, readBody, uuid, uuidParam } from "./http";
import type { ApiEnv } from "./identity";
import { actorName, notAvailable, requireUser } from "./identity";

// Ranked searches (D-26, WDL-421).
const conflicts: Record<string, string> = {
  search_active:
    "You’re already in a ranked search. Cancel it before starting or joining another.",
  not_known:
    "Pick someone you’ve played with, or invite your partner with a link.",
  own_invite: "This is your own invite. Share the link with your partner.",
  invite_closed:
    "This invite has already been answered, cancelled or has run out.",
  search_matched: "You’ve been matched. Accept or decline the match instead.",
  proposal_closed: "This match has already been settled or has run out.",
  cannot_widen: "You can widen your search after 3 days without a match.",
  booking_taken: "Another player is already booking the court.",
  booking_closed: "This match can’t be booked right now.",
  not_booker:
    "Only the player booking the court can do that, and only while their 48 hours last.",
  idempotency_conflict:
    "This request key was already used for different details.",
};
const missing: Record<string, string> = {
  search_not_found: "That search isn’t available.",
  invite_not_found: "This invite isn’t available.",
  match_not_found: "That match isn’t available.",
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
  if (missing[error.message])
    throw new ApiError(404, "not_found", missing[error.message]);
  if (
    error.message === "activity_duration_limit" ||
    error.message === "activity_capacity_limit"
  )
    throw new ApiError(
      422,
      error.message,
      "A ranked match can last from 30 minutes to 4 hours.",
    );
  if (error.code === "23514")
    throw new ApiError(422, "invalid_input", "Check your search choices.");
  throw new ApiError(
    503,
    "service_unavailable",
    "The action could not be confirmed. Check the result or retry the same request.",
  );
}

const operationKey = z.string().regex(uuid);
const start = z.object({
  operationKey,
  format: z.string().max(20),
  areas: z.array(z.string().max(40)).max(10),
  courts: z.array(z.string().regex(uuid)).max(10),
  windows: z.array(z.string().max(30)).max(10),
  partner: z
    .union([
      z.object({ profileId: z.string().regex(uuid) }),
      z.object({ link: z.literal(true) }),
    ])
    .nullable()
    .optional(),
});
const plain = z.object({ operationKey });
const answer = z.object({ operationKey, accept: z.boolean() });
const booking = z.object({
  operationKey,
  location: z.string().max(300),
  mapsLink: z.string().max(500),
  startLocal: z.string().max(16),
  endLocal: z.string().max(16),
  cost: z.string().max(22),
  timeZone: z.string().max(100),
});
const body = async <T>(c: Context<ApiEnv>, schema: z.ZodType<T>) =>
  parse(
    schema,
    await readBody(c.req.raw),
    "invalid_input",
    "Check your search choices.",
  );

const one = `/ranked/search/:search{${uuidParam}}`;
const match = `/ranked/matches/:match{${uuidParam}}`;
const invite = `/ranked/invites/:token{${uuidParam}}`;

export const ranked = new Hono<ApiEnv>()
  .get("/ranked/search", requireUser, async (c) =>
    json(await call(c, "read_my_search", {})),
  )
  .post("/ranked/search", requireUser, async (c) => {
    const b = await body(c, start);
    const search = normalizeSearch({
      format: b.format,
      areas: b.areas,
      courts: b.courts,
      windows: b.windows,
      partner: b.partner ?? null,
    });
    if (!search.ok)
      throw new ApiError(422, "invalid_input", search.errors[0].message);
    const partner = search.value.partner;
    return json(
      await call(c, "start_search", {
        p_key: b.operationKey,
        p_format: search.value.format,
        p_areas: search.value.areas,
        p_courts: search.value.courts,
        p_windows: search.value.windows,
        p_partner_profile:
          partner && "profileId" in partner ? partner.profileId : null,
        p_by_link: !!partner && "link" in partner,
      }),
    );
  })
  .all("/ranked/search", requireUser, () => notAvailable())
  .get("/ranked/partners", requireUser, async (c) =>
    json(await call(c, "ranked_partners", {})),
  )
  .all("/ranked/partners", requireUser, () => notAvailable())
  .post(`${one}/cancel`, requireUser, async (c) => {
    const b = await body(c, plain);
    return json(
      await call(c, "cancel_search", {
        p_key: b.operationKey,
        p_search: c.req.param("search"),
      }),
    );
  })
  .post(`${one}/restart`, requireUser, async (c) => {
    const b = await body(c, plain);
    return json(
      await call(c, "restart_search", {
        p_key: b.operationKey,
        p_search: c.req.param("search"),
      }),
    );
  })
  .post(`${one}/widen`, requireUser, async (c) => {
    const b = await body(c, plain);
    return json(
      await call(c, "widen_search", {
        p_key: b.operationKey,
        p_search: c.req.param("search"),
      }),
    );
  })
  .all(`${one}/:action`, requireUser, () => notAvailable())
  .post(`${match}/answer`, requireUser, async (c) => {
    const b = await body(c, answer);
    return json(
      await call(c, "answer_match", {
        p_key: b.operationKey,
        p_match: c.req.param("match"),
        p_accept: b.accept,
      }),
    );
  })
  .post(`${match}/claim`, requireUser, async (c) => {
    const b = await body(c, plain);
    return json(
      await call(c, "claim_booking", {
        p_key: b.operationKey,
        p_match: c.req.param("match"),
      }),
    );
  })
  .post(`${match}/release`, requireUser, async (c) => {
    const b = await body(c, plain);
    return json(
      await call(c, "release_booking", {
        p_key: b.operationKey,
        p_match: c.req.param("match"),
      }),
    );
  })
  // The booker's court, time and cost become an ordinary session, checked by
  // the same rules as the session form (WDL-424).
  .post(`${match}/book`, requireUser, async (c) => {
    const b = await body(c, booking);
    const mine = (await call(c, "read_my_search", {})) as MySearch;
    const found = mine.match;
    if (!found || found.id !== c.req.param("match"))
      throw new ApiError(404, "not_found", missing.match_not_found);
    let details;
    try {
      details = normalizeSession(
        rankedSessionForm(
          {
            format: found.format,
            players: found.players.length,
            location: b.location,
            mapsLink: b.mapsLink,
            startLocal: b.startLocal,
            endLocal: b.endLocal,
            cost: b.cost,
            timeZone: b.timeZone,
          },
          new Date(),
        ),
        true,
      );
    } catch (e) {
      if (e instanceof InputError)
        throw new ApiError(422, "invalid_input", e.message);
      throw e;
    }
    return json(
      await call(c, "book_match", {
        p_key: b.operationKey,
        p_match: c.req.param("match"),
        p_details: details,
        p_host_name: (await actorName(c, "Organizer")).name,
      }),
    );
  })
  .all(`${match}/:action`, requireUser, () => notAvailable())
  .get(invite, requireUser, async (c) => {
    const data = await call(c, "read_search_invite", {
      p_token: c.req.param("token"),
    });
    if (!data) throw new ApiError(404, "not_found", missing.invite_not_found);
    return json(data);
  })
  .post(invite, requireUser, async (c) => {
    const b = await body(c, answer);
    return json(
      await call(c, "answer_search_invite", {
        p_key: b.operationKey,
        p_token: c.req.param("token"),
        p_accept: b.accept,
      }),
    );
  })
  .all(invite, requireUser, () => notAvailable());
