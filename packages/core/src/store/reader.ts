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
import type { StoreLog } from './common';
import type { ReadFs } from './fs-port';
import { storePaths, type RevisionId, type Sha256 } from './layout';
import { DamagedPointerError, readEvents, readLive, type LivePointer } from './pointer';
import { nodeReadFs } from './read-fs';
import { readManifest, revisionHealth } from './revisions';

// RevisionCatalogReader (#3, item 19): owner's CatalogReader, over the
// revision store. Each request stats publication/live.json, so a publish
// from this process or another shows on the next request; while the
// pointer hasn't moved, the answer is the one already worked out. When it
// has, the reader reads the revision the pointer names, checks every hash,
// and checks it as served (UnitChecks.validateLive), under which an
// unregistered variant only warns and renders on the fallback composition.
// One it can't serve is damaged or incompatible, and the reader serves the
// last known good in its place, `degraded`, with the reason: the most
// recently live revision that serves, without a tombstone. With none, it's
// `incompatible`; with no pointer, `empty`. It never rewrites the pointer:
// it gets the reads of node:fs and nothing else, and imports no module that
// writes. It keeps up to four served units by revision ID, and tells the
// composition root whether anything is servable each time it decides.

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
  // The decision for the pointer as last stat'ed, shared by every request
  // that stats the same file.
  let decided: { readonly key: string; readonly decision: Promise<Decision> } | undefined;
  let lastState: CatalogStatus['state'] | undefined;
  let lastDrift: string | undefined;
  // As the AssetStore finds one: a regular file under its hash, never a link.
  const hasBlob = async (hash: Sha256) => (await fs.lstat(paths.blob(hash)))?.isFile === true;

  /** The unit `id` serves, or why it can't. */
  async function serve(id: RevisionId): Promise<
    | { readonly ok: true; readonly unit: PublicationUnit; readonly unitHash: string }
    | {
        readonly ok: false;
        readonly reason: string;
      }
  > {
    const kept = units.get(id);
    if (kept) {
      units.delete(id);
      units.set(id, kept);
      return { ok: true, ...kept };
    }
    const health = await revisionHealth(fs, paths, id, checks, hasBlob, 'serve');
    if (health.state === 'removed') return { ok: false, reason: 'removed' };
    if (health.state !== 'ok') return { ok: false, reason: `${health.state}:${health.reason}` };
    const found = {
      unit: publicationUnitOf(health.revision.unit),
      unitHash: health.revision.unit.unitHash,
    };
    units.set(id, found);
    while (units.size > UNIT_CACHE_SIZE) units.delete(units.keys().next().value!);
    return { ok: true, ...found };
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

  async function drift(pointer: LivePointer): Promise<readonly RenderDrift[] | null> {
    if (!renderDrift) return null;
    const manifest = await readManifest(fs, paths, pointer.revisionId);
    if (!manifest) return null;
    const found = renderDrift(manifest.rendering);
    return found.length > 0 ? found : null;
  }

  async function decide(): Promise<Decision> {
    let pointer: LivePointer | null;
    let reason: string | undefined;
    try {
      pointer = await readLive(fs, paths);
    } catch (error) {
      if (!(error instanceof DamagedPointerError)) throw error;
      pointer = null;
      reason = 'pointer_damaged';
    }
    const base = {
      liveRevisionId: pointer?.revisionId ?? null,
      seq: pointer?.seq ?? null,
      unitHash: pointer?.unitHash ?? null,
    };
    if (!pointer && reason === undefined) {
      if (whenEmpty) {
        const live = await whenEmpty.getLive();
        return {
          live,
          status: {
            state: live.state,
            ...base,
            servingRevisionId: live.revisionId,
            renderDrift: null,
          },
        };
      }
      return {
        live: { state: 'empty', ...NOTHING },
        status: { state: 'empty', ...base, servingRevisionId: null, renderDrift: null },
      };
    }
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

  async function current(): Promise<Decision> {
    const stats = await fs.stat(paths.live);
    const key = stats ? `${stats.ino}:${stats.mtimeMs}:${stats.size}` : 'none';
    // An empty store asks whenEmpty every time, which keeps its own watch.
    if (decided?.key === key && key !== 'none') return decided.decision;
    const decision = decide();
    decided = { key, decision };
    try {
      const done = await decision;
      announce(done);
      return done;
    } catch (error) {
      if (decided?.decision === decision) decided = undefined;
      throw error;
    }
  }

  return Object.freeze({
    getLive: async () => (await current()).live,
    status: async () => (await current()).status,
  });
}
