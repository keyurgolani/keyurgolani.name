import { surfaceClass, type SurfaceProps } from './pane';

// Lites (brief §5.2, the vocabulary; AG-M3): one pane split by mullion gaps
// that show the sky. The pane is the list; each lite is a cell of it, painted
// with the pane surface, and the gaps between them are the list's own gap,
// so the sky shows through a split pane, never between free-standing cards.
// Cells take their content's height (no equal-height stretching), and the
// outer corners are the pane's: only the first and last cells round.

export function Lites({ as: Element = 'ul', className, children, ...rest }: SurfaceProps) {
  return (
    <Element className={surfaceClass('ag-lites', className)} role="list" {...rest}>
      {children}
    </Element>
  );
}

export function Lite({ as: Element = 'li', className, children, ...rest }: SurfaceProps) {
  return (
    <Element className={surfaceClass('ag-lite', className)} {...rest}>
      {children}
    </Element>
  );
}
