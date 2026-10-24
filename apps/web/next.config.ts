import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@rallypoint/domain", "@rallypoint/api", "@rallypoint/ui"],
  poweredByHeader: false,
  // Keep the target-specific Prisma WASM imports for OpenNext/Wrangler to bundle.
  serverExternalPackages: ["@rallypoint/database"],
  outputFileTracingIncludes: {
    "/api/*": [
      "../../packages/database/node_modules/pg-cloudflare/dist/**/*",
      "../../packages/database/node_modules/pg-cloudflare/esm/**/*",
    ],
  },
};
export default config;
