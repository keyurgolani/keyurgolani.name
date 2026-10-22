import type { Metadata } from 'next';
import type { PublicView } from '@portfolio/schema';
import { buildStructuredData } from '@portfolio/kit/seo';
import { jsonLdScript } from './json-ld';

// The head of a portfolio document (#7, Slice 1, item 2): its title,
// description, and share metadata, and its JSON-LD, all from the unit it
// renders. The site's layout gives it the live revision's public view, and a
// preview's layout the previewed unit's, so a preview's head is the
// previewed portfolio's, never the live one's.

export interface ExperienceHead {
  /** What the document's metadata export returns. */
  readonly metadata: Metadata;
  /** Each JSON-LD block, serialized for an inline <script type="application/ld+json">. */
  readonly jsonLd: readonly string[];
}

/** The head for `unit`, with every absolute URL on `origin`, the deployment's canonical origin. */
export function experienceHead(unit: PublicView, origin: string): ExperienceHead {
  const { portfolio } = unit;
  const title = portfolio.meta?.title ?? `${portfolio.identity.name} — Portfolio`;
  const description = portfolio.meta?.description ?? portfolio.identity.tagline;
  return {
    metadata: {
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
    },
    jsonLd: buildStructuredData(unit, { siteUrl: origin }).map(jsonLdScript),
  };
}
