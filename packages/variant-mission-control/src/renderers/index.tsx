import type { ReactElement } from 'react';
import {
  hrefFor,
  RichText,
  type CoreRenderers,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { said, type HomeModel } from '../model';
import { Out } from '../parts';
import { ContactBody, CtaBody } from './contact';
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

// Mission Control's own renderer of every core kind (P2): no section renders
// through the kit's shared renderers. Each draws its section's body; the
// panel frame sets its title bar. The hero and the thesis are the anchor
// panel's parts; any other hero, and any other practice part, has its own
// form in a panel.

/** The kinds this file renders, as the manifest's renderedKinds lists them: every core kind. */
export const RENDERED_KINDS = [
  'hero',
  'lede',
  'works',
  'evidence',
  'github',
  'chronology',
  'practice',
  'focus',
  'now',
  'quote',
  'fun-facts',
  'contact',
  'cta',
  'custom',
] as const;

/** The anchor's hero part: the subtagline as its status line, then the actions. */
function HeroBody(
  props: SectionRendererProps<SectionOf<'hero'>> & { model: HomeModel },
): ReactElement | null {
  const { section, input, model } = props;
  if (section.id !== model.hero?.id) return <SecondHeroBody {...props} />;
  const ctas = section.ctas ?? [];
  return (
    <>
      {said(section.subtitle) ? <p className="mc-anchor__sub">{section.subtitle}</p> : null}
      {/* The h1 is the owner's name; a hero that names someone or something else says so. */}
      {said(section.name) && section.name !== input.portfolio.identity.name ? (
        <p className="mc-anchor__sub">{section.name}</p>
      ) : null}
      {model.thesis === undefined && model.lede ? <Lede model={model} input={input} /> : null}
      {/* With the thesis as the lede and no About text to open, the tagline sits here. */}
      {model.tagline && model.tagline.section === undefined ? (
        <p className="mc-anchor__tagline">
          <RichText source={model.tagline.text} inline input={input} />
        </p>
      ) : null}
      {said(section.subtagline) ? <p className="mc-anchor__status">{section.subtagline}</p> : null}
      {ctas.length > 0 ? (
        <ul className="mc-actions mc-anchor__actions">
          {ctas.map((cta, index) => (
            <li key={`${cta.url}-${index}`}>
              <Out
                href={hrefFor(cta.url, input)}
                className={index === 0 ? 'mc-act mc-act--primary' : 'mc-act'}
              >
                {cta.label}
              </Out>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** The lede, its source's first sentence, then the rest of it as the standfirst (MC-M1, N3). */
function Lede({ model, input }: { model: HomeModel; input: VariantRenderInput }) {
  if (!model.lede) return null;
  return (
    <>
      <p className="mc-lede">
        <RichText source={model.lede} inline input={input} />
      </p>
      {model.ledeRest ? (
        <p className="mc-lede__rest">
          <RichText source={model.ledeRest} inline input={input} />
        </p>
      ) : null}
    </>
  );
}

/** The thesis is the anchor's lede and standfirst (MC-M1); every other part is a panel of its own. */
function ThesisOrPractice(
  props: SectionRendererProps<SectionOf<'practice'>> & { model: HomeModel },
): ReactElement | null {
  const { section, input, model } = props;
  if (section.id === model.thesis?.id)
    return (
      <>
        {said(section.subtitle) ? <p className="mc-anchor__sub">{section.subtitle}</p> : null}
        <Lede model={model} input={input} />
      </>
    );
  return <PracticeBody {...props} />;
}

export function renderersFor(model: HomeModel): CoreRenderers {
  return {
    hero: (props) => <HeroBody {...props} model={model} />,
    lede: LedeBody,
    works: (props) => <WorksBody {...props} model={model} />,
    evidence: (props) => <EvidenceBody {...props} model={model} />,
    github: (props) => <GithubBody {...props} model={model} />,
    chronology: (props) => <ChronologyBody {...props} model={model} />,
    practice: (props) => <ThesisOrPractice {...props} model={model} />,
    focus: FocusBody,
    now: NowBody,
    quote: QuoteBody,
    'fun-facts': FunFactsBody,
    contact: ContactBody,
    cta: CtaBody,
    custom: CustomBody,
  };
}
