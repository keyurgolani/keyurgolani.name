import type { CSSProperties } from 'react';
import {
  CENTER,
  FLATTEN,
  MAP_HEIGHT,
  MAP_WIDTH,
  orbitGeometry,
  starField,
  TILT,
  type OrbitGeometry,
} from './geometry';

// The orrery (redesign, stream E): the opening stage's one signature, drawn
// on the server. The orbits, the anchors, their trails and leaders, and the
// near stars are one still SVG; the section bodies ride on two spin planes,
// each a box the stylesheet flattens and tilts to the orbits' plane, and a
// far layer of stars drifts under a still mask. What moves is always a plain
// box around a still SVG, by transform alone, so the compositor turns it
// with no main-thread frame (code review M1); an animated SVG root isn't
// composited, and costs a full render every frame. Under reduced motion, before the page mounts, in a
// plate, and with no JavaScript, it's the still frame the server drew. All
// of it is decoration, hidden from assistive technology: every fact it
// stands for is a link or text beside it.

/** The stars in each layer: a constant, so the field never grows with the window. */
export const NEAR_STARS = 44;
export const FAR_STARS = 30;

/** The rings that turn together: the inner two on one plane, the outer two on another. */
const PLANES = [
  { name: 'inner', rings: [0, 1] },
  { name: 'outer', rings: [2, 3] },
] as const;

const pct = (value: number, of: number) => `${((value / of) * 100).toFixed(3)}%`;

/** One spin plane: its rings' section bodies, on a square the stylesheet flattens onto the orbits. */
function SpinPlane({ name, orbits }: { name: string; orbits: readonly OrbitGeometry[] }) {
  if (orbits.length === 0) return null;
  const reach = Math.max(...orbits.map((orbit) => orbit.radius)) + 8;
  const style = {
    insetInlineStart: pct(CENTER.x, MAP_WIDTH),
    insetBlockStart: pct(CENTER.y, MAP_HEIGHT),
    inlineSize: pct(reach * 2, MAP_WIDTH),
    '--layout-tilt': `${TILT}deg`,
    '--layout-flatten': FLATTEN,
  } as CSSProperties;
  return (
    <div className={`kc-plane kc-plane--${name}`} style={style}>
      <span className="kc-spin">
        <svg
          className="kc-spin__bodies"
          viewBox={`${-reach} ${-reach} ${reach * 2} ${reach * 2}`}
          focusable="false"
        >
          {orbits.flatMap((orbit) =>
            orbit.bodies.map((angle, index) => {
              const a = (angle * Math.PI) / 180;
              return (
                <circle
                  key={`${orbit.index}-${index}`}
                  className="kc-body"
                  cx={(orbit.radius * Math.cos(a)).toFixed(1)}
                  cy={(orbit.radius * Math.sin(a)).toFixed(1)}
                  r={index % 3 === 0 ? 5.5 : 4}
                />
              );
            }),
          )}
        </svg>
      </span>
    </div>
  );
}

/**
 * The map's picture: everything but the plates. `counts` is how many
 * sections each drawn ring holds, innermost first; `seed` is the render's.
 */
export function Orrery({ counts, seed }: { counts: readonly number[]; seed: number }) {
  const orbits = orbitGeometry(counts);
  const near = starField(seed, NEAR_STARS, MAP_WIDTH, MAP_HEIGHT);
  const far = starField(seed + 1, FAR_STARS, MAP_WIDTH, MAP_HEIGHT);
  const outermost = orbits.at(-1)?.radius ?? 0;
  return (
    <div className="kc-map__frame" dir="ltr" aria-hidden="true">
      <div className="kc-sky">
        <span className="kc-sky__drift">
          <svg
            className="kc-sky__stars"
            viewBox={`0 0 ${MAP_WIDTH * 2} ${MAP_HEIGHT}`}
            preserveAspectRatio="none"
            focusable="false"
          >
            {[0, MAP_WIDTH].flatMap((tile) =>
              far.map((star, index) => (
                <circle
                  key={`${tile}-${index}`}
                  cx={star.x + tile}
                  cy={star.y}
                  r={(star.r * 0.8).toFixed(2)}
                />
              )),
            )}
          </svg>
        </span>
      </div>
      <svg className="kc-orrery" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} focusable="false">
        <g className="kc-orrery__stars">
          {near.map((star, index) => (
            <circle key={index} cx={star.x} cy={star.y} r={star.r} />
          ))}
        </g>
        <g transform={`translate(${CENTER.x} ${CENTER.y}) rotate(${TILT})`}>
          {outermost > 0 ? (
            <ellipse
              className="kc-orrery__halo-orbit"
              rx={outermost + 44}
              ry={((outermost + 44) * FLATTEN).toFixed(1)}
            />
          ) : null}
          {orbits.map((orbit) => (
            <ellipse
              key={orbit.index}
              className="kc-orrery__orbit"
              rx={orbit.radius}
              ry={(orbit.radius * FLATTEN).toFixed(1)}
            />
          ))}
          <circle className="kc-orrery__corona" r={58} />
          <circle className="kc-orrery__corona" r={48} />
          <circle className="kc-orrery__corona" r={40} />
        </g>
        {orbits.map((orbit) => (
          <g key={orbit.index} className="kc-orrery__anchor" data-ring={orbit.index}>
            <path className="kc-orrery__trail" d={orbit.trail} />
            <path className="kc-orrery__leader" d={orbit.leader} />
            <circle className="kc-orrery__terminal" cx={orbit.start.x} cy={orbit.start.y} r={3} />
            <circle className="kc-orrery__ring" cx={orbit.anchor.x} cy={orbit.anchor.y} r={15} />
            <circle className="kc-orrery__body" cx={orbit.anchor.x} cy={orbit.anchor.y} r={8} />
          </g>
        ))}
      </svg>
      <span
        className="kc-core"
        style={{
          insetInlineStart: pct(CENTER.x, MAP_WIDTH),
          insetBlockStart: pct(CENTER.y, MAP_HEIGHT),
          inlineSize: pct(66, MAP_WIDTH),
        }}
      />
      {PLANES.map((plane) => (
        <SpinPlane
          key={plane.name}
          name={plane.name}
          orbits={orbits.filter((orbit) =>
            (plane.rings as readonly number[]).includes(orbit.index),
          )}
        />
      ))}
    </div>
  );
}
