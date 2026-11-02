import type { Section } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import type { CSSProperties } from 'react';
import { figuresBand } from './model';

// The figures band (brief §5.1, component 4): one ruled cell per metric on
// the column lines, divided by vertical hairlines, each value with its
// unit folded in over the evidence statement as its caption. Swiss owns
// this form (N8); the whole band sits inside the first view (S1), never
// padded to a count the content doesn't have.

type Evidence = Extract<Section, { kind: 'evidence' }>;

/** The band's body, inside the section's own frame. */
export function FiguresBand({ input }: { section: Evidence; input: VariantRenderInput }) {
  const band = figuresBand(input);
  if (!band) return null;
  return (
    <ul className="ss-figs" data-count={band.figures.length}>
      {band.figures.map((figure) => (
        <li key={figure.id} className="ss-fig">
          {/* The number never breaks; a word unit may take the next line. The run's length
              sizes the figure down in a narrow cell (styles.css), so it never overflows. */}
          <p
            className="ss-fig__value ss-num"
            data-type-role="display"
            style={{ '--layout-ss-fig': figure.run.length } as CSSProperties}
          >
            <span className="ss-fig__run">{figure.run}</span>
            {figure.after ? ` ${figure.after}` : null}
          </p>
          {figure.caption ? (
            <p className="ss-fig__caption" data-type-role="body-compact">
              {figure.caption}
              {figure.note ? <span className="ss-fig__note">{` ${figure.note}`}</span> : null}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
