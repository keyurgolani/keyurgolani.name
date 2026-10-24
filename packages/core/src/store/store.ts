import type { AuditSink } from '../audit/sink';
import { recordOwnerModule } from '../load-trace';
import { filesystemAssetStore, type AssetStore } from './assets';
import type { StoreLog } from './common';
import { filesystemDraftStore, type DraftStore } from './drafts';
import { nodeFs, type FsPort } from './fs-port';
import { storePaths, type StorePaths } from './layout';
import { publicationLock, type PublicationLock } from './lock';
import { filesystemPublicationService, type PublicationService } from './publication';
import { filesystemRevisionStore, type RevisionStore } from './revisions';
import type { UnitChecks } from '../catalog/unit';

// The revision store (#3) over one data directory: the DraftStore,
// RevisionStore, PublicationService, and AssetStore, sharing its paths and
// the publication lock. Opening it touches nothing on disk; startup runs
// preflight() first, then publication.repair(), and claims the directory
// with claimServer().

recordOwnerModule('core/store/store');

export interface StoreOptions {
  /** PORTFOLIO_DATA_DIR. */
  readonly dataDir: string;
  /** #4's composite validator and what derives from a valid unit, bound by the composition root. */
  readonly checks: UnitChecks;
  /** #2's AuditSink, which publication events join. */
  readonly audit?: AuditSink;
  readonly log?: StoreLog;
  /** The file operations; tests pass one with crash points. */
  readonly fs?: FsPort;
  readonly now?: () => number;
  /** How long a waiter waits for the lock: 5 s. */
  readonly lockWaitMs?: number;
}

export interface Store {
  readonly paths: StorePaths;
  readonly lock: PublicationLock;
  readonly drafts: DraftStore;
  readonly revisions: RevisionStore;
  readonly publication: PublicationService;
  readonly assets: AssetStore;
}

export function openStore({
  dataDir,
  checks,
  audit,
  log,
  fs = nodeFs,
  now,
  lockWaitMs,
}: StoreOptions): Store {
  const paths = storePaths(dataDir);
  const lock = publicationLock({
    fs,
    paths,
    ...(now ? { now } : {}),
    ...(lockWaitMs === undefined ? {} : { waitMs: lockWaitMs }),
    ...(log ? { log } : {}),
  });
  const assets = filesystemAssetStore({ fs, paths });
  const shared = {
    fs,
    paths,
    lock,
    checks,
    assets,
    ...(now ? { now } : {}),
    ...(log ? { log } : {}),
  };
  const publication = filesystemPublicationService({ ...shared, ...(audit ? { audit } : {}) });
  return Object.freeze({
    paths,
    lock,
    assets,
    // A draft on a damaged base compares as the publish gate does (#10).
    drafts: filesystemDraftStore({ ...shared, lastKnownGood: () => publication.lastKnownGood() }),
    revisions: filesystemRevisionStore({ fs, paths, checks, hasBlob: (hash) => assets.has(hash) }),
    publication,
  });
}
