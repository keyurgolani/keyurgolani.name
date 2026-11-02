import type { Section } from '@portfolio/schema';
import { sectionRenders } from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';
import { figuresBand, formatNumber, headOf, heroOf, type Part } from '../model';
import { ownId, Paren, uiLang, Words } from '../parts';
import { posterHeading } from '../poster';

// The Index sheet (brief §5.1, component 2): a ruled table of contents,
// every section by part with its parenthetical count, and "Print as a
// résumé". Until the Position controller has run and marked the page
// (no script, before hydration, a failed bundle) the Index is a plain link
// and the sheet a contents list in the page's flow after main, so nothing
// can be left open over a section. Marked, it's a native popover on the
// Index button: Escape and an outside click close it and focus goes back
// to the button; the controller closes it on a link click and when focus
// ends up outside it (S4), and shows the print button (styles.css).

const PLURAL = new Intl.PluralRules('en');
const counted = (n: number, one: string, other: string, locale: string) =>
  `${formatNumber(n, locale)} ${PLURAL.select(n) === 'one' ? one : other}`;

/** The masthead's Index cell: the popover's button, and the plain link that stands in with no script. */
export function IndexButton({ input }: { input: VariantRenderInput }) {
  const lang = uiLang(input.portfolio.locale);
  const sheet = ownId(input.ids.prefix, 'index');
  return (
    <div className="ss-index">
      <button
        type="button"
        className="ss-index__button"
        popoverTarget={sheet}
        aria-controls={sheet}
        data-type-role="label"
      >
        <span className="ss-index__mark" aria-hidden="true" />
        <Words lang={lang}>Index</Words>
      </button>
      <a className="ss-index__link" href={`#${sheet}`} data-type-role="label">
        <span className="ss-index__mark" aria-hidden="true" />
        <Words lang={lang}>Index</Words>
      </a>
    </div>
  );
}

export function IndexSheet({
  input,
  parts,
}: {
  input: VariantRenderInput;
  parts: readonly Part[];
}) {
  const lang = uiLang(input.portfolio.locale);
  const { prefix } = input.ids;
  const onHome = input.route.route === 'home';
  const home = onHome ? '' : routeHref(input, { route: 'home' });
  const link = (anchor: string) => `${home}#${anchor}`;
  const shown = (section: Section | undefined): section is Section =>
    section !== undefined && sectionRenders(section, input);
  const hero = heroOf(input);
  const band = figuresBand(input)?.section;
  const opening: Section[] = [];
  if (shown(hero)) opening.push(hero);
  if (shown(band)) opening.push(band);
  const total = parts.reduce((sum, part) => sum + part.sections.length, opening.length);
  const sheet = ownId(prefix, 'index');
  const entry = (section: Section) => {
    const head = headOf(section, input);
    // The hero's entry takes the section's own title, as every entry does
    // (the contract's completeness), with no parenthetical beside it.
    return (
      <li key={section.id}>
        <a href={link(section === hero ? posterHeading(input) : `${prefix}${section.id}`)}>
          {head.hidden ? <Words lang={lang}>{head.title}</Words> : head.title}
        </a>
        {head.paren && !head.hidden && section !== hero ? (
          <>
            {' '}
            <Paren>{head.paren}</Paren>
          </>
        ) : null}
      </li>
    );
  };
  return (
    <div className="ss-index__sheet" id={sheet} popover="auto">
      <nav className="ss-grid" aria-label="Index of sections">
        <ol className="ss-index__parts">
          {opening.length > 0 ? (
            <li className="ss-index__row">
              <p className="ss-index__part" data-type-role="title">
                <a href={link(posterHeading(input))}>
                  <Words lang={lang}>Opening</Words>
                </a>
              </p>
              <ul className="ss-index__list" data-type-role="body">
                {opening.map(entry)}
              </ul>
            </li>
          ) : null}
          {parts.map((part) => (
            <li key={part.id} className="ss-index__row" data-part={part.id}>
              <p className="ss-index__part" data-type-role="title">
                <a href={link(ownId(prefix, `part-${part.id}`))}>
                  {part.own ? <Words lang={lang}>{part.word}</Words> : part.word}
                </a>
              </p>
              <ul className="ss-index__list" data-type-role="body">
                {part.sections.filter(shown).map(entry)}
              </ul>
            </li>
          ))}
        </ol>
        <p className="ss-index__foot" data-type-role="body-compact">
          <Words lang={lang}>
            {opening.length > 0
              ? `${counted(total, 'section', 'sections', input.portfolio.locale)}: the opening and ${counted(parts.length, 'part', 'parts', input.portfolio.locale)}`
              : `${counted(total, 'section', 'sections', input.portfolio.locale)} in ${counted(parts.length, 'part', 'parts', input.portfolio.locale)}`}
          </Words>
          <button type="button" className="ss-print" data-ss-print="" hidden>
            <Words lang={lang}>Print as a résumé</Words>
          </button>
        </p>
      </nav>
    </div>
  );
}
