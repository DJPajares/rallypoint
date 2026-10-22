export interface AppEnv {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_API_SCHEMA?: string;
  PAYMENT_QR_BUCKET?: string;
  LOCAL_AUTH_ENABLED?: string;
  EMAIL_AUTH_ENABLED?: string;
  EMAIL_OTP_LENGTH?: string;
  GOOGLE_AUTH_ENABLED?: string;
}
