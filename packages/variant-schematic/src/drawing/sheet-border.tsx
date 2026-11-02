import type { ReactNode } from 'react';

// The sheet border (SC-M1, SC-M2): every sheet is a drawn frame with zone
// references on all four edges, numbers along the top and bottom on the
// field's column lines and letters down both sides, as ISO 5457 sheets
// carry them. It's composition geometry in token hairlines, so it reads under
// every recipe; the rulers are decoration (aria-hidden), and the drafting
// grid is the field's own background.

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** The zone rows a sheet carries: one per two views, from 2 to 8. */
export const zoneRows = (views: number) => Math.min(8, Math.max(2, Math.ceil(views / 2)));

function Ruler({
  edge,
  marks,
}: {
  edge: 'top' | 'bottom' | 'start' | 'end';
  marks: readonly string[];
}) {
  return (
    <ol className={`sx-zones sx-zones--${edge}`} aria-hidden="true">
      {marks.map((mark) => (
        <li key={mark}>{mark}</li>
      ))}
    </ol>
  );
}

export function SheetBorder({
  rows,
  className,
  children,
}: {
  rows: number;
  className?: string;
  children: ReactNode;
}) {
  const columns = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const letters = [...LETTERS.slice(0, rows)];
  return (
    <div className={`sx-border${className ? ` ${className}` : ''}`}>
      <Ruler edge="top" marks={columns} />
      <Ruler edge="start" marks={letters} />
      <div className="sx-field">{children}</div>
      <Ruler edge="end" marks={letters} />
      <Ruler edge="bottom" marks={columns} />
    </div>
  );
}
