import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import { listRoutes, ROUTE_HEADER } from './src/server/routes';

/**
 * The registered variant and content extension packages, which
 * `pnpm build:registry` lists (#5). predev and prebuild run it first.
 */
function registeredPackages(): string[] {
  const file = path.join(process.cwd(), 'src', 'lib', 'generated', 'transpile-packages.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as string[];
  } catch {
    throw new Error(
      'src/lib/generated/transpile-packages.json is missing. Run pnpm --filter @portfolio/web build:registry first.',
    );
  }
}

/**
 * Every Studio page the route table lists (#2). Each is a fixed path, which
 * headers.test.ts holds them to, so a rewrite from one has no parameter for
 * Next to add to the query.
 */
function studioPages(): string[] {
  return listRoutes()
    .filter((entry) => entry.kind === 'page' && /^\/studio(?:\/|$)/.test(entry.pattern))
    .map((entry) => entry.pattern);
}

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // For pnpm monorepo: include workspace files in the standalone trace.
  outputFileTracingRoot: path.resolve(process.cwd(), '..', '..'),
  // Ship the bundled sample pair, portfolio.example.yml and site.example.yml,
  // with the standalone output. Nothing imports them, so the tracer can't
  // find them on its own.
  outputFileTracingIncludes: { '/**': ['../../portfolio.example.yml', '../../site.example.yml'] },
  transpilePackages: [
    '@portfolio/schema',
    '@portfolio/kit',
    '@portfolio/variant-contract',
    '@portfolio/core',
    ...registeredPackages(),
  ],
  // No image optimizer: images render as plain <img>. Left on, /_next/image
  // sends its own CSP in place of the baseline one below and writes the
  // decoded url parameter to stderr as it came, so a visitor could forge log
  // lines. Off, Next answers it with the 404 page.
  images: { unoptimized: true },
  // Each route group in app/ has its own root layout, the site's in
  // app/(site) and Studio's (#2), so a URL no route matches gets
  // app/global-not-found.tsx, which brings its own document. Without the
  // flag, next build exits.
  experimental: { globalNotFound: true },
  async rewrites() {
    return {
      // A Studio page under a profile with none (#2): proxy.ts marks the
      // request with x-portfolio-not-found (NOT_FOUND_HEADER in
      // server/studio-headers.ts), and this sends it to Next's own 404 page
      // before Next finds the page, so it answers as a path no route matches
      // does, with the request's own URL and query.
      beforeFiles: studioPages().map((source) => ({
        source,
        has: [{ type: 'header' as const, key: 'x-portfolio-not-found', value: '1' }],
        destination: '/_not-found',
      })),
      // A path the route table calls missing (#5, Slice 4): proxy.ts marks it
      // in the x-portfolio-route header (server/routes.ts ROUTE_HEADER), and
      // this renders the 404 page through the same /_not-found route, from
      // the server and with its 404 status. As an afterFiles rewrite it runs
      // once Next has looked in public/, so a file there is still served, and
      // before the dynamic routes, so the views catch-all never sees the path.
      // Its source is an unnamed group: Next adds a named parameter, such as
      // /:path*'s, to the 404 page's query, which a path no route matches
      // never has.
      afterFiles: [
        {
          source: '/(.*)',
          has: [{ type: 'header' as const, key: ROUTE_HEADER, value: 'missing' }],
          destination: '/_not-found',
        },
      ],
      fallback: [],
    };
  },
  // Baseline headers on every route (#1, item 22), matched in any case, as
  // Next matches header sources. A route that sends its own
  // Content-Security-Policy, Studio and login (#2), public pages (#6),
  // preview (#7), and /sample (#9), sends it from proxy.ts, which takes the
  // place of this one, so each response carries one. So does Studio's
  // Referrer-Policy: same-origin, which proxy.ts sends with its CSP and
  // Cross-Origin-Resource-Policy: same-origin under a profile with a Studio
  // page, so under another one /studio gets what any unknown path gets.
  // Studio's transport, in every profile, sends same-origin from here, since
  // no-referrer would null the Origin of the sign-in form's post. Studio and
  // its transport ask for no-store here too, for what Next answers itself,
  // such as an error page. headers.test.ts holds every path to these. HSTS
  // belongs at the TLS-terminating proxy (docs/deployment.md).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }],
      },
      {
        source: '/:path((?!api/studio(?:/|$)).*)',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
      {
        source: '/:path(api/studio(?:/.*)?)',
        headers: [
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
      {
        source: '/:path((?:api/)?studio(?:/.*)?)',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

export default config;
