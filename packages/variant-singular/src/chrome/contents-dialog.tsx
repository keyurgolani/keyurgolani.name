import { Dialog } from '@portfolio/appearance/primitives';
import { hrefFor } from '@portfolio/kit/sections';
import type { PageOutline } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { heroCtasOf, homeStopsOf, linkText, pad2, planOf, type Stop } from '../model';
import { ownId, uiLang, Words } from '../parts';
import { IndexSentence } from '../record/index-sentence';

// Contents (brief §5.7, step 3): the #19 Dialog primitive, opened from the
// bar. It holds the short version, the panels in order with their numbers,
// and the record's index sentence. A link in it closes it and lands where
// it points, focus included (closeOnNavigate); Escape, Close and a tap on
// the backdrop close it too, focus going back to Contents. The record's
// own index, in the page, is the same list for a visitor without it.

export const CONTENTS_ID = 'sg-contents';

export function ContentsDialog({
  input,
  outline,
  stops = homeStopsOf(input),
  short = 'The short version',
  home,
}: {
  input: VariantRenderInput;
  /** Home's outline, for the record's index sentence; none on a case page. */
  outline?: PageOutline;
  stops?: readonly Stop[];
  short?: string;
  /** A link back to the portfolio, on a case page. */
  home?: string;
}) {
  const lang = uiLang(input.portfolio.locale);
  const { prefix } = input.ids;
  const { record } = planOf(input);
  const ways = heroCtasOf(input);
  return (
    <Dialog
      id={CONTENTS_ID}
      trigger={<Words lang={lang}>Contents</Words>}
      triggerEmphasis="quiet"
      title={<Words lang={lang}>Contents</Words>}
      closeLabel="Close"
      headingLevel={2}
      closeOnNavigate
      lightDismiss
      closeInHeader
    >
      <div className="sg-contents">
        {/* Each nav is named by text, not aria-label, so the name carries its language (P1 review). */}
        <nav className="sg-contents__short" aria-labelledby={ownId(prefix, 'sg-contents--short')}>
          <span className="sg-hidden" id={ownId(prefix, 'sg-contents--short')} lang={lang}>
            {short}
          </span>
          <ol role="list">
            {stops.map((stop) => (
              <li key={stop.anchor}>
                <a href={`#${ownId(prefix, stop.anchor)}`}>
                  <span className="sg-num sg-contents__n" aria-hidden="true">
                    {stop.n === undefined ? null : pad2(stop.n)}
                  </span>
                  {stop.label.own ? stop.label.text : <Words lang={lang}>{stop.label.text}</Words>}
                </a>
              </li>
            ))}
            {home ? (
              <li>
                <a href={home}>
                  <span className="sg-num sg-contents__n" aria-hidden="true" />
                  <Words lang={lang}>Back to the portfolio</Words>
                </a>
              </li>
            ) : null}
          </ol>
        </nav>
        {/* Home's opening calls to action, in his words: panel 1's band carries one action at most. */}
        {outline && ways.length > 0 ? (
          <nav className="sg-contents__ways" aria-labelledby={ownId(prefix, 'sg-contents--ways')}>
            <span className="sg-hidden" id={ownId(prefix, 'sg-contents--ways')} lang={lang}>
              From the opening
            </span>
            <ul role="list">
              {ways.map((way) => (
                <li key={way.url}>
                  <a href={hrefFor(way.url.trim(), input)}>{linkText(way)}</a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {outline && record.length > 0 ? (
          <nav
            className="sg-contents__record"
            aria-labelledby={ownId(prefix, 'sg-contents--record')}
          >
            <span className="sg-hidden" id={ownId(prefix, 'sg-contents--record')} lang={lang}>
              Sections of the record
            </span>
            <IndexSentence input={input} outline={outline} />
          </nav>
        ) : null}
      </div>
    </Dialog>
  );
}
