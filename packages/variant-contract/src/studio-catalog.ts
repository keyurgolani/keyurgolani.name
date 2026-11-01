// What Studio's composition picker knows of the platform's own compositions
// (P-5) beyond their manifests: the family each sits in, and the program's
// compositions no package registers yet, which the picker lists as in
// progress. It sits beside COMPOSITION_STATUS (status.ts) because the host
// names no composition (apps/web's variant-ids test): first-party
// composition data lives in the platform's contract package. It imports
// nothing, so the browser's Studio can load it.

/** The composition picker's families, in the order its chips list them. */
export const COMPOSITION_FAMILIES = ['print', 'technical', 'stage', 'surface'] as const;
export type CompositionFamily = (typeof COMPOSITION_FAMILIES)[number];

/**
 * Each first-party composition's family, registered or not. A third-party
 * composition has none, and its picker lists it under All.
 */
export const COMPOSITION_FAMILY: Readonly<Record<string, CompositionFamily>> = Object.freeze({
  'editorial-evidence': 'print',
  'swiss-signal': 'print',
  chapters: 'print',
  shell: 'technical',
  'mission-control': 'technical',
  schematic: 'technical',
  'kinetic-cosmos': 'stage',
  'obsidian-atelier': 'stage',
  'horizontal-cinema': 'stage',
  singular: 'stage',
  flux: 'stage',
  'spatial-bento': 'surface',
  'raw-grid': 'surface',
  'aurora-glass': 'surface',
  'terra-field': 'surface',
});

/**
 * The program's compositions a build may not register yet, with what the
 * picker says of each: listed in progress, disabled, with nothing to draw,
 * until a package registers the id, and then the registered one is listed
 * in its place. Flux registered with its package, so it was never listed
 * here (ruling Q6).
 */
export const UPCOMING_COMPOSITIONS: readonly {
  readonly id: string;
  readonly name: string;
  readonly signature: string;
}[] = Object.freeze([
  { id: 'chapters', name: 'Chapters', signature: 'A short book' },
  { id: 'mission-control', name: 'Mission Control', signature: 'Operations wall' },
  { id: 'schematic', name: 'Schematic', signature: 'Drawing set' },
  { id: 'singular', name: 'Singular', signature: 'One question a screen' },
]);
