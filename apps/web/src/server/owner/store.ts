import 'server-only';
import type { CatalogReader, RenderDrift, Rendering, UnitChecks } from '@portfolio/core';
import {
  claimServer,
  filesystemAuditSink,
  openStore,
  preflight,
  revisionCatalogReader,
  StoreError,
  type AuditSink,
  type PreflightCode,
  type RevisionCatalogReader,
  type ServerClaim,
  type Store,
  type StoreLogEntry,
} from '@portfolio/core/owner';
import type { ConfigIssue, DeploymentConfig } from '../config';
import { recordOwnerModule } from '../load-trace';
import { log } from '../log';

// Owner's revision store (#3, items 19 and 21), over PORTFOLIO_DATA_DIR, and
// the reader owner's visitors are served through. Until #3's Slice 3 imports
// the mounted documents at first start, an empty store serves them, so
// production owner keeps serving what it did; once a revision is published,
// the data directory is authoritative and the reader serves it, a publish
// from another process included. The startup requirements run its checks:
// data.directory's preflight and server claim, then revision.integrity's
// repair, the live revision's hashes, render drift, and the state. Typed by
// shape, so this module doesn't import the composition root.

recordOwnerModule('server/owner/store');

const KEY = 'PORTFOLIO_DATA_DIR';
/** How often readiness may run the data directory's probe. */
export const PROBE_INTERVAL_MS = 30_000;

export interface OwnerStoreInput {
  readonly config: DeploymentConfig;
  /** The build's checks, on the deployment's origin. */
  readonly checks: UnitChecks;
  /** What serves while nothing is published: the mounted documents, until Slice 3's first-start import. */
  readonly documents: CatalogReader;
  /** Where a live manifest's rendering differs from the build's. */
  readonly renderDrift?: (rendering: Rendering) => readonly RenderDrift[];
  /** The composition root's: whether visitor pages can render. */
  readonly setServable: (servable: boolean) => void;
  /** Where publication events join #2's audit log. Defaults to the data directory's. */
  readonly audit?: AuditSink;
  readonly now?: () => number;
}

export interface OwnerStore {
  readonly store: Store;
  readonly reader: RevisionCatalogReader;
  /** data.directory's #3 half: the preflight, then publication/server.json. */
  checkDirectory(): Promise<readonly ConfigIssue[]>;
  /** revision.integrity: startup repair, then the live revision as the reader serves it. */
  checkIntegrity(): Promise<readonly ConfigIssue[]>;
  /** Readiness's data-directory check: item 3's write, sync, and rename probe, run at most every 30 s. */
  probe(): Promise<boolean>;
  /** Lets publication/server.json go, at once, as the process exits. */
  release(): void;
}

/** What startup can find wrong with the data directory or the store in it. */
type FindingCode =
  | PreflightCode
  | 'data_dir_in_use'
  | 'store_repair_failed'
  | 'revision_damaged'
  | 'revision_unservable';

const MESSAGES: Readonly<Record<FindingCode, string>> = {
  data_dir_missing: 'PORTFOLIO_DATA_DIR names no directory. Create it, or mount a volume there.',
  data_dir_unreachable:
    "The server can't reach PORTFOLIO_DATA_DIR: a directory above it doesn't let the server's " +
    'user look in, or a link loops.',
  data_dir_not_private:
    'Another user owns PORTFOLIO_DATA_DIR, or its group or anyone may write it, so someone else ' +
    "could swap a directory in it. Make it the server's own, at 0700, as the image does for " +
    '/var/lib/portfolio.',
  data_dir_linked:
    'A store directory in PORTFOLIO_DATA_DIR, such as drafts/, is a symbolic link, and the store ' +
    'never writes through one. Put the directory itself there.',
  data_dir_not_writable:
    "The server can't write in PORTFOLIO_DATA_DIR. Give the server's user (uid 1001 in the " +
    'image) write access, as the image does for /var/lib/portfolio.',
  data_dir_rename_failed:
    "The server can't rename files in PORTFOLIO_DATA_DIR. Use a local Linux volume.",
  data_dir_in_source:
    'PORTFOLIO_DATA_DIR is inside PORTFOLIO_SOURCE_DIR, or holds it. Keep the data directory ' +
    'apart from the mounted documents.',
  store_layout_unsupported:
    'PORTFOLIO_DATA_DIR holds a store in a layout this build does not read. Run the build that ' +
    'wrote it, or restore a backup taken with this one.',
  data_dir_in_use:
    'Another owner server holds PORTFOLIO_DATA_DIR. Stop it first: one server runs per data ' +
    'directory. A claim its server stopped refreshing is free after 45 seconds.',
  store_repair_failed:
    "The store's startup repair didn't finish, so what a crash left is still there. The next " +
    'publish or rollback finishes it.',
  revision_damaged:
    "The live revision can't be served, so the last known good is served in its place. Recover " +
    'or roll back to a revision this build serves. The store.catalog.degraded line says why.',
  revision_unservable:
    'No published revision can be served, so visitors get 503. Publish a revision, or restore a ' +
    'backup. The store.catalog.incompatible line says why.',
};

