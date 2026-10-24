import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { PublicView } from '@portfolio/schema';
import { experienceHead } from '~/lib/experience-head';
import { fallbackBoundary } from '~/lib/fallback-boundary';
import { requireDeploymentConfig, servedReference } from '~/server/config-store';
import { getPublicView } from '~/server/public-view';
import { CONTENT_HEADER } from '~/server/route-header';
import '~/lib/experience-styles';
import { FallbackBoundaryProvider } from '../_chrome/fallback-boundary';

// Rendered per request from the revision register() loaded at startup, so a
// build with no deployment configuration (the image's) never bakes in a
// portfolio or an origin. That includes the 404 page.
export const dynamic = 'force-dynamic';

/**
 * The public view of the live pair, or of the demo's reference on its own
 * pages, or null when the catalog can't produce one. Under `next dev` an invalid edit lands here; the layout renders
 * neutral defaults and the page's own failure reaches (site)/error.tsx.
 */
async function liveView(): Promise<PublicView | null> {
  // A page of the demo's read-only reference (#9), as proxy.ts marks it, and
  // no client can: the reference's own verified view, never the sample's.
  if ((await headers()).get(CONTENT_HEADER) === 'reference') {
    const reference = servedReference();
    if (reference) return reference.view;
  }
  try {
    return await getPublicView();
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { origin } = requireDeploymentConfig();
  const view = await liveView();
  if (!view) return { title: 'Portfolio', metadataBase: new URL(origin) };
  return experienceHead(view, origin).metadata;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { origin } = requireDeploymentConfig();
  const view = await liveView();
  const portfolio = view?.portfolio;
  const jsonLdBlocks = view ? experienceHead(view, origin).jsonLd : [];
  // The portfolio's language and writing direction, from its locale and
  // direction, and nothing else: the appearance is the document boundary's
  // (#19), which the server renders whole, so <html> carries no theme and
  // nothing changes it before hydration. The neutral defaults stand in only
  // while an invalid edit under next dev leaves no pair to read.
  return (
    <html lang={portfolio?.locale ?? 'en'} dir={portfolio?.direction ?? 'ltr'}>
      <head>
        {jsonLdBlocks.map((json, i) => (
          <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
        ))}
      </head>
      <body>
        {/* The fallback packs' boundary, which the error page renders in. */}
        <FallbackBoundaryProvider value={fallbackBoundary()}>{children}</FallbackBoundaryProvider>
      </body>
    </html>
  );
}
