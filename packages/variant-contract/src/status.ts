// Each first-party composition's status (A2): whether an owner may pick it
// yet. It imports nothing, so proxy.ts, which reads /sample's `?variant=`
// before every request, and the browser's demo Studio can load it.

/** Whether a composition is ready for an owner to pick, or still being built. */
export type CompositionStatus = 'pending' | 'ready';

/**
 * Each first-party composition's status, one line a composition. `pnpm
 * register-variant` adds a new one as `pending`, and its lane flips it to
 * `ready` with the merge whose home and case page have both passed design
 * review (an owner opens the case page from the picker too). A pending
 * composition is out of /sample's `?variant=` switch, which renders the
 * sample's own composition in its place, and out of the recipes, and
 * Studio's picker shows it disabled, "In progress", with no thumbnail. It
 * lives in the platform's own code, so no site document or manifest can
 * set it. Every id in COMPOSITION_IDS has a line (ids.test.ts).
 */
export const COMPOSITION_STATUS: Readonly<Record<string, CompositionStatus>> = {
  'editorial-evidence': 'ready',
  'kinetic-cosmos': 'ready',
  'obsidian-atelier': 'ready',
  'spatial-bento': 'ready',
  'horizontal-cinema': 'ready',
  'swiss-signal': 'ready',
  'raw-grid': 'ready',
  shell: 'ready',
  'terra-field': 'ready',
  'aurora-glass': 'ready',
  singular: 'ready',
  'mission-control': 'ready',
  schematic: 'ready',
  flux: 'ready',
  chapters: 'ready',
};

/** A variant's status: its COMPOSITION_STATUS line, or `ready` for a variant no lane gates. */
export function compositionStatus(id: string): CompositionStatus {
  return Object.hasOwn(COMPOSITION_STATUS, id) ? COMPOSITION_STATUS[id]! : 'ready';
}

/** What Studio's picker labels a pending composition with. */
export const PENDING_LABEL = 'In progress';
