import type { CoreRenderers } from '../types';
import { ChronologySection } from './chronology';
import { ContactSection, CtaSection } from './connection';
import { CustomSection } from './custom';
import { EvidenceSection } from './evidence';
import { GithubSection } from './github';
import { HeroSection, LedeSection, NowSection } from './narrative';
import { PracticeSection } from './practice';
import { QuoteSection } from './quoted';
import { FocusSection, FunFactsSection } from './short-lists';
import { WorksSection } from './works';

/**
 * The shared renderer of every core kind. renderSection() uses one for each
 * kind a variant doesn't render bespoke or skip, and a variant may call one
 * from its own renderer.
 */
export const SHARED_RENDERERS: CoreRenderers = {
  hero: HeroSection,
  lede: LedeSection,
  now: NowSection,
  works: WorksSection,
  evidence: EvidenceSection,
  chronology: ChronologySection,
  practice: PracticeSection,
  contact: ContactSection,
  custom: CustomSection,
  quote: QuoteSection,
  focus: FocusSection,
  'fun-facts': FunFactsSection,
  cta: CtaSection,
  github: GithubSection,
};
