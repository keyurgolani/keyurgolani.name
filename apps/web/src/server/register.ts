import 'server-only';
import path from 'node:path';
import { createAppearanceCatalog } from './appearance-catalog';
import { issueLogLine, type ConfigIssue, type Profile } from './config';
import { setDeploymentState } from './config-store';
import { CONTENT_EXTENSIONS } from './content-extensions';
import { log } from './log';
import type { Registration } from './start-or-exit';
import { runStartup, type StartupResult } from './startup';

/**
 * Validates the deployment. When it can start, stores the result, logs any
 * warnings, and logs the redacted summary once as `deployment.config`.
 * Otherwise returns the log line for every finding, which startOrExit writes
 * before it exits. Runs from instrumentation register() on the Node.js
 * runtime, before the server handles a request.
 */
export async function registerDeployment(): Promise<Registration> {
  const cwd = process.cwd();
  // The image and `next dev` both keep them two levels above apps/web.
  const example = (name: string) => path.resolve(/*turbopackIgnore: true*/ cwd, '..', '..', name);
  // The interim catalog of the variants this build registers (#4, item 14).
  const { listManifests } = await import('~/lib/registry');
  const result: StartupResult = await runStartup({
    env: process.env,
    cwd,
    examples: { portfolio: example('portfolio.example.yml'), site: example('site.example.yml') },
    catalog: createAppearanceCatalog(listManifests()),
    extensions: CONTENT_EXTENSIONS,
    // Called only after startup, by re-validation under next dev.
    report: (issue) => {
      console.log(issueLogLine(issue, result.profile));
    },
  });
  if (!result.ok) {
    return {
      ok: false,
      log: result.issues.map((issue) => logLine(issue, result.profile)).join(''),
    };
  }
  setDeploymentState(result.state);
  // The server keeps running, so stdout can take its time with these.
  for (const issue of result.issues) console.log(issueLogLine(issue, result.profile));
  log({ level: 'info', event: 'deployment.config', ...result.summary });
  return { ok: true };
}

function logLine(issue: ConfigIssue, profile: Profile | undefined): string {
  return `${issueLogLine(issue, profile)}\n`;
}
