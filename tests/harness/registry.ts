// The variants this build registers (#5), from the registry `pnpm
// --filter @portfolio/web build:registry` generates, which `pnpm build` runs
// first. The browser tests run each composition through it.
import { createRequire } from 'node:module';
import type * as Registry from '../../apps/web/src/lib/generated/registry.meta';

// apps/web has no "type": "module", so its modules are CommonJS to Node and
// load through require().
const require = createRequire(import.meta.url);
const registry = require('../../apps/web/src/lib/generated/registry.meta.ts') as typeof Registry;

/** Every registered variant, sorted by id: the fallback composition among them. */
export const VARIANTS = registry.VARIANTS;

/** The fallback composition's id, which renders for a selection no package registers. */
export const FALLBACK_ID = 'fallback';
