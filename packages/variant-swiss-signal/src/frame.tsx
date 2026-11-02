import type { ReactNode } from 'react';
import type { SectionComposition, SectionFrameProps } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { figuresBand, headOf, heroOf, partContents, present, type Part } from './model';
import { ownId, Paren, Phrase, uiLang, Words } from './parts';
import { posterHeading } from './poster';
import { ChronologyRenderer } from './renderers/record';
import { ContactRenderer, CtaRenderer, GithubRenderer } from './renderers/contact';
import { EvidenceRenderer } from './renderers/evidence';
import { WorksRenderer } from './renderers/works';
import {
  CustomRenderer,
  FocusRenderer,
  FunFactsRenderer,
  LedeRenderer,
  NowRenderer,
  PracticeRenderer,
  QuoteRenderer,
} from './renderers/words';
import { HeroRenderer } from './poster';

// Swiss's frames (brief §5.1, components 5 and 6): the part opener, the
// part's word at poster scale on a 3 px rule with its contents as a
// parenthetical, and the section head band, the title and its count on
// the left and the owner's subtitle on the same baseline on the right, on
// a 1.5 px rule. Every section renders inside one, through renderSection.

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

/** The composition renderSection takes for this render: Swiss's renderers and its frame. */
export function compositionFor(
  input: VariantRenderInput,
  parts: readonly Part[],
): SectionComposition {
  const hero = heroOf(input)?.id;
  const band = figuresBand(input)?.section.id;
  const lang = uiLang(input.portfolio.locale);
  const contactWord = parts.find((part) => part.id === 'contact' && !part.own)?.word;
  function Frame({ frame, section, level, children }: SectionFrameProps) {
    if (section.id === hero) {
      return (
        <section {...frame} className="ss-poster" aria-labelledby={posterHeading(input)}>
          {children}
        </section>
      );
    }
    const head = headOf(section, input);
    const id = `${frame.id ?? ownId(input.ids.prefix, section.id)}--h`;
    const title = (hidden: boolean): ReactNode =>
      hidden ? <Words lang={lang}>{head.title}</Words> : head.title;
    if (section.id === band) {
      return (
        <section {...frame} className="ss-figures" aria-labelledby={id}>
          <div className="ss-grid">
            {/* An untitled band keeps its heading for the outline, named for its kind, unseen. */}
            <h2
              className={head.hidden ? 'ss-hidden' : 'ss-figures__head'}
              id={id}
              data-type-role="label"
            >
              {title(head.hidden)}
            </h2>
            {present(section.subtitle) ? (
              <p className="ss-figures__sub" data-type-role="body">
                <Phrase source={section.subtitle} input={input} />
              </p>
            ) : null}
            {children}
          </div>
        </section>
      );
    }
    // The contact section whose title is the part's word heads nothing twice.
    const hidden =
      head.hidden ||
      (section.kind === 'contact' && contactWord !== undefined && head.title === contactWord);
    const Heading = `h${level}` as 'h3';
    return (
      <section {...frame} className="ss-section" aria-labelledby={id}>
        <div className="ss-grid">
          <header className={hidden ? 'ss-head ss-head--bare' : 'ss-head'}>
            <Heading
              id={id}
              className={hidden ? 'ss-hidden' : 'ss-head__title'}
              data-type-role="title"
            >
              {title(head.hidden)}
              {head.paren && !hidden ? (
                <>
                  {' '}
                  <Paren signal>{head.paren}</Paren>
                </>
              ) : null}
            </Heading>
            {/* A head the part opener stands for still carries the owner's subtitle. */}
            {present(section.subtitle) ? (
              <p className="ss-head__sub" data-type-role="body">
                <Phrase source={section.subtitle} input={input} />
              </p>
            ) : null}
          </header>
          <div className="ss-body" data-kind={section.kind}>
            {children}
          </div>
        </div>
      </section>
    );
  }
  return { renderers: RENDERERS, Frame };
}

/** A part's opener: its word at poster scale, its contents as the parenthetical. */
export function PartOpener({ part, input }: { part: Part; input: VariantRenderInput }) {
  const lang = uiLang(input.portfolio.locale);
  const contents = partContents(part);
  const id = ownId(input.ids.prefix, `part-${part.id}--h`);
  return (
    <div className="ss-grid">
      <div className="ss-part__open">
        <h2 className="ss-part__title" id={id} data-type-role="display">
          {part.own ? <Words lang={lang}>{part.word}</Words> : part.word}
        </h2>
        {contents.length > 0 ? (
          <p className="ss-part__toc" data-type-role="quote">
            <span className="ss-paren ss-paren--signal">(</span>
            {contents.map((entry, index) => (
              <span key={entry.id}>
                {index > 0 ? ', ' : null}
                <a href={`#${input.ids.prefix}${entry.id}`}>{entry.title}</a>
              </span>
            ))}
            <span className="ss-paren ss-paren--signal">)</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
