import type { ChronologyEntry } from '@portfolio/schema';
import { MediaFigure } from '../media';
import { placedMedia } from '../placement';
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
import { anchorSection, chronologyOf, recordAnchor, worksByIds } from '../view';

// A chronology (#10, slice 1, item 7): the entries a section lists, in its
// order, or with none, every public entry newest first, as the view orders
// them by their authored dates. An entry's thread, and the entries it
// branches from or merges into, ride on data attributes for a composition
// that draws lanes; the shared renderer draws none and infers none. The works
// an entry produced link to their place on the page when they have one.

/** The works an entry names: each a link to its anchor on the page, else its title alone. */
function ProducedWorks({ entry, ctx }: { entry: ChronologyEntry; ctx: RenderContext }) {
  const works = worksByIds(entry.works, ctx.input);
  if (works.length === 0) return null;
  return (
    <ul className="pf-tags" role="list">
      {works.map((work) => (
        <li key={work.id}>
          <MaybeLink url={anchorSection(work, ctx.input) ? `#${work.id}` : undefined} ctx={ctx}>
            {work.title}
          </MaybeLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * One chronology entry, as a list item whose id is the record's on the first
 * section that lists it. A composition that draws lanes passes the entry's
 * lane, and the lanes its fork and join reach, which ride on data attributes.
 */
export function ChronologyItem({
  entry,
  ctx,
  anchor,
  lane,
}: {
  entry: ChronologyEntry;
  ctx: RenderContext;
  anchor?: string;
  lane?: { lane: number; branchesFromLane?: number; mergesIntoLane?: number };
}) {
  const logo = placedMedia(entry.logo, ctx);
  return (
    <li
      id={anchor}
      className="pf-item"
      data-chronology-kind={entry.kind}
      data-thread={entry.thread}
      data-branches-from={entry.branchesFrom}
      data-merges-into={entry.mergesInto}
      data-lane={lane?.lane}
      data-branches-from-lane={lane?.branchesFromLane}
      data-merges-into-lane={lane?.mergesIntoLane}
      lang={entry.lang}
    >
      {logo ? (
        <MediaFigure placed={logo} ctx={ctx} className="pf-logo" sizes="3rem" inline />
      ) : null}
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
          <PeriodText key="period" period={entry.period} ctx={ctx} />,
        ]}
      />
      {present(entry.description) ? (
        <RichText source={entry.description} input={ctx.input} />
      ) : null}
      <TagList items={entry.highlights} className="pf-highlights" />
      <TagList items={entry.achievements} className="pf-highlights" />
      <TagList items={entry.skills} />
      <ProducedWorks entry={entry} ctx={ctx} />
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
          <ChronologyItem
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
