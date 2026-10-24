import { defineCloudflareConfig } from "@opennextjs/cloudflare";
const config = defineCloudflareConfig({});
// OpenNext must generate its Workers client instead of calling the Node/Vercel
// build script. The custom command runs from this app's directory.
config.buildCommand =
  "pnpm --filter @rallypoint/database generate:cloudflare && pnpm exec next build";
export default config;
