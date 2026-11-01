import type { ReactNode } from 'react';
import type { Placement, Work } from '@portfolio/schema';
import {
  DateText,
  formatFigure,
  hrefFor,
  isArchived,
  isRoutedWork,
  MediaFigure,
  placedImage,
  present,
  recordAnchor,
  renderContext,
  type RenderContext,
  type SectionOf,
  type SectionRendererProps,
} from '@portfolio/kit/sections';
import { routeHref } from '@portfolio/variant-contract';
import { atelierModel, mediumLabel, type AtelierModel, type Hung, type Room } from './model';
import { joined, numbers, yearOf, Words } from './parts';
import { SectionTitle } from './galleries/title';

// A bay of the collection's salon wall (redesign, stream C): one works
// section, its title in vinyl on the wall, and each work it hangs as the
// object its medium is, under the one caption system the wall uses: the
// title on the start of the line, the catalogue number on its end, and the
// credit under them in the quiet tone.
//
//   screen   a picture mounted flush, with an inset hairline
//   sheet    a work's title page: what it is, its title, how long it reads
//   sleeve   an episode in the scheme's inverse: its series, its number, its length
//   print    photographs framed on a mat, numbered as plates of one work
//   ledge    a record's sleeve standing on a picture ledge
//
// The caption's title is the one link, stretched over the object, so the
// whole object is one target and its text stays selectable. A work the
// rooms hold isn't hung twice: the bay says which rooms it's in. The home
// hangs six works at most (item 8), so the wall hangs what the rooms leave
// of them, and every other piece is its bay's checklist, folded below.

const SIZES = '(min-width: 64rem) 25vw, 50vw';

/**
 * How many pieces a bay hangs on the wall: home is the curated view, so a
 * bay shows its first three, and the rest of it is its checklist, folded.
 */
export const ON_WALL = 3;

/** How many works the home page hangs at most, the rooms' included: the home outline (item 8). */
export const HOME_WORKS = 6;

/**
 * How many pieces each bay hangs: what the rooms leave of the home's six,
 * given out a piece a bay at a time in the wall's order, never more than
 * a bay holds or than ON_WALL.
 */
export function onWall(model: AtelierModel): ReadonlyMap<string, number> {
  const counts = new Map(model.collection.map((section) => [section.id, 0]));
  let left = Math.max(0, HOME_WORKS - model.rooms.length);
  for (let given = true; left > 0 && given;) {
    given = false;
    for (const section of model.collection) {
      const held = Math.min(ON_WALL, model.bays.get(section.id)?.hung.length ?? 0);
      const count = counts.get(section.id)!;
      if (left > 0 && count < held) {
        counts.set(section.id, count + 1);
        left -= 1;
        given = true;
      }
    }
  }
  return counts;
}

/** The wall's columns. */
const WALL = 12;

/** How many of the wall's columns a bay wants: two an object, three a print, three for a note alone. */
function wants(wall: readonly Hung[]): number {
  if (wall.length === 0) return 3;
  const columns = wall.reduce(
    (sum, each) => sum + (each.mount === 'print' ? 3 * Math.min(each.plates.length, 4) : 2),
    0,
  );
  return Math.min(WALL, Math.max(2, columns));
}

/**
 * Each bay's span on a wide wall: the bays hung in their order, a row at
 * a time, as many as the row's twelve columns take, and the columns a row
 * has left over given out among its bays, one at a time from the first,
 * so every row runs from the wall's first column line to its last.
 */
