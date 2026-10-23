import 'server-only';
import path from 'node:path';
import type { UnitChecks } from '@portfolio/core';
import { CONTENT_EXTENSIONS, liveContext, REGISTRY } from '~/lib/variants';
import webPackage from '../../package.json';
import { issueLogLine, type ConfigIssue, type Profile } from './config';
import { setDeploymentState } from './config-store';
import { log } from './log';
import type { Registration } from './start-or-exit';
import { runStartup, type StartupResult } from './startup';
import { buildUnitChecks, renderDrift } from './unit-checks';

/**
 * What a revision is checked with in this deployment, published and served
 * (#3), on its canonical origin. portfolio-store builds the same from the
 * same registry, so a revision either writes records one rendering.
 */
export function deploymentUnitChecks(origin: string): UnitChecks {
  return buildUnitChecks({
    registry: REGISTRY,
    extensions: CONTENT_EXTENSIONS,
    origin,
    appVersion: webPackage.version,
  });
}

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
  // What this build registers (#5): the interim appearance catalog, the
  // content extensions, and the contract's live checks, under which a
  // selection this build doesn't register is a warning and the fallback
  // composition renders.
  const { catalog, extensions, validators } = liveContext();
  const result: StartupResult = await runStartup({
    env: process.env,
    cwd,
    examples: { portfolio: example('portfolio.example.yml'), site: example('site.example.yml') },
    catalog,
    extensions,
    validators,
    // Called only after startup, by re-validation under next dev.
    report: (issue) => {
      console.log(issueLogLine(issue, result.profile));
    },
    unitChecks: deploymentUnitChecks,
    renderDrift: (rendering) => renderDrift(REGISTRY, rendering),
    // `next dev` keeps owner's data in the workspace root's .data (#3).
    devDataDir: path.resolve(/*turbopackIgnore: true*/ cwd, '..', '..', '.data'),
  });
  if (!result.ok) {
    return {
      ok: false,
      log: result.issues.map((issue) => logLine(issue, result.profile)).join(''),
    };
  }
  setDeploymentState(result.state);
  // The data directory's server claim goes with the process, however it
  // exits; Next's own SIGTERM handling ends in an exit (#3, item 21).
  const { release } = result.state;
  if (release) process.once('exit', release);
  // The server keeps running, so stdout can take its time with these.
  for (const issue of result.issues) console.log(issueLogLine(issue, result.profile));
  log({ level: 'info', event: 'deployment.config', ...result.summary });
  return { ok: true };
}

function logLine(issue: ConfigIssue, profile: Profile | undefined): string {
  return `${issueLogLine(issue, profile)}\n`;
}
