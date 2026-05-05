import type { MetadataRoute } from 'next';
import { loadPortfolio } from '~/lib/portfolio';
import { listManifests } from '~/lib/registry';

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

  const lastModified = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified, changeFrequency: 'weekly', priority: 1 },
    {
      url: `${baseUrl}/variants`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];

  for (const manifest of listManifests()) {
    entries.push({
      url: `${baseUrl}/preview/${manifest.slug}`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.3,
    });
  }

  return entries;
}
