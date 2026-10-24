import { Navigation, type NavigationItem } from '@portfolio/appearance/primitives';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { mediumLabel, named, type Chapter, type HomeModel } from './model';
import { ownId, Words } from './parts';

// The chapter index (#15): a quiet list of every chapter, by its number,
// title, and medium, then the other sections the page shows, each a plain
// fragment link to its direct URL. It's in the page's flow, under the
// opening, from the server's first paint, so it reads and works with no
// script, no hover, and no motion, and #19's Navigation keeps it a single
// landmark in a document and none in a plate. It marks nothing current: on
// home every chapter is in view in turn, and each says where it is itself.

/** A chapter's entry: its number, its title, and its medium. */
function Entry({ chapter, input }: { chapter: Chapter; input: VariantRenderInput }) {
  const medium = mediumLabel(chapter.work);
  return (
    <span className="oa-index__entry">
      <span className="oa-index__number" data-type-role="numeric">
        {chapter.number}
      </span>{' '}
      <span className="oa-index__title" lang={chapter.work.lang}>
        {chapter.work.title}
      </span>
      {medium ? (
        <>
          {' '}
          <span className="oa-index__medium" data-type-role="caption">
            <Words input={input}>{medium}</Words>
          </span>
        </>
      ) : null}
    </span>
  );
}

export function ChapterIndex({
  input,
  model,
  shown,
}: {
  input: VariantRenderInput;
  model: HomeModel;
  /** The ids of the sections that rendered, so the index links nothing missing. */
  shown: ReadonlySet<string>;
}) {
  const headingId = ownId(input, 'index-heading');
  const items: NavigationItem[] = [
    ...model.chapters.map((chapter) => ({
      href: `#${chapter.anchor}`,
      label: <Entry chapter={chapter} input={input} />,
    })),
    ...model.sections
      .filter((section) => named(section) && shown.has(section.id))
      .map((section) => ({
        href: `#${input.ids.prefix}${section.id}`,
        label: <span className="oa-index__section">{section.title}</span>,
        lang: section.lang,
      })),
  ];
  if (items.length === 0) return null;
  return (
    <div id={ownId(input, 'index')} className="oa-index">
      <h2 id={headingId} className="oa-index__heading" data-type-role="label">
        <Words input={input}>Index</Words>
      </h2>
      <Navigation labelledBy={headingId} orientation="vertical" items={items} />
    </div>
  );
}
