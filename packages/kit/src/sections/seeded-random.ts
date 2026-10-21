/**
 * A pseudo-random sequence fixed by `seed`, such as a render input's
 * `env.seed`, for decoration that must look the same in every render of the
 * same content: the server's, the browser's, and a preview's. Each call of the
 * returned function gives the next number in [0, 1). It's mulberry32, which is
 * fast and plenty for layout jitter, and no use for anything secret.
 */
export function seededRandom(seed: number): () => number {
  if (!Number.isInteger(seed)) throw new TypeError(`A seed is an integer, not ${seed}.`);
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
