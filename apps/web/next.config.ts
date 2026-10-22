import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@rallypoint/domain", "@rallypoint/api"],
  poweredByHeader: false,
};
export default config;
