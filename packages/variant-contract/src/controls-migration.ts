// Migrating a site document's stored control values (#5, Slice 5, item 3):
// each registered variant's entry stepped to its manifest's controls
// version, as #4 edits (applyEdits()) that change only the values that
// migrate and the version. In YAML every other line stays as written; a
// renamed control moves to the end of its `values` mapping, and a key or
// value an edit writes is plain, or double-quoted when it must be.
// `pnpm variants:migrate-controls` prints and applies them, and #8's Studio
// offers them as a draft action. An entry already current changes nothing,
// so a second run is a no-op. Nothing reads an entry of another version, so
// until it migrates, every control renders its default.

import { isJsonEqual, type Edit, type Site } from '@portfolio/schema';
import { migrateControls, type ControlChange } from './controls';
import { toPointer } from './diagnostics';
import { findVariant, type VariantRegistry } from './registry';

export type ControlsMigrationStatus =
  /** At the manifest's controls version: nothing to do. */
  | 'current'
  /** Stepped to the manifest's version. */
  | 'migrated'
  /** Newer than the manifest, from a later release of the variant: left as it is. */
  | 'newer'
  /** No migration reaches the manifest's version: left as it is. */
  | 'stuck'
  /** This build doesn't register the variant, so there's nothing to migrate by: left as it is. */
  | 'unregistered';

export interface ControlsMigrationEntry {
  readonly variant: string;
  readonly status: ControlsMigrationStatus;
  /** The stored version. */
  readonly from: number;
  /** The version it ends at: the manifest's once migrated, else the stored one. */
  readonly to: number;
  /** What each migration step changed, in order. */
  readonly changes: readonly ControlChange[];
}

export interface ControlsMigrationPlan {
  /** Every stored entry, by variant id. */
  readonly entries: readonly ControlsMigrationEntry[];
  /** The site document edits that make the migration, in order, for applyEdits(). Empty when every entry stays as it is. */
  readonly edits: readonly Edit[];
}

/** Each variant's stored controls, stepped to its manifest's version where this build can. */
export function planControlsMigration(
  site: Pick<Site, 'variantControls'>,
  registry: VariantRegistry,
): ControlsMigrationPlan {
  const entries: ControlsMigrationEntry[] = [];
  const edits: Edit[] = [];
  const stored = Object.entries(site.variantControls ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [variant, entry] of stored) {
    const left = (status: ControlsMigrationStatus): ControlsMigrationEntry => ({
      variant,
      status,
      from: entry.version,
      to: entry.version,
      changes: [],
    });
    const registered = findVariant(registry, variant);
    if (!registered) {
      entries.push(left('unregistered'));
      continue;
    }
    const target = registered.manifest.controls.version;
    if (entry.version === target) {
      entries.push(left('current'));
      continue;
    }
    const result = migrateControls(registered.manifest, entry);
    if (result.newer || result.entry.version !== target) {
      entries.push(left(result.newer ? 'newer' : 'stuck'));
      continue;
    }
    const at = ['variantControls', variant] as const;
    const before = entry.values;
    const after = result.entry.values;
    // Sets before deletes: a renamed control is added before its old name
    // goes, so a block mapping never empties into `{}` on the way.
    for (const [key, value] of Object.entries(after)) {
      if (!Object.hasOwn(before, key) || !isJsonEqual(before[key], value)) {
        edits.push({ pointer: toPointer([...at, 'values', key]), op: 'set', value });
      }
    }
    for (const key of Object.keys(before)) {
      if (!Object.hasOwn(after, key)) {
        edits.push({ pointer: toPointer([...at, 'values', key]), op: 'delete' });
      }
    }
    edits.push({ pointer: toPointer([...at, 'version']), op: 'set', value: target });
    entries.push({
      variant,
      status: 'migrated',
      from: entry.version,
      to: target,
      changes: result.changes,
    });
  }
  return { entries, edits };
}
