import type { Metadata } from 'next';
import type { PublicView } from '@portfolio/schema';
import { buildStructuredData } from '@portfolio/kit/seo';
import { INDEXABLE } from '~/server/capabilities';
import { requireDeploymentConfig } from '~/server/config-store';
import { jsonLdScript } from './json-ld';

// The head of a portfolio document (#7, Slice 1, item 2; #22): its title,
// description, and share metadata, and its JSON-LD, all from the unit it
// renders. The site's layout gives it the live revision's public view, and a
// preview's layout the previewed unit's, so a preview's head is the
// previewed portfolio's, never the live one's.
//
// Every absolute URL is on `origin`, the deployment's PORTFOLIO_ORIGIN,
// never a Host header, a forwarded header, or the content. `og:url` names
// the route's canonical path only when the caller gives one: a visitor page
// at the site root does (its canonical link names the same path), and a
// preview frame or a /sample page doesn't, since neither is a route on the
// live site. Under a profile that isn't indexable, demo, no JSON-LD goes
// out at all: the bundled sample can't pass for a real person.

export interface ExperienceHead {
  /** What the document's metadata export returns. */
  readonly metadata: Metadata;
  /** Each JSON-LD block, serialized for an inline <script type="application/ld+json">. */
  readonly jsonLd: readonly string[];
}

export interface ExperienceHeadOptions {
  /** The route's canonical path on the live site, such as `/` or `/work/<slug>`, with no query. */
  readonly path?: string;
  /** Whether the deployment's profile is indexable. The deployment's own by default. */
  readonly indexable?: boolean;
}

/** The deployment's indexability, which only a configured deployment has. */
function deploymentIndexable(): boolean {
  return INDEXABLE[requireDeploymentConfig().profile];
}

/** A canonical path: a path on the site, with no query or fragment, or none. */
function canonicalPath(path: string | undefined): string | undefined {
  if (path === undefined || !path.startsWith('/') || path.startsWith('//')) return undefined;
  return path.replace(/[?#].*$/, '');
}

/** The head for `unit`, with every absolute URL on `origin`, the deployment's canonical origin. */
export function experienceHead(
  unit: PublicView,
  origin: string,
  options: ExperienceHeadOptions = {},
): ExperienceHead {
  const { portfolio } = unit;
  const title = portfolio.meta?.title ?? `${portfolio.identity.name} — Portfolio`;
  const description = portfolio.meta?.description ?? portfolio.identity.tagline;
  const path = canonicalPath(options.path);
  const indexable = options.indexable ?? deploymentIndexable();
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
        ...(path === undefined ? {} : { url: path }),
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
      },
    },
    jsonLd: indexable ? buildStructuredData(unit, { siteUrl: origin }).map(jsonLdScript) : [],
  };
}
