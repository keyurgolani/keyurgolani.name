import { renderRssFeed } from '@portfolio/kit/seo';
import { requireDeploymentConfig } from '~/server/config-store';
import { getPublicView } from '~/server/public-view';
import { served } from '~/server/route-guard';

export const dynamic = 'force-dynamic';

async function feed(request: Request): Promise<Response> {
  try {
    const { origin } = requireDeploymentConfig();
    const { portfolio } = await getPublicView();
    const xml = renderRssFeed(portfolio, { siteUrl: origin });
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    // The public body stays fixed; the cause goes to the server log only.
    console.error('[feed] Could not build the feed:', error);
    // proxy.ts sets a fresh request ID on every request.
    const requestId = request.headers.get('x-request-id') ?? 'none';
    return new Response(`Feed unavailable. Request ID: ${requestId}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

export const GET = served('/feed.xml', feed);
