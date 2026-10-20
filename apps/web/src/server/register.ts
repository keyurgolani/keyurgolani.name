import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { listManifests } from '~/lib/registry';
import { issueLogLine, type ConfigIssue, type Profile } from './config';
import { setDeploymentState } from './config-store';
import { runStartup, type StartupResult } from './startup';

/**
 * Validates the deployment and stores the result, or logs every fatal
 * finding as a config.fatal line and exits 1. Runs from instrumentation
 * register() on the Node.js runtime, before the server handles a request.
 */
export function registerDeployment(): void {
  const cwd = process.cwd();
  const result: StartupResult = runStartup({
    env: process.env,
    cwd,
    // The image and `next dev` both keep it two levels above apps/web.
    examplePath: path.resolve(/*turbopackIgnore: true*/ cwd, '..', '..', 'portfolio.example.yml'),
    variantSlugs: listManifests().map((manifest) => manifest.slug),
    // Called only after startup, by re-validation under next dev.
    report: (issue) => writeIssue(issue, result.profile),
  });
  for (const issue of result.issues) writeIssue(issue, result.profile);
  if (!result.ok) process.exit(1);
  setDeploymentState(result.state);
}

/** Writes synchronously, so the line is out before process.exit(). */
function writeIssue(issue: ConfigIssue, profile: Profile | undefined): void {
  fs.writeSync(1, `${issueLogLine(issue, profile)}\n`);
}
