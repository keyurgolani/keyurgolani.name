import type { MetadataRoute } from 'next';
import { loadPortfolio } from '~/lib/portfolio';

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
