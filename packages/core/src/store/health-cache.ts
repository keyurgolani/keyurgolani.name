import type { UnitChecks, UnitDiagnostic } from '../catalog/unit';
import { recordOwnerModule } from '../load-trace';
import type { ReadFs } from './fs-port';
import type { RevisionId, Sha256, StorePaths } from './layout';
import { isTombstoned, revisionHealth, type HealthPurpose } from './revisions';

// What the running build makes of each revision, kept (#3, item 14, and
// the Slice 1 review's F9), so status(), the last-known-good walk, and
// revision.list don't check every revision on every call. A revision never
// changes once written, so its verdict holds until something it rests on
// does: the pointer moves, when every check reruns, as item 14 asks; a
// tombstone appears; or a blob it references goes, or comes back. Each
// kept verdict is checked for the last two, by stats alone, before it's
// used. A revision unreadable for a failure that may pass, such as EACCES
// or EMFILE, isn't kept: the next call checks it again. The checks are the
// build's, and a new build is a new process, so a verdict never outlives
// its build. It keeps verdicts, never revisions, so it holds no content.

recordOwnerModule('core/store/health-cache');

/** RevisionHealth without the revision: what the PublicationService needs of one. */
export type HealthVerdict =
  | { readonly state: 'ok'; readonly unitHash: Sha256 }
  | { readonly state: 'damaged'; readonly reason: string }
  | {
      readonly state: 'incompatible';
      readonly reason: string;
      readonly diagnostics: readonly UnitDiagnostic[];
    }
  | { readonly state: 'removed' };

interface Kept {
  readonly verdict: HealthVerdict;
  /** The blobs the revision references, and whether each was there. */
  readonly blobs: readonly (readonly [Sha256, boolean])[];
  /** Set for a read failure that may pass: the verdict isn't kept past its own call. */
  readonly transient?: true;
}

export interface HealthCacheOptions {
  readonly fs: ReadFs;
  readonly paths: StorePaths;
  readonly checks: UnitChecks;
  readonly hasBlob: (hash: Sha256) => Promise<boolean>;
}

export type CachedHealth = (id: RevisionId, purpose: HealthPurpose) => Promise<HealthVerdict>;

export function healthCache({ fs, paths, checks, hasBlob }: HealthCacheOptions): CachedHealth {
  const kept = new Map<string, Promise<Kept>>();
  // live.json as last stat'ed: when it changes, every verdict goes.
  let pointer: string | undefined;

  async function check(id: RevisionId, purpose: HealthPurpose): Promise<Kept> {
    const health = await revisionHealth(fs, paths, id, checks, hasBlob, purpose);
    switch (health.state) {
      case 'ok':
        return {
          verdict: { state: 'ok', unitHash: health.revision.unit.unitHash },
          blobs: health.revision.manifest.blobs.map((blob) => [blob, true] as const),
        };
      case 'incompatible': {
        const blobs: (readonly [Sha256, boolean])[] = [];
        for (const blob of health.revision.manifest.blobs) blobs.push([blob, await hasBlob(blob)]);
        return {
          verdict: {
            state: 'incompatible',
            reason: health.reason,
            diagnostics: health.diagnostics,
          },
          blobs,
        };
      }
      case 'damaged':
        return {
          verdict: { state: 'damaged', reason: health.reason },
          blobs: [],
          ...(health.transient ? { transient: true as const } : {}),
        };
      default:
        return { verdict: health, blobs: [] };
    }
  }

  /** Whether a kept verdict still holds: no tombstone since, and every blob as it was. */
  async function holds(id: RevisionId, entry: Kept): Promise<boolean> {
    if (entry.verdict.state === 'removed') return true;
    if (await isTombstoned(fs, paths, id)) return false;
    for (const [blob, present] of entry.blobs) {
      if ((await hasBlob(blob)) !== present) return false;
    }
    return true;
  }

  return async function health(id, purpose) {
    const stats = await fs.stat(paths.live);
    const key = stats ? `${stats.ino}:${stats.mtimeMs}:${stats.size}` : 'none';
    if (key !== pointer) {
      kept.clear();
      pointer = key;
    }
    const name = `${purpose}:${id}`;
    const found = kept.get(name);
    if (found) {
      const entry = await found.catch(() => undefined);
      if (entry && (await holds(id, entry))) return entry.verdict;
      if (kept.get(name) === found) kept.delete(name);
    }
    const checking = check(id, purpose);
    kept.set(name, checking);
    try {
      const entry = await checking;
      if (entry.transient && kept.get(name) === checking) kept.delete(name);
      return entry.verdict;
    } catch (error) {
      if (kept.get(name) === checking) kept.delete(name);
      throw error;
    }
  };
}
