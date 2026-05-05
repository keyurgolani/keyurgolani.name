import { z } from 'zod';
import { HeroSchema, LedeSchema, NowSchema } from './narrative';
import {
  ExperienceSchema,
  EducationSchema,
  ProjectsSchema,
  WritingsSchema,
  PublicationsSchema,
  TalksSchema,
  AwardsSchema,
  EpisodesSchema,
  PatentsSchema,
} from './dated-entries';
import { GallerySchema, DiscographySchema } from './visual';
import { TestimonialsSchema, PressSchema, QuoteSchema } from './quoted';
import { SkillsSchema, StackSchema, ServicesSchema } from './lists';
import { ContactSchema, CtaSchema } from './connection';
import { StatsSchema } from './accent';
import { FocusSchema, FunFactsSchema, TenureSchema } from './personal';
import { ExternalPortfoliosSchema } from './external';
import { GithubSchema } from './github';

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

export const SectionSchema = z.discriminatedUnion('kind', [
  HeroSchema,
  LedeSchema,
  NowSchema,
  ExperienceSchema,
  EducationSchema,
  ProjectsSchema,
  WritingsSchema,
  PublicationsSchema,
  TalksSchema,
  AwardsSchema,
  EpisodesSchema,
  PatentsSchema,
  GallerySchema,
  DiscographySchema,
  TestimonialsSchema,
  PressSchema,
  QuoteSchema,
  SkillsSchema,
  StackSchema,
  ServicesSchema,
  ContactSchema,
  CtaSchema,
  StatsSchema,
  FocusSchema,
  FunFactsSchema,
  TenureSchema,
  ExternalPortfoliosSchema,
  GithubSchema,
]);

export type Section = z.infer<typeof SectionSchema>;
export type SectionKind = Section['kind'];

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