export function baySpans(model: AtelierModel): ReadonlyMap<string, number> {
  const spans = new Map<string, number>();
  const counts = onWall(model);
  let row: { id: string; span: number }[] = [];
  const close = () => {
    let left = WALL - row.reduce((sum, bay) => sum + bay.span, 0);
    for (let index = 0; left > 0 && row.length > 0; index = (index + 1) % row.length, left -= 1) {
      row[index]!.span += 1;
    }
    for (const bay of row) spans.set(bay.id, bay.span);
    row = [];
  };
  // Bays that hang nothing, only their checklists, share a row of their own when two or more stand
  // together, never a short column beside hung pieces over an empty wall (P1-5); one alone keeps its
  // place in its neighbours' row, never a row of twelve columns to itself.
  const sections = model.collection;
  const empty = sections.map((section) => (counts.get(section.id) ?? 0) === 0);
  const apart = empty.map(
    (none, index) => none && (empty[index - 1] === true || empty[index + 1] === true),
  );
  sections.forEach((section, index) => {
    const span = wants((model.bays.get(section.id)?.hung ?? []).slice(0, counts.get(section.id)));
    if (index > 0 && apart[index] !== apart[index - 1]) close();
    if (row.reduce((sum, bay) => sum + bay.span, 0) + span > WALL) close();
    row.push({ id: section.id, span });
  });
  close();
  return spans;
}

/** Where a work's caption links: its own page, its address, its first link, or its audio or video. */
function hrefOf(work: Work, ctx: RenderContext): string | undefined {
  const { input } = ctx;
  if (isRoutedWork(work)) return routeHref(input, { route: 'work', slug: work.slug });
  const url = [work.url, work.links?.[0]?.url, work.audioUrl, work.videoUrl].find(present);
  return url !== undefined ? hrefFor(url, input) : undefined;
}

/** The credit under a caption: when, then who with, then the archive's mark. */
function credit(work: Work, ctx: RenderContext): ReactNode[] {
  const when = work.publishedAt ?? work.releasedAt;
  return [
    when !== undefined ? <DateText key="when" raw={when} ctx={ctx} /> : yearOf(work.period?.start),
    work.medium === 'writing' || work.medium === 'audio-video' ? undefined : work.role,
    work.guests?.length ? `with ${joined(work.guests)}` : undefined,
    work.label,
    isArchived(work, ctx.input) ? 'from the archive' : undefined,
  ].filter((part) => part !== undefined && part !== '');
}

function Caption({
  title,
  number,
  href,
  parts,
  lang,
  named = false,
}: {
  title: string;
  number: string;
  href: string | undefined;
  parts: ReactNode[];
  lang?: string;
  /** The bay's head already says the title: the wall shows what the work is, the title stays for a reader. */
  named?: string | false;
}) {
  return (
    <p className="oa-caption" data-type-role="label">
      <span className="oa-caption__title" lang={lang}>
        {href ? (
          <a className="oa-caption__link" href={href}>
            {named ? <Named title={title} kind={named} /> : title}
          </a>
        ) : named ? (
          <Named title={title} kind={named} />
        ) : (
          title
        )}
      </span>
      <span className="oa-caption__no">{number}</span>
      {parts.length > 0 ? (
        <span className="oa-caption__credit">
          {parts.map((part, index) => (
            <span key={index}>
              {index > 0 ? ', ' : null}
              {part}
            </span>
          ))}
        </span>
      ) : null}
    </p>
  );
}

function Picture({
  placement,
  ctx,
  className,
}: {
  placement: Placement | undefined;
  ctx: RenderContext;
  className: string;
}) {
  const placed = placedImage(placement, ctx.input);
  return placed ? (
    <MediaFigure placed={placed} ctx={ctx} className={className} sizes={SIZES} />
  ) : null;
}

