import type { MetadataRoute } from 'next';
import { loadPortfolio } from '~/lib/portfolio';

// Render from the mounted portfolio file on each request. A build-time
// prerender would bake in whatever file the build saw, which for a CI image
// is the bundled example persona.
export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  let baseUrl: string | null = null;
  try {
    const { portfolio } = await loadPortfolio();
    if (portfolio.meta?.url) baseUrl = portfolio.meta.url.replace(/\/$/, '');
  } catch {
    // ignore
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // /admin and the customize/portfolio APIs are author-only — keep them out
        // of search indexes even if the deployment exposes them publicly.
        disallow: ['/admin', '/api/'],
      },
    ],
    ...(baseUrl ? { sitemap: `${baseUrl}/sitemap.xml`, host: baseUrl } : {}),
  };
}
