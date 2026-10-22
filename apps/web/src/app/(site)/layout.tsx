import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import type { PublicView } from '@portfolio/schema';
import { themeInitScript } from '@portfolio/kit';
import { buildStructuredData } from '@portfolio/kit/seo';
import { ClientHostModules } from '~/lib/host-modules-client';
import { jsonLdScript } from '~/lib/json-ld';
import { startingTheme } from '~/lib/starting-theme';
import { requireDeploymentConfig } from '~/server/config-store';
import { getPublicView } from '~/server/public-view';
import '../globals.css';
// The shared section renderers' layout, then every registered variant's
// stylesheet, which `pnpm --filter @portfolio/web build:registry` lists.
import '@portfolio/kit/sections/styles.css';
import '~/lib/generated/registry.styles';

// Rendered per request from the revision register() loaded at startup, so a
// build with no deployment configuration (the image's) never bakes in a
// portfolio or an origin. That includes the 404 page.
export const dynamic = 'force-dynamic';

/**
 * The public view of the live pair, or null when the catalog can't produce
 * one. Under `next dev` an invalid edit lands here; the layout renders
 * neutral defaults and the page's own failure reaches (site)/error.tsx.
 */
async function liveView(): Promise<PublicView | null> {
  try {
    return await getPublicView();
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { origin } = requireDeploymentConfig();
  const portfolio = (await liveView())?.portfolio;
  if (!portfolio) return { title: 'Portfolio', metadataBase: new URL(origin) };

  const title = portfolio.meta?.title ?? `${portfolio.identity.name} — Portfolio`;
  const description = portfolio.meta?.description ?? portfolio.identity.tagline;
  return {
    title,
    description,
    authors: [{ name: portfolio.identity.name }],
    creator: portfolio.identity.name,
    metadataBase: new URL(origin),
    openGraph: {
      type: 'profile',
      title,
      description,
      siteName: title,
      url: '/',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { origin } = requireDeploymentConfig();
  const view = await liveView();
  const portfolio = view?.portfolio;
  const jsonLdBlocks = view ? buildStructuredData(view, { siteUrl: origin }).map(jsonLdScript) : [];
  // The first paint's theme, until the visitor picks one: the site's display mode.
  const initScript = themeInitScript(
    view ? startingTheme(view.site.appearance.displayMode) : 'system',
  );

  // The portfolio's language and writing direction, from its locale and
  // direction. The neutral defaults stand in only while an invalid edit
  // under next dev leaves no pair to read.
  return (
    <html
      lang={portfolio?.locale ?? 'en'}
      dir={portfolio?.direction ?? 'ltr'}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
        {jsonLdBlocks.map((json, i) => (
          <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
        ))}
      </head>
      <body>
        <ClientHostModules />
        {children}
      </body>
    </html>
  );
}
