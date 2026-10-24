// The spatial stage's scene (#16), as data: the still's four planes in
// depth, and a field of particles around them. Its size is a constant,
// whatever the portfolio holds: the same planes and the same number of
// particles for a portfolio of one work or of five hundred, so nothing the
// owner adds can grow what the GPU draws. Pure and seeded, so a render is
// the same on every load, with no Math.random.

/** The color roles the scene reads from the boundary. */
export const SCENE_ROLES = [
  'surface-subtle',
  'surface-prominent',
  'surface-default',
  'accent',
  'text-muted',
] as const;
export type SceneRole = (typeof SCENE_ROLES)[number];

export interface ScenePlane {
  readonly name: 'far' | 'middle' | 'near' | 'signature';
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number];
  readonly role: SceneRole;
}

export interface Scene {
  readonly planes: readonly ScenePlane[];
  /** Particle positions, three numbers each. */
  readonly particles: Float32Array;
}

/** The planes, back to front, as the still draws them. */
export const PLANES: readonly ScenePlane[] = [
  { name: 'far', position: [0, 0.9, -0.6], size: [3.2, 2.4], role: 'surface-subtle' },
  { name: 'middle', position: [0, 0.35, -0.2], size: [3.2, 2.4], role: 'surface-prominent' },
  { name: 'near', position: [0, -0.2, 0.2], size: [3.2, 2.4], role: 'surface-default' },
  { name: 'signature', position: [0.25, 0.1, 0.45], size: [1, 0.75], role: 'accent' },
];

/** Particles in the field: a constant. */
export const PARTICLE_COUNT = 480;
/** The field's half extent on each axis. */
const EXTENT: readonly [number, number, number] = [3.6, 2.6, 1.6];

/** A small, fast, seeded generator (mulberry32): the same seed gives the same field. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The scene for `seed`: the planes, and `count` particles placed once, in
 * one pass, into the array `allocate` makes, from the generator `generate`
 * makes for the seed. The page takes the defaults; a test passes a count, an
 * array that counts what touches it, and a generator that counts its draws,
 * to hold the work to linear in the particles.
 */
export function buildScene(
  seed: number,
  count: number = PARTICLE_COUNT,
  allocate: (length: number) => Float32Array = (length) => new Float32Array(length),
  generate: (seed: number) => () => number = seeded,
): Scene {
  const next = generate(seed);
  const particles = allocate(count * 3);
  for (let index = 0; index < count; index++) {
    for (let axis = 0; axis < 3; axis++) {
      particles[index * 3 + axis] = (next() * 2 - 1) * EXTENT[axis]!;
    }
  }
  return { planes: PLANES, particles };
}
