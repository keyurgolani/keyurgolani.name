import type { ReactNode } from 'react';

// The pane (brief §5.2, the vocabulary): frost, holding reading. It's
// painted with the design language's own pane surface, a surface role at
// --ui-surface-opacity over --ui-surface-material (the glass ruling), so
// it never falls below the language's floor. Only the capsule, the
// identity pane and its stat tiles blur (AG-M6): `frost` marks those.

export type SurfaceTag =
  | 'div'
  | 'section'
  | 'article'
  | 'aside'
  | 'figure'
  | 'li'
  | 'ul'
  | 'ol'
  | 'nav'
  | 'header'
  | 'footer';

/** The attributes a surface passes through to its element. */
export interface SurfaceProps {
  readonly as?: SurfaceTag;
  readonly className?: string;
  readonly children?: ReactNode;
  readonly id?: string;
  readonly lang?: string;
  readonly dir?: 'ltr' | 'rtl';
  readonly 'aria-labelledby'?: string;
  readonly 'aria-label'?: string;
  readonly [data: `data-${string}`]: string | undefined;
}

/** The class list of a surface: its own word, then the caller's. */
export const surfaceClass = (...names: (string | false | undefined)[]) =>
  names.filter(Boolean).join(' ');

export function Pane({
  as: Element = 'div',
  className,
  frost = false,
  children,
  ...rest
}: SurfaceProps & {
  /** One of the three blurred surfaces: the capsule, the identity pane, a stat tile (AG-M6). */
  readonly frost?: boolean;
}) {
  return (
    <Element className={surfaceClass('ag-pane', frost && 'ag-frost', className)} {...rest}>
      {children}
    </Element>
  );
}
