// The environment for a pnpm command in another checkout (#6, Slice 1):
// pnpm test:trace:baseline installs 62a0f06 in a worktree of its own.

/**
 * `env` without the settings pnpm passes down to a script it runs. pnpm run
 * exports this checkout's pnpm-workspace.yaml and .npmrc settings as
 * npm_config_* variables (strictDepBuilds as npm_config_strict_dep_builds,
 * for one), and a pnpm command in another checkout reads them as its own, so
 * an install there would follow this checkout's rules rather than its own.
 *
 * @param {Record<string, string | undefined>} env
 */
export function withoutPnpmSettings(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !/^(npm|pnpm)_config_/i.test(name)),
  );
}
