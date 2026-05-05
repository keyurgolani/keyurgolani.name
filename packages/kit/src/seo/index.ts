export * from './feed';

/**
 * Structured-data builder — produces Schema.org JSON-LD from a Portfolio.
 *
 * Returns an array of distinct schemas (ProfilePage, Person, WebSite). Hosts
 * render each as a separate `<script type="application/ld+json">` element
 * in <head>. Splitting the schemas (rather than nesting Person inside
 * ProfilePage's mainEntity) keeps each one validatable on its own and lets
 * search engines pick the one most useful for a given query.
 *
 * Inference, in order of fallback:
 *   - `jobTitle`       → first ongoing experience item's role
 *   - `worksFor`       → first ongoing experience item's organization
 *   - `alumniOf`       → first education item's institution
 *   - `knowsAbout`     → flattened skills.items + skills.groups[].items
 *                        (falls back to stack.groups[].items[].name)
 *   - `sameAs`         → portfolio.links[] URLs (excluding mailto/tel)
 */

import type {
  Portfolio,
  Section,
  Experience,
  Education,
  Skills,
  Stack,
} from '@portfolio/schema';

export interface JsonLd {
  '@context': string;
  '@type': string;
  [key: string]: unknown;
}

export function buildStructuredData(portfolio: Portfolio): JsonLd[] {
  const out: JsonLd[] = [];
  out.push(buildPersonSchema(portfolio));
  out.push(buildProfilePageSchema(portfolio));
  const website = buildWebsiteSchema(portfolio);
  if (website) out.push(website);
  return out;
}

function buildPersonSchema(portfolio: Portfolio): JsonLd {
  const { identity, links, sections, meta } = portfolio;

  const person: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: identity.name,
  };

  const tagline = identity.tagline ?? meta?.description;
  if (tagline) person.description = tagline;

  if (meta?.url) person.url = meta.url;
  if (identity.avatar?.src) person.image = identity.avatar.src;
  if (identity.email) person.email = identity.email;

  const ongoing = findFirstOngoingExperience(sections);
  if (ongoing) {
    if (ongoing.role) person.jobTitle = ongoing.role;
    if (ongoing.organization) {
      person.worksFor = {
        '@type': 'Organization',
        name: ongoing.organization,
        ...(ongoing.organizationUrl ? { url: ongoing.organizationUrl } : {}),
      };
    }
  }

  const education = findFirstEducationItem(sections);
  if (education) {
    person.alumniOf = {
      '@type': 'EducationalOrganization',
      name: education.institution,
      ...(education.institutionUrl ? { url: education.institutionUrl } : {}),
    };
  }

  const knowsAbout = collectKnowsAbout(sections);
  if (knowsAbout.length > 0) person.knowsAbout = knowsAbout;

  const sameAs = collectSameAs(links);
  if (sameAs.length > 0) person.sameAs = sameAs;

  return person;
}

function buildProfilePageSchema(portfolio: Portfolio): JsonLd {
  const { identity, meta } = portfolio;
  const profile: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    name: meta?.title ?? `${identity.name} — Portfolio`,
    mainEntity: {
      '@type': 'Person',
      name: identity.name,
      ...(meta?.url ? { url: meta.url } : {}),
    },
  };
  if (meta?.description) profile.description = meta.description;
  if (meta?.url) profile.url = meta.url;
  return profile;
}

function buildWebsiteSchema(portfolio: Portfolio): JsonLd | null {
  if (!portfolio.meta?.url) return null;
  const site: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: portfolio.meta.title ?? `${portfolio.identity.name} — Portfolio`,
    url: portfolio.meta.url,
    author: {
      '@type': 'Person',
      name: portfolio.identity.name,
    },
  };
  if (portfolio.meta.description) site.description = portfolio.meta.description;
  return site;
}

function findFirstOngoingExperience(
  sections: readonly Section[],
): Experience['items'][number] | null {
  for (const section of sections) {
    if (section.kind !== 'experience') continue;
    const ongoing = section.items.find((it) => !it.period.end);
    if (ongoing) return ongoing;
    if (section.items[0]) return section.items[0];
  }
  return null;
}

function findFirstEducationItem(
  sections: readonly Section[],
): Education['items'][number] | null {
  for (const section of sections) {
    if (section.kind !== 'education') continue;
    if (section.items[0]) return section.items[0];
  }
  return null;
}

function collectKnowsAbout(sections: readonly Section[]): string[] {
  const out: string[] = [];
  for (const section of sections) {
    if (section.kind === 'skills') {
      const skills = section as Skills;
      if (skills.items) out.push(...skills.items);
      if (skills.groups) {
        for (const g of skills.groups) out.push(...g.items);
      }
    }
    if (section.kind === 'stack') {
      const stack = section as Stack;
      for (const g of stack.groups) {
        for (const item of g.items) out.push(item.name);
      }
    }
  }
  return dedupe(out);
}

function collectSameAs(links: readonly { url: string }[]): string[] {
  const out: string[] = [];
  for (const link of links) {
    if (!/^https?:\/\//.test(link.url)) continue;
    out.push(link.url);
  }
  return dedupe(out);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
