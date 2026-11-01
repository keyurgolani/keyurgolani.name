import { surfaceClass, type SurfaceProps } from './pane';

// The sheet (brief §5.2, the vocabulary): solid, holding a work. The
// scheme's prominent surface, opaque, raised one step above the panes, so a
// work reads as an object laid on the glass. It never blurs.

export function Sheet({ as: Element = 'article', className, children, ...rest }: SurfaceProps) {
  return (
    <Element className={surfaceClass('ag-sheet', className)} {...rest}>
      {children}
    </Element>
  );
}