function finding(code: FindingCode, severity: ConfigIssue['severity'] = 'fatal'): ConfigIssue {
  return { severity, key: KEY, code, message: MESSAGES[code] };
}

// The stores this module made, so a requirement check can tell one from any
// other object in its context.
const stores = new WeakSet<OwnerStore>();

/** The owner store in a requirement's context, if the owner branch put one there. */
export function ownerStoreOf(value: unknown): OwnerStore | undefined {
  return typeof value === 'object' && value !== null && stores.has(value as OwnerStore)
    ? (value as OwnerStore)
    : undefined;
}

/** Store log lines through the server's log: IDs, seq, stage, duration, and drift, never content. */
const storeLog = (entry: StoreLogEntry) => log({ ...entry });

export function ownerStore({
  config,
  checks,
  documents,
  renderDrift,
  setServable,
  audit,
  now,
}: OwnerStoreInput): OwnerStore {
  // The data.directory requirement refuses startup without one.
  const dataDir = config.dataDir ?? '';
  const store = openStore({
    dataDir,
    checks,
    log: storeLog,
    audit:
      audit ??
      filesystemAuditSink({ dataDir, ...(now ? { now } : {}), log: (entry) => log(entry) }),
    ...(now ? { now } : {}),
  });
  const reader = revisionCatalogReader({
    dataDir,
    checks,
    whenEmpty: documents,
    ...(renderDrift ? { renderDrift } : {}),
    setServable,
    log: storeLog,
  });
  let claim: ServerClaim | undefined;
  let ready = false;
  let probed: { readonly at: number; readonly result: Promise<boolean> } | undefined;
  const clock = now ?? Date.now;

  const owner: OwnerStore = Object.freeze({
    store,
    reader,
    async checkDirectory() {
      const problem = await preflight({ dataDir, sourceDir: config.sourceDir });
      if (problem) return [finding(problem)];
      const claimed = await claimServer({ paths: store.paths, lock: store.lock, log: storeLog });
      if (!claimed.ok) return [finding(claimed.code)];
      claim = claimed.claim;
      ready = true;
      return [];
    },
    async checkIntegrity() {
      // Nothing to check in a directory that failed its own.
      if (!ready) return [];
      const issues: ConfigIssue[] = [];
      try {
        await store.publication.repair();
      } catch (error) {
        log({
          level: 'warn',
          event: 'store.repair.failed',
          code: error instanceof StoreError ? error.code : 'storage_unavailable',
        });
        issues.push(finding('store_repair_failed', 'warning'));
      }
      const status = await reader.status();
      if (status.state === 'degraded') issues.push(finding('revision_damaged'));
      if (status.state === 'incompatible') issues.push(finding('revision_unservable'));
      return issues;
    },
    probe() {
      const at = clock();
      if (!probed || at - probed.at >= PROBE_INTERVAL_MS) {
        const result = preflight({ dataDir, sourceDir: config.sourceDir }).then(
          (problem) => problem === null,
          () => false,
        );
        probed = { at, result };
      }
      return probed.result;
    },
    release() {
      claim?.releaseSync();
    },
  });
  stores.add(owner);
  return owner;
}
