import type { ReactNode } from 'react';
import type { SectionFrame, SectionFrameProps } from '@portfolio/kit/sections';

// Spatial Bento's section frames: every section is a tile of the field, a
// <section> that spreads the frame's attributes and says where it sits.
// The overview's showcase is the one frame whose works are tiles of the
// band themselves: its box spans the band on the band's own grid.

export interface TileOptions {
  /** Its named area in the overview's band. */
  readonly area?: string;
  /** Its columns of 12 on a board, and of 6 at the middle layout. */
  readonly span?: number;
  readonly spanMd?: number;
  /** Its start column on a board's wide field, from 1, where the stylesheet must set it. */
  readonly col?: number;
  /** Two rows on a board's wide field: the tall one beside a stacked pair. */
  readonly tall?: boolean;
  /** The board's one dark plate, the accent poster, or a well. */
  readonly tone?: 'inverse' | 'accent' | 'well';
  /** A large tile's padding and radius, or a dense one's. */
  readonly size?: 'large' | 'dense';
  /** Set before the renderer's output, such as the hero's menu. */
  readonly before?: ReactNode;
  /** Its title is its board's name, which the board's label already shows. */
  readonly echo?: boolean;
}

/** A frame that sets the section as a tile. */
export function tileFrame(options: TileOptions = {}): SectionFrame {
  const { area, span, spanMd, col, tall, tone, size, before, echo } = options;
  return function TileFrame({ frame, children }: SectionFrameProps) {
    const classes = ['sb-tile', `sb-tile--${frame['data-kind'].replace('/', '-')}`];
    if (tone) classes.push(`sb-tile--${tone}`);
    if (size) classes.push(`sb-tile--${size}`);
    return (
      <section
        {...frame}
        className={classes.join(' ')}
        data-area={area}
        data-span={span}
        data-span-md={spanMd}
        data-col={col}
        data-rows={tall ? 2 : undefined}
        data-echo={echo ? '' : undefined}
        // The platform's focus ring takes the surface's own color here (on-accent, or the inverse ring).
        data-ui-surface={tone === 'accent' || tone === 'inverse' ? tone : undefined}
      >
        {before}
        {children}
      </section>
    );
  };
}

/**
 * A section in the full record (design gate 8): a closed native disclosure
 * in the Record board's one archive tile, its summary the section's title
 * and the board it belongs to, and inside it the section's own frame, its
 * id and attributes, as a part of the tile rather than a tile in a tile.
 * It opens from a fragment link, prints open, and works with no script.
 */
export function archiveFrame(title: string, board: string): SectionFrame {
  return function ArchiveFrame({ frame, children }: SectionFrameProps) {
    return (
      <details className="sb-archive__item" data-record="">
        <summary className="sb-archive__summary">
          <span className="sb-archive__name">{title}</span>
          <span className="sb-archive__board">{board}</span>
        </summary>
        <section {...frame} className="sb-archive__part">
          {children}
        </section>
      </details>
    );
  };
}

/**
 * The showcase's frame: a box across the band, on the band's own tracks, so
 * its works are tiles of the band and its anchor lands on a box.
 */
export function GroupFrame({ frame, children }: SectionFrameProps) {
  return (
    <section {...frame} className="sb-group">
      {children}
    </section>
  );
}
