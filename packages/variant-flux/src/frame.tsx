import type { SectionComposition, SectionFrameProps } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { HeroRenderer, openingHeading } from './hero';
import {
  echoesTab,
  folds,
  formatNumber,
  headOf,
  itemCount,
  heroOf,
  openingOf,
  present,
  thesisSectionOf,
  type Sheet,
} from './model';
import { Bound, Phrase, uiLang, Words } from './parts';
import {
  CustomRenderer,
  FocusRenderer,
  FunFactsRenderer,
  LedeRenderer,
  NowRenderer,
  PracticeRenderer,
  QuoteRenderer,
} from './renderers/about';
import { ContactRenderer, CtaRenderer } from './renderers/close';
import { ChronologyRenderer, EvidenceRenderer, GithubRenderer } from './renderers/record';
import { WorksRenderer } from './renderers/works';

// Flux's frames (brief §5.10, step 6): every section is a part of its
// sheet, its title over its body, with no box of its own: the sheet is the
// one surface. A section titled as its sheet's tab says the tab's word
// again, so its heading stays for assistive technology alone. The full
// record folds behind a native disclosure (the home outline): it opens
// from a fragment link, prints open and works without script. The first
// hero frames the opening; the first thesis section frames the thesis
// after its first sentence. The call to action beside the contact merges
// into the close, its title opening its message under the contact's one
// heading.

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

/** The kinds whose made-up heading (no title of the owner's) stays for assistive technology alone. */
const QUIET_OWN = new Set(['quote', 'lede', 'now', 'focus', 'fun-facts']);

/** The composition renderSection takes for this render: Flux's renderers and its frame. */
export function compositionFor(
  input: VariantRenderInput,
  sheets: readonly Sheet[],
): SectionComposition {
  const hero = heroOf(input)?.id;
  const thesis = thesisSectionOf(input)?.id;
  const lang = uiLang(input.portfolio.locale);
  const now = openingOf(input).now;
  const wordOf = new Map<string, string | undefined>();
  // A section of a new kind after another on its sheet turns the page: it takes more room above
  // it than one of the same kind (should-fix 2's rhythm: a run, a turn, and the folds together).
  const turns = new Set<string>();
  const firsts = new Set(sheets.map((sheet) => sheet.sections[0]?.id).filter(present));
  for (const sheet of sheets)
    sheet.sections.forEach((section, index) => {
      wordOf.set(section.id, sheet.word);
      const before = sheet.sections[index - 1];
      if (before && before.kind !== section.kind) turns.add(section.id);
    });
  function Frame({ frame, section, level, children }: SectionFrameProps) {
    if (section.id === hero) {
      return (
        <section {...frame} className="fx-opening-frame" aria-labelledby={openingHeading(input)}>
          {children}
        </section>
      );
    }
    const head = headOf(section);
    const id = `${frame.id ?? `${input.ids.prefix}${section.id}`}--h`;
    const title = head.own ? <Words lang={lang}>{head.title}</Words> : <Bound text={head.title} />;
    const Heading = `h${level}` as 'h3';
    const subtitleOf = (className: string) =>
      present(section.subtitle) ? (
        <p className={className} data-type-role="body">
          <Phrase source={section.subtitle} input={input} />
        </p>
      ) : null;
    if (section.id === thesis) {
      // Untitled, its heading for assistive technology says what it is: the thesis, not the kind.
      const named = head.own ? <Words lang={lang}>Thesis</Words> : title;
      return (
        <section {...frame} className="fx-thesis" aria-labelledby={id}>
          <Heading id={id} className="fx-hidden">
            {named}
          </Heading>
          {children}
          {subtitleOf('fx-thesis__sub')}
          {now ? (
            <p className="fx-thesis__now" data-type-role="title">
              <Phrase source={now} input={input} />
            </p>
          ) : null}
        </section>
      );
    }
    if (section.kind === 'cta') {
      return (
        <section {...frame} className="fx-offer" aria-labelledby={id}>
          {present(section.title) ? (
            <p className="fx-offer__title" id={id} data-type-role="headline">
              {section.title}
            </p>
          ) : (
            <p className="fx-hidden" id={id}>
              {title}
            </p>
          )}
          {subtitleOf('fx-sec__sub')}
          {children}
        </section>
      );
    }
    // A heading the composition would have to make up says nothing a reader needs: kept for
    // assistive technology alone, like one that repeats its sheet's tab.
    const echoes =
      (!head.own && echoesTab(head.title, wordOf.get(section.id), firsts.has(section.id))) ||
      (head.own && QUIET_OWN.has(section.kind));
    const subtitle = present(section.subtitle) ? (
      <p className="fx-sec__sub" data-type-role="body">
        <Phrase source={section.subtitle} input={input} />
      </p>
    ) : null;
    if (folds(section, input)) {
      const held = itemCount(section, input);
      return (
        <section
          {...frame}
          className={`fx-sec fx-sec--${section.kind} fx-sec--fold`}
          aria-labelledby={id}
        >
          <details className="fx-fold" data-fx-fold="">
            <summary className="fx-fold__summary">
              <Heading id={id} className="fx-sec__title" data-type-role="title">
                {title}
              </Heading>
              {held > 0 ? (
                <span className="fx-fold__count fx-num" data-type-role="label">
                  {formatNumber(held, input.portfolio.locale)}
                </span>
              ) : null}
            </summary>
            <div className="fx-fold__body">
              {subtitle}
              {children}
            </div>
          </details>
        </section>
      );
    }
    return (
      <section
        {...frame}
        className={`fx-sec fx-sec--${section.kind}`}
        aria-labelledby={id}
        data-fx-turn={turns.has(section.id) ? '' : undefined}
      >
        <header className="fx-sec__head">
          <Heading
            id={id}
            className={echoes ? 'fx-hidden' : 'fx-sec__title'}
            data-type-role={section.kind === 'contact' ? 'headline' : 'title'}
          >
            {title}
          </Heading>
          {subtitle}
        </header>
        <div className="fx-sec__body">{children}</div>
      </section>
    );
  }
  return { renderers: RENDERERS, Frame };
}
