import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // For pnpm monorepo: include workspace files in the standalone trace.
  outputFileTracingRoot: path.resolve(process.cwd(), '..', '..'),
  transpilePackages: [
    '@portfolio/schema',
    '@portfolio/kit',
    '@portfolio/variant-editorial',
  ],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default config;
