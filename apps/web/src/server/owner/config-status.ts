import 'server-only';
import { assertAuthorized } from '../authorize';
import type { DeploymentConfig } from '../config';
import { configSummary, type CatalogAdapter } from '../config-summary';
import type { Handler } from '../dispatcher';
import { recordOwnerModule } from '../load-trace';

recordOwnerModule('server/owner/config-status');

/** The `config.status` query: the redacted deployment summary, for an owner session. */
export function configStatus(config: DeploymentConfig, catalog: CatalogAdapter): Handler {
  const summary = configSummary(config, catalog);
  return (authorized) => {
    assertAuthorized(authorized, 'config.status');
    return summary;
  };
}
