import { z } from 'zod';
import { LooseDateSchema, UrlSchema, type SchemaParts } from './common';

export function datedEntrySchemas({ object, section, Image, Link, Period }: SchemaParts) {
  const ExperienceSchema = section('experience', {
    items: z.array(
      object({
        role: z.string(),
        organization: z.string(),
        organizationUrl: UrlSchema.optional(),
        location: z.string().optional(),
        period: Period,
        description: z.string().optional(),
        highlights: z.array(z.string()).optional(),
        skills: z.array(z.string()).optional(),
        logo: Image.optional(),
      }),
    ),
  });

  const EducationSchema = section('education', {
    items: z.array(
      object({
        degree: z.string(),
        field: z.string().optional(),
        institution: z.string(),
        institutionUrl: UrlSchema.optional(),
        location: z.string().optional(),
        period: Period,
        description: z.string().optional(),
        achievements: z.array(z.string()).optional(),
        logo: Image.optional(),
      }),
    ),
  });

  const ProjectsSchema = section('projects', {
    items: z.array(
      object({
        name: z.string(),
        summary: z.string().optional(),
        description: z.string().optional(),
        period: Period.optional(),
        role: z.string().optional(),
        organization: z.string().optional(),
        technologies: z.array(z.string()).optional(),
        image: Image.optional(),
        images: z.array(Image).optional(),
        links: z.array(Link).optional(),
        highlights: z.array(z.string()).optional(),
      }),
    ),
  });

  const WritingsSchema = section('writings', {
    items: z.array(
      object({
        title: z.string(),
        summary: z.string().optional(),
        excerpt: z.string().optional(),
        publication: z.string().optional(),
        publishedAt: LooseDateSchema.optional(),
        url: UrlSchema.optional(),
        readingTimeMinutes: z.number().int().positive().optional(),
        tags: z.array(z.string()).optional(),
      }),
    ),
  });

  const PublicationsSchema = section('publications', {
    items: z.array(
      object({
        title: z.string(),
        authors: z.array(z.string()).optional(),
        venue: z.string().optional(),
        publishedAt: LooseDateSchema.optional(),
        abstract: z.string().optional(),
        citation: z.string().optional(),
        doi: z.string().optional(),
        url: UrlSchema.optional(),
        pdfUrl: UrlSchema.optional(),
        awards: z.array(z.string()).optional(),
      }),
    ),
  });

  const TalksSchema = section('talks', {
    items: z.array(
      object({
        title: z.string(),
        venue: z.string().optional(),
        location: z.string().optional(),
        presentedAt: LooseDateSchema.optional(),
        type: z
          .enum(['keynote', 'workshop', 'panel', 'lightning', 'session', 'interview'])
          .optional(),
        description: z.string().optional(),
        abstract: z.string().optional(),
        slidesUrl: UrlSchema.optional(),
        videoUrl: UrlSchema.optional(),
        links: z.array(Link).optional(),
      }),
    ),
  });

  const AwardsSchema = section('awards', {
    items: z.array(
      object({
        name: z.string(),
        organization: z.string().optional(),
        receivedAt: LooseDateSchema.optional(),
        description: z.string().optional(),
        url: UrlSchema.optional(),
      }),
    ),
  });

  const EpisodesSchema = section('episodes', {
    showName: z.string().optional(),
    showDescription: z.string().optional(),
    items: z.array(
      object({
        number: z.number().int().positive().optional(),
        title: z.string(),
        publishedAt: LooseDateSchema.optional(),
        durationMinutes: z.number().positive().optional(),
        description: z.string().optional(),
        showNotes: z.string().optional(),
        guests: z.array(z.string()).optional(),
        audioUrl: UrlSchema.optional(),
        videoUrl: UrlSchema.optional(),
        links: z.array(Link).optional(),
      }),
    ),
  });

  const PatentsSchema = section('patents', {
    items: z.array(
      object({
        title: z.string(),
        number: z.string().optional(),
        status: z.enum(['granted', 'pending', 'expired']).optional(),
        filedAt: LooseDateSchema.optional(),
        grantedAt: LooseDateSchema.optional(),
        inventors: z.array(z.string()).optional(),
        assignee: z.string().optional(),
        description: z.string().optional(),
        url: UrlSchema.optional(),
      }),
    ),
  });

  return {
    ExperienceSchema,
    EducationSchema,
    ProjectsSchema,
    WritingsSchema,
    PublicationsSchema,
    TalksSchema,
    AwardsSchema,
    EpisodesSchema,
    PatentsSchema,
  };
}

type Schemas = ReturnType<typeof datedEntrySchemas>;
export type Experience = z.infer<Schemas['ExperienceSchema']>;
export type Education = z.infer<Schemas['EducationSchema']>;
export type Projects = z.infer<Schemas['ProjectsSchema']>;
export type Writings = z.infer<Schemas['WritingsSchema']>;
export type Publications = z.infer<Schemas['PublicationsSchema']>;
export type Talks = z.infer<Schemas['TalksSchema']>;
export type Awards = z.infer<Schemas['AwardsSchema']>;
export type Episodes = z.infer<Schemas['EpisodesSchema']>;
export type Patents = z.infer<Schemas['PatentsSchema']>;
