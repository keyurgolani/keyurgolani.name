import type { Extensions } from '../extensions';
import type { SchemaParts } from './common';
import { narrativeSchemas, type Hero, type Lede, type Now } from './narrative';
import {
  datedEntrySchemas,
  type Awards,
  type Education,
  type Episodes,
  type Experience,
  type Patents,
  type Projects,
  type Publications,
  type Talks,
  type Writings,
} from './dated-entries';
import { visualSchemas, type Discography, type Gallery } from './visual';
import { quotedSchemas, type Press, type Quote, type Testimonials } from './quoted';
import { listSchemas, type Services, type Skills, type Stack } from './lists';
import { connectionSchemas, type Contact, type Cta } from './connection';
import { accentSchemas, type Stats } from './accent';
import { personalSchemas, type Focus, type FunFacts, type Tenure } from './personal';
import { externalSchemas, type ExternalPortfolios } from './external';
import { githubSchemas, type Github } from './github';

export * from './common';
export * from './narrative';
export * from './dated-entries';
export * from './visual';
export * from './quoted';
export * from './lists';
export * from './connection';
export * from './accent';
export * from './personal';
export * from './external';
export * from './github';

/** Every core kind's schema for one set of parts. */
export function coreSectionSchemas(parts: SchemaParts) {
  const { ExternalPortfolioItemSchema, ExternalPortfoliosSchema } = externalSchemas(parts);
  return {
    sections: [
      ...Object.values(narrativeSchemas(parts)),
      ...Object.values(datedEntrySchemas(parts)),
      ...Object.values(visualSchemas(parts)),
      ...Object.values(quotedSchemas(parts)),
      ...Object.values(listSchemas(parts)),
      ...Object.values(connectionSchemas(parts)),
      ...Object.values(accentSchemas(parts)),
      ...Object.values(personalSchemas(parts)),
      ExternalPortfoliosSchema,
      ...Object.values(githubSchemas(parts)),
    ],
    ExternalPortfolioItemSchema,
  };
}

/** A section of one of the 28 core kinds. */
export type CoreSection =
  | Hero
  | Lede
  | Now
  | Experience
  | Education
  | Projects
  | Writings
  | Publications
  | Talks
  | Awards
  | Episodes
  | Patents
  | Gallery
  | Discography
  | Testimonials
  | Press
  | Quote
  | Skills
  | Stack
  | Services
  | Contact
  | Cta
  | Stats
  | Focus
  | FunFacts
  | Tenure
  | ExternalPortfolios
  | Github;

/**
 * A section of a kind a content extension adds, `<package name>/<name>`. A
 * registered extension checks `data`; any other is kept as plain JSON.
 */
export interface ExtensionSection {
  kind: `${string}/${string}`;
  id: string;
  title?: string;
  subtitle?: string;
  lang?: string;
  extensions?: Extensions;
  data: unknown;
}

export type Section = CoreSection | ExtensionSection;
export type SectionKind = CoreSection['kind'];

export const ALL_SECTION_KINDS: readonly SectionKind[] = [
  'hero',
  'lede',
  'now',
  'experience',
  'education',
  'projects',
  'writings',
  'publications',
  'talks',
  'awards',
  'episodes',
  'patents',
  'gallery',
  'discography',
  'testimonials',
  'press',
  'quote',
  'skills',
  'stack',
  'services',
  'contact',
  'cta',
  'stats',
  'focus',
  'fun-facts',
  'tenure',
  'external-portfolios',
  'github',
] as const;
