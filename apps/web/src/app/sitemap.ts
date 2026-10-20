import type { MetadataRoute } from 'next';
import { requireDeploymentConfig } from '~/server/config-store';
import { servedPage } from '~/server/page-guard';

// Per request, so the origin is the deployment's, not the build's.
export const dynamic = 'force-dynamic';

/** Only routes the profile serves, on PORTFOLIO_ORIGIN. Today that is the home page. */
export default servedPage('/sitemap.xml', function sitemap(): MetadataRoute.Sitemap {
  const { origin, profile } = requireDeploymentConfig();
  if (profile !== 'owner' && profile !== 'read-only') return [];
  return [{ url: `${origin}/`, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 }];
});
