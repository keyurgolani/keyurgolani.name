import type { VariantRenderInput } from '@portfolio/variant-contract';
import { homeStopsOf, type Stop } from '../model';
import { ownId, uiLang, Words } from '../parts';

// The pager rail (brief §5.7, step 3; N8: "Singular: labelled dot rail
// only"): a dot per panel and a dash for the record, in the right margin,
// each a 44 px link whose label shows beside it on hover and focus (SG-S1).
// The pager marks the panel being read with aria-current and lends the rail
// that panel's ground; until it runs, the rail sits on a small paper plate
// so it reads over any ground. On a phone the strip stands in for it; in
// print it's a plain list.

export function Rail({
  input,
  stops = homeStopsOf(input),
  label = 'Panels',
}: {
  input: VariantRenderInput;
  stops?: readonly Stop[];
  label?: string;
}) {
  const { prefix } = input.ids;
  const lang = uiLang(input.portfolio.locale);
  return (
    <nav className="sg-rail" aria-labelledby={ownId(prefix, 'sg-rail--name')} data-ground="canvas">
      {/* Named by text, not aria-label, so the name carries its language (P1 review). */}
      <span className="sg-hidden" id={ownId(prefix, 'sg-rail--name')} lang={lang}>
        {label}
      </span>
      <ol className="sg-rail__list" role="list">
        {stops.map((stop) => (
          <li key={stop.anchor}>
            <a
              className={`sg-rail__stop${stop.n === undefined ? ' sg-rail__stop--record' : ''}`}
              href={`#${ownId(prefix, stop.anchor)}`}
              data-sg-rail={stop.anchor}
            >
              <span className="sg-rail__mark" aria-hidden="true" />
              <span className="sg-rail__label" data-type-role="body">
                {stop.label.own ? stop.label.text : <Words lang={lang}>{stop.label.text}</Words>}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
