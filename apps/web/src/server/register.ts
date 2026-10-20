import 'server-only';
import path from 'node:path';
import { issueLogLine, type ConfigIssue, type Profile } from './config';
import { setDeploymentState } from './config-store';
import type { Registration } from './start-or-exit';
import { runStartup, type StartupResult } from './startup';

/**
 * Validates the deployment. When it can start, stores the result and logs
 * any warnings. Otherwise returns the log line for every finding, which
 * startOrExit writes before it exits. Runs from instrumentation register()
 * on the Node.js runtime, before the server handles a request.
 */
export async function registerDeployment(): Promise<Registration> {
  const cwd = process.cwd();
  const result: StartupResult = await runStartup({
    env: process.env,
    cwd,
    // The image and `next dev` both keep it two levels above apps/web.
    examplePath: path.resolve(/*turbopackIgnore: true*/ cwd, '..', '..', 'portfolio.example.yml'),
    // Called only after startup, by re-validation under next dev.
    report: (issue) => {
      process.stdout.write(logLine(issue, result.profile));
    },
  });
  const log = result.issues.map((issue) => logLine(issue, result.profile)).join('');
  if (!result.ok) return { ok: false, log };
  setDeploymentState(result.state);
  // The server keeps running, so stdout can take its time with these.
  if (log) process.stdout.write(log);
  return { ok: true };
}

function logLine(issue: ConfigIssue, profile: Profile | undefined): string {
  return `${issueLogLine(issue, profile)}\n`;
}
