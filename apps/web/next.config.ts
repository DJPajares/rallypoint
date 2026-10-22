import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@rallypoint/domain", "@rallypoint/api", "@rallypoint/ui"],
  poweredByHeader: false,
};
export default config;
