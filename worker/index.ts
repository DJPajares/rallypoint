import { createClient } from "@supabase/supabase-js";
import type { AppEnv } from "./env";
import { ApiError, discardRejectedBody, json } from "./http";
import { sessionRoute, sessionRequest } from "./sessions";
import { registrationRoute, registrationRequest } from "./registrations";
function connection(env: AppEnv) {
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_PUBLISHABLE_KEY ||
    !env.SUPABASE_SECRET_KEY
  ) {
    throw new ApiError(
      503,
      "configuration_required",
      "Sign-in is not configured yet. Complete local setup and restart the app.",
    );
  }
  const url = new URL(env.SUPABASE_URL);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname)
    )
  ) {
    throw new ApiError(
      503,
      "configuration_required",
      "The data service configuration needs attention.",
    );
  }
  return {
    url: url.origin,
    key: env.SUPABASE_PUBLISHABLE_KEY,
    secret: env.SUPABASE_SECRET_KEY,
  };
}
const client = (url: string, key: string) =>
  createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
    },
  });
export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      const featureRoute = sessionRoute(path) || registrationRoute(path);
      if (request.method !== "GET" && !featureRoute)
        throw new ApiError(
          405,
          "method_not_allowed",
          "This action is not available.",
        );
      if (path === "/api/health") return json({ status: "ok" });
      if (path === "/api/config") {
        try {
          const c = connection(env);
          const local = ["127.0.0.1", "localhost"];
          return json({
            configured: true,
            auth: {
              url: c.url,
              publishableKey: c.key,
              google: env.GOOGLE_AUTH_ENABLED === "true",
              localEmail:
                env.LOCAL_AUTH_ENABLED === "true" &&
                local.includes(new URL(request.url).hostname) &&
                local.includes(new URL(c.url).hostname),
            },
          });
        } catch {
          return json({ configured: false, auth: null });
        }
      }
      if (featureRoute && path.startsWith("/api/shared/")) {
        const c = connection(env);
        return await sessionRequest(request, client(c.url, c.secret), null);
      }
      if (
        !featureRoute &&
        !["/api/me", "/api/workspace"].includes(path) &&
        !/^\/api\/groups\/[0-9a-f-]+\/setup$/.test(path)
      ) {
        throw new ApiError(404, "not_found", "That page could not be found.");
      }
      const token = request.headers
        .get("Authorization")
        ?.match(/^Bearer (\S+)$/)?.[1];
      if (!token)
        throw new ApiError(401, "sign_in_required", "Sign in to continue.");
      const c = connection(env);
      const { data, error } = await client(c.url, c.key).auth.getUser(token);
      if (error || !data.user) {
        if (error && ![400, 401, 403].includes(error.status ?? 0))
          throw new ApiError(
            503,
            "service_unavailable",
            "Sign-in could not be checked. Please try again.",
          );
        throw new ApiError(
          401,
          "session_expired",
          "Your session has ended. Please sign in again.",
        );
      }
      const user = data.user;
      if (user.is_anonymous || !user.email || !user.email_confirmed_at)
        throw new ApiError(
          403,
          "verified_identity_required",
          "Verify your email before continuing.",
        );
      if (registrationRoute(path))
        return await registrationRequest(
          request,
          client(c.url, c.secret),
          user,
        );
      if (featureRoute)
        return await sessionRequest(request, client(c.url, c.secret), user.id);
      if (path === "/api/me")
        return json({
          id: user.id,
          email: user.email,
          // Editable metadata is display-only, never role authority.
          displayName: String(
            user.user_metadata.full_name ?? user.email.split("@")[0],
          ).slice(0, 80),
        });
      const db = client(c.url, c.secret).schema("api");
      if (path === "/api/workspace") {
        const { data: groups, error: dbError } = await db.rpc(
          "list_my_groups",
          { p_actor_id: user.id },
        );
        if (dbError)
          throw new ApiError(
            503,
            "service_unavailable",
            "Your groups could not be loaded. Please try again.",
          );
        return json({ groups });
      }
      const id = path.split("/")[3];
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))
        throw new ApiError(404, "not_found", "That page could not be found.");
      const { data: group, error: dbError } = await db.rpc("read_group_setup", {
        p_actor_id: user.id,
        p_group_id: id,
      });
      if (dbError?.code === "42501")
        throw new ApiError(
          403,
          "group_access_denied",
          "You do not have organizer access to this group.",
        );
      if (dbError)
        throw new ApiError(
          503,
          "service_unavailable",
          "The group could not be loaded. Please try again.",
        );
      return json({ group });
    } catch (error) {
      await discardRejectedBody(request);
      if (error instanceof ApiError)
        return json(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      return json(
        {
          error: {
            code: "service_unavailable",
            message: "The connection was interrupted. Please try again.",
          },
        },
        503,
      );
    }
  },
};