/** The object itself, by its mount. */
function WorkObject({ hung, ctx, bay }: { hung: Hung; ctx: RenderContext; bay?: string }) {
  const { work } = hung;
  const { input } = ctx;
  switch (hung.mount) {
    case 'screen':
      return (
        <span className="oa-work__object oa-screen">
          <Picture placement={hung.image} ctx={ctx} className="oa-screen__image" />
        </span>
      );
    case 'ledge':
      return (
        <span className="oa-work__object oa-ledge">
          <Picture placement={hung.image} ctx={ctx} className="oa-ledge__image" />
        </span>
      );
    case 'sleeve':
      return (
        <span className="oa-work__object oa-sleeve" lang={work.lang}>
          <span className="oa-sleeve__series" data-type-role="label">
            {/* A series its bay already names is said once: the sleeve says what the number is. */}
            {present(work.series) && sameTitle(bay, work.series) && work.number !== undefined ? (
              <Words input={input}>Episode</Words>
            ) : present(work.series) ? (
              work.series
            ) : (
              (mediumLabel(work) ?? work.title)
            )}
          </span>
          {work.number !== undefined ? (
            <span className="oa-sleeve__number" data-type-role="display">
              {formatFigure(work.number, ctx)}
            </span>
          ) : (
            <span className="oa-sleeve__title" data-type-role="headline">
              {work.title}
            </span>
          )}
          {work.durationMinutes !== undefined ? (
            <span className="oa-sleeve__time" data-type-role="label">
              <Words input={input}>{`${Math.round(work.durationMinutes)} minutes`}</Words>
            </span>
          ) : null}
        </span>
      );
    default: {
      // What the sheet is: where it was published; else, for writing, what the owner did ("Curriculum
      // author"), as "Writing" says no more than the bay does; else its medium.
      const kind = present(work.publication)
        ? work.publication
        : work.medium === 'writing' && present(work.role)
          ? work.role
          : (mediumLabel(work) ?? undefined);
      return (
        <span className="oa-work__object oa-sheet" lang={work.lang}>
          {kind ? (
            <span className="oa-sheet__kind" data-type-role="label">
              {kind}
            </span>
          ) : null}
          <span className="oa-sheet__title">{work.title}</span>
          {work.readingTimeMinutes !== undefined ? (
            <span className="oa-sheet__time" data-type-role="label">
              <Words input={input}>{`${work.readingTimeMinutes} minutes`}</Words>
            </span>
          ) : null}
        </span>
      );
    }
  }
}

/**
 * A series of prints: the work's caption, its title linked as every
 * object's is, then each picture a plate, numbered under the work and
 * captioned with its own words.
 */
