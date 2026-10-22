import type {
  CatalogReader,
  CatalogStatus,
  LiveRevision,
  PublicationUnit,
  RenderDrift,
  SetServable,
} from '../catalog/port';
import type { Rendering, UnitChecks } from '../catalog/unit';
import { publicationUnitOf } from '../catalog/view';
import { recordOwnerModule } from '../load-trace';
import { StoreError, type StoreLog } from './common';
import type { FileStats, ReadFs } from './fs-port';
import { storePaths, type RevisionId, type Sha256 } from './layout';
import { DamagedPointerError, hasHistory, readEvents, readLive, type LivePointer } from './pointer';
import { nodeReadFs } from './read-fs';
import { isTombstoned, readManifest, readRevision, revisionHealth } from './revisions';

// RevisionCatalogReader (#3, item 19): owner's CatalogReader, over the
// revision store. Each request stats publication/live.json, so a publish
// from this process or another shows on the next request; while the
// pointer hasn't moved, the answer is the one already worked out, and no
// request checks a revision. When it has, the reader reads the revision the
// pointer names, checks every hash, and checks its text as served
// (UnitChecks.validateLive), under which an unregistered variant only warns
// and renders on the fallback composition; what it serves is the pair that
// check passed. One it can't serve is damaged or incompatible, and the
// reader serves the last known good in its place, `degraded`, with the
// reason: the most recently live revision that serves, without a
// tombstone. With none, it's `incompatible`. With no pointer it's `empty`,
// unless the store has published before, when the pointer is damaged. It
// never rewrites the pointer: it gets the reads of node:fs and nothing
// else, and imports no module that writes. It keeps up to four served units
// by revision ID; as the pointer moves to a kept one, its tombstone, its
// files' hashes, and its blobs are checked again, and only the validator is
// skipped. It tells the composition root whether anything is servable each
// time it decides.

recordOwnerModule('core/store/reader');

/** How many served units the reader keeps, by revision ID. */
export const UNIT_CACHE_SIZE = 4;

export interface RevisionCatalogOptions {
  /** PORTFOLIO_DATA_DIR. */
  readonly dataDir: string;
  /** The build's checks. A revision is checked as served. */
  readonly checks: UnitChecks;
  /**
   * What serves while nothing is published. Until #3's Slice 3 imports the
   * mounted documents at first start, owner's empty store serves them.
   */
  readonly whenEmpty?: CatalogReader;
  /** How a live manifest's rendering differs from the build's; none when it doesn't. */
  readonly renderDrift?: (rendering: Rendering) => readonly RenderDrift[];
  /** Told whether anything is servable each time the reader decides. */
  readonly setServable?: SetServable;
  readonly log?: StoreLog;
  /** The reads. Tests pass their own. */
  readonly fs?: ReadFs;
}

export interface RevisionCatalogReader extends CatalogReader {
  /** The serving state, the IDs behind it, and the render drift, as of now. */
  status(): Promise<CatalogStatus>;
}

interface Decision {
  readonly live: LiveRevision;
  readonly status: CatalogStatus;
}

const NOTHING = { revisionId: null, unitHash: null, unit: null } as const;

/**
 * The decision for a store that has never published: whenEmpty answers,
 * asked on every request, since it keeps its own watch.
 */
const EMPTY = Symbol('empty');
type Found = Decision | typeof EMPTY;

