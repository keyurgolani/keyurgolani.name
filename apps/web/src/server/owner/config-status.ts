import 'server-only';
import { assertAuthorized } from '../authorize';
import type { DeploymentConfig } from '../config';
import { configSummary, type CatalogAdapter } from '../config-summary';
import type { Handler } from '../dispatcher';
import { recordOwnerModule } from '../load-trace';
import type { ConfigStatus } from '../operations';
import type { VariantHealth } from '../variant-health';

recordOwnerModule('server/owner/config-status');

/**
 * The `config.status` query, for an owner session: the redacted deployment
 * summary, and how the live site's variant renders, read per request (#5):
 * `degraded` when the fallback composition stands in for it.
 */
export function configStatus(
  config: DeploymentConfig,
  catalog: CatalogAdapter,
  variantHealth: () => Promise<VariantHealth>,
): Handler {
  const summary = configSummary(config, catalog);
  return async (authorized): Promise<ConfigStatus> => {
    assertAuthorized(authorized, 'config.status');
    return { ...summary, variant: await variantHealth() };
  };
}
