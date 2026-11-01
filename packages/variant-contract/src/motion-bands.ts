// The motion slots a composition sets in its root rule (#19's shared scales,
// M3, and K-4's ambient slot), as the variant contract holds them: the timed
// slots' bands, in ms, and the four slot names. @portfolio/appearance's
// scales re-export MOTION_BANDS from here, so the source audit and the
// third-party CSS audit (K-5 round 5) read one set of numbers.

/** The duration band a composition's value for each timed slot falls in, in ms. */
export const MOTION_BANDS = Object.freeze({
  feedback: Object.freeze({ min: 150, max: 300 }),
  scene: Object.freeze({ min: 600, max: 1000 }),
  ambient: Object.freeze({ min: 20_000, max: 60_000 }),
});

/** A composition's motion slot, with the part of the name after --layout-motion-. */
export const MOTION_SLOT = /^--layout-motion-(curve|feedback|scene|ambient)$/;

/**
 * Whether `value` is one a composition may give the motion slot `property`:
 * a literal time in a timed slot's band, and for the curve the language's
 * easing or a cubic-bezier() whose y values stay in 0 to 1, so nothing
 * overshoots or bounces.
 */
export function motionSlotValue(property: string, value: string): boolean {
  const slot = MOTION_SLOT.exec(property)?.[1];
  const text = value.trim();
  if (slot === 'curve') {
    if (/^var\(\s*--ui-motion-easing\s*\)$/i.test(text)) return true;
    const bezier = /^cubic-bezier\(([^)]*)\)$/i.exec(text);
    const points = bezier?.[1]!.split(',').map((part) => Number(part.trim())) ?? [];
    return (
      points.length === 4 &&
      points.every((point) => Number.isFinite(point) && point >= 0 && point <= 1)
    );
  }
  const band = MOTION_BANDS[slot as keyof typeof MOTION_BANDS];
  const time = /^(\d+(?:\.\d*)?|\.\d+)(ms|s)$/i.exec(text);
  if (band === undefined || time === null) return false;
  const ms = Number(time[1]) * (time[2]!.toLowerCase() === 's' ? 1000 : 1);
  return ms >= band.min && ms <= band.max;
}
