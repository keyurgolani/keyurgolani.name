import type { CoreRenderers } from '@portfolio/kit/sections';
import { ChronologyBodies } from './chronology';
import { ContactBody, CtaBody } from './connect';
import { EvidenceBodies } from './evidence';
import { GithubBody } from './github';
import {
  CustomBody,
  FocusBody,
  FunFactsBody,
  HeroBody,
  LedeBody,
  NowBody,
  QuoteBody,
} from './narrative';
import { PracticeBody } from './practice';
import { WorksBodies } from './works';

/**
 * Kinetic Cosmos's renderer of every core kind (redesign, stream E). A
 * section's frame draws its title, so each of these renders only what the
 * section holds; the opening's and the closing's own sections set theirs.
 */
export const RENDERERS: CoreRenderers = {
  hero: HeroBody,
  lede: LedeBody,
  now: NowBody,
  works: WorksBodies,
  evidence: EvidenceBodies,
  chronology: ChronologyBodies,
  practice: PracticeBody,
  contact: ContactBody,
  custom: CustomBody,
  quote: QuoteBody,
  focus: FocusBody,
  'fun-facts': FunFactsBody,
  cta: CtaBody,
  github: GithubBody,
};
