// The last word of the rehearsal (ci/rehearsal.mjs) and the fresh-clone run
// (ci/fresh-clone.mjs), after their rows: no pending row may stay pending
// past what it waits on, and no report may hold a per-run secret (#12).
// Each run fails on any problem this returns.
import { redactArtifacts } from './profile-checks.mjs';
import { pendingProblems } from './pending.mjs';

/**
 * The run's final problems.
 *
 * @param {{
 *   pendingRows: readonly { id: string, waitsOn: string }[],
 *   landedState: object,
 *   reports: string,
 *   secrets: Readonly<Record<string, string | undefined>>,
 *   requiredSecrets?: readonly string[],
 * }} input `secrets` names each per-run secret the scan looks for;
 *   `requiredSecrets` names the ones the run made, such as owner's password
 *   and hash once a container row ran, so a scan that lost one fails.
 * @returns {string[]}
 */
export function finalVerdict({ pendingRows, landedState, reports, secrets, requiredSecrets = [] }) {
  const problems = pendingProblems(pendingRows, landedState).map((p) => `pending: ${p}`);
  for (const name of requiredSecrets) {
    if (!secrets[name]) problems.push(`canary: the scan has no ${name} to look for`);
  }
  const values = Object.values(secrets).filter((value) => typeof value === 'string' && value);
  if (values.length === 0) problems.push('canary: the scan has no secret to look for');
  const { redacted, unchecked } = redactArtifacts(reports, values);
  for (const file of redacted) problems.push(`canary: ${file} held a per-run secret, now redacted`);
  for (const file of unchecked) {
    problems.push(`canary: ${file} was too large to check for a per-run secret`);
  }
  return problems;
}
