import { hrefFor, type SectionOf, type SectionRendererProps } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { planOf, present, squash, whoOf, type Panel } from '../model';
import { headingId } from './panel';

// Panel 1, Who (brief §5.7; SG-M1): the h1 holds the name at title size
// and the thesis as the panel's single display line; the lede sits under it
// at title size, and the aside beside it holds the subtagline, the current
// role and the place. Four sizes in the first view at most (T1): display,
// title, body, and the counter's.

/** The panel-1 answer, from the identity, the hero and the thesis alone. */
export function Who({ input, panel }: { input: VariantRenderInput; panel: Panel }) {
  const who = whoOf(input);
  const name = squash(input.portfolio.identity.name);
  const hero = panel.section?.kind === 'hero' ? panel.section : undefined;
  // The hero's subtitle leads the aside. Its calls to action are in Contents, in his words
  // (heroCtasOf), so panel 1 keeps its one action (SG-M3).
  const aside = [present(hero?.subtitle) ? squash(hero.subtitle) : undefined, ...who.aside].filter(
    present,
  );
  return (
    <>
      <h1
        className="sg-who__h"
        id={headingId(input, panel)}
        tabIndex={-1}
        data-sg-heading=""
        data-sg-rise="lead"
      >
        <span className="sg-who__name" data-type-role="title">
          {name}
        </span>
        {who.line ? (
          <>
            {/* A sentence break for the h1's text, which the layout sets on its own line. */}
            <span className="sg-hidden">. </span>
            <span className="sg-who__line" data-type-role="display" data-length={who.lineClass}>
              {who.line}
            </span>
          </>
        ) : null}
      </h1>
      {who.lede ? (
        <p className="sg-who__lede" data-type-role="title" data-sg-rise="support">
          {who.lede}
        </p>
      ) : null}
      {aside.length > 0 ? (
        <div className="sg-who__aside" data-type-role="body" data-sg-rise="meta">
          {aside.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * The hero kind: panel 1's answer for the first hero; any other hero, in
 * the record, as its lines and its calls to action.
 */
export function HeroRenderer({ section, input }: SectionRendererProps<SectionOf<'hero'>>) {
  const panel = planOf(input).panelOf.get(section.id);
  if (panel) return <Who input={input} panel={panel} />;
  const lines = [section.name, section.tagline, section.subtagline].filter(present).map(squash);
  const ctas = section.ctas ?? [];
  return (
    <div className="sg-rec__lines" data-type-role="body">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {ctas.length > 0 ? (
        <ul className="sg-rec__links" role="list">
          {ctas.map((cta) => (
            <li key={cta.url}>
              <a href={hrefFor(cta.url.trim(), input)}>{squash(cta.label)}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
