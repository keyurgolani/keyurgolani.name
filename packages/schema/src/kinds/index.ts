import type { Extensions } from '../extensions';
import type { SchemaParts } from './common';
import {
  sectionSchemas,
  type ChronologySection,
  type ContactSection,
  type Cta,
  type CustomSection,
  type EvidenceSection,
  type Focus,
  type FunFacts,
  type Github,
  type Hero,
  type Lede,
  type Now,
  type PracticeSection,
  type Quote,
  type WorksSection,
} from './sections';

export * from './common';
export * from './records';
export * from './sections';

/** Every core kind's schema for one set of parts. */
export function coreSectionSchemas(parts: SchemaParts) {
  return { sections: Object.values(sectionSchemas(parts)) };
}

/** A section of one of the 14 core kinds. */
export type CoreSection =
  | WorksSection
  | EvidenceSection
  | ChronologySection
  | PracticeSection
  | ContactSection
  | CustomSection
  | Hero
  | Lede
  | Now
  | Quote
  | Focus
  | FunFacts
  | Cta
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

/**
 * The version 3 core section kinds, in the order the docs list them. The
 * skills' sync check reads this literal.
 */
export const ALL_SECTION_KINDS: readonly SectionKind[] = [
  'works',
  'evidence',
  'chronology',
  'practice',
  'contact',
  'custom',
  'hero',
  'lede',
  'now',
  'quote',
  'focus',
  'fun-facts',
  'cta',
  'github',
] as const;

/** The version 3 core section kinds: the same list as ALL_SECTION_KINDS. */
export const CORE_SECTION_KINDS: readonly SectionKind[] = ALL_SECTION_KINDS;

/** The kinds that list record ids in `items`, and the record each lists. */
export const RECORD_SECTION_KINDS = {
  works: 'work',
  evidence: 'evidence',
  chronology: 'chronology',
} as const satisfies Partial<Record<SectionKind, string>>;
