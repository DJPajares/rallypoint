import { Hono } from "hono";
import { badges } from "./badges";
import type { AppEnv } from "./env";
import { ApiError, discardRejectedBody, errorJson, json, uuid } from "./http";
import type { ApiEnv } from "./identity";
import { actorName, connection, requireUser } from "./identity";
import { payments } from "./payments";
import { profiles } from "./profiles";
import { registrations } from "./registrations";
import { sessions } from "./sessions";
import { splits } from "./splits";

const loopback = ["127.0.0.1", "localhost"];
const app = new Hono<ApiEnv>().basePath("/api");

// Hono answers HEAD from GET routes; this API has never offered HEAD.
app.use(async (c, next) => {
  if (c.req.method === "HEAD")
    throw new ApiError(
      405,
      "method_not_allowed",
      "This action is not available.",
    );
  await next();
});

app.get("/health", () => json({ status: "ok" }));
// What a browser needs to sign in. Never includes the server key.
app.get("/config", (c) => {
  try {
    const conn = connection(c.env);
    return json({
      configured: true,
      auth: {
        url: conn.url,
        publishableKey: conn.key,
        google: c.env.GOOGLE_AUTH_ENABLED === "true",
        email: c.env.EMAIL_AUTH_ENABLED === "true",
        emailCodeLength: c.env.EMAIL_OTP_LENGTH === "8" ? 8 : 6,
        localEmail:
          c.env.LOCAL_AUTH_ENABLED === "true" &&
          loopback.includes(new URL(c.req.url).hostname) &&
          loopback.includes(new URL(conn.url).hostname),
      },
    });
  } catch {
    return json({ configured: false, auth: null });
  }
});

app.get("/me", requireUser, async (c) => {
  const user = c.var.user;
  const { name, profileId } = await actorName(c, "Participant");
  return json({
    id: user.id,
    email: user.email,
    profileId,
    // The name they chose to show, else their account name. Display-only,
    // never role authority.
    displayName: name,
  });
});
app.get("/workspace", requireUser, async (c) => {
  const { data: groups, error } = await c.var.db.rpc("list_my_groups", {
    p_actor_id: c.var.user.id,
  });
  if (error)
    throw new ApiError(
      503,
      "service_unavailable",
      "Your groups could not be loaded. Please try again.",
    );
  return json({ groups });
});
app.get("/dues", requireUser, async (c) => {
  const db = c.var.db;
  const { data: dues, error } = await db.rpc("list_my_dues", {
    p_actor_id: c.var.user.id,
  });
  if (error)
    throw new ApiError(
      503,
      "service_unavailable",
      "Your dues could not be loaded. Please try again.",
    );
  const { data: splitClaims, error: claimError } = await db.rpc(
    "list_my_split_claims",
    { p_actor_id: c.var.user.id },
  );
  if (claimError)
    throw new ApiError(
      503,
      "service_unavailable",
      "Your estimates could not be loaded. Please try again.",
    );
  return json({ dues, splitClaims });
});
app.get("/me/sessions", requireUser, async (c) => {
  const { data, error } = await c.var.db.rpc("list_my_sessions", {
    p_actor_id: c.var.user.id,
  });
  if (error)
    throw new ApiError(
      503,
      "service_unavailable",
      "Your sessions could not be loaded. Please try again.",
    );
  return json(data);
});
app.get("/groups/:id{[0-9a-f-]+}/setup", requireUser, async (c) => {
  const id = c.req.param("id");
  if (!uuid.test(id))
    throw new ApiError(404, "not_found", "That page could not be found.");
  const { data: group, error } = await c.var.db.rpc("read_group_setup", {
    p_actor_id: c.var.user.id,
    p_group_id: id,
  });
  if (error?.code === "42501")
    throw new ApiError(
      403,
      "group_access_denied",
      "You do not have organizer access to this group.",
    );
  if (error)
    throw new ApiError(
      503,
      "service_unavailable",
      "The group could not be loaded. Please try again.",
    );
  return json({ group });
});

app.route("/", sessions);
app.route("/", registrations);
app.route("/", splits);
app.route("/", payments);
app.route("/", badges);
app.route("/", profiles);

// Unknown reads are missing pages; any other unknown method is refused.
app.notFound(async (c) => {
  await discardRejectedBody(c.req.raw);
  return errorJson(
    c.req.method === "GET"
      ? new ApiError(404, "not_found", "That page could not be found.")
      : new ApiError(
          405,
          "method_not_allowed",
          "This action is not available.",
        ),
  );
});
app.onError(async (error, c) => {
  await discardRejectedBody(c.req.raw);
  return errorJson(
    error instanceof ApiError
      ? error
      : new ApiError(
          503,
          "service_unavailable",
          "The connection was interrupted. Please try again.",
        ),
  );
});

/**
 * The whole API as one Web-standard handler: `fetch(request, env)`. Any host
 * can serve it; RallyPoint mounts it inside the Next.js app at /api.
 */
export default app as {
  fetch: (request: Request, env: AppEnv) => Response | Promise<Response>;
};
