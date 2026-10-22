import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { ApiError, json, parse, readBody, uuid, uuidParam } from "./http";
import type { ApiEnv } from "./identity";
import { displayName, notAvailable, requireUser } from "./identity";

const conflicts: Record<string, string> = {
  split_not_finalized: "Finalize the split before changing amounts.",
  split_already_finalized:
    "This split was already finalized. Refresh to see it.",
  split_too_early: "The split can be finalized once the session starts.",
  split_unavailable: "A split is not available for this session.",
  stale_split: "The split changed. Review the latest amounts before saving.",
  split_total_increase: "A correction cannot increase the session cost.",
  split_paid_allocation:
    "A paid amount would change. Resolve the payment before correcting it.",
  split_undo_requires_review: "Review a new split before restoring this share.",
  idempotency_conflict: "This request was already used for different details.",
};
async function call(
  c: Context<ApiEnv>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await c.var.db.rpc(name, {
    p_actor_id: c.var.user.id,
    p_slug: c.req.param("slug"),
    ...args,
  });
  if (error) {
    if (error.code === "42501")
      throw new ApiError(
        403,
        "group_access_denied",
        "Only this session’s organizers can manage the split.",
      );
    if (conflicts[error.message])
      throw new ApiError(409, error.message, conflicts[error.message]);
    if (["23514", "22P02", "22003"].includes(error.code))
      throw new ApiError(
        422,
        "invalid_split",
        "Check the session cost and split details.",
      );
    throw new ApiError(
      503,
      "service_unavailable",
      "The action could not be confirmed. Check the result before retrying.",
    );
  }
  return json(data);
}

const minor = z
  .number()
  .refine(Number.isSafeInteger)
  .refine((n) => n >= 0);
const party = z.string().regex(uuid).optional();
const previewIntent = z.object({ intent: z.enum(["finalize", "correct"]) });
const correctPreview = z.object({
  totalMinor: minor,
  undoWaiverPartyId: party,
});
const write = z.object({
  operationKey: z.string().regex(uuid),
  basis: z.string().regex(/^[0-9a-f]{64}$/),
});
const correction = z.object({
  totalMinor: minor,
  reason: z.string().trim().min(1).max(300),
  undoWaiverPartyId: party,
});
const writeArgs = (c: Context<ApiEnv>, b: z.infer<typeof write>) => ({
  p_key: b.operationKey,
  p_basis: b.basis,
  p_actor_name: displayName(c.var.user, "Organizer"),
});

const base = `/splits/:slug{${uuidParam}}`;
const action = "Use the action button.";
const review = "Refresh and review the split before saving.";
export const splits = new Hono<ApiEnv>()
  .get(base, requireUser, (c) => call(c, "read_split"))
  .all(base, requireUser, () => notAvailable())
  .post(`${base}/preview`, requireUser, async (c) => {
    const b = await readBody(c.req.raw);
    const { intent } = parse(
      previewIntent,
      b,
      "invalid_split",
      "Choose the split to review.",
    );
    if (intent === "finalize")
      return call(c, "preview_split", { p_input: { intent } });
    const p = parse(
      correctPreview,
      b,
      "invalid_split",
      "Enter a valid corrected cost.",
    );
    return call(c, "preview_split", {
      p_input: {
        intent,
        totalMinor: p.totalMinor,
        ...(p.undoWaiverPartyId === undefined
          ? {}
          : { undoWaiverPartyId: p.undoWaiverPartyId }),
      },
    });
  })
  .all(`${base}/preview`, requireUser, () => notAvailable(action))
  .post(`${base}/finalize`, requireUser, async (c) => {
    const b = parse(write, await readBody(c.req.raw), "invalid_split", review);
    return call(c, "finalize_split", writeArgs(c, b));
  })
  .all(`${base}/finalize`, requireUser, () => notAvailable(action))
  .post(`${base}/correct`, requireUser, async (c) => {
    const raw = await readBody(c.req.raw);
    const b = parse(write, raw, "invalid_split", review);
    const k = parse(
      correction,
      raw,
      "invalid_split",
      "Enter the corrected cost and a short reason.",
    );
    return call(c, "correct_split", {
      ...writeArgs(c, b),
      p_total_minor: k.totalMinor,
      p_reason: k.reason,
      p_undo_party: k.undoWaiverPartyId ?? null,
    });
  })
  .all(`${base}/correct`, requireUser, () => notAvailable(action));
