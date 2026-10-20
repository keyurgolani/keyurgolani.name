import type { MetadataRoute } from 'next';
import { requireDeploymentConfig } from '~/server/config-store';
import { requireServed } from '~/server/page-guard';

// Per request, so the origin is the deployment's, not the build's.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  requireServed('/robots.txt');
  const { origin, profile } = requireDeploymentConfig();
  if (profile !== 'owner' && profile !== 'read-only') {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/studio', '/api/'] }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
