import type { CoreRenderers } from '@portfolio/kit/sections';
import type { Env } from '../env';
import { EvidenceBody } from './evidence';
import { HeroBody } from './hero';
import {
  ContactBody,
  CtaBody,
  CustomBody,
  LedeBody,
  NowBody,
  QuoteBody,
  ShortListBody,
} from './prose';
import { ChronologyBody, GithubBody, PracticeBody } from './record';
import { WorksBody } from './works';

// Editorial Evidence's own renderer of every core kind: no section renders
// through the shared renderers. Each renders its section's body; the frame
// around it, a band, a margin note, or the opening, sets its head.

/** The renderers for one place, each knowing the page's model. */
export function renderersFor(env: Env): CoreRenderers {
  return {
    hero: (props) => <HeroBody {...props} env={env} />,
    lede: (props) => <LedeBody {...props} env={env} />,
    now: NowBody,
    focus: ShortListBody,
    'fun-facts': ShortListBody,
    quote: QuoteBody,
    contact: ContactBody,
    cta: CtaBody,
    custom: CustomBody,
    works: (props) => <WorksBody {...props} env={env} />,
    evidence: (props) => <EvidenceBody {...props} env={env} />,
    chronology: (props) => <ChronologyBody {...props} env={env} />,
    practice: (props) => <PracticeBody {...props} env={env} />,
    github: (props) => <GithubBody {...props} env={env} />,
  };
}
