import { renderRssFeed } from '@portfolio/kit/seo';
import { loadPortfolio } from '~/lib/portfolio';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { portfolio } = await loadPortfolio();
    const xml = renderRssFeed(portfolio);
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    // The message can quote the portfolio file or carry its path, so it goes
    // to the server log and the public body stays fixed.
    console.error('[feed] Could not build feed:', error);
    return new Response('Feed unavailable', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
