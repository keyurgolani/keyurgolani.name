import type { Evidence } from '@portfolio/schema';
import { Disclosure } from '@portfolio/appearance/primitives';
import {
  EvidenceEntry,
  evidenceOf,
  formatFigure,
  present,
  recordAnchor,
  renderContext,
  RichText,
  SectionHeader,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';

// Evidence as objects (#14): each piece is a card that opens in place. Its
// face is a disclosure's summary, which names it with the owner's own words
// and says whether it's open, and focus stays on it as it opens and closes,
// so nothing has to be restored. Open, it holds the record whole, as the
// shared renderer writes it, its heading one level below the section's. No
// heading sits inside the summary, and several can be open at once.

/** What a piece of evidence is called at a glance, from what the owner wrote, in order. */
function Glance({ entry, ctx }: { entry: Evidence; ctx: RenderContext }) {
  const value = entry.metric?.value;
  const name = [entry.title, entry.source?.name, entry.publication, entry.venue].find(present);
  return (
    <span className="kc-evidence__glance">
      {value !== undefined ? (
        <span className="kc-evidence__figure" data-type-role="numeric">
          <data value={value}>{formatFigure(value, ctx)}</data>
          {present(entry.metric?.unit) ? <> {entry.metric.unit}</> : null}
        </span>
      ) : null}
      {name !== undefined ? (
        <span className="kc-evidence__name">{name}</span>
      ) : present(entry.statement) && value === undefined ? (
        <RichText source={entry.statement} inline input={ctx.input} />
      ) : null}
    </span>
  );
}

export function EvidenceObjects({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'evidence'>>) {
  const ctx = renderContext(input, section, level);
  const entries = evidenceOf(section, input);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <ul className="kc-evidence" role="list">
        {entries.map((entry) => (
          <li
            key={entry.id}
            id={recordAnchor(section, entry, input)}
            className="kc-evidence__object"
            data-evidence-type={entry.type}
            lang={entry.lang}
          >
            <Disclosure
              className="kc-evidence__disclosure"
              summary={<Glance entry={entry} ctx={ctx} />}
            >
              <ul className="kc-evidence__record" role="list">
                <EvidenceEntry entry={entry} ctx={ctx} />
              </ul>
            </Disclosure>
          </li>
        ))}
      </ul>
    </>
  );
}
