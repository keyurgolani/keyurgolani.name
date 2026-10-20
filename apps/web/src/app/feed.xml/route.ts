import { renderRssFeed } from '@portfolio/kit/seo';
import { requireDeploymentConfig } from '~/server/config-store';
import { log } from '~/server/log';
import { getPublicView } from '~/server/public-view';
import { notFoundResponse, served } from '~/server/route-guard';

export const dynamic = 'force-dynamic';

async function feed(request: Request): Promise<Response> {
  // The step that failed, for the log line: the error can carry a path, and
  // Next never sees it, since this answers for it.
  let step: 'catalog_unavailable' | 'render_failed' = 'catalog_unavailable';
  try {
    const { origin } = requireDeploymentConfig();
    const { portfolio, site } = await getPublicView();
    // The site document turns the feed off with features.feed: false.
    if (!site.features.feed) return notFoundResponse();
    step = 'render_failed';
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
    // The body stays fixed, and the error stays out of the log. Under next
    // dev, the catalog's own config.fatal lines say why.
    log({ level: 'error', event: 'feed.failed', code: step, route: '/feed.xml', requestId });
    return new Response(`Feed unavailable. Request ID: ${requestId}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

export const GET = served('/feed.xml', feed);
