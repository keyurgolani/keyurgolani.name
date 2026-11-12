// The plan a quality run tests: the cells of the build QUALITY_WEB names,
// in the mode QUALITY_MODE names (`pr` by default), from the repository's
// registrations, with the cells the run's changed paths direct in `pr`
// (lib/changes.ts). run.ts writes it to reports/quality/plan.json, and the
// specs build their tests from the same call, so both see the same plan.

import { planCells, readBuildMeta, type Plan, type RunMode } from './cells';
import { readChanges } from './lib/changes';
import { qualityWeb } from './lib/env';
import { loadRegistrations } from './lib/registration';
import { nightlyScope } from './lib/nightly-scope';
import { loadReleaseScope, plannedScope, scopePlan } from './lib/release-scope';

export const RUN_MODES: readonly RunMode[] = ['pr', 'full'];

export function runMode(env: NodeJS.ProcessEnv = process.env): RunMode {
  const mode = env.QUALITY_MODE ?? 'pr';
  if (!(RUN_MODES as readonly string[]).includes(mode)) {
    throw new Error(`QUALITY_MODE is ${mode}, not one of ${RUN_MODES.join(', ')}.`);
  }
  return mode as RunMode;
}

export async function loadPlan(env: NodeJS.ProcessEnv = process.env): Promise<Plan> {
  const meta = readBuildMeta(qualityWeb(env));
  const mode = runMode(env);
  // A night (QUALITY_NIGHT) plans the nightly's scope, cut from the reachable plan (row 151,
  // lib/nightly-scope.ts); a release run refuses a night, so no release scope cuts it.
  const night = mode === 'full' && Boolean(env.QUALITY_NIGHT);
  // A release candidate's scope (lib/release-scope.ts), which its jobs name: full mode stays full
  // without one. The reachable scope is planned (cells.ts), any other cut from the full plan.
  const release = mode === 'full' && !night ? loadReleaseScope(env) : null;
  const scope = night ? 'reachable' : plannedScope(release?.scope);
  const plan = planCells({
    meta,
    registrations: await loadRegistrations(),
    mode,
    // `full` plans every variant and language as changed, whatever changed.
    changes: mode === 'pr' ? readChanges(meta, env).changes : [],
    ...(scope ? { scope } : {}),
  });
  if (night) return nightlyScope(plan);
  return release ? scopePlan(plan, release.scope) : plan;
}
