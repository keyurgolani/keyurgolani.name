import 'server-only';
import type { LiveRevision } from './catalog-port';
import { getDeploymentState, NOT_LOADED } from './config-store';

export type { CatalogReader, LiveRevision, PublicationUnit } from './catalog-port';

/**
 * The live revision. Every page and metadata route reads the catalog through
 * here, from the adapter register() built at startup.
 */
export function getLive(): Promise<LiveRevision> {
  const state = getDeploymentState();
  if (!state) return Promise.reject(new Error(NOT_LOADED));
  return state.catalog.getLive();
}
