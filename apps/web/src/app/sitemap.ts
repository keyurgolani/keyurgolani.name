import type { MetadataRoute } from 'next';
import { loadPortfolio } from '~/lib/portfolio';

// Render from the mounted portfolio file on each request. A build-time
// prerender would bake in whatever file the build saw, which for a CI image
// is the bundled example persona.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let baseUrl: string | null = null;
  try {
    const { portfolio } = await loadPortfolio();
    if (portfolio.meta?.url) baseUrl = portfolio.meta.url.replace(/\/$/, '');
  } catch {
    // no-op — we'll emit an empty sitemap so search engines just see "no
    // canonical URLs declared" rather than a 500.
  }

  if (!baseUrl) return [];

  return [{ url: baseUrl, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 }];
}
