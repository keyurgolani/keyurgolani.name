import { cache } from 'react';
import type { LiveRevision } from './catalog-port';
import { getDeploymentState, NOT_LOADED } from './config-store';

// The live revision as one request reads it (#3, item 19). React's cache
// keeps the first answer for the rest of the request's render, so a page,
// its layout's JSON-LD, its metadata, and a 404 body all render from one
// revision, even while a publish lands. Outside a render, as in a route
// handler, each call reads again. It imports nothing server-only, so the 404
// chrome, which renders before startup too, can read it; pages and routes
// import it from server/catalog.ts.

/** The live revision, from the CatalogReader register() built at startup, once per request. */
export const getLive = cache(async (): Promise<LiveRevision> => {
  const state = getDeploymentState();
  if (!state) throw new Error(NOT_LOADED);
  return state.catalog.getLive();
});
