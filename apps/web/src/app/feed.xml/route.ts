import { renderRssFeed } from '@portfolio/kit/seo';
import { requireDeploymentConfig } from '~/server/config-store';
import { log } from '~/server/log';
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
  } catch {
    // proxy.ts sets a fresh request ID on every request.
    const requestId = request.headers.get('x-request-id') ?? 'none';
    // The body stays fixed, and the error stays out of the log: it can carry
    // a path. Under next dev, the catalog's own config.fatal lines say why.
    log({ level: 'error', event: 'feed.failed', route: '/feed.xml', requestId });
    return new Response(`Feed unavailable. Request ID: ${requestId}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

export const GET = served('/feed.xml', feed);
