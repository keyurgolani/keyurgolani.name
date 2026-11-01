import type { CSSProperties } from 'react';
import { ownId } from '../parts';
import { FieldStage } from './stage';
import { drawn, FIELD, GOO, placement, type InkPose, type Mode } from './spec';

// The field (brief §5.10, step 3; FX-M2, FX-M19): full bleed behind the
// opening, two saturated inks pouring off its edges, each its own drawing
// per mode, all of them through one goo filter rendered once. Every circle
// is the composition's own geometry (spec.ts): the server draws the same
// still for any owner, with no script, under reduced motion, after Pause
// and on a static page alike. The drift moves one lobe per ink by transform
// alone, from where it's drawn, so the live field pours on from the still
// and never cuts to another pose. aria-hidden: nothing here is content.

const MODES: readonly Mode[] = ['w', 'm', 't', 'p'];

/** The goo filter's id, one per page. */
export const gooId = (prefix: string) => ownId(prefix, 'goo');

/** The one goo filter: a blur in field units, then a steep alpha threshold that merges what touches. */
export function GooDefs({ prefix }: { prefix: string }) {
  return (
    <svg className="fx-defs" aria-hidden="true" focusable="false" width="0" height="0">
      <defs>
        <filter
          id={gooId(prefix)}
          filterUnits="userSpaceOnUse"
          x="-20"
          y="-20"
          width="240"
          height="240"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation={GOO.sigma} />
          <feColorMatrix
            type="matrix"
            values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${GOO.slope} ${GOO.offset}`}
          />
        </filter>
      </defs>
    </svg>
  );
}

function InkDrawing({
  pose,
  ink,
  mode,
  goo,
}: {
  pose: InkPose;
  ink: 'a' | 'b';
  mode: Mode;
  goo: string;
}) {
  const place = placement(pose);
  const [dx, dy] = pose.travel;
  const style = {
    '--layout-fx-w': place.width,
    '--layout-fx-h': place.height,
    '--layout-fx-side': place.side,
    '--layout-fx-origin': place.origin,
  } as CSSProperties;
  const lobe = {
    // Inward is leftward in a drawing against the right side.
    '--layout-fx-dx': pose.side === 'right' ? -dx : dx,
    '--layout-fx-dy': dy,
  } as CSSProperties;
  return (
    <svg
      className={`fx-ink fx-ink--${ink}`}
      data-mode={mode}
      data-side={pose.side}
      data-origin={pose.origin}
      viewBox={`0 0 ${place.width} ${place.height}`}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <g filter={`url(#${goo})`}>
        {pose.frame.map((circle, index) => {
          const { cx, cy, r } = drawn(pose, circle);
          return <circle key={index} cx={cx} cy={cy} r={r} />;
        })}
        <g className="fx-ink__lobe" style={lobe}>
          {pose.lobe.map((circle, index) => {
            const { cx, cy, r } = drawn(pose, circle);
            return <circle key={index} cx={cx} cy={cy} r={r} />;
          })}
        </g>
      </g>
    </svg>
  );
}

/** The opening's field: two inks per mode (none under `blobs: off`), behind everything in the opening. */
export function Field({ prefix, inks }: { prefix: string; inks: boolean }) {
  const goo = gooId(prefix);
  return (
    <FieldStage className="fx-field" id={ownId(prefix, 'field')}>
      {inks
        ? MODES.map((mode) =>
            (['a', 'b'] as const).map((ink) => (
              <InkDrawing
                key={`${mode}-${ink}`}
                pose={FIELD[mode][ink]}
                ink={ink}
                mode={mode}
                goo={goo}
              />
            )),
          )
        : null}
    </FieldStage>
  );
}
