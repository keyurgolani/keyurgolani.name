import {
  renderSection,
  type SectionComposition,
  type SectionFrameProps,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { ReactNode } from 'react';
import { foldLineOf, headOf, nestedCtasOf, planOf, present, type FoldLine } from './model';
import { HeroRenderer } from './panels/who';
import { ContactRenderer } from './panels/contact';
import { PanelShell } from './panels/panel';
import { EvidenceRenderer } from './renderers/evidence';
import { ChronologyRenderer, GithubRenderer, PracticeRenderer } from './renderers/record';
import { WorksRenderer } from './renderers/works';
import {
  CtaRenderer,
  CustomRenderer,
  FocusRenderer,
  FunFactsRenderer,
  LedeRenderer,
  NowRenderer,
  QuoteRenderer,
} from './renderers/words';
import { Hidden, ownId, Phrase, uiLang, When, Words } from './parts';

// Singular's frames (brief §5.7): a section the plan gives a panel is that
// panel, on its ground with its action band (the hero is panel 1, the
// figures panel 3, the references panel 5, the contact section panel 6
// with every call to action nested in it); every other section is one row
// of the record, its head on the first track and its body on the other two.
// The record is the full record (the home outline): each row's body sits
// in a closed native disclosure whose summary says what it holds, the
// heading staying a heading outside it, so the outline, Contents and every
// fragment keep the row; a works row that only repeats the panels' works
// says so ("3 works, shown above") and opens to the line that points back
// and each work's whole entry.
// Every section renders through renderSection inside one of these.

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

/** The composition renderSection takes: Singular's renderers and its frames. */
export function compositionFor(input: VariantRenderInput): SectionComposition {
  const plan = planOf(input);
  const nested = new Set(nestedCtasOf(input).map((cta) => cta.id));
  const lang = uiLang(input.portfolio.locale);
  const composition: SectionComposition = { renderers: RENDERERS, Frame };
  function Frame({ frame, section, level, children }: SectionFrameProps) {
    const panel = plan.panelOf.get(section.id);
    if (panel) {
      const ctas =
        panel.key === 'contact'
          ? nestedCtasOf(input).map((cta) => renderSection(cta, input, composition, { level: 3 }))
          : [];
      return (
        <PanelShell input={input} panel={panel} frame={frame} className={`sg-panel--${panel.key}`}>
          {children}
          {ctas.some((cta) => cta !== null) ? (
            <div className="sg-contact__ctas" data-sg-rise="meta">
              {ctas}
            </div>
          ) : null}
        </PanelShell>
      );
    }
    const head = headOf(section);
    const id = `${frame.id ?? ownId(input.ids.prefix, section.id)}--h`;
    const Heading = `h${level}` as 'h3';
    const title = head.own ? head.text : <Words lang={lang}>{head.text}</Words>;
    if (nested.has(section.id)) {
      return (
        <section {...frame} className="sg-contact__cta" aria-labelledby={id}>
          <Heading id={id} className="sg-contact__cta-h" data-type-role="title">
            {title}
          </Heading>
          {present(section.subtitle) ? (
            <p className="sg-rec__muted">
              <Phrase source={section.subtitle} input={input} />
            </p>
          ) : null}
          {children}
        </section>
      );
    }
    const asOf = section.kind === 'now' ? section.asOf : undefined;
    return (
      <section {...frame} className="sg-grid sg-rec" aria-labelledby={id}>
        <header className="sg-rec__head">
          <Heading id={id} className="sg-rec__title">
            {title}
          </Heading>
          {present(section.subtitle) ? (
            <p className="sg-rec__muted">
              <Phrase source={section.subtitle} input={input} />
            </p>
          ) : null}
          {asOf ? (
            <p className="sg-rec__muted">
              <Words lang={lang}>As of</Words> <When raw={asOf} input={input} />
            </p>
          ) : null}
        </header>
        <Fold line={foldLineOf(section, input)} title={title} lang={lang}>
          {children}
        </Fold>
      </section>
    );
  }
  return composition;
}

/**
 * A record row's body, closed (the home outline): a native disclosure whose
 * summary is what the row holds, a count in the composition's words or the
 * owner's first sentence, or nothing, and the plus. Its name ends with the
 * row's title, out of sight, so each summary's name is its own.
 */
function Fold({
  line,
  title,
  lang,
  children,
}: {
  line: FoldLine | undefined;
  title: ReactNode;
  lang: 'en' | undefined;
  children: ReactNode;
}) {
  return (
    <details className="sg-fold">
      <summary className="sg-fold__sum" data-type-role="body">
        {line ? (
          <span className={`sg-fold__line sg-fold__line--${line.kind}`}>
            {line.kind === 'count' ? <Words lang={lang}>{line.text}</Words> : line.text}
          </span>
        ) : null}
        <Hidden>
          {line ? ': ' : null}
          {title}
        </Hidden>
        <span className="sg-fold__mark" aria-hidden="true" />
      </summary>
      <div className="sg-rec__body">{children}</div>
    </details>
  );
}
