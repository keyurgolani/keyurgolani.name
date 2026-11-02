// The quality build (#11, Slice 1, item 6): a `next build` of a copy of the
// workspace (tests/harness/fixture-host.mjs) made with the quality flags,
// which the cells' standalone servers run, never next dev. Nothing in the
// checkout is built, so its own build stays free of fixtures. The flags:
//
// - QUALITY_FIXTURES=1: #11's tier packs (Part A's rows of the fixture gate).
// - APPEARANCE_FIXTURES=1: #19's fixture packs and /_fixtures/appearance,
//   where the token-role match is checked.
// - BUDGET_FIXTURES=1: #6's budget fixtures. #6 slice 2 adds their packages
//   and gate row; until it lands nothing maps to the flag, so it's a
//   stand-in that changes nothing.

import { buildFixtureHost } from '../../harness/fixture-host.mjs';

export const QUALITY_BUILD_ENV = Object.freeze({
  QUALITY_FIXTURES: '1',
  APPEARANCE_FIXTURES: '1',
  BUDGET_FIXTURES: '1',
});

/**
 * Builds the quality host, its log at `log`, with `env` (the quality flags,
 * or QUALITY_FIXTURES=meta for quality:meta's known-bad build).
 *
 * @param {{ log: string, env?: Record<string, string> }} options
 * @returns {{ root: string, web: string, remove: () => void }}
 */
export function buildQualityHost({ log, env = QUALITY_BUILD_ENV }) {
  const { root, web, remove } = buildFixtureHost({ variants: [], buildEnv: { ...env }, log });
  return { root, web, remove };
}
