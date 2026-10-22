import 'server-only';
import type { DeploymentConfig } from '../config';
import type { CatalogAdapter } from '../config-summary';
import type { Handler } from '../dispatcher';
import { recordOwnerModule } from '../load-trace';
import type { LiveVariantHealth } from '../variant-health';
import { configStatus } from './config-status';
import type { OwnerStore } from './store';

// Owner code. Only composition.ts loads it, through import() in its owner
// branch; check:deps fails any other import outside tests, so demo and
// read-only never evaluate a module here.

recordOwnerModule('server/owner/index');

/** For the auth provider: composition.ts hands it on as the provider loads. */
export { mintSession } from './session-mint';
/** The revision store and owner's reader (#3), which the owner requirements share. */
export { ownerStore, type OwnerStore, type OwnerStoreInput } from './store';

/** #7's preview grants, which composition.ts binds to the provider's sessions. */
export { ownerPreviews, type OwnerPreviewInput, type OwnerPreviews } from './preview';

export interface OwnerInput {
  readonly config: DeploymentConfig;
  readonly catalog: CatalogAdapter;
  /** The revision store and its reader (#3). */
  readonly store: OwnerStore;
  /** How the live site's variant renders, for config.status. */
  readonly variantHealth: () => Promise<LiveVariantHealth>;
}

/** The owner operation handlers, by operation name. */
export function ownerHandlers({
  config,
  catalog,
  store,
  variantHealth,
}: OwnerInput): Readonly<Record<string, Handler>> {
  return Object.freeze({
    'config.status': configStatus(config, catalog, variantHealth, () => store.reader.status()),
  });
}
