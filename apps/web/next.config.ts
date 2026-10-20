import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // For pnpm monorepo: include workspace files in the standalone trace.
  outputFileTracingRoot: path.resolve(process.cwd(), '..', '..'),
  // Ship the bundled sample pair, portfolio.example.yml and site.example.yml,
  // with the standalone output. Nothing imports them, so the tracer can't
  // find them on its own.
  outputFileTracingIncludes: { '/**': ['../../portfolio.example.yml', '../../site.example.yml'] },
  transpilePackages: ['@portfolio/schema', '@portfolio/kit', '@portfolio/variant-editorial'],
  // No image optimizer: images render as plain <img>. Left on, /_next/image
  // sends its own CSP in place of the baseline one below and writes the
  // decoded url parameter to stderr as it came, so a visitor could forge log
  // lines. Off, Next answers it with the 404 page.
  images: { unoptimized: true },
  // Baseline headers on every route (#1, item 22). A route that sends its own
  // Content-Security-Policy sets frame-ancestors there and leaves this entry's
  // source, so each response carries one CSP: Studio and login (#2), public
  // pages (#6), preview (#7), and /sample (#9). None does yet. HSTS belongs at
  // the TLS-terminating proxy (docs/deployment.md).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default config;
