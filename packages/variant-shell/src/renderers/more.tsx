import type { ReactNode } from 'react';
import type { Work } from '@portfolio/schema';
import { RichText, type RenderContext } from '@portfolio/kit/sections';
import { present } from '../model';
import { Link, Sr, Words } from '../parts';

// A row's longer text, folded (gate item 8, the lead's home length): a listing row prints its
// one-line record, and what a reader opens to read (an excerpt, the notes, a track list, an
// abstract) sits under a `[+]` line naming what it holds, closed on home, open on paper. Each
// part inside is a `cat` body under its `#` comment, so the row stays one record long.

/** One part of a row's fold: its comment and its body. */
export interface MorePart {
  readonly key: string;
  /** The comment over the part, in the composition's words. */
  readonly label: string;
  /** How many it holds, when it's a list. */
  readonly count?: number;
  readonly body: ReactNode;
}

/** A row's fold: nothing when it has no parts. */
export function More({
  parts,
  uiLang,
  of,
}: {
  parts: readonly MorePart[];
  uiLang: 'en' | undefined;
  /** Whose fold it is, the row's name: read after the visible words, so each fold's is its own. */
  of?: string;
}) {
  if (parts.length === 0) return null;
  const name = (part: MorePart) =>
    part.count !== undefined ? `${part.label} (${part.count})` : part.label;
  return (
    <details className="sh-more" data-sh-more="">
      <summary className="sh-more__sum">
        <Words lang={uiLang}>{parts.map(name).join(', ')}</Words>
        {of !== undefined && of.trim() !== '' ? <Sr>: {of}</Sr> : null}
      </summary>
      <div className="sh-more__body">
        {parts.map((part) => (
          <div key={part.key} className="sh-more__part">
            <p className="sh-faint" aria-hidden="true">
              # <Words lang={uiLang}>{part.label}</Words>
            </p>
            {part.body}
          </div>
        ))}
      </div>
    </details>
  );
}

/** A track's length as `ls` would print a duration: m:ss. */
function trackLength(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * What a work holds past its record line, as its fold's parts: the excerpt, the description,
 * the show notes, each a `cat` body, and a release's tracks as `ls`, numbered, with lengths.
 */
export function workParts(work: Work, ctx: RenderContext): MorePart[] {
  const { input } = ctx;
  const parts: MorePart[] = [];
  if (present(work.excerpt)) {
    parts.push({
      key: 'excerpt',
      label: 'excerpt',
      body: (
        <blockquote className="sh-prose sh-more__q">
          <RichText source={work.excerpt} input={input} />
        </blockquote>
      ),
    });
  }
  if (present(work.description)) {
    parts.push({
      key: 'description',
      label: 'description',
      body: <RichText source={work.description} input={input} className="sh-prose" />,
    });
  }
  if (present(work.showNotes)) {
    parts.push({
      key: 'notes',
      label: 'show notes',
      body: <RichText source={work.showNotes} input={input} className="sh-prose" />,
    });
  }
  const tracks = work.tracks ?? [];
  if (tracks.length > 0) {
    const width = String(tracks.length).length < 2 ? 2 : String(tracks.length).length;
    parts.push({
      key: 'tracks',
      label: 'tracks',
      count: tracks.length,
      body: (
        <ol className="sh-trk">
          {tracks.map((track, i) => (
            <li key={i}>
              <span className="sh-trk__n" aria-hidden="true">
                {String(i + 1).padStart(width, '0')}
              </span>
              <span className="sh-trk__t">
                {track.url ? (
                  <Link url={track.url} input={input}>
                    {track.title}
                  </Link>
                ) : (
                  track.title
                )}
              </span>
              {track.durationSeconds !== undefined ? (
                <span className="sh-trk__d">{trackLength(track.durationSeconds)}</span>
              ) : null}
            </li>
          ))}
        </ol>
      ),
    });
  }
  return parts;
}
