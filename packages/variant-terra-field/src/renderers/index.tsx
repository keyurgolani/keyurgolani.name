import type { CoreRenderers } from '@portfolio/kit/sections';
import { ContactBody, CtaBody } from './contact';
import type { Env } from './env';
import { EvidenceBody } from './evidence';
import {
  CustomBody,
  FocusBody,
  FunFactsBody,
  LedeBody,
  NowBody,
  QuoteBody,
  SecondHeroBody,
} from './prose';
import { ChronologyBody, GithubBody, PracticeBody } from './record';
import { WorksBody } from './works';

// Terra Field's own renderer of every core kind: no section renders through
// the shared renderers. Each draws its section's body; the frame around it
// (frame.tsx, or the opening's and the close's own) sets its head.

export function renderersFor(env: Env): CoreRenderers {
  return {
    hero: SecondHeroBody,
    lede: LedeBody,
    works: (props) => <WorksBody {...props} env={env} />,
    evidence: EvidenceBody,
    chronology: ChronologyBody,
    practice: PracticeBody,
    github: GithubBody,
    now: NowBody,
    focus: FocusBody,
    'fun-facts': FunFactsBody,
    quote: QuoteBody,
    custom: CustomBody,
    contact: ContactBody,
    cta: CtaBody,
  };
}
