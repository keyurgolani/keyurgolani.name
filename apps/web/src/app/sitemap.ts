import { listCanonicalUrls } from '@portfolio/schema';
import type { MetadataRoute } from 'next';
import { INDEXABLE } from '~/server/capabilities';
import { requireDeploymentConfig } from '~/server/config-store';
import { servedPage } from '~/server/page-guard';
import { getPublicView } from '~/server/public-view';

// Per request, so the origin is the deployment's, not the build's.
export const dynamic = 'force-dynamic';

/**
 * Only routes the profile serves, on PORTFOLIO_ORIGIN: the home page and
 * each case study the live public view routes (#10b), and nothing under
 * demo, which keeps the sample out of search (#22). A variant's path views
 * stay out, since each is canonical to its parent route (#5, Slice 4). No
 * entry carries a `lastModified`: the same revision answers the same bytes,
 * so a rollback reads exactly as before the publish.
 */
export default servedPage('/sitemap.xml', async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { origin, profile } = requireDeploymentConfig();
  if (!INDEXABLE[profile]) return [];
  return listCanonicalUrls(await getPublicView()).map((path) => ({
    url: `${origin}${path}`,
    changeFrequency: 'weekly',
    priority: path === '/' ? 1 : 0.8,
  }));
});
