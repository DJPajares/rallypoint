export interface AppEnv {
  DATABASE_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_API_SCHEMA?: string;
  PAYMENT_QR_BUCKET?: string;
  LOCAL_AUTH_ENABLED?: string;
  PASSWORD_AUTH_ENABLED?: string;
  GOOGLE_AUTH_ENABLED?: string;
}
