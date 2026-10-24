import { createClient } from "@supabase/supabase-js";
import { createDatabase } from "@rallypoint/database";
import { DEFAULT_FROM, type DrainOptions } from "./drain.ts";
import { mailpitProvider, resendProvider, type Provider } from "./provider.ts";

export interface EmailEnv {
  DATABASE_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_API_SCHEMA?: string;
  EMAIL_DELIVERY_ENABLED?: string;
  EMAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  MAILPIT_URL?: string;
  EMAIL_FROM?: string;
  APP_ORIGIN?: string;
}

function chooseProvider(env: EmailEnv): Provider | null {
  if (env.EMAIL_DELIVERY_ENABLED !== "true") return null;
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
    return resendProvider({ apiKey: env.RESEND_API_KEY });
  }
  if (env.EMAIL_PROVIDER === "mailpit" && env.MAILPIT_URL) {
    return mailpitProvider({ baseUrl: env.MAILPIT_URL });
  }
  return null;
}

/**
 * The drain's options from server configuration, or null when the database is not
 * configured. Delivery is off (provider null) unless it is enabled, a provider is
 * named with what it needs, and the app origin for links is known.
 */
export function deliveryFromEnv(
  env: EmailEnv,
): (DrainOptions & { close(): Promise<void> }) | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.DATABASE_URL)
    return null;
  const auth = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const db = createDatabase(env);
  const appOrigin = env.APP_ORIGIN ?? "";
  return {
    db,
    admin: auth.auth.admin,
    close: () => db.close(),
    provider: appOrigin === "" ? null : chooseProvider(env),
    from: env.EMAIL_FROM || DEFAULT_FROM,
    appOrigin,
  };
}
