import type { NextConfig } from 'next';
const config: NextConfig = {
  devIndicators: false,
  transpilePackages: [
    '@rallypoint/domain',
    '@rallypoint/api',
    '@rallypoint/ui'
  ],
  poweredByHeader: false
};
export default config;
