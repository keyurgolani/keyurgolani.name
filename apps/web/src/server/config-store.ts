import type { CatalogReader } from './catalog-port';
import type { DeploymentConfig } from './config';
import type { PreviewGrantsPort } from './preview-port';
import type { Dispatch, StudioPages } from './studio-port';

// Holds what instrumentation register() validated and built, frozen, on a
// globalThis symbol, so every bundle in the server process reads the same
// object, proxy.ts included. Importing this module does nothing: it reads
// no environment variables and touches no files.

/** The validated deployment: its configuration and what the composition root built for it. */
export interface DeploymentState {
  readonly config: DeploymentConfig;
  readonly catalog: CatalogReader;
  /** The Studio transport's dispatcher, bound to this profile's operations. */
  readonly dispatch: Dispatch;
  /** Startup requirements that failed with `failure: 'degraded'`; empty when none did. */
  readonly degraded: readonly string[];
  /** How Studio pages find their session (#2). Only owner's composition binds it. */
  readonly pages?: StudioPages;
  /** How grant paths are checked and what they render (#7). Only owner's composition binds it. */
  readonly previews?: PreviewGrantsPort;
  /** Owner only: whether the data directory passes its write, sync, and rename probe (#3), at most every 30 s. */
  readonly dataDirectory?: () => Promise<boolean>;
  /** Owner only: lets the data directory's server claim go, at once (#3). register() runs it as the process exits. */
  readonly release?: () => void;
}

export const NOT_LOADED =
  'The deployment configuration is not loaded. instrumentation register() validates it at startup.';

const STORE: unique symbol = Symbol.for('keyurgolani.portfolio.deployment');
const SERVABLE: unique symbol = Symbol.for('keyurgolani.portfolio.servable');
const LIVE_COMPOSITION: unique symbol = Symbol.for('keyurgolani.portfolio.live-composition');

type Holder = typeof globalThis & {
  [STORE]?: DeploymentState;
  [SERVABLE]?: boolean;
  [LIVE_COMPOSITION]?: string;
};

export function getDeploymentState(): DeploymentState | undefined {
  return (globalThis as Holder)[STORE];
}

/** The frozen deployment configuration, or undefined before register() has run. */
export function getDeploymentConfig(): DeploymentConfig | undefined {
  return getDeploymentState()?.config;
}

/** The frozen deployment configuration. Throws before register() has run. */
export function requireDeploymentConfig(): DeploymentConfig {
  const config = getDeploymentConfig();
  if (!config) throw new Error(NOT_LOADED);
  return config;
}

/** Called by register() once the deployment validates, and by tests. */
export function setDeploymentState(state: DeploymentState | undefined): void {
  (globalThis as Holder)[STORE] = state === undefined ? undefined : Object.freeze({ ...state });
}

/**
 * Whether visitor pages can render (#5, Slice 3, item 6). It's true until
 * something says otherwise. #3's RevisionCatalogReader sets it, through the
 * callback the composition root passes it, each time it decides what serves:
 * false while nothing is servable, `empty` or `incompatible`, and proxy.ts
 * answers each visitor page with a 503 meanwhile, since a page can't set its
 * own status, once servableAgain() says it still isn't.
 */
export function isServable(): boolean {
  return (globalThis as Holder)[SERVABLE] ?? true;
}

/** Called by #3's CatalogReader, and by tests. */
export function setServable(servable: boolean): void {
  (globalThis as Holder)[SERVABLE] = servable;
}

/** How long proxy.ts waits on the catalog before it answers 503 all the same. */
export const RECHECK_MS = 1_000;

/** The catalog read servableAgain() started, which every request meanwhile waits on. */
let asking: Promise<boolean> | undefined;

/**
 * Whether visitor pages can render once the catalog has read again, for
 * proxy.ts while isServable() says no: #3's reader sets the flag on each
 * read, so a publish from another process shows on the next one. One read
 * at a time, and false, never a throw, when it fails or takes longer than
 * RECHECK_MS.
 */
export function servableAgain(): Promise<boolean> {
  const catalog = getDeploymentState()?.catalog;
  if (!catalog) return Promise.resolve(isServable());
  asking ??= (async () => catalog.getLive())()
    .then(
      () => isServable(),
      () => false,
    )
    .finally(() => {
      asking = undefined;
    });
  const read = asking;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), RECHECK_MS);
    void read.then((servable) => {
      clearTimeout(timer);
      resolve(servable);
    });
  });
}

/**
 * The composition the live revision renders (#6, Slice 2): the id of the
 * variant its site selects, or the fallback composition's when this build
 * doesn't register that one. The composition root's reader writes it on
 * every getLive(), whichever reader the profile has, and register() reads
 * the live revision once at startup, so it's set before the first request.
 * proxy.ts picks a visitor page's experience segment from it, and the page
 * there checks it again, so both read this one value. Undefined until then.
 */
export function liveComposition(): string | undefined {
  return (globalThis as Holder)[LIVE_COMPOSITION];
}

/** Called by the composition root's reader on every getLive(), and by tests. */
export function setLiveComposition(id: string | undefined): void {
  (globalThis as Holder)[LIVE_COMPOSITION] = id;
}
