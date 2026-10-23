import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import {
  EXPERIENCE_HEADER,
  EXPERIENCE_ID,
  EXPERIENCE_SEGMENT,
  ROUTE_HEADER,
} from './src/server/route-header';

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

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // For pnpm monorepo: include workspace files in the standalone trace.
  outputFileTracingRoot: path.resolve(process.cwd(), '..', '..'),
  // Ship the bundled sample pair, portfolio.example.yml and site.example.yml,
  // with the standalone output, and what sits beside it (#10): the snapshots
  // the sample adapter reads, and the sample's media sources, which #10's
  // second slice derives renditions from. Nothing imports them, so the
  // tracer can't find them on its own.
  //
  // The documents and the two directories hang on different routes on
  // purpose. Turbopack joins a route's includes into one glob, matches it
  // anywhere in a path, and walks every directory some part of it could
  // match. A file at the root could be in any directory, so beside the two
  // documents, snapshots/*.json matched every snapshots directory in the
  // tree, through every workspace link: the contract fixtures' and the
  // schema's test snapshots, and tests/fixtures'. On their own, the two
  // directory globs walk only into the root's snapshots/ and example-media/.
  // One route is enough to ship a file, and every build has these two. pnpm
  // check:standalone fails a build whose output holds any other snapshot, or
  // lacks the sample's.
  outputFileTracingIncludes: {
    '/api/health': ['../../portfolio.example.yml', '../../site.example.yml'],
    '/api/ready': ['../../snapshots/*.json', '../../example-media/**/*.png'],
  },
  // #5's contract fixtures stay out of it. Only the preview's dev fixture
  // route reads them, under next dev alone, but the tracer follows its reads
  // and would ship every fixture's portfolio and site documents,
  // hidden-canary's among them, in the standalone output, and so in the
  // image. pnpm check:standalone fails a build whose output holds one.
  outputFileTracingExcludes: {
    '/**': ['../../packages/variant-contract/fixtures/**'],
  },
  transpilePackages: [
    '@portfolio/schema',
    '@portfolio/kit',
    '@portfolio/variant-contract',
    '@portfolio/appearance',
    '@portfolio/core',
    ...registeredPackages(),
  ],
  // Browser source maps only in a PORTFOLIO_ANALYZE=1 build, which pnpm
  // test:trace reads to attribute chunk bytes to packages (#6, Slice 1).
  // The default build, the image, and CI never set it, so they ship no
  // .map file: ci/source-maps.test.mjs and pnpm check:source-maps hold that.
  productionBrowserSourceMaps: process.env.PORTFOLIO_ANALYZE === '1',
  // No image optimizer: images render as plain <img>. Left on, /_next/image
  // sends its own CSP in place of the baseline one below and writes the
  // decoded url parameter to stderr as it came, so a visitor could forge log
  // lines. Off, Next answers it with the 404 page.
  images: { unoptimized: true },
  // Each route group in app/ has its own root layout, the site's in
  // app/(site), Studio's (#2), and the appearance fixtures' (#19), so a URL
  // no route matches gets app/global-not-found.tsx, which brings its own
  // document. Without the flag, next build exits.
  experimental: { globalNotFound: true },
  // Next's own 308 for a trailing slash goes out before proxy.ts and these
  // headers, with none of them, so a preview grant path would get a
  // cacheable answer (#7, Slice 2). proxy.ts sends the same 308 instead,
  // with the headers the path gets. Next still answers a repeated slash or
  // a backslash itself, before anything here (docs/deployment.md).
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return {
      // A path the route table lists that proxy.ts answers as one it
      // doesn't: a Studio page under a profile with none (#2), a route no
      // profile of this build serves (#19, Slice 3), or a route spelled with
      // a fixed segment percent-encoded (#5, Slice 4). proxy.ts marks the
      // request with x-portfolio-not-found (NOT_FOUND_HEADER in
      // server/studio-headers.ts), and this sends it to Next's own 404 page
      // before Next looks anywhere else, so it answers as a path no route
      // matches does, with the request's own URL and query. Its source is an
      // unnamed group, as afterFiles' is.
      beforeFiles: [
        {
          source: '/(.*)',
          has: [{ type: 'header' as const, key: 'x-portfolio-not-found', value: '1' }],
          destination: '/_not-found',
        },
        // A request with Next's router prefetch header and no RSC header,
        // which Next's own router never sends, gets the 404 page too (#1).
        // proxy.ts can't drop the header itself, since Next keeps its router
        // headers out of the proxy's request and puts them back after it. A
        // path under /_next/ waits for the afterFiles rule below, so a build
        // file is still served. The value pattern keeps the header's value
        // out of the 404 page's query, where a bare key would put it. An
        // empty RSC header counts as none, as Next reads it here.
        {
          source: '/((?!_next/).*)',
          has: [{ type: 'header' as const, key: 'next-router-prefetch', value: '.*' }],
          missing: [{ type: 'header' as const, key: 'rsc' }],
          destination: '/_not-found',
        },
      ],
      // A path the route table calls missing (#5, Slice 4): proxy.ts marks it
      // in the x-portfolio-route header (server/route-header.ts), and
      // this renders the 404 page through the same /_not-found route, from
      // the server and with its 404 status. As an afterFiles rewrite it runs
      // once Next has looked in public/, so a file there is still served, and
      // before the dynamic routes, so none of them sees the path.
      // Its source is an unnamed group: Next adds a named parameter, such as
      // /:path*'s, to the 404 page's query, which a path no route matches
      // never has.
      afterFiles: [
        {
          source: '/(.*)',
          has: [{ type: 'header' as const, key: ROUTE_HEADER, value: 'missing' }],
          destination: '/_not-found',
        },
        // The router prefetch rule for /_next/ (#1): Next has served any
        // build file by now, so a path there that isn't one, asked for with
        // the prefetch header and no RSC header, gets the 404 page.
        {
          source: '/_next/(.*)',
          has: [{ type: 'header' as const, key: 'next-router-prefetch', value: '.*' }],
          missing: [{ type: 'header' as const, key: 'rsc' }],
          destination: '/_not-found',
        },
        // A visitor page (#6, Slice 2): proxy.ts names the experience segment
        // it renders in, x-portfolio-experience (EXPERIENCE_HEADER in
        // server/route-header.ts), and this sends the request there, with its
        // path below the segment and its query as sent. Next adds a parameter
        // to the query only when the destination uses none, and this one uses
        // both, and the value pattern takes an id whole, so the header spells
        // no path. It's an afterFiles rule because Next applies each
        // beforeFiles rule that matches to the path the one before it left:
        // there it would send /_not-found, where the router prefetch rule
        // sends a prefetch with no RSC header, on to a segment.
        {
          source: '/:path*',
          has: [
            {
              type: 'header' as const,
              key: EXPERIENCE_HEADER,
              value: `(?<experience>${EXPERIENCE_ID})`,
            },
          ],
          destination: `/${EXPERIENCE_SEGMENT}/:experience/:path*`,
        },
      ],
      fallback: [],
    };
  },
  // Baseline headers on every route (#1, item 22), matched in any case, as
  // Next matches header sources. A route that sends its own
  // Content-Security-Policy, Studio and login (#2), public pages (#6), and
  // /sample (#9), sends it from proxy.ts, which takes the place of this one,
  // so each response carries one. So does Studio's Referrer-Policy:
  // same-origin, which proxy.ts sends with its CSP and
  // Cross-Origin-Resource-Policy: same-origin under a profile with a Studio
  // page, so under another one /studio gets what any unknown path gets.
  // Studio's transport, in every profile, sends same-origin from here, since
  // no-referrer would null the Origin of the sign-in form's post. Studio and
  // its transport ask for no-store here too, for what Next answers itself,
  // such as an error page. /preview and /preview-assets (#7) get neither the
  // baseline CSP nor its Referrer-Policy: proxy.ts sends the preview's own,
  // and no-referrer, on every response there. The build's assets and
  // /_portfolio, #19's compiled packs and #6's fonts and variant assets,
  // allow any origin, since an opaque preview frame loads them cross-origin;
  // proxy.ts answers any other method or spelling under those prefixes.
  // headers.test.ts holds every path to these. HSTS belongs at the
  // TLS-terminating proxy (docs/deployment.md).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }],
      },
      {
        source: '/:path((?!api/studio(?:/|$))(?!preview(?:-assets)?(?:/|$)).*)',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
      },
      {
        source: '/_portfolio/:path*',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
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
