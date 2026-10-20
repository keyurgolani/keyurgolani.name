import 'server-only';
import type { DeploymentConfig } from '../config';
import type { CatalogAdapter } from '../config-summary';
import type { Handler } from '../dispatcher';
import { recordOwnerModule } from '../load-trace';
import { configStatus } from './config-status';

// Owner code. Only composition.ts loads it, through import() in its owner
// branch; check:deps fails any other import, so demo and read-only never
// evaluate a module here.

recordOwnerModule('server/owner/index');

export interface OwnerInput {
  readonly config: DeploymentConfig;
  readonly catalog: CatalogAdapter;
}

/** The owner operation handlers, by operation name. */
export function ownerHandlers({ config, catalog }: OwnerInput): Readonly<Record<string, Handler>> {
  return Object.freeze({ 'config.status': configStatus(config, catalog) });
}
