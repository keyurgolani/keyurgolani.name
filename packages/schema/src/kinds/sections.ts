import { z } from 'zod';
import {
  LabelSchema,
  listOf,
  LooseDateSchema,
  RefSchema,
  requiredList,
  TextSchema,
  UrlSchema,
  type SchemaParts,
} from './common';
import { PracticePartSchema } from './records';

// The version 3 section kinds (#10, item 1). A section places content in the
// reading order: `works`, `evidence`, and `chronology` list record ids,
// `practice` shows one part of the practice, `contact` places the contact
// record, and `custom` carries its own content. The eight kinds below them
// are unchanged from version 2, apart from the authored-absence rule.

export function sectionSchemas({ object, section, Link, Action, Placement }: SchemaParts) {
  /** Works by id, in reading order. */
  const WorksSectionSchema = section('works', { items: requiredList(RefSchema) });

  /** Evidence by id, in reading order. */
  const EvidenceSectionSchema = section('evidence', { items: requiredList(RefSchema) });

  /** Chronology entries by id. Without `items`, every public entry, newest first. */
  const ChronologySectionSchema = section('chronology', { items: listOf(RefSchema).optional() });

  /** One part of the practice: its thesis, skills, tools, or services. */
  const PracticeSectionSchema = section('practice', { part: PracticePartSchema });

  /** Where the contact record shows. */
  const ContactSectionSchema = section('contact', {});

  /** Content no other kind holds. It always renders in the shared fallback. */
  const CustomSectionSchema = section('custom', {
    title: LabelSchema,
    body: TextSchema.optional(),
    items: listOf(
      object({
        title: LabelSchema,
        summary: TextSchema.optional(),
        media: listOf(Placement).optional(),
        evidence: listOf(RefSchema).optional(),
        links: listOf(Link).optional(),
      }),
    ).optional(),
  });

  // The eight unchanged kinds.

  const HeroSchema = section('hero', {
    greeting: TextSchema.optional(),
    name: LabelSchema.optional(),
    tagline: TextSchema.optional(),
    subtagline: TextSchema.optional(),
    ctas: listOf(Action).optional(),
  });

  const LedeSchema = section('lede', { body: TextSchema });

  const NowSchema = section('now', {
    asOf: LooseDateSchema.optional(),
    body: TextSchema,
  });

  const QuoteSchema = section('quote', {
    text: TextSchema,
    attribution: TextSchema.optional(),
    source: TextSchema.optional(),
    sourceUrl: UrlSchema.optional(),
  });

  /** The few things the author is putting energy into now. */
  const FocusSchema = section('focus', { items: requiredList(TextSchema) });

  /** Playful personal details. */
  const FunFactsSchema = section('fun-facts', { items: requiredList(TextSchema) });

  const CtaSchema = section('cta', {
    description: TextSchema.optional(),
    primaryAction: Action.optional(),
    secondaryAction: Action.optional(),
  });

  /**
   * GitHub: configuration only. What it shows comes from the publish-frozen
   * snapshot at snapshots/github.json, never from a fetch at render time.
   */
  const GithubSchema = section('github', {
    username: z.string().min(1),
    /** Show the 53-week contribution heatmap. */
    showContributionGraph: z.boolean().default(true),
    /** Show pinned repositories (up to 6). */
    showPinnedRepos: z.boolean().default(true),
    /** Show the total stars-given counter. */
    showTotalStars: z.boolean().default(true),
    /** Show a per-language breakdown. */
    showLanguageBreakdown: z.boolean().default(false),
    /** Show a list of repositories most recently pushed to. */
    showRecentlyActive: z.boolean().default(true),
    /** Number of repositories to show in the recently-active list (1-20). */
    recentlyActiveLimit: z.number().finite().int().min(1).max(20).default(10),
    /** Repository names to feature even if they aren't pinned. */
    featuredRepos: z.array(z.string()).default([]),
    /** Repository names to suppress from listings. */
    excludeRepos: z.array(z.string()).default([]),
  });

  return {
    WorksSectionSchema,
    EvidenceSectionSchema,
    ChronologySectionSchema,
    PracticeSectionSchema,
    ContactSectionSchema,
    CustomSectionSchema,
    HeroSchema,
    LedeSchema,
    NowSchema,
    QuoteSchema,
    FocusSchema,
    FunFactsSchema,
    CtaSchema,
    GithubSchema,
  };
}

type Schemas = ReturnType<typeof sectionSchemas>;
export type WorksSection = z.infer<Schemas['WorksSectionSchema']>;
export type EvidenceSection = z.infer<Schemas['EvidenceSectionSchema']>;
export type ChronologySection = z.infer<Schemas['ChronologySectionSchema']>;
export type PracticeSection = z.infer<Schemas['PracticeSectionSchema']>;
export type ContactSection = z.infer<Schemas['ContactSectionSchema']>;
export type CustomSection = z.infer<Schemas['CustomSectionSchema']>;
export type CustomItem = NonNullable<CustomSection['items']>[number];
export type Hero = z.infer<Schemas['HeroSchema']>;
export type Lede = z.infer<Schemas['LedeSchema']>;
export type Now = z.infer<Schemas['NowSchema']>;
export type Quote = z.infer<Schemas['QuoteSchema']>;
export type Focus = z.infer<Schemas['FocusSchema']>;
export type FunFacts = z.infer<Schemas['FunFactsSchema']>;
export type Cta = z.infer<Schemas['CtaSchema']>;
export type Github = z.infer<Schemas['GithubSchema']>;
