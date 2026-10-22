import type { MetadataRoute } from 'next';
import { INDEXABLE } from '~/server/capabilities';
import { requireDeploymentConfig } from '~/server/config-store';
import { servedPage } from '~/server/page-guard';

// Per request, so the origin is the deployment's, not the build's.
export const dynamic = 'force-dynamic';

/**
 * Only routes the profile serves, on PORTFOLIO_ORIGIN: today the home page,
 * and nothing under demo until #9 and #22 decide what crawlers may see there.
 * A variant's path views stay out, since each is canonical to its parent
 * route (#5, Slice 4), and work pages join once #10 resolves slugs.
 */
export default servedPage('/sitemap.xml', function sitemap(): MetadataRoute.Sitemap {
  const { origin, profile } = requireDeploymentConfig();
  if (!INDEXABLE[profile]) return [];
  return [{ url: `${origin}/`, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 }];
});
