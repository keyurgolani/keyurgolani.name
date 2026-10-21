import type { CoreRenderers } from '../types';
import { ContactSection, CtaSection } from './connection';
import {
  AwardsSection,
  EducationSection,
  EpisodesSection,
  ExperienceSection,
  PatentsSection,
  ProjectsSection,
  PublicationsSection,
  TalksSection,
  WritingsSection,
} from './dated-entries';
import {
  ExternalPortfoliosSection,
  FocusSection,
  FunFactsSection,
  GithubSection,
  StatsSection,
  TenureSection,
} from './figures';
import { ServicesSection, SkillsSection, StackSection } from './lists';
import { HeroSection, LedeSection, NowSection } from './narrative';
import { PressSection, QuoteSection, TestimonialsSection } from './quoted';
import { DiscographySection, GallerySection } from './visual';

/**
 * The shared renderer of every core kind. renderSection() uses one for each
 * kind a variant doesn't render bespoke or skip, and a variant may call one
 * from its own renderer.
 */
export const SHARED_RENDERERS: CoreRenderers = {
  hero: HeroSection,
  lede: LedeSection,
  now: NowSection,
  experience: ExperienceSection,
  education: EducationSection,
  projects: ProjectsSection,
  writings: WritingsSection,
  publications: PublicationsSection,
  talks: TalksSection,
  awards: AwardsSection,
  episodes: EpisodesSection,
  patents: PatentsSection,
  gallery: GallerySection,
  discography: DiscographySection,
  testimonials: TestimonialsSection,
  press: PressSection,
  quote: QuoteSection,
  skills: SkillsSection,
  stack: StackSection,
  services: ServicesSection,
  contact: ContactSection,
  cta: CtaSection,
  stats: StatsSection,
  focus: FocusSection,
  'fun-facts': FunFactsSection,
  tenure: TenureSection,
  'external-portfolios': ExternalPortfoliosSection,
  github: GithubSection,
};
