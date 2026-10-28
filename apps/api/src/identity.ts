import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { createDatabase, type Database } from "@rallypoint/database";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./env";
import { ApiError } from "./http";

/** Hono typing shared by every route: settings in, verified identity out. */
export interface ApiEnv {
  Bindings: AppEnv;
  Variables: {
    user: User;
    db: Database;
    storage: ReturnType<typeof client>["storage"];
  };
}

export function connection(env: AppEnv) {
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
export const client = (url: string, key: string, schema = "api") =>
  createClient(url, key, {
    db: { schema },
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

/** Lazy connection: health/config/auth-only routes do not need Postgres. */
export const databaseScope = createMiddleware<ApiEnv>(async (c, next) => {
  const db = createDatabase(c.env);
  c.set("db", db);
  try {
    await next();
  } finally {
    // Cleanup must never replace a committed response with an ambiguous failure.
    await db.close().catch(() => {});
  }
});

/**
 * A verified, non-anonymous Supabase user from the bearer token. Roles are
 * never read from the token or metadata; each database operation checks them.
 */
export const requireUser = createMiddleware<ApiEnv>(async (c, next) => {
  const token = c.req.header("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token)
    throw new ApiError(401, "sign_in_required", "Sign in to continue.");
  const conn = connection(c.env);
  const { data, error } = await client(conn.url, conn.key).auth.getUser(token);
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
  if (
    !data.user.email ||
    !data.user.email_confirmed_at ||
    data.user.is_anonymous
  )
    throw new ApiError(
      403,
      "verified_identity_required",
      "Verify your email before continuing.",
    );
  c.set("user", data.user);
  c.set("storage", client(conn.url, conn.secret).storage);
  await next();
});

/**
 * For reads open to everyone that show more to some people (P-36 private
 * sessions). A missing, invalid or unverified token reads as signed out, the
 * least that can be shown, never as an error.
 */
export async function optionalUserId(c: Context<ApiEnv>) {
  const token = c.req.header("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return null;
  const conn = connection(c.env);
  const { data, error } = await client(conn.url, conn.key)
    .auth.getUser(token)
    .catch(() => ({ data: { user: null }, error: true }));
  const user = data.user;
  if (error || !user?.email || !user.email_confirmed_at || user.is_anonymous)
    return null;
  return user.id;
}

/** Display-only; editable metadata never grants authority. */
export const displayName = (user: User, fallback: string) =>
  // Cut by code point so an emoji at the limit is never split in half.
  [
    ...String(
      user.user_metadata.full_name ?? user.email?.split("@")[0] ?? fallback,
    ).trim(),
  ]
    .slice(0, 80)
    .join("") || fallback;

/**
 * The name this person shows everywhere (their chosen name, else their account
 * name) and their public profile id. Creates the profile row on first use.
 */
export async function actorName(
  c: Context<ApiEnv>,
  fallback: string,
): Promise<{ name: string; profileId: string }> {
  const { data, error } = await c.var.db.rpc("ensure_my_profile", {
    p_actor_id: c.var.user.id,
    p_account_name: displayName(c.var.user, fallback),
  });
  if (error || !data)
    throw new ApiError(
      503,
      "service_unavailable",
      "Your profile could not be loaded. Please try again.",
    );
  return data as { name: string; profileId: string };
}

/** For routes reached by a method they don't support. */
export const notAvailable = (message = "This action is not available.") => {
  throw new ApiError(405, "method_not_allowed", message);
};
