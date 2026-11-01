// What a hermetic command's environment holds (#12): HOME and every XDG
// directory the run's own, HOME empty, and no token. The rehearsal
// (ci/rehearsal.mjs) and the fresh-clone run (ci/fresh-clone.mjs) both hold
// their commands to it. Pure Node.
import path from 'node:path';

/**
 * Problems with what a guide command's environment holds: HOME and every
 * XDG directory the run's own, HOME empty, and no token. `listHome` lists
 * HOME's entries.
 */
export function hermeticProblems(env, { home, listHome }) {
  const problems = [];
  if (env.HOME !== home) problems.push(`HOME is ${env.HOME}, not the run's own`);
  for (const key of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) {
    if (!String(env[key] ?? '').startsWith(`${home}${path.sep}`)) {
      problems.push(`${key} is ${env[key] ?? 'unset'}, not under the run's HOME`);
    }
  }
  const entries = listHome();
  if (entries.length > 0) problems.push(`HOME isn't empty: ${entries.join(', ')}`);
  for (const key of Object.keys(env)) {
    if (TOKEN_KEYS.test(key)) problems.push(`${key} is set`);
  }
  return problems;
}

/** Variables that carry a token or a secret, none of which a guide command may get. */
export const TOKEN_KEYS =
  /^(GITHUB_TOKEN|GH_TOKEN|GH_ENTERPRISE_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_\w+|NPM_TOKEN|NODE_AUTH_TOKEN|.*_(TOKEN|SECRET|PASSWORD))$/;
