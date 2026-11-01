// The arc: the composition's one curve. On a field it's the field's own
// edge, a ::before with elliptical end radii by the arc depth (styles.css);
// at icon size it's this glyph, decoration only, beside the words it marks.

/** The arc at icon size. `rise` bows up, as the closing field's top edge; `sag` bows down. */
export function ArcGlyph({
  bend = 'rise',
  className = 'tf-glyph',
}: {
  bend?: 'rise' | 'sag';
  className?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 48 16" aria-hidden="true" focusable="false">
      <path d={bend === 'rise' ? 'M2 13 Q 24 -5 46 13' : 'M2 3 Q 24 21 46 3'} />
    </svg>
  );
}
