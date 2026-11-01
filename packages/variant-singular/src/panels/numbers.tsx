import type { VariantRenderInput } from '@portfolio/variant-contract';
import { figureRow, planOf, present, type Panel } from '../model';
import { Phrase, uiLang, Words } from '../parts';
import { headingId, PanelShell } from './panel';

// Panel 3, Numbers (brief §5.7; SG-S2): a ledger of the owner's figures
// inside the report's 880 px measure, each statement beside its numeral on
// one hairline row, every row ending on the same baseline, so the first
// label (often the longest) reads with its figure like the rest. The
// numerals take the hero step in tabular figures; the unit, when the
// statement doesn't already start with it, follows at title size.

export function NumbersLedger({ input, panel }: { input: VariantRenderInput; panel: Panel }) {
  const numbers = planOf(input).numbers!;
  const lang = uiLang(input.portfolio.locale);
  const locale = input.portfolio.locale;
  const subtitle = panel.section?.subtitle;
  return (
    <div className="sg-nums">
      <h2
        className="sg-label"
        id={headingId(input, panel)}
        tabIndex={-1}
        data-sg-heading=""
        data-type-role="title"
        data-sg-rise="meta"
      >
        {panel.label.own ? panel.label.text : <Words lang={lang}>{panel.label.text}</Words>}
      </h2>
      {present(subtitle) ? (
        <p className="sg-panel__sub" data-type-role="body" data-sg-rise="meta">
          <Phrase source={subtitle} input={input} />
        </p>
      ) : null}
      <dl className="sg-nums__list" data-sg-rise="lead">
        {numbers.figures.map((entry) => {
          const row = figureRow(entry, locale);
          return (
            <div key={entry.id} className="sg-nums__row" lang={entry.lang}>
              <dt data-type-role="title">
                {row.statement}
                {row.description ? (
                  <>
                    {' '}
                    <span className="sg-nums__more">{row.description}</span>
                  </>
                ) : null}
              </dt>
              <dd className="sg-num">
                <data value={String(row.raw)} data-type-role="display">
                  {row.value}
                </data>
                {row.unit ? (
                  <span className="sg-nums__unit" data-type-role="title">
                    {row.unit}
                  </span>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/** Panel 3 when its figures are the proof list's, with no section of their own. */
export function NumbersPanel({ input, panel }: { input: VariantRenderInput; panel: Panel }) {
  return (
    <PanelShell input={input} panel={panel}>
      <NumbersLedger input={input} panel={panel} />
    </PanelShell>
  );
}
