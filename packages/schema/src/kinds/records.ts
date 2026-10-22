import { z } from 'zod';
import { parseExtensionKind } from '../ids';
import { isMediaSource } from '../media-source';
import {
  IdSchema,
  LabelSchema,
  LanguageTagSchema,
  listOf,
  LooseDateSchema,
  MetricKeySchema,
  RefSchema,
  requiredList,
  SlugSchema,
  TextSchema,
  UrlSchema,
  VisibilitySchema,
  type SchemaParts,
} from './common';

// The version 3 records (#10, item 1): works, evidence, chronology entries,
// and media assets, each with a document-unique id, plus the practice and
// contact records. Profession-neutral: a field one profession needs is an
// optional typed field, not a separate kind.

/** What a work is. A content extension may add its own, as `<namespace>/<name>`. */
export const WORK_MEDIA = [
  'interface',
  'system',
  'software',
  'photography',
  'image-series',
  'writing',
  'research',
  'music',
  'audio-video',
  'object',
] as const;
export type CoreWorkMedium = (typeof WORK_MEDIA)[number];
export type WorkMedium = CoreWorkMedium | `${string}/${string}`;

export const WorkMediumSchema = z
  .string()
  .refine(
    (value) =>
      (WORK_MEDIA as readonly string[]).includes(value) || parseExtensionKind(value) !== null,
    {
      message: `should be one of: ${WORK_MEDIA.join(', ')}, or an extension's <npm package name>/<name>.`,
    },
  ) as z.ZodType<WorkMedium, z.ZodTypeDef, unknown>;

/** What a piece of evidence is. */
export const EVIDENCE_TYPES = [
  'metric',
  'testimonial',
  'publication',
  'talk',
  'award',
  'patent',
  'press',
  'exhibition',
  'client',
  'recording',
  'repository',
  'external-work',
] as const;
export const EvidenceTypeSchema = z.enum(EVIDENCE_TYPES);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

/** What a chronology entry is. */
export const CHRONOLOGY_KINDS = ['role', 'study', 'project', 'event', 'milestone'] as const;
export const ChronologyKindSchema = z.enum(CHRONOLOGY_KINDS);
export type ChronologyKind = z.infer<typeof ChronologyKindSchema>;

/** The lanes a chronology draws when entries name none of their own. */
export const DEFAULT_CHRONOLOGY_THREADS = ['work', 'study', 'creative'] as const;

/** What a media asset holds. */
export const MEDIA_KINDS = ['image', 'audio', 'video', 'document'] as const;
export const MediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof MediaKindSchema>;

/** Where an asset's file is: a path under the media root, or an https URL. */
export const MediaSourceSchema = z.string().refine(isMediaSource, {
  message:
    'must be a path under the media root, such as atlas/cover.jpg (no leading /, no . or .. segments, no \\, ?, #, or :), or an https URL.',
});

/** The icon an external-work card may name. Renderers map the name to their own icon. */
export const ExternalWorkIconSchema = z.enum([
  'camera',
  'music',
  'book',
  'palette',
  'code',
  'pen',
  'globe',
  'film',
  'mic',
  'headphones',
  'gallery',
]);
export type ExternalWorkIcon = z.infer<typeof ExternalWorkIconSchema>;

/** A talk's format. */
export const TalkFormatSchema = z.enum([
  'keynote',
  'workshop',
  'panel',
  'lightning',
  'session',
  'interview',
]);

/** A patent's status. */
export const PatentStatusSchema = z.enum(['granted', 'pending', 'expired']);

/** The parts of the practice a `practice` section shows. */
export const PRACTICE_PARTS = ['thesis', 'skills', 'tools', 'services'] as const;
export const PracticePartSchema = z.enum(PRACTICE_PARTS);
export type PracticePart = z.infer<typeof PracticePartSchema>;

