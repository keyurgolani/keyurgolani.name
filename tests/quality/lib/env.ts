// What run.ts hands a quality run's Playwright processes, by environment:
// the quality build, the run mode, and the planted canary. No Playwright
// import, so run.ts and the reporter read them too.

/** The quality build's apps/web, which run.ts or the global setup built. */
export function qualityWeb(env: NodeJS.ProcessEnv = process.env): string {
  const web = env.QUALITY_WEB;
  if (!web) {
    throw new Error('No quality build. Run the cells with pnpm quality:pr or pnpm quality:full.');
  }
  return web;
}

/** The cookie every quality test's context carries the run's canary in (fixtures.ts). */
export const CANARY_COOKIE = 'quality_canary';

/** The run's canary, which run.ts or the global setup planted. */
export function runCanary(env: NodeJS.ProcessEnv = process.env): string {
  const canary = env.QUALITY_CANARY;
  if (!canary) throw new Error('No canary was planted. Run the cells with pnpm quality:pr.');
  return canary;
}

/**
 * The run's shard, <n>/<m>, which run.ts hands its Playwright processes for
 * `pnpm quality:pr -- --shard=<n>/<m>` (lib/pr-shards.ts) and
 * `pnpm quality:full -- --shard=<n>/<m>` (lib/full-shards.ts), or null for a
 * whole run.
 */
export function runShard(env: NodeJS.ProcessEnv = process.env): string | null {
  const shard = env.QUALITY_SHARD;
  if (shard === undefined || shard === '') return null;
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > Number(match[2])) {
    throw new Error(`QUALITY_SHARD is ${shard}, not <n>/<m> with 1 <= n <= m.`);
  }
  return shard;
}

/**
 * The night whose slice of the full plan the run runs, a UTC date, which
 * run.ts hands its Playwright processes for
 * `pnpm quality:full -- --night=<YYYY-MM-DD>` (lib/full-shards.ts), or null
 * for the whole plan.
 */
export function runNight(env: NodeJS.ProcessEnv = process.env): string | null {
  const night = env.QUALITY_NIGHT;
  if (night === undefined || night === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) {
    throw new Error(`QUALITY_NIGHT is ${night}, not a date, YYYY-MM-DD.`);
  }
  return night;
}
