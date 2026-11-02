// The plan a quality run tests: the cells of the build QUALITY_WEB names,
// in the mode QUALITY_MODE names (`pr` by default), from the repository's
// registrations, with the cells the run's changed paths direct in `pr`
// (lib/changes.ts). run.ts writes it to reports/quality/plan.json, and the
// specs build their tests from the same call, so both see the same plan.

import { planCells, readBuildMeta, type Plan, type RunMode } from './cells';
import { readChanges } from './lib/changes';
import { qualityWeb } from './lib/env';
import { loadRegistrations } from './lib/registration';

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
  return planCells({
    meta,
    registrations: await loadRegistrations(),
    mode,
    // `full` plans every variant and language as changed, whatever changed.
    changes: mode === 'pr' ? readChanges(meta, env).changes : [],
  });
}
