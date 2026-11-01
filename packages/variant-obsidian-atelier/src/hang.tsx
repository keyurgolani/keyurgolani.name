import type { ReactNode } from 'react';
import { MediaFigure, placedImage, present, type RenderContext } from '@portfolio/kit/sections';
import { mediumLine, ownId, Words } from './parts';
import { atelierModel, type Room } from './model';

// A hang (redesign, stream C): one work on a wall, mounted flush, and its
// wall label beside it, the label pinned to the work's base and never over
// it. The label is the catalogue's: the number, the title, the medium and
// when folded into one line, the role, and the tools, then where to go
// next. The picture keeps its own aspect, so a portrait, a panorama, and a
// transparent image all hang whole.

/** The id of a room's wall label, which its figure is labelled by. */
export const labelId = (ctx: RenderContext, room: Room) =>
  ownId(ctx.input, `label-${room.work.id}`);

export function WallLabel({
  room,
  ctx,
  no,
  caption = false,
  untitled = false,
  children,
}: {
  room: Room;
  ctx: RenderContext;
  /** Without the work's title, when the work it labels shows its own, as a title page does. */
  untitled?: boolean;
  /** Set at caption size, as the entrance's and an installation's labels are, rather than body size. */
  caption?: boolean;
  /** The label's first line, the work's catalogue number unless a page says otherwise, such as "Plate 1 of 4". */
  no?: string;
  /** What follows the label's lines, such as a link to the room. */
  children?: ReactNode;
}) {
  const { work } = room;
  const medium = mediumLine(work);
  const credit = [work.role, work.organization].filter(present).join(', ');
  // What it's made with, or for writing what it's about.
  const tools = (work.tools?.length ? work.tools : (work.tags ?? [])).filter(present);
  const reading =
    work.readingTimeMinutes !== undefined ? `A ${work.readingTimeMinutes}-minute read` : undefined;
  return (
    <figcaption
      className="oa-label"
      id={labelId(ctx, room)}
      data-type-role={caption ? 'label' : 'body'}
    >
      <span className="oa-label__no">
        <Words input={ctx.input}>
          {no ?? `No. ${room.number} of ${atelierModel(ctx.input).total}`}
        </Words>
      </span>
      {untitled ? null : (
        <span className="oa-label__title" lang={work.lang}>
          {work.title}
        </span>
      )}
      {medium ? (
        <span>
          <Words input={ctx.input}>{medium}</Words>
        </span>
      ) : null}
      {reading ? (
        <span>
          <Words input={ctx.input}>{reading}</Words>
        </span>
      ) : null}
      {present(credit) ? <span lang={work.lang}>{credit}</span> : null}
      {tools.length > 0 ? <span lang={work.lang}>{tools.join(', ')}</span> : null}
      {children}
    </figcaption>
  );
}

export function Hang({
  room,
  ctx,
  eager = false,
  sizes,
  no,
  caption = false,
  children,
}: {
  room: Room;
  ctx: RenderContext;
  eager?: boolean;
  sizes: string;
  /** Its wall label at caption size. */
  caption?: boolean;
  /** The wall label's first line, when it isn't the catalogue number. */
  no?: string;
  /** What the wall label ends on. */
  children?: ReactNode;
}) {
  // The label carries the work's words, so the picture's own figure shows its credit and rights alone.
  const placed = placedImage(room.image, ctx.input);
  if (!placed) return null;
  return (
    <figure className="oa-hang" aria-labelledby={labelId(ctx, room)}>
      <div className="oa-hang__work oa-mount">
        <MediaFigure
          placed={placed}
          ctx={ctx}
          className="oa-mount__image"
          eager={eager}
          sizes={sizes}
        />
      </div>
      <WallLabel room={room} ctx={ctx} no={no} caption={caption}>
        {children}
      </WallLabel>
    </figure>
  );
}
