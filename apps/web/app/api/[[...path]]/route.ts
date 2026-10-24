import api from "@rallypoint/api";
import type { AppEnv } from "@rallypoint/api/env";
import { getCloudflareContext } from "@opennextjs/cloudflare";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function environment(): AppEnv {
  // Normal Next dev/start uses runtime .env.local; OpenNext supplies bindings.
  if (process.env.SUPABASE_URL)
    return {
      DATABASE_URL: process.env.DATABASE_URL,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      SUPABASE_API_SCHEMA: process.env.SUPABASE_API_SCHEMA,
      PAYMENT_QR_BUCKET: process.env.PAYMENT_QR_BUCKET,
      LOCAL_AUTH_ENABLED: process.env.LOCAL_AUTH_ENABLED,
      EMAIL_AUTH_ENABLED: process.env.EMAIL_AUTH_ENABLED,
      EMAIL_OTP_LENGTH: process.env.EMAIL_OTP_LENGTH,
      GOOGLE_AUTH_ENABLED: process.env.GOOGLE_AUTH_ENABLED,
    };
  try {
    return getCloudflareContext().env as AppEnv;
  } catch {
    return {};
  }
}
async function handle(request: Request) {
  return api.fetch(request, environment());
}
export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as OPTIONS,
  handle as HEAD,
};
