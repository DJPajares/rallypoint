import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { normalizeSearch } from "@rallypoint/domain/ranked-search";
import { ApiError, json, parse, readBody, uuid, uuidParam } from "./http";
import type { ApiEnv } from "./identity";
import { notAvailable, requireUser } from "./identity";

// Ranked searches (D-26, WDL-421).
const conflicts: Record<string, string> = {
  search_active:
    "You’re already in a ranked search. Cancel it before starting or joining another.",
  not_known:
    "Pick someone you’ve played with, or invite your partner with a link.",
  own_invite: "This is your own invite. Share the link with your partner.",
  invite_closed:
    "This invite has already been answered, cancelled or has run out.",
  search_matched:
    "You’ve been matched. Accept or decline the match instead.",
  proposal_closed: "This match has already been settled or has run out.",
  cannot_widen: "You can widen your search after 3 days without a match.",
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
