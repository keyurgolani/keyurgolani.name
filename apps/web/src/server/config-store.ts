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
}

export const NOT_LOADED =
  'The deployment configuration is not loaded. instrumentation register() validates it at startup.';

const STORE: unique symbol = Symbol.for('keyurgolani.portfolio.deployment');
const SERVABLE: unique symbol = Symbol.for('keyurgolani.portfolio.servable');

type Holder = typeof globalThis & { [STORE]?: DeploymentState; [SERVABLE]?: boolean };

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
 * something says otherwise. #3's CatalogReader sets it at startup and on
 * every getLive(), false while the catalog is empty or incompatible, and
 * proxy.ts answers each visitor page with a 503 meanwhile, since a page
 * can't set its own status.
 */
export function isServable(): boolean {
  return (globalThis as Holder)[SERVABLE] ?? true;
}

/** Called by #3's CatalogReader, and by tests. */
export function setServable(servable: boolean): void {
  (globalThis as Holder)[SERVABLE] = servable;
}
