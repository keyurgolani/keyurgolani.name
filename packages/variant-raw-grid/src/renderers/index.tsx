import type { CoreRenderers } from '@portfolio/kit/sections';
import { ContactBody, CtaBody } from './contact';
import type { Env } from './env';
import { EvidenceBody } from './evidence';
import { CustomBody, FocusBody, FunFactsBody, LedeBody, NowBody, QuoteBody } from './prose';
import { ChronologyBody, GithubBody, PracticeBody } from './record';
import { WorksBody } from './works';
import { PosterBody } from '../opening/poster';

// Raw Grid's own renderer of every core kind: no section renders through
// the shared renderers. Each draws its section's cells; the band around it
// (frame.tsx) sets its head.

export function renderersFor(env: Env): CoreRenderers {
  return {
    // A second hero in a sheet: a poster of its own, with no stickers.
    hero: (props) => <PosterBody {...props} stickers={[]} uiLang={env.model.uiLang} />,
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
