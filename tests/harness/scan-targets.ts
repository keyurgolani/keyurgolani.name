// What the leak scans request (#1, Verification item 2, and #2): every route,
// retired route, and operation, each dynamic segment filled, and some paths
// that don't exist. The profile matrix and #2's security suite share it.
import { createRequire } from 'node:module';
import type * as Operations from '../../apps/web/src/server/operations';
import type * as Routes from '../../apps/web/src/server/routes';
import { IMAGE_PROBE } from './canaries.mjs';

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require().
const require = createRequire(import.meta.url);
const { listOperations } = require('../../apps/web/src/server/operations.ts') as typeof Operations;
const { listRoutes, RETIRED_PATTERNS } =
  require('../../apps/web/src/server/routes.ts') as typeof Routes;

/** A concrete path for a pattern, filling each dynamic segment. */
export const concrete = (pattern: string) =>
  pattern.replace(/\[\[?\.{0,3}[^\]]+\]\]?/g, 'sample') || '/';

/** Every target the leak scan requests: each route, retired route, and operation, and some that don't exist. */
export function scanTargets(): string[] {
  return [
    ...listRoutes()
      .filter((route) => route.capability !== 'operations')
      .map((route) => concrete(route.pattern)),
    ...RETIRED_PATTERNS.map(concrete),
    ...listOperations().map((operation) => `/api/studio/${operation.name}`),
    '/api/studio/no.such.operation',
    '/no-such-page',
    '/api/no-such-route',
    IMAGE_PROBE,
  ];
}
