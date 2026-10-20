import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // For pnpm monorepo: include workspace files in the standalone trace.
  outputFileTracingRoot: path.resolve(process.cwd(), '..', '..'),
  // loadPortfolio falls back to the bundled example (src/lib/paths.ts), which
  // the tracer can't see through the dynamic path.
  outputFileTracingIncludes: { '/**': ['../../portfolio.example.yml'] },
  transpilePackages: ['@portfolio/schema', '@portfolio/kit', '@portfolio/variant-editorial'],
};

export default config;