export function recordSchemas({ object, Link, Placement, Period, FocalPoint }: SchemaParts) {
  const Decision = object({
    decision: TextSchema,
    rationale: TextSchema.optional(),
    alternatives: TextSchema.optional(),
  });

  /**
   * A case study, every field Markdown and optional, so each profession uses
   * the ones it has. One with none authored is refused.
   */
  const CaseStudySchema = object({
    challenge: TextSchema.optional(),
    context: TextSchema.optional(),
    role: TextSchema.optional(),
    constraints: TextSchema.optional(),
    decisions: listOf(Decision).optional(),
    evidence: TextSchema.optional(),
    outcomes: TextSchema.optional(),
    reflection: TextSchema.optional(),
  }).refine((study) => Object.keys(study).some((key) => key !== 'extensions'), {
    message: 'has no field authored. Leave caseStudy out, or write one of its fields.',
  });

  const Track = object({
    title: LabelSchema,
    durationSeconds: z.number().finite().positive().optional(),
    url: UrlSchema.optional(),
  });

  /**
   * A work: something made. Fields beyond the first few are typed and
   * optional, carried from the version 2 kinds a work can come from.
   */
  const WorkSchema = object({
    id: IdSchema,
    /** Its `/work/<slug>` route, which a case study needs. It may change; publish redirects the old one. */
    slug: SlugSchema.optional(),
    title: LabelSchema,
    medium: WorkMediumSchema,
    visibility: VisibilitySchema.optional(),
    lang: LanguageTagSchema.optional(),
    summary: TextSchema.optional(),
    description: TextSchema.optional(),
    period: Period.optional(),
    role: TextSchema.optional(),
    organization: TextSchema.optional(),
    tools: listOf(TextSchema).optional(),
    cover: Placement.optional(),
    media: listOf(Placement).optional(),
    /** Evidence ids, in the order the work cites them. */
    evidence: listOf(RefSchema).optional(),
    links: listOf(Link).optional(),
    highlights: listOf(TextSchema).optional(),
    url: UrlSchema.optional(),
    // Writing.
    excerpt: TextSchema.optional(),
    publication: TextSchema.optional(),
    publishedAt: LooseDateSchema.optional(),
    readingTimeMinutes: z.number().finite().int().positive().optional(),
    tags: listOf(TextSchema).optional(),
    // Music.
    artist: TextSchema.optional(),
    releasedAt: LooseDateSchema.optional(),
    label: TextSchema.optional(),
    tracks: listOf(Track).optional(),
    // Audio and video.
    series: TextSchema.optional(),
    number: z.number().finite().int().positive().optional(),
    durationMinutes: z.number().finite().positive().optional(),
    showNotes: TextSchema.optional(),
    guests: listOf(TextSchema).optional(),
    audioUrl: UrlSchema.optional(),
    videoUrl: UrlSchema.optional(),
    caseStudy: CaseStudySchema.optional(),
  }).superRefine((work, ctx) => {
    if (work.caseStudy !== undefined && work.slug === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['slug'],
        message: 'is required: a work with a case study gets the route /work/<slug>.',
      });
    }
  });

  const Source = object({
    name: LabelSchema,
    url: UrlSchema.optional(),
    role: TextSchema.optional(),
    organization: TextSchema.optional(),
    avatar: Placement.optional(),
  });

  const Metric = object({
    key: MetricKeySchema.optional(),
    value: z.number().finite().optional(),
    unit: TextSchema.optional(),
  }).refine(({ key, value }) => key !== undefined || value !== undefined, {
    message: 'has neither key nor value. Give it a value, or a key that names what it measures.',
  });

  const ExternalHighlight = object({ label: TextSchema, sub: TextSchema });

  /**
   * An attributable fact: a metric, a testimonial, a publication, and so on.
   * Fields past the first few are typed and optional, carried from the
   * version 2 kinds evidence can come from.
   */
  const EvidenceSchema = object({
    id: IdSchema,
    type: EvidenceTypeSchema,
    visibility: VisibilitySchema.optional(),
    lang: LanguageTagSchema.optional(),
    title: LabelSchema.optional(),
    /** The claim itself, Markdown: a testimonial's words, or what a metric counts. */
    statement: TextSchema.optional(),
    description: TextSchema.optional(),
    /** When the claim was true. */
    asOf: LooseDateSchema.optional(),
    source: Source.optional(),
    metric: Metric.optional(),
    url: UrlSchema.optional(),
    links: listOf(Link).optional(),
    // Publication.
    authors: listOf(TextSchema).optional(),
    venue: TextSchema.optional(),
    publishedAt: LooseDateSchema.optional(),
    abstract: TextSchema.optional(),
    citation: TextSchema.optional(),
    doi: TextSchema.optional(),
    pdfUrl: UrlSchema.optional(),
    awards: listOf(TextSchema).optional(),
    // Talk.
    location: TextSchema.optional(),
    presentedAt: LooseDateSchema.optional(),
    format: TalkFormatSchema.optional(),
    slidesUrl: UrlSchema.optional(),
    videoUrl: UrlSchema.optional(),
    // Award.
    organization: TextSchema.optional(),
    receivedAt: LooseDateSchema.optional(),
    // Patent.
    number: TextSchema.optional(),
    status: PatentStatusSchema.optional(),
    filedAt: LooseDateSchema.optional(),
    grantedAt: LooseDateSchema.optional(),
    inventors: listOf(TextSchema).optional(),
    assignee: TextSchema.optional(),
    // Press.
    publication: TextSchema.optional(),
    excerpt: TextSchema.optional(),
    author: TextSchema.optional(),
    // External work.
    locationLabel: TextSchema.optional(),
    categories: listOf(TextSchema).optional(),
    highlights: listOf(ExternalHighlight).optional(),
    urlLabel: TextSchema.optional(),
    buttonText: TextSchema.optional(),
    iconName: ExternalWorkIconSchema.optional(),
  }).superRefine((evidence, ctx) => {
    if (
      evidence.title === undefined &&
      evidence.statement === undefined &&
      evidence.metric === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['statement'],
        message: 'is required when the evidence has no title and no metric: nothing would show.',
      });
    }
    if (evidence.type === 'testimonial') {
      if (evidence.statement === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['statement'],
          message: "is required for a testimonial: it's what was said.",
        });
      }
      if (evidence.source === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['source'],
          message: 'is required for a testimonial: it names who said it.',
        });
      }
    }
  });

  /** An entry in the authored chronology: a role, a study, a project, an event, or a milestone. */
  const ChronologyEntrySchema = object({
    id: IdSchema,
    kind: ChronologyKindSchema,
    title: LabelSchema,
    period: Period,
    visibility: VisibilitySchema.optional(),
    lang: LanguageTagSchema.optional(),
    organization: TextSchema.optional(),
    organizationUrl: UrlSchema.optional(),
    location: TextSchema.optional(),
    field: TextSchema.optional(),
    description: TextSchema.optional(),
    highlights: listOf(TextSchema).optional(),
    achievements: listOf(TextSchema).optional(),
    skills: listOf(TextSchema).optional(),
    logo: Placement.optional(),
    /** The lane it runs in, such as work, study, or creative. Never inferred. */
    thread: IdSchema.optional(),
    /** A chronology entry this one branches from, or merges into. */
    branchesFrom: RefSchema.optional(),
    mergesInto: RefSchema.optional(),
    /** Works it produced, by id. */
    works: listOf(RefSchema).optional(),
  });

  /**
   * A media asset: an image, audio, video, or document, by a stable id. Its
   * derived record (dimensions, renditions) is the unit's media document's.
   */
  const MediaAssetSchema = object({
    id: IdSchema,
    kind: MediaKindSchema,
    source: MediaSourceSchema,
    visibility: VisibilitySchema.optional(),
    alt: TextSchema.optional(),
    credit: TextSchema.optional(),
    focalPoint: FocalPoint.optional(),
    decorative: z.boolean().optional(),
  }).refine(({ alt, decorative }) => !(decorative === true && alt !== undefined), {
    message: 'has alt text and decorative: true. Keep one: decoration takes no alt text.',
  });

  const SkillGroup = object({
    name: LabelSchema.optional(),
    description: TextSchema.optional(),
    items: requiredList(TextSchema),
  });
  const ToolGroup = object({
    name: LabelSchema.optional(),
    description: TextSchema.optional(),
    items: requiredList(
      object({ name: LabelSchema, url: UrlSchema.optional(), version: TextSchema.optional() }),
    ),
  });
  const ServiceGroup = object({
    name: LabelSchema.optional(),
    description: TextSchema.optional(),
    items: requiredList(
      object({
        name: LabelSchema,
        description: TextSchema.optional(),
        pricing: TextSchema.optional(),
        url: UrlSchema.optional(),
        highlights: listOf(TextSchema).optional(),
      }),
    ),
  });

  /** The practice: one authored thesis, and ordered groups of skills, tools, and services. */
  const PracticeSchema = object({
    thesis: TextSchema.optional(),
    skills: listOf(SkillGroup).optional(),
    tools: listOf(ToolGroup).optional(),
    services: listOf(ServiceGroup).optional(),
  }).refine((practice) => Object.keys(practice).some((key) => key !== 'extensions'), {
    message: 'has no part authored. Leave practice out, or write its thesis or a group.',
  });

  const ContactSchema = object({
    message: TextSchema.optional(),
    links: listOf(Link).optional(),
    showAvailability: z.boolean().optional(),
  }).refine(({ message, links }) => message !== undefined || links !== undefined, {
    message: 'has no message and no links, so nothing would show. Leave contact out instead.',
  });

  return {
    CaseStudySchema,
    WorkSchema,
    EvidenceSchema,
    ChronologyEntrySchema,
    MediaAssetSchema,
    PracticeSchema,
    ContactSchema,
  };
}

type Schemas = ReturnType<typeof recordSchemas>;
export type CaseStudy = z.infer<Schemas['CaseStudySchema']>;
export type Work = z.infer<Schemas['WorkSchema']>;
export type Evidence = z.infer<Schemas['EvidenceSchema']>;
export type ChronologyEntry = z.infer<Schemas['ChronologyEntrySchema']>;
export type MediaAsset = z.infer<Schemas['MediaAssetSchema']>;
export type Practice = z.infer<Schemas['PracticeSchema']>;
export type Contact = z.infer<Schemas['ContactSchema']>;
