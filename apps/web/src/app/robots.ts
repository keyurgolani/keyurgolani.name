import type { MetadataRoute } from 'next';
import { INDEXABLE } from '~/server/capabilities';
import { requireDeploymentConfig } from '~/server/config-store';
import { servedPage } from '~/server/page-guard';

// Per request, so the origin is the deployment's, not the build's.
export const dynamic = 'force-dynamic';

/**
 * What crawlers may fetch (#22). Under owner and read-only, everything but
 * Studio and the API, with the sitemap on PORTFOLIO_ORIGIN. Under demo,
 * every page, and no sitemap: the sample stays out of search through the
 * `X-Robots-Tag: noindex` on every response, which a crawler only sees on
 * a page it may fetch, so a `Disallow: /` would work against it.
 */
export default servedPage('/robots.txt', function robots(): MetadataRoute.Robots {
  const { origin, profile } = requireDeploymentConfig();
  if (!INDEXABLE[profile]) return { rules: [{ userAgent: '*', allow: '/' }] };
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/studio', '/api/'] }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
});