export function revisionCatalogReader({
  dataDir,
  checks,
  whenEmpty,
  renderDrift,
  setServable = () => {},
  log = () => {},
  fs = nodeReadFs,
}: RevisionCatalogOptions): RevisionCatalogReader {
  const paths = storePaths(dataDir);
  // Units that served, by revision ID, the most recently used last.
  const units = new Map<
    RevisionId,
    { readonly unit: PublicationUnit; readonly unitHash: string }
  >();
  // The decision for the pointer as last stat'ed, or with none, for the
  // store's events/ and revisions/, shared by every request that finds the same.
  let decided: { readonly key: string; readonly decision: Promise<Found> } | undefined;
  let lastState: CatalogStatus['state'] | undefined;
  let lastDrift: string | undefined;
  // As the AssetStore finds one: a regular file under its hash, never a
  // link. One that can't be looked at isn't there.
  const hasBlob = async (hash: Sha256) =>
    (await fs.lstat(paths.blob(hash)).catch(() => null))?.isFile === true;

  /**
   * Whether a kept unit still serves, as the pointer moves to it: no
   * tombstone, every file still whole with the hashes it had, and every
   * blob there. What it skips is the validator, whose verdict on the same
   * text, with the same build, can't change.
   */
  async function stillServes(
    id: RevisionId,
    kept: { readonly unitHash: string },
  ): Promise<boolean> {
    if (await isTombstoned(fs, paths, id)) return false;
    const read = await readRevision(fs, paths, id);
    if (!read.ok || read.revision.unit.unitHash !== kept.unitHash) return false;
    for (const blob of read.revision.manifest.blobs) if (!(await hasBlob(blob))) return false;
    return true;
  }

  /** The unit `id` serves, or why it can't. */
  async function serve(id: RevisionId): Promise<
    | { readonly ok: true; readonly unit: PublicationUnit; readonly unitHash: string }
    | {
        readonly ok: false;
        readonly reason: string;
      }
  > {
    const kept = units.get(id);
    units.delete(id);
    if (kept && (await stillServes(id, kept))) {
      units.set(id, kept);
      return { ok: true, unit: kept.unit, unitHash: kept.unitHash };
    }
    const health = await revisionHealth(fs, paths, id, checks, hasBlob, 'serve');
    if (health.state === 'removed') return { ok: false, reason: 'removed' };
    if (health.state !== 'ok') return { ok: false, reason: `${health.state}:${health.reason}` };
    const { unit } = health.revision;
    // The models the validator passed: the stored text, as this build parses it.
    const served = {
      ...unit,
      portfolio: { ...unit.portfolio, model: health.served.portfolio },
      site: { ...unit.site, model: health.served.site },
    };
    const found = { unit: publicationUnitOf(served), unitHash: unit.unitHash };
    units.set(id, found);
    while (units.size > UNIT_CACHE_SIZE) units.delete(units.keys().next().value!);
    return { ok: true, unit: found.unit, unitHash: found.unitHash };
  }

  /** The last known good: the most recently live revision that serves, other than `skip`. */
  async function lastKnownGood(skip: RevisionId | null) {
    const events = await readEvents(fs, paths);
    const tried = new Set<RevisionId>(skip ? [skip] : []);
    for (let index = events.length - 1; index >= 0; index--) {
      const id = events[index]!.revisionId;
      if (tried.has(id)) continue;
      tried.add(id);
      const served = await serve(id);
      if (served.ok) return { id, ...served };
    }
    return null;
  }

  /** Where the live manifest's rendering differs from the build's: what the owner sees, so a failure here is none. */
  async function drift(pointer: LivePointer): Promise<readonly RenderDrift[] | null> {
    if (!renderDrift) return null;
    try {
      const manifest = await readManifest(fs, paths, pointer.revisionId);
      if (!manifest) return null;
      const found = renderDrift(manifest.rendering);
      return found.length > 0 ? found : null;
    } catch {
      return null;
    }
  }

  /** What serves while the store has never published: whenEmpty's answer, or nothing. */
  async function empty(): Promise<Decision> {
    const base = { liveRevisionId: null, seq: null, unitHash: null };
    if (!whenEmpty) {
      return {
        live: { state: 'empty', ...NOTHING },
        status: { state: 'empty', ...base, servingRevisionId: null, renderDrift: null },
      };
    }
    const live = await whenEmpty.getLive();
    return {
      live,
      status: { state: live.state, ...base, servingRevisionId: live.revisionId, renderDrift: null },
    };
  }

  async function decide(): Promise<Found> {
    let pointer: LivePointer | null;
    let reason: string | undefined;
    try {
      pointer = await readLive(fs, paths);
    } catch (error) {
      if (!(error instanceof DamagedPointerError)) throw error;
      pointer = null;
      reason = 'pointer_damaged';
    }
    if (!pointer && reason === undefined) {
      if (!(await hasHistory(fs, paths))) return EMPTY;
      // live.json is gone from a store that has published, as after a bad
      // restore: the last known good serves, never whenEmpty's documents.
      reason = 'pointer_damaged';
      log({ level: 'error', event: 'store.pointer.missing', code: 'pointer_damaged' });
    }
    const base = {
      liveRevisionId: pointer?.revisionId ?? null,
      seq: pointer?.seq ?? null,
      unitHash: pointer?.unitHash ?? null,
    };
    const drifted = pointer ? await drift(pointer) : null;
    if (pointer) {
      const served = await serve(pointer.revisionId);
      if (served.ok) {
        return {
          live: { state: 'live', revisionId: pointer.revisionId, ...served },
          status: {
            state: 'live',
            ...base,
            servingRevisionId: pointer.revisionId,
            renderDrift: drifted,
          },
        };
      }
      reason = served.reason;
    }
    const good = await lastKnownGood(pointer?.revisionId ?? null);
    if (good) {
      return {
        live: { state: 'degraded', revisionId: good.id, unit: good.unit, unitHash: good.unitHash },
        status: {
          state: 'degraded',
          ...base,
          servingRevisionId: good.id,
          reason,
          renderDrift: drifted,
        },
      };
    }
    return {
      live: { state: 'incompatible', ...NOTHING },
      status: {
        state: 'incompatible',
        ...base,
        servingRevisionId: null,
        reason,
        renderDrift: drifted,
      },
    };
  }

  /** Logs what changed, and says whether anything serves. */
  function announce({ status }: Decision): void {
    setServable(status.state === 'live' || status.state === 'degraded');
    if (status.state !== lastState) {
      lastState = status.state;
      if (status.state === 'degraded' || status.state === 'incompatible') {
        log({
          level: status.state === 'degraded' ? 'warn' : 'error',
          event: `store.catalog.${status.state}`,
          ...(status.liveRevisionId ? { revisionId: status.liveRevisionId } : {}),
          ...(status.servingRevisionId ? { servingRevisionId: status.servingRevisionId } : {}),
          ...(status.reason ? { code: status.reason } : {}),
        });
      }
    }
    const drifted = status.renderDrift ? JSON.stringify(status.renderDrift) : undefined;
    if (drifted !== lastDrift) {
      lastDrift = drifted;
      if (status.renderDrift) {
        log({
          level: 'warn',
          event: 'store.render-drift',
          ...(status.liveRevisionId ? { revisionId: status.liveRevisionId } : {}),
          drift: status.renderDrift,
        });
      }
    }
  }

  /**
   * A decision that failed, such as for a directory that can't be listed:
   * nothing serves, and its code says why, never the error, which can name
   * a path.
   */
  function failure(error: unknown): Decision {
    const reason = error instanceof StoreError ? error.code : 'storage_unavailable';
    return {
      live: { state: 'incompatible', ...NOTHING },
      status: {
        state: 'incompatible',
        liveRevisionId: null,
        seq: null,
        unitHash: null,
        servingRevisionId: null,
        reason,
        renderDrift: null,
      },
    };
  }

  /**
   * The key a decision is kept under: live.json's stat; with none, those of
   * events/ and revisions/, which change as anything lands in either or
   * leaves it; or the error that stopped it.
   */
  async function pointerKey(): Promise<string> {
    const of = (stats: FileStats | null) => (stats ? `${stats.ino}:${stats.mtimeMs}` : 'none');
    try {
      const stats = await fs.stat(paths.live);
      if (stats) return `${stats.ino}:${stats.mtimeMs}:${stats.size}`;
      return `none:${of(await fs.stat(paths.events))}:${of(await fs.stat(paths.revisions))}`;
    } catch (error) {
      return `unreadable:${String((error as NodeJS.ErrnoException)?.code)}`;
    }
  }

  async function current(): Promise<Decision> {
    const key = await pointerKey();
    let decision: Promise<Found>;
    if (decided?.key === key) {
      decision = decided.decision;
    } else {
      // A decision that throws is kept, as a failure: a broken store isn't
      // decided again on every request, and no raw error reaches a render.
      decision = decide().catch(failure);
      decided = { key, decision };
    }
    const found = await decision;
    // An empty store asks whenEmpty every time, which keeps its own watch.
    const done = found === EMPTY ? await empty().catch(failure) : found;
    // The latest decision sets the flag on every call, a kept one included,
    // so nothing else has to ask the reader again for visitors to see it.
    // One a newer pointer overtook while it ran says nothing.
    if (decided?.decision === decision) announce(done);
    return done;
  }

  return Object.freeze({
    getLive: async () => (await current()).live,
    status: async () => (await current()).status,
  });
}
