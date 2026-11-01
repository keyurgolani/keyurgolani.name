import type { ReactElement } from 'react';
import type { Section } from '@portfolio/schema';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { planOf, RECORD_ANCHOR } from '../model';
import { ownId, uiLang, Words } from '../parts';

// The record (brief §5.7): after the six panels, every section they don't
// answer, in authored order, on paper at one size: the head on the first
// track, the body on the second and the facts on the third. It opens with
// its rows closed (the home outline): each row's heading is its own entry,
// so the rows are the index, and Contents keeps the sentence of links. With
// no script every row opens natively, and in print every row prints open.

export function Record({
  input,
  render,
}: {
  input: VariantRenderInput;
  render: (section: Section) => ReactElement | null;
}) {
  const { record } = planOf(input);
  if (record.length === 0) return null;
  const lang = uiLang(input.portfolio.locale);
  const id = ownId(input.ids.prefix, RECORD_ANCHOR);
  return (
    <section
      className="sg-record"
      id={id}
      data-ground="canvas"
      data-sg-stop=""
      data-sg-anchor={RECORD_ANCHOR}
      data-sg-record=""
      aria-labelledby={`${id}--h`}
    >
      <div className="sg-grid sg-record__head">
        <h2
          className="sg-record__h"
          id={`${id}--h`}
          tabIndex={-1}
          data-sg-heading=""
          data-type-role="display"
        >
          <Words lang={lang}>The record</Words>
        </h2>
      </div>
      <div className="sg-record__rows">{record.map((section) => render(section))}</div>
    </section>
  );
}
