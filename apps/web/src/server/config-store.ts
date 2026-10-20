import type { CatalogReader } from './catalog-port';
import type { DeploymentConfig } from './config';

// Holds what instrumentation register() validated and built, frozen, on a
// globalThis symbol, so every bundle in the server process reads the same
// object. Importing this module does nothing: it reads no environment
// variables and touches no files.

/** The validated deployment: its configuration and its catalog adapter. */
export interface DeploymentState {
  readonly config: DeploymentConfig;
  readonly catalog: CatalogReader;
}

export const NOT_LOADED =
  'The deployment configuration is not loaded. instrumentation register() validates it at startup.';

const STORE: unique symbol = Symbol.for('keyurgolani.portfolio.deployment');

type Holder = typeof globalThis & { [STORE]?: DeploymentState };

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
