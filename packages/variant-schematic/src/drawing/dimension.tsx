import type { ReactNode } from 'react';

// Dimension lines, balloons and the stamp (brief §5.4, step 3). The linework
// is pseudo-elements alone: extension lines are the element's own edges,
// the shafts and arrowheads clip-path geometry, so the label is plain text
// that never waits for a draw-on (M1, SC-S8). A dimension with content (the
// thesis over the name) is read; one that only repeats a count is
// decoration, `decorative`. Without a label it's ticks only, never read.

export function Dimension({
  children,
  axis = 'h',
  decorative = false,
  className,
  delay,
  as: Tag = 'p',
}: {
  children?: ReactNode;
  axis?: 'h' | 'v';
  decorative?: boolean;
  className?: string;
  /** The draw-on's delay step, 0 to 4, each 110 ms (440 ms at most). */
  delay?: number;
  as?: 'p' | 'div';
}) {
  const empty = children === undefined || children === null;
  return (
    <Tag
      className={`sx-dim sx-dim--${axis}${className ? ` ${className}` : ''}`}
      aria-hidden={decorative || empty ? 'true' : undefined}
      data-draw={delay}
      data-annotation=""
    >
      {empty ? null : <span className="sx-dim__label">{children}</span>}
    </Tag>
  );
}

/** An item balloon: a numbered circle. Its number is the list's own, so it isn't read twice. */
export function Balloon({ n }: { n: number }) {
  return (
    <span className="sx-balloon" aria-hidden="true">
      {n}
    </span>
  );
}

/** A view bubble: the view's number over its sheet's. */
export function ViewBubble({ view, sheet }: { view: number; sheet: number }) {
  return (
    <span className="sx-bubble" aria-hidden="true">
      <span>{view}</span>
      <span>{`S${sheet}`}</span>
    </span>
  );
}

/** The rubber stamp at the end of the drawing, set at −3°. */
export function Stamp({ children }: { children: ReactNode }) {
  return (
    <p className="sx-stamp" aria-hidden="true">
      {children}
    </p>
  );
}
