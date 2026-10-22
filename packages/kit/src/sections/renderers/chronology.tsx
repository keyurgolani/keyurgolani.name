import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  ItemTitle,
  MaybeLink,
  Meta,
  PeriodText,
  present,
  renderContext,
  SectionHeader,
  TagList,
  type RenderContext,
} from '../primitives';
import { RichText } from '../rich-text';
import type { SectionOf, SectionRendererProps } from '../types';
import { chronologyOf, recordAnchor } from '../view';

// A chronology (#10, slice 1, item 7): the entries a section lists, in its
// order, or with none, every public entry, newest first by its authored
// dates. The entry's thread and where it branches from or merges into ride
// on data attributes, for a composition that draws lanes; the shared
// renderer draws none, and infers none.

type Entry = NonNullable<VariantRenderInput['portfolio']['chronology']>[number];

function ChronologyEntry({
  entry,
  ctx,
  anchor,
}: {
  entry: Entry;
  ctx: RenderContext;
  anchor?: string;
}) {
  return (
    <li
      id={anchor}
      className="pf-item"
      data-chronology-kind={entry.kind}
      data-thread={entry.thread}
      data-branches-from={entry.branchesFrom}
      data-merges-into={entry.mergesInto}
    >
      <ItemTitle text={entry.title} ctx={ctx} />
      <Meta
        parts={[
          entry.field,
          present(entry.organization) && (
            <MaybeLink key="organization" url={entry.organizationUrl} ctx={ctx}>
              {entry.organization}
            </MaybeLink>
          ),
          entry.location,
          entry.period && <PeriodText key="period" period={entry.period} ctx={ctx} />,
        ]}
      />
      {present(entry.description) ? (
        <RichText source={entry.description} input={ctx.input} />
      ) : null}
      <TagList items={entry.highlights} className="pf-highlights" />
      <TagList items={entry.tools} />
    </li>
  );
}

export function ChronologySection({
  section,
  input,
  level,
}: SectionRendererProps<SectionOf<'chronology'>>) {
  const ctx = renderContext(input, section, level);
  return (
    <>
      <SectionHeader section={section} ctx={ctx} />
      <ol className="pf-list pf-chronology" role="list">
        {chronologyOf(section, input).map((entry) => (
          <ChronologyEntry
            key={entry.id}
            entry={entry}
            ctx={ctx}
            anchor={recordAnchor(section, entry, input)}
          />
        ))}
      </ol>
    </>
  );
}
