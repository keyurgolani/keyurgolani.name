import type { ReactNode } from 'react';
import type { Work } from '@portfolio/schema';
import {
  formatNames,
  hrefFor,
  MediaFigure,
  placedMedia,
  present,
  RichText,
  type RenderContext,
} from '@portfolio/kit/sections';
import { said } from '../model';
import { Out, Words } from '../parts';

// What a work's owner wrote past its summary, in the wall's own forms (the
// P2 code review's must-fix 1): its credits as one label-voice line, its
// excerpt as a pull line, its frames with their captions, a release's
// tracklist, and its description, show notes, tags and tools. A work
// without a page of its own keeps the long ones behind one disclosure
// inside its cell, the same device as Experience's earlier roles, so the
// wall stays its length; a work with a case study shows them on its page.

/** Who and where: role, organization, artist, series, publication, label and guests, as written. */
export function creditsOf(work: Work, ctx: RenderContext): ReactNode[] {
  return [
    work.role,
    work.organization,
    work.artist,
    work.series,
    work.publication,
    work.label,
    work.guests?.length ? formatNames(work.guests, ctx) : undefined,
  ].filter((part): part is NonNullable<typeof part> =>
    typeof part === 'string' ? said(part) : Boolean(part),
  );
}

/** A work's credits on one line in the label voice, split by the language's spacing. */
export function Credits({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const parts = creditsOf(work, ctx);
  if (parts.length === 0) return null;
  return (
    <p className="mc-credits">
      {parts.map((part, index) => (
        <span key={index}>{part}</span>
      ))}
    </p>
  );
}

/** A writing's excerpt: its own words, set as a pull line. */
export function Excerpt({ work, ctx }: { work: Work; ctx: RenderContext }) {
  return present(work.excerpt) ? (
    <blockquote className="mc-excerpt">
      <RichText source={work.excerpt} input={ctx.input} />
    </blockquote>
  ) : null;
}

/** A track's length as minutes and seconds. */
const trackTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** A release's tracks in order, each with its length. */
export function Tracks({ work, ctx }: { work: Work; ctx: RenderContext }) {
  const tracks = (work.tracks ?? []).filter((track) => said(track.title));
  if (tracks.length === 0) return null;
  return (
    <ol className="mc-tracks">
      {tracks.map((track, index) => (
        <li key={index}>
          <span className="mc-tracks__n mc-num">{index + 1}</span>
          <span className="mc-tracks__title">
            {track.url ? (
              <Out href={hrefFor(track.url, ctx.input)}>{track.title}</Out>
            ) : (
              track.title
            )}
          </span>
          {track.durationSeconds !== undefined ? (
            <span className="mc-tracks__time mc-num">{trackTime(track.durationSeconds)}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** The work's frames, each with its caption, place and tags: every one, or those after `skip`. */
export function Frames({
  work,
  ctx,
  skip = 0,
  except,
}: {
  work: Work;
  ctx: RenderContext;
  skip?: number;
  /** The one placement shown elsewhere already, as the page's cover. */
  except?: number;
}) {
  const placed = (work.media ?? []).flatMap((placement, index) => {
    if (index < skip || index === except) return [];
    const image = placedMedia(placement, ctx);
    return image ? [image] : [];
  });
  if (placed.length === 0) return null;
  return (
    <ul className="mc-frames">
      {placed.map((image, index) => (
        <li key={`${image.asset}-${index}`}>
          <MediaFigure
            placed={image}
            ctx={ctx}
            className="mc-frames__frame"
            sizes="(width >= 47.5rem) 30vw, 100vw"
          />
        </li>
      ))}
    </ul>
  );
}

/** Short labels as one line in the label voice. */
export function Labels({ items }: { items: readonly string[] | undefined }) {
  const shown = (items ?? []).filter(said);
  return shown.length > 0 ? <p className="mc-cell__meta">{shown.join(', ')}</p> : null;
}

/** A fold's label from what it holds: "Credits and notes", "Tracks, notes and tags". */
export function foldWords(held: readonly string[]): string {
  const words =
    held.length <= 1
      ? (held[0] ?? 'details')
      : `${held.slice(0, -1).join(', ')} and ${held[held.length - 1]}`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The long fields of a work without a page of its own, behind one closed
 * disclosure inside its cell: its credits, what it is at length, its show
 * notes, its tracks, its frames with their captions (the cover's among
 * them), the cover's own caption, its tags and, for the signature cell,
 * its tools. None when it has none of them.
 */
export function WorkMore({
  work,
  ctx,
  uiLang,
  tools,
  credits = false,
  excerpt = false,
}: {
  work: Work;
  ctx: RenderContext;
  uiLang: 'en' | undefined;
  /** Whether its tools go here, rather than on the cell's own line. */
  tools: boolean;
  /** Whether its credits go here, rather than on the cell. */
  credits?: boolean;
  /** Whether its excerpt goes here, as in a log row, rather than on the cell. */
  excerpt?: boolean;
}) {
  // Frames are the placements Frames shows: an audio or video placement is none, so a fold
  // never says "frames" over none, and a work with only those has no fold for them.
  const frames = (work.media ?? []).some((placement) => placedMedia(placement, ctx) !== undefined);
  const tracks = (work.tracks ?? []).some((track) => said(track.title));
  const coverWords = work.cover ? placedMedia(work.cover, ctx)?.caption : undefined;
  // What it holds, in the composition's words, so each fold says what's inside it.
  const held = [
    credits && creditsOf(work, ctx).length > 0 ? 'credits' : undefined,
    excerpt && present(work.excerpt) ? 'excerpt' : undefined,
    present(work.description) || present(work.showNotes) ? 'notes' : undefined,
    tracks ? 'tracks' : undefined,
    frames || coverWords ? 'frames' : undefined,
    work.tags?.some(said) || (tools && work.tools?.some(said)) ? 'tags' : undefined,
  ].filter((word): word is string => word !== undefined);
  const has = held.length > 0;
  if (!has) return null;
  return (
    <details className="mc-fold mc-fold--inner mc-more" data-mc-fold="">
      <summary className="mc-fold__bar mc-fold__bar--inner">
        <Words lang={uiLang}>{foldWords(held)}</Words>
      </summary>
      <div className="mc-more__body">
        {credits ? <Credits work={work} ctx={ctx} /> : null}
        {excerpt ? <Excerpt work={work} ctx={ctx} /> : null}
        {present(work.description) ? (
          <RichText source={work.description} className="mc-cell__summary" input={ctx.input} />
        ) : null}
        {present(work.showNotes) ? (
          <RichText source={work.showNotes} className="mc-cell__summary" input={ctx.input} />
        ) : null}
        <Tracks work={work} ctx={ctx} />
        {coverWords ? <div className="mc-more__caption">{coverWords}</div> : null}
        {frames ? <Frames work={work} ctx={ctx} /> : null}
        {tools ? <Labels items={work.tools} /> : null}
        <Labels items={work.tags} />
      </div>
    </details>
  );
}
