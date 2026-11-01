import type { Evidence, Section } from '@portfolio/schema';
import { recordAnchor } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { present } from '../model';
import { Phrase } from '../parts';
import { Sheet } from '../surfaces/sheet';

// The cascade (brief §5.2, testimonials): each quote a sheet, shingled down
// the lite, every other one stepped across, so the words read as notes laid
// one over the next. A figure with its quote and its source.

type EvidenceSection = Extract<Section, { kind: 'evidence' }>;

export function Cascade({
  entries,
  section,
  input,
}: {
  entries: readonly Evidence[];
  section: EvidenceSection;
  input: VariantRenderInput;
}) {
  return (
    <ul className="ag-cascade" role="list">
      {entries.map((entry) => {
        const words = entry.statement ?? entry.excerpt ?? entry.description;
        const source = entry.source;
        return (
          <Sheet
            as="li"
            key={entry.id}
            className="ag-say"
            id={recordAnchor(section, entry, input)}
            lang={entry.lang}
          >
            <figure className="ag-say__figure">
              {present(words) ? (
                <blockquote className="ag-say__quote" data-type-role="quote">
                  <Phrase source={words} input={input} />
                </blockquote>
              ) : null}
              {source ? (
                <figcaption className="ag-say__who" data-type-role="caption">
                  <span className="ag-say__name">{source.name}</span>
                  {present(source.role) || present(source.organization) ? (
                    <span className="ag-say__role">
                      {[source.role, source.organization].filter(present).join(', ')}
                    </span>
                  ) : null}
                </figcaption>
              ) : null}
            </figure>
          </Sheet>
        );
      })}
    </ul>
  );
}
