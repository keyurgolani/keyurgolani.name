import type { SectionComposition, SectionFrameProps } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { coverHeading, HeroRenderer } from './cover';
import { ViewBubble } from './drawing/dimension';
import { countOf, githubRepos, present, sheetSet } from './model';
import { figure, ownId, Phrase, Ui, words } from './parts';
import {
  ContactRenderer,
  CtaRenderer,
  CustomRenderer,
  FocusRenderer,
  FunFactsRenderer,
  LedeRenderer,
  NowRenderer,
  QuoteRenderer,
} from './renderers/about';
import { EvidenceRenderer } from './renderers/evidence';
import { ChronologyRenderer, GithubRenderer, PracticeRenderer } from './renderers/record';
import { WorksRenderer } from './renderers/works';

// Schematic's frames (brief §5.4): the hero is the cover sheet, a bordered,
// zoned sheet of its own; every other section is a view on its sheet, its
// head a view bubble (view number over sheet number, SC-S3) beside its
// title, the owner's subtitle under it only when there is one. A view the
// phone-fold rule names (SC-S6) is a native disclosure, open in the markup,
// so it works and prints with no script; the enhancement closes it on
// phones at load.

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

/** The composition renderSection takes: Schematic's renderers and its frame. */
export function compositionFor(input: VariantRenderInput): SectionComposition {
  const set = sheetSet(input);
  const { t, lang } = words(input);
  function Frame({ frame, section, level, children }: SectionFrameProps) {
    if (section.id === set.cover?.id) {
      return (
        <section {...frame} className="sx-id" aria-labelledby={coverHeading(input)}>
          {children}
        </section>
      );
    }
    const view = set.viewOf.get(section.id);
    const count = view?.closed ? countOf(section, input) : undefined;
    const id = `${frame.id ?? ownId(input.ids.prefix, section.id)}--h`;
    const Heading = `h${level}` as 'h3';
    const title = view?.title ?? section.title ?? section.kind;
    const head = (
      <>
        {view ? <ViewBubble view={view.no} sheet={view.sheet.n} /> : null}
        <Heading
          id={id}
          className="sx-vt__title"
          data-type-role="title"
          lang={view && !view.own ? lang : undefined}
        >
          {title}
        </Heading>
        {present(section.subtitle) && !view?.closed ? (
          <p className="sx-vt__sub" data-type-role="body-compact">
            <Phrase source={section.subtitle} input={input} />
          </p>
        ) : null}
        {view?.closed && count !== undefined ? (
          <span className="sx-vt__count" data-type-role="numeric">
            <Ui lang={lang}>
              {section.kind === 'practice' &&
              (section.part === 'skills' || section.part === 'tools')
                ? t.groups(count, figure(count, input))
                : section.kind === 'quote'
                  ? t.quotations(count, figure(count, input))
                  : section.kind === 'github'
                    ? // Its repositories once the snapshot is ready; until then its one profile link.
                      githubRepos(section, input)
                      ? t.repoCount(count, figure(count, input))
                      : t.profiles(count, figure(count, input))
                    : t.entries(count, figure(count, input))}
            </Ui>
          </span>
        ) : null}
      </>
    );
    return (
      <section {...frame} className={`sx-view sx-view--${section.kind}`} aria-labelledby={id}>
        {view?.closed ? (
          <details className="sx-fold" data-sx-outline="">
            <summary className="sx-vt">{head}</summary>
            <div className="sx-view__body">
              {present(section.subtitle) ? (
                <p className="sx-vt__sub" data-type-role="body-compact">
                  <Phrase source={section.subtitle} input={input} />
                </p>
              ) : null}
              {children}
            </div>
          </details>
        ) : view?.folds ? (
          <details className="sx-fold" open data-sx-fold="">
            <summary className="sx-vt">{head}</summary>
            <div className="sx-view__body">{children}</div>
          </details>
        ) : (
          <>
            <header className="sx-vt">{head}</header>
            <div className="sx-view__body">{children}</div>
          </>
        )}
      </section>
    );
  }
  return { renderers: RENDERERS, Frame };
}
