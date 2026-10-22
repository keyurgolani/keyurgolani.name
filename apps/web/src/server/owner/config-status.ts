import 'server-only';
import type { CatalogStatus } from '@portfolio/core';
import { SOURCE_DRIFT_MESSAGE, type SourceDrift } from '@portfolio/core/owner';
import { assertAuthorized } from '../authorize';
import type { DeploymentConfig } from '../config';
import { configSummary, type CatalogAdapter } from '../config-summary';
import type { Handler } from '../dispatcher';
import { recordOwnerModule } from '../load-trace';
import type { ConfigStatus, SourceStatus, WriteState } from '../operations';
import type { LiveVariantHealth } from '../variant-health';

recordOwnerModule('server/owner/config-status');

/**
 * The `config.status` query, for an owner session: the redacted deployment
 * summary; how the live site's variant renders, read per request (#5):
 * `degraded` when the fallback composition stands in for it, and `fail`,
 * with the rest of the summary still there, when the revision or the
 * variant's module doesn't load; the catalog (#3, item 23): what serves,
 * the revisions behind it, and any drift between the live manifest and the
 * build; whether owner writes go through, and why not; and whether the
 * mounted pair changed since the last import (item 24). The reason a live
 * revision isn't served is in the server log, as store.catalog.degraded.
 */
export function configStatus(
  config: DeploymentConfig,
  catalog: CatalogAdapter,
  variantHealth: () => Promise<LiveVariantHealth>,
  catalogStatus: () => Promise<CatalogStatus>,
  writes: () => WriteState,
  sourceDrift: () => Promise<SourceDrift>,
): Handler {
  const summary = configSummary(config, catalog);
  return async (authorized): Promise<ConfigStatus> => {
    assertAuthorized(authorized, 'config.status');
    const [variant, status, drift] = await Promise.all([
      variantHealth(),
      catalogStatus(),
      sourceDrift(),
    ]);
    return {
      ...summary,
      variant,
      catalog: {
        state: status.state,
        liveRevisionId: status.liveRevisionId,
        servingRevisionId: status.servingRevisionId,
        renderDrift: status.renderDrift ? [...status.renderDrift] : null,
      },
      writes: writes(),
      source: sourceStatus(drift),
    };
  };
}

/** Source drift as config.status says it: the message when the pair changed. */
function sourceStatus(drift: SourceDrift): SourceStatus {
  if (drift.state === 'changed' && drift.mounted && drift.imported) {
    return {
      state: 'changed',
      message: SOURCE_DRIFT_MESSAGE,
      mountedSourceHash: drift.mounted,
      importedSourceHash: drift.imported,
    };
  }
  return {
    state: drift.state === 'changed' ? 'unknown' : drift.state,
    mountedSourceHash: drift.mounted,
    importedSourceHash: drift.imported,
  };
}
