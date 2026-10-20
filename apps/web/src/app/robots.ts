import type { MetadataRoute } from 'next';
import { requireDeploymentConfig } from '~/server/config-store';
import { servedPage } from '~/server/page-guard';

// Per request, so the origin is the deployment's, not the build's.
export const dynamic = 'force-dynamic';

export default servedPage('/robots.txt', function robots(): MetadataRoute.Robots {
  const { origin, profile } = requireDeploymentConfig();
  if (profile !== 'owner' && profile !== 'read-only') {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/studio', '/api/'] }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
});
