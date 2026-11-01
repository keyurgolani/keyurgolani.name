// The third ink, the emphasis pool the drop stands in (brief §5.10;
// FX-M18, FX-S38, FX-S41). Its own geometry, one closed outline in a
// drawing as wide as the plate's stage and set at its foot: a meniscus that
// climbs the drop's two walls and sags between them, a tongue that ends
// round under the left shoulder, a tail past the right one, and a rounded
// underside, so no edge is a ruler-straight shelf and no run of equal beads
// (FX-M17). It's drawn after the drop, so the drop's foot sinks into it on
// the lip's curve. With no signature work the pool keeps its own crest
// (`bare`): a rounded swell with no drop to hold. Still: it never drifts,
// so it adds no animation, and as one outline it needs no goo.

/** The pool under a drop, in a 140 x 48 drawing whose drop spans x 20 to 120 and stands at y 10. */
const HELD =
  'M2 31C2 23 9 18 17 15.5C22 14 25 9 30 9.5C34 10 38 15 46 17.5C60 21 80 21 94 17.5C102 15 106 10 110 9.5C115 9 118 13 123 15C132 18.5 139 23 139 30C139 41 124 47 104 47.5L38 47.5C17 47 2 41 2 31Z';

/** The bare pool: one swell with its own rounded crest. */
const BARE =
  'M2 35C2 25 32 13 70 13C108 13 138 25 138 35C138 43 122 47.5 102 47.5L38 47.5C18 47.5 2 43 2 35Z';

export function Pool({ bare = false }: { bare?: boolean }) {
  return (
    <svg
      className={bare ? 'fx-pool fx-pool--bare' : 'fx-pool'}
      viewBox="0 0 140 48"
      aria-hidden="true"
      focusable="false"
    >
      <path d={bare ? BARE : HELD} />
    </svg>
  );
}