function Prints({ hung, ctx, bay }: { hung: Hung; ctx: RenderContext; bay?: string }) {
  const { work } = hung;
  const single = hung.plates.length === 1;
  return (
    <>
      <Caption
        title={work.title}
        number={String(hung.number)}
        href={hrefOf(work, ctx)}
        parts={credit(work, ctx)}
        lang={work.lang}
        named={sameTitle(bay, work.title) ? (mediumLabel(work) ?? false) : false}
      />
      <ul className="oa-plates" role="list">
        {hung.plates.map((placement, index) => (
          <li key={`${placement.asset}-${index}`} className="oa-plate">
            <span className="oa-work__object oa-print">
              <Picture placement={placement} ctx={ctx} className="oa-print__image" />
            </span>
            {present(placement.caption) || !single ? (
              <Caption
                title={present(placement.caption) ? placement.caption : work.title}
                number={single ? String(hung.number) : `${hung.number}.${index + 1}`}
                href={undefined}
                parts={[
                  placement.location,
                  placement.takenAt !== undefined ? (
                    <DateText key="taken" raw={placement.takenAt} ctx={ctx} />
                  ) : undefined,
                ].filter((part) => part !== undefined && part !== '')}
                lang={work.lang}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/** A title the bay's head already says: the wall shows the kind of work, a reader hears the title too. */
function Named({ title, kind }: { title: string; kind: string }) {
  return (
    <>
      <span className="oa-visually-hidden">{`${title}, `}</span>
      {kind}
    </>
  );
}

/** Whether a bay's title is its work's own, so the wall would say it twice. */
function sameTitle(bay: string | undefined, title: string): boolean {
  return present(bay) && bay.trim().toLocaleLowerCase() === title.trim().toLocaleLowerCase();
}

/** Which rooms hold some of the section's works, linked: "Nos. 1 and 2 are in Rooms I and II." */
function InRooms({ rooms, ctx }: { rooms: readonly Room[]; ctx: RenderContext }) {
  if (rooms.length === 0) return null;
  const nos =
    rooms.length === 1
      ? `No. ${rooms[0]!.number} is`
      : `Nos. ${joined(rooms.map((room) => String(room.number)))} are`;
  return (
    <p className="oa-bay__note" data-type-role="label">
      <Words input={ctx.input}>{`${nos} in ${rooms.length === 1 ? 'Room' : 'Rooms'} `}</Words>
      {rooms.map((room, index) => (
        <span key={room.work.id}>
          {index > 0
            ? index === rooms.length - 1
              ? rooms.length > 2
                ? ', and '
                : ' and '
              : ', '
            : null}
          <a href={`#${room.anchor}`}>{room.numeral}</a>
        </span>
      ))}
      .
    </p>
  );
}

/**
 * The rest of a bay, past what hangs: its checklist, the catalogue's list
 * mode, folded under the wall. Each row is the work's number, its title,
 * linked where the caption would be, and its credit, and keeps the work's
 * anchor, so a link to it still lands.
 */
function Checklist({
  rest,
  whole,
  section,
  ctx,
}: {
  rest: readonly Hung[];
  /** Whether the checklist is the whole bay, nothing of it hung. */
  whole: boolean;
  section: SectionOf<'works'>;
  ctx: RenderContext;
}) {
  const { input } = ctx;
  const first = rest[0]!.number;
  const last = rest[rest.length - 1]!.number;
  return (
    <details className="oa-checklist">
      <summary className="oa-summary">
        <span className="oa-plus" aria-hidden="true" />
        <span>
          <Words input={input}>
            {`${whole ? 'The bay' : 'The rest of the bay'}, ${numbers(first, last)}`}
          </Words>
        </span>
        <span className="oa-visually-hidden" lang={section.lang}>
          {present(section.title) ? `: ${section.title}` : ''}
        </span>
      </summary>
      <table className="oa-table oa-checklist__table" data-columns={3}>
        <thead>
          <tr>
            <th scope="col">
              <Words input={input}>No.</Words>
            </th>
            <th scope="col">
              <Words input={input}>Title</Words>
            </th>
            <th scope="col">
              <Words input={input}>Credit</Words>
            </th>
          </tr>
        </thead>
        <tbody>
          {rest.map((hung) => {
            const href = hrefOf(hung.work, ctx);
            const parts = credit(hung.work, ctx);
            return (
              <tr key={hung.work.id} id={recordAnchor(section, hung.work, input)}>
                <td className="oa-checklist__no">{hung.number}</td>
                <th scope="row" lang={hung.work.lang}>
                  {href ? <a href={href}>{hung.work.title}</a> : hung.work.title}
                </th>
                <td>
                  {parts.map((part, index) => (
                    <span key={index}>
                      {index > 0 ? ', ' : null}
                      {part}
                    </span>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

export function WorksSection({ section, input, level }: SectionRendererProps<SectionOf<'works'>>) {
  const ctx = renderContext(input, section, level);
  const model = atelierModel(input);
  const bay = model.bays.get(section.id) ?? { hung: [], inRooms: [] };
  const count = onWall(model).get(section.id) ?? 0;
  const wall = bay.hung.slice(0, count);
  const rest = bay.hung.slice(count);
  return (
    <>
      <div className="oa-bay__head">
        <SectionTitle section={section} ctx={ctx} />
        <InRooms rooms={bay.inRooms} ctx={ctx} />
      </div>
      {wall.length > 0 ? (
        <ul className="oa-hangs" role="list">
          {wall.map((hung) => (
            <li
              key={hung.work.id}
              id={recordAnchor(section, hung.work, input)}
              className={`oa-work oa-work--${hung.mount}`}
              data-medium={hung.work.medium}
              lang={hung.work.lang}
            >
              {hung.mount === 'print' ? (
                <Prints hung={hung} ctx={ctx} bay={section.title} />
              ) : (
                <>
                  <WorkObject hung={hung} ctx={ctx} bay={section.title} />
                  <Caption
                    title={hung.work.title}
                    number={String(hung.number)}
                    href={hrefOf(hung.work, ctx)}
                    parts={credit(hung.work, ctx)}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {rest.length > 0 ? (
        <Checklist rest={rest} whole={wall.length === 0} section={section} ctx={ctx} />
      ) : null}
    </>
  );
}
