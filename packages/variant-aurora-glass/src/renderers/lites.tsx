import type { Evidence, Section } from '@portfolio/schema';
import { recordAnchor } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { metricValue, plainInline, present } from '../model';
import { Phrase } from '../parts';
import { Lite, Lites } from '../surfaces/lites';

// Metric lites (brief §5.2; C6): the section's own pane split by mullions
// into one lite per figure, the value at headline size over its statement
// and its note. A row of lites shares two tracks, the values' and the words',
// so the statements start on one line and each note follows its own
// statement, however long another's runs.

type EvidenceSection = Extract<Section, { kind: 'evidence' }>;

/** A statement past this many characters is a sentence, not a figure's label. */
const LABEL_LENGTH = 40;

export function MetricLites({
  entries,
  section,
  input,
}: {
  entries: readonly Evidence[];
  section: EvidenceSection;
  input: VariantRenderInput;
}) {
  const locale = input.portfolio.locale;
  return (
    <Lites as="ul" className="ag-figures" data-count={String(entries.length)}>
      {entries.map((entry) => {
        const statement = present(entry.statement) ? plainInline(entry.statement) : undefined;
        const value = metricValue(entry, statement, locale);
        // A label stays the caption; a sentence reads in the note line under it, as a
        // description does, not as a caption of many short lines (the design review's 2).
        const sentence = statement !== undefined && statement.length > LABEL_LENGTH;
        return (
          <Lite key={entry.id} id={recordAnchor(section, entry, input)} lang={entry.lang}>
            <p className="ag-figure__value ag-num" data-type-role="headline">
              {value}
            </p>
            {/* The statement and its note together: the row of lites lines up the statements, and each note follows its own. */}
            <div className="ag-figure__words">
              {statement && !sentence ? (
                <p className="ag-figure__caption" data-type-role="body">
                  <Phrase source={entry.statement!} input={input} />
                </p>
              ) : null}
              {sentence ? (
                <p className="ag-figure__note" data-type-role="caption">
                  <Phrase source={entry.statement!} input={input} />
                </p>
              ) : null}
              {present(entry.description) ? (
                <p className="ag-figure__note" data-type-role="caption">
                  <Phrase source={entry.description} input={input} />
                </p>
              ) : null}
              {present(entry.source?.name) ? (
                <p className="ag-figure__note" data-type-role="caption">
                  {entry.source.name}
                </p>
              ) : null}
            </div>
          </Lite>
        );
      })}
    </Lites>
  );
}
