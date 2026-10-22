export * from './feed';

/**
 * Structured data: Schema.org JSON-LD from the published view (#10).
 *
 * Returns an array of distinct schemas (Person, ProfilePage, WebSite). Hosts
 * render each as a separate `<script type="application/ld+json">` element
 * in <head>. Splitting the schemas (rather than nesting Person inside
 * ProfilePage's mainEntity) keeps each one validatable on its own and lets
 * search engines pick the one most useful for a given query.
 *
 * It reads only the published view, so nothing hidden or private reaches it.
 * Each value comes from the owner's records:
 *   - `jobTitle`, `worksFor` the first ongoing role in the chronology, else the first role
 *   - `alumniOf`             the first study in the chronology with an organization
 *   - `knowsAbout`           the practice's skills, else its tools
 *   - `sameAs`               the portfolio's http(s) links
 *   - `image`                the avatar's rendition, once it has one
 *   - `workExample`          the signature and featured works, each with an
 *                            `@id` made from its record id
 * #22 (published metadata) owns the rest.
 */

import type { ChronologyEntry, PublicView } from '@portfolio/schema';
import { worksByIds } from '../sections/view';

export interface JsonLd {
  '@context': string;
  '@type': string;
  [key: string]: unknown;
}

export interface StructuredDataOptions {
  /** The site's canonical origin, from the deployment. Without it no block carries a URL. */
  siteUrl?: string;
}

/** What the structured data reads: the published view's portfolio and media. */
export type StructuredDataSource = Pick<PublicView, 'portfolio' | 'media'>;

/** Takes the published view only, so nothing hidden or private reaches the JSON-LD. */
export function buildStructuredData(
  view: StructuredDataSource,
  options: StructuredDataOptions = {},
): JsonLd[] {
  const url = options.siteUrl?.replace(/\/$/, '');
  const out: JsonLd[] = [];
  out.push(buildPersonSchema(view, url));
  out.push(buildProfilePageSchema(view, url));
  const website = buildWebsiteSchema(view, url);
  if (website) out.push(website);
  return out;
}

/** A record's JSON-LD id: the site's URL and the record's id, the anchor it has on the page. */
export function recordJsonLdId(url: string, id: string): string {
  return `${url}/#${id}`;
}

function buildPersonSchema(view: StructuredDataSource, url: string | undefined): JsonLd {
  const { identity, links, meta, chronology } = view.portfolio;

  const person: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: identity.name,
  };

  const tagline = identity.tagline ?? meta?.description;
  if (tagline) person.description = tagline;

  if (url) person.url = url;
  const image = avatarUrl(view, url);
  if (image) person.image = image;
  if (identity.email) person.email = identity.email;

  const role = currentRole(chronology);
  if (role) {
    person.jobTitle = role.title;
    if (role.organization) {
      person.worksFor = {
        '@type': 'Organization',
        name: role.organization,
        ...(role.organizationUrl ? { url: role.organizationUrl } : {}),
      };
    }
  }

  const study = chronology.find((entry) => entry.kind === 'study' && entry.organization);
  if (study?.organization) {
    person.alumniOf = {
      '@type': 'EducationalOrganization',
      name: study.organization,
      ...(study.organizationUrl ? { url: study.organizationUrl } : {}),
    };
  }

  const knowsAbout = collectKnowsAbout(view);
  if (knowsAbout.length > 0) person.knowsAbout = knowsAbout;

  const sameAs = collectSameAs(links);
  if (sameAs.length > 0) person.sameAs = sameAs;

  if (url) {
    const { signature, featured } = view.portfolio;
    const works = worksByIds([...(signature ? [signature] : []), ...featured], view);
    if (works.length > 0) {
      person.workExample = works.map((work) => ({
        '@type': 'CreativeWork',
        '@id': recordJsonLdId(url, work.id),
        name: work.title,
        ...(work.url ? { url: work.url } : {}),
      }));
    }
  }

  return person;
}

function buildProfilePageSchema(view: StructuredDataSource, url: string | undefined): JsonLd {
  const { identity, meta } = view.portfolio;
  const profile: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    name: meta?.title ?? `${identity.name} — Portfolio`,
    mainEntity: {
      '@type': 'Person',
      name: identity.name,
      ...(url ? { url } : {}),
    },
  };
  if (meta?.description) profile.description = meta.description;
  if (url) profile.url = url;
  return profile;
}

function buildWebsiteSchema(view: StructuredDataSource, url: string | undefined): JsonLd | null {
  if (!url) return null;
  const { identity, meta } = view.portfolio;
  const site: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: meta?.title ?? `${identity.name} — Portfolio`,
    url,
    author: {
      '@type': 'Person',
      name: identity.name,
    },
  };
  if (meta?.description) site.description = meta.description;
  return site;
}

/** The avatar's widest image rendition, as an absolute URL, once it has one. */
function avatarUrl(view: StructuredDataSource, url: string | undefined): string | undefined {
  const asset = view.portfolio.identity.avatar?.asset;
  const media =
    asset !== undefined && Object.hasOwn(view.media, asset) ? view.media[asset] : undefined;
  if (!url || media?.derived.state !== 'ready') return undefined;
  const [widest] = media.derived.value.renditions
    .filter(({ mime }) => mime.startsWith('image/'))
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return widest ? new URL(widest.url, `${url}/`).href : undefined;
}

/** The first role still going, else the first role, in the chronology's order. */
function currentRole(chronology: readonly ChronologyEntry[]): ChronologyEntry | undefined {
  const roles = chronology.filter((entry) => entry.kind === 'role');
  return (
    roles.find(
      (entry) =>
        entry.period.end === undefined || /^(?:present|now|current)$/i.test(entry.period.end),
    ) ?? roles[0]
  );
}

function collectKnowsAbout(view: StructuredDataSource): string[] {
  const { practice } = view.portfolio;
  const skills = (practice?.skills ?? []).flatMap((group) => group.items);
  const known =
    skills.length > 0
      ? skills
      : (practice?.tools ?? []).flatMap((group) => group.items.map((item) => item.name));
  return dedupe(known);
}

function collectSameAs(links: readonly { url: string }[]): string[] {
  return dedupe(links.filter((link) => /^https?:\/\//.test(link.url)).map((link) => link.url));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
