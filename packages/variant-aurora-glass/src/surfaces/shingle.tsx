import { surfaceClass, type SurfaceProps } from './pane';

// The shingle (brief §5.2, the vocabulary; AG-M4): one surface laid over
// another. Its parent is a grid; the under surface takes the `under` track
// and the over one the `over` track, which cross by at least one full
// column on wide screens (the over surface starts inside the under one and
// runs past its edge), and by a band of the under surface's foot on phones,
// where the over surface slides up over it. DOM order is reading order:
// under first, then over.

export function Shingle({ as: Element = 'div', className, children, ...rest }: SurfaceProps) {
  return (
    <Element className={surfaceClass('ag-shingle', className)} {...rest}>
      {children}
    </Element>
  );
}
