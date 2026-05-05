import { z } from 'zod';
import { ImageSchema, LinkSchema, LooseDateSchema, PeriodSchema, SectionBase } from './common';

export const ExperienceSchema = z.object({
  kind: z.literal('experience'),
  ...SectionBase,
  items: z.array(
    z.object({
      role: z.string(),
      organization: z.string(),
      organizationUrl: z.string().optional(),
      location: z.string().optional(),
      period: PeriodSchema,
      description: z.string().optional(),
      highlights: z.array(z.string()).optional(),
      skills: z.array(z.string()).optional(),
      logo: ImageSchema.optional(),
    }),
  ),
});
export type Experience = z.infer<typeof ExperienceSchema>;

export const EducationSchema = z.object({
  kind: z.literal('education'),
  ...SectionBase,
  items: z.array(
    z.object({
      degree: z.string(),
      field: z.string().optional(),
      institution: z.string(),
      institutionUrl: z.string().optional(),
      location: z.string().optional(),
      period: PeriodSchema,
      description: z.string().optional(),
      achievements: z.array(z.string()).optional(),
      logo: ImageSchema.optional(),
    }),
  ),
});
export type Education = z.infer<typeof EducationSchema>;

export const ProjectsSchema = z.object({
  kind: z.literal('projects'),
  ...SectionBase,
  items: z.array(
    z.object({
      name: z.string(),
      summary: z.string().optional(),
      description: z.string().optional(),
      period: PeriodSchema.optional(),
      role: z.string().optional(),
      organization: z.string().optional(),
      technologies: z.array(z.string()).optional(),
      image: ImageSchema.optional(),
      images: z.array(ImageSchema).optional(),
      links: z.array(LinkSchema).optional(),
      highlights: z.array(z.string()).optional(),
    }),
  ),
});
export type Projects = z.infer<typeof ProjectsSchema>;

export const WritingsSchema = z.object({
  kind: z.literal('writings'),
  ...SectionBase,
  items: z.array(
    z.object({
      title: z.string(),
      summary: z.string().optional(),
      excerpt: z.string().optional(),
      publication: z.string().optional(),
      publishedAt: LooseDateSchema.optional(),
      url: z.string().optional(),
      readingTimeMinutes: z.number().int().positive().optional(),
      tags: z.array(z.string()).optional(),
    }),
  ),
});
export type Writings = z.infer<typeof WritingsSchema>;

export const PublicationsSchema = z.object({
  kind: z.literal('publications'),
  ...SectionBase,
  items: z.array(
    z.object({
      title: z.string(),
      authors: z.array(z.string()).optional(),
      venue: z.string().optional(),
      publishedAt: LooseDateSchema.optional(),
      abstract: z.string().optional(),
      citation: z.string().optional(),
      doi: z.string().optional(),
      url: z.string().optional(),
      pdfUrl: z.string().optional(),
      awards: z.array(z.string()).optional(),
    }),
  ),
});
export type Publications = z.infer<typeof PublicationsSchema>;

export const TalksSchema = z.object({
  kind: z.literal('talks'),
  ...SectionBase,
  items: z.array(
    z.object({
      title: z.string(),
      venue: z.string().optional(),
      location: z.string().optional(),
      presentedAt: LooseDateSchema.optional(),
      type: z.enum(['keynote', 'workshop', 'panel', 'lightning', 'session', 'interview']).optional(),
      description: z.string().optional(),
      abstract: z.string().optional(),
      slidesUrl: z.string().optional(),
      videoUrl: z.string().optional(),
      links: z.array(LinkSchema).optional(),
    }),
  ),
});
export type Talks = z.infer<typeof TalksSchema>;

export const AwardsSchema = z.object({
  kind: z.literal('awards'),
  ...SectionBase,
  items: z.array(
    z.object({
      name: z.string(),
      organization: z.string().optional(),
      receivedAt: LooseDateSchema.optional(),
      description: z.string().optional(),
      url: z.string().optional(),
    }),
  ),
});
export type Awards = z.infer<typeof AwardsSchema>;

export const EpisodesSchema = z.object({
  kind: z.literal('episodes'),
  ...SectionBase,
  showName: z.string().optional(),
  showDescription: z.string().optional(),
  items: z.array(
    z.object({
      number: z.number().int().positive().optional(),
      title: z.string(),
      publishedAt: LooseDateSchema.optional(),
      durationMinutes: z.number().positive().optional(),
      description: z.string().optional(),
      showNotes: z.string().optional(),
      guests: z.array(z.string()).optional(),
      audioUrl: z.string().optional(),
      videoUrl: z.string().optional(),
      links: z.array(LinkSchema).optional(),
    }),
  ),
});
export type Episodes = z.infer<typeof EpisodesSchema>;

export const PatentsSchema = z.object({
  kind: z.literal('patents'),
  ...SectionBase,
  items: z.array(
    z.object({
      title: z.string(),
      number: z.string().optional(),
      status: z.enum(['granted', 'pending', 'expired']).optional(),
      filedAt: LooseDateSchema.optional(),
      grantedAt: LooseDateSchema.optional(),
      inventors: z.array(z.string()).optional(),
      assignee: z.string().optional(),
      description: z.string().optional(),
      url: z.string().optional(),
    }),
  ),
});
export type Patents = z.infer<typeof PatentsSchema>;
