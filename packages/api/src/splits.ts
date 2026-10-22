import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ApiError, json } from "./http";
import { readBody } from "./sessions";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const splitRoute = (path: string) => {
  const parts = path.split("/");
  return (
    parts[1] === "api" &&
    parts[2] === "splits" &&
    uuid.test(parts[3] ?? "") &&
    (parts.length === 4 ||
      (parts.length === 5 &&
        ["preview", "finalize", "correct"].includes(parts[4])))
  );
};
export async function splitRequest(
  request: Request,
  client: SupabaseClient,
  user: User,
): Promise<Response> {
  const parts = new URL(request.url).pathname.split("/"),
    slug = parts[3],
    action = parts[4];
  let name = "read_split",
    args: Record<string, unknown> = { p_actor_id: user.id, p_slug: slug };
  if (action) {
    if (request.method !== "POST")
      throw new ApiError(405, "method_not_allowed", "Use the action button.");
    const b = await readBody(request);
    if (action === "preview") {
      if (b.intent !== "finalize" && b.intent !== "correct")
        throw new ApiError(422, "invalid_split", "Choose the split to review.");
      name = "preview_split";
      args.p_input =
        b.intent === "finalize"
          ? { intent: "finalize" }
          : {
              intent: "correct",
              totalMinor: b.totalMinor,
              ...(b.undoWaiverPartyId === undefined
                ? {}
                : { undoWaiverPartyId: b.undoWaiverPartyId }),
            };
    } else {
      if (
        typeof b.operationKey !== "string" ||
        !uuid.test(b.operationKey) ||
        typeof b.basis !== "string" ||
        !/^[0-9a-f]{64}$/.test(b.basis)
      )
        throw new ApiError(
          422,
          "invalid_split",
          "Refresh and review the split before saving.",
        );
      name = action === "finalize" ? "finalize_split" : "correct_split";
      args = {
        ...args,
        p_key: b.operationKey,
        p_basis: b.basis,
        p_actor_name:
          String(
            user.user_metadata.full_name ??
              user.email?.split("@")[0] ??
              "Organizer",
          )
            .trim()
            .slice(0, 80) || "Organizer",
      };
      if (action === "correct") {
        if (
          !Number.isSafeInteger(b.totalMinor) ||
          Number(b.totalMinor) < 0 ||
          typeof b.reason !== "string" ||
          !b.reason.trim() ||
          b.reason.trim().length > 300 ||
          (b.undoWaiverPartyId !== undefined &&
            (typeof b.undoWaiverPartyId !== "string" ||
              !uuid.test(b.undoWaiverPartyId)))
        )
          throw new ApiError(
            422,
            "invalid_split",
            "Enter the corrected cost and a short reason.",
          );
        args = {
          ...args,
          p_total_minor: b.totalMinor,
          p_reason: b.reason.trim(),
          p_undo_party: b.undoWaiverPartyId ?? null,
        };
      }
    }
  } else if (request.method !== "GET")
    throw new ApiError(
      405,
      "method_not_allowed",
      "This action is not available.",
    );
  const { data, error } = await client.schema("api").rpc(name, args);
  if (error) {
    if (error.code === "42501")
      throw new ApiError(
        403,
        "group_access_denied",
        "Only this session’s organizers can manage the split.",
      );
    const conflicts: Record<string, string> = {
      split_not_finalized: "Finalize the split before changing amounts.",
      split_already_finalized:
        "This split was already finalized. Refresh to see it.",
      split_too_early: "The split can be finalized once the session starts.",
      split_unavailable: "A split is not available for this session.",
      stale_split:
        "The split changed. Review the latest amounts before saving.",
      split_total_increase: "A correction cannot increase the session cost.",
      split_paid_allocation:
        "A paid amount would change. Resolve the payment before correcting it.",
      split_undo_requires_review:
        "Review a new split before restoring this share.",
      idempotency_conflict:
        "This request was already used for different details.",
    };
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
