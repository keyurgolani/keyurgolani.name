// The server's clock for the contract fixtures (#5, Slice 6), loaded before
// the app with NODE_OPTIONS=--import: it starts at FIXED_TIME,
// 2026-01-01T00:00:00Z, and runs on from there, so every render of a fixture
// gets the same env.now, the request time truncated to the UTC day, and the
// parity renders, which pass FIXED_TIME to buildRenderInput, match it. Time
// still passes, so whatever measures an interval measures a real one. A Date
// built from a value is unchanged. #11 reuses it.
//
//   NODE_OPTIONS="--import=file:///.../tests/harness/fixed-clock.mjs"

/** Where the clock starts. */
export const FIXED_TIME = '2026-01-01T00:00:00.000Z';

const RealDate = globalThis.Date;
const offset = RealDate.parse(FIXED_TIME) - RealDate.now();
const now = () => RealDate.now() + offset;

/**
 * Date, reading the shifted clock wherever it reads the current time: with
 * no argument, as a function, and Date.now().
 */
function FixedDate(...args) {
  if (!new.target) return new RealDate(now()).toString();
  return args.length === 0 ? new RealDate(now()) : new RealDate(...args);
}
FixedDate.prototype = RealDate.prototype;
FixedDate.now = now;
FixedDate.parse = RealDate.parse;
FixedDate.UTC = RealDate.UTC;
Object.defineProperty(FixedDate, 'name', { value: 'Date' });

globalThis.Date = FixedDate;
