import type { Section } from '@portfolio/schema';
import type { SectionComposition, SectionFrameProps } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { HeroRenderer, openingHeading } from './hero';
import { evidenceRuns, headOf, heroOf, present, thesisSectionOf, workRuns } from './model';
import { ownId, Phrase, uiLang, Words } from './parts';
import {
  CustomRenderer,
  FocusRenderer,
  FunFactsRenderer,
  LedeRenderer,
  NowRenderer,
  PracticeRenderer,
  QuoteRenderer,
} from './renderers/about';
import { EvidenceRenderer } from './renderers/evidence';
import { ContactRenderer, CtaRenderer } from './renderers/horizon';
import { ChronologyRenderer } from './renderers/rail';
import { GithubRenderer } from './renderers/rays';
import { WorksRenderer } from './renderers/works';

// Aurora's frames (brief §5.2, step 5): every section is a lite of its
// band's pane, its head (the title, plain, never a pill: AG-M5) beside its
// body on wide screens and over it on phones. A section whose body brings
// its own surfaces (metric lites, the Looking stage) is a split lite: its
// head is a lite of its own and its body sits in the band's mullions,
// unpainted. The first hero frames the opening; the first thesis section
// frames the opening's standfirst, its heading for assistive technology.
// Contact is the horizon's pane and the call to action its sheet.

export const RENDERERS = {
  hero: HeroRenderer,
  lede: LedeRenderer,
  now: NowRenderer,
  works: WorksRenderer,
  evidence: EvidenceRenderer,
  chronology: ChronologyRenderer,
  practice: PracticeRenderer,
  contact: ContactRenderer,
  custom: CustomRenderer,
  quote: QuoteRenderer,
  focus: FocusRenderer,
  'fun-facts': FunFactsRenderer,
  cta: CtaRenderer,
  github: GithubRenderer,
} as const;

/** Whether a section's body brings its own surfaces, so its frame splits into lites. */
function splitBody(section: Section, input: VariantRenderInput): boolean {
  if (section.kind === 'evidence') {
    return evidenceRuns(section, input).every(
      (run) => run.form === 'lites' || run.form === 'portals',
    );
  }
  return false;
}

/** Whether a section's body takes the lite's whole width: the Looking stage. */
function wideBody(section: Section, input: VariantRenderInput): boolean {
  return (
    section.kind === 'works' && workRuns(section, input).every((run) => run.form === 'looking')
  );
}

/** The composition renderSection takes for this render: Aurora's renderers and its frame. */
export function compositionFor(input: VariantRenderInput): SectionComposition {
  const hero = heroOf(input)?.id;
  const thesis = thesisSectionOf(input)?.id;
  const lang = uiLang(input.portfolio.locale);
  function Frame({ frame, section, level, children }: SectionFrameProps) {
    if (section.id === hero) {
      return (
        <section {...frame} className="ag-opening-frame" aria-labelledby={openingHeading(input)}>
          {children}
        </section>
      );
    }
    const head = headOf(section);
    const id = `${frame.id ?? ownId(input.ids.prefix, section.id)}--h`;
    const title = head.own ? <Words lang={lang}>{head.title}</Words> : head.title;
    if (section.id === thesis) {
      const Heading = `h${level}` as 'h2';
      return (
        <section {...frame} className="ag-standfirst" aria-labelledby={id}>
          <Heading id={id} className="ag-hidden">
            {title}
          </Heading>
          {children}
        </section>
      );
    }
    const Heading = `h${level}` as 'h3';
    const kind = section.kind;
    const surface =
      kind === 'contact'
        ? 'ag-call'
        : kind === 'cta'
          ? 'ag-offer'
          : splitBody(section, input)
            ? 'ag-sec ag-sec--split'
            : wideBody(section, input)
              ? 'ag-lite ag-sec ag-sec--wide'
              : 'ag-lite ag-sec';
    return (
      <section {...frame} className={`${surface} ag-sec--${kind}`} aria-labelledby={id}>
        <header className="ag-sec__head">
          <Heading
            id={id}
            className="ag-sec__title"
            data-type-role={kind === 'contact' || kind === 'cta' ? 'headline' : 'title'}
          >
            {title}
          </Heading>
          {present(section.subtitle) ? (
            <p className="ag-sec__sub" data-type-role="body-compact">
              <Phrase source={section.subtitle} input={input} />
            </p>
          ) : null}
        </header>
        <div className="ag-sec__body">{children}</div>
      </section>
    );
  }
  return { renderers: RENDERERS, Frame };
}
