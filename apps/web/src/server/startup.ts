import 'server-only';
import type { RenderDrift, Rendering, UnitChecks } from '@portfolio/core';
import type { AppearanceCatalog, ContentExtension, UnitValidator } from '@portfolio/schema';
import type { PairFiles } from '@portfolio/schema/node';
import { compose, type AuthProviderFactory } from './composition';
import { readDeploymentConfig, type ConfigIssue, type Env, type Profile } from './config';
import type { DeploymentState } from './config-store';
import type { ConfigSummary } from './operations';

// Startup validation. instrumentation register() runs it once before the
// server handles a request; any fatal finding stops the process there.

export interface StartupInput {
  readonly env: Env;
  /** The server's working directory (apps/web), for relative paths. */
  readonly cwd: string;
  /** The bundled example pair. */
  readonly examples: PairFiles;
  /** The appearance ids this build registers. Without one, they go unchecked. */
  readonly catalog?: AppearanceCatalog;
  /** The content extensions documents are checked against. */
  readonly extensions?: readonly ContentExtension[];
  /** The contract's checks on the pair, live (#5): a selection this build doesn't register only warns. */
  readonly validators?: readonly UnitValidator[];
  /** Receives findings made after startup (re-validation under next dev). */
  readonly report: (issue: ConfigIssue) => void;
  /** Reads <KEY>_FILE values; tests replace it. */
  readonly readFile?: (file: string) => string;
  /** Defaults to the providers the build registers; tests pass doubles. */
  readonly authProviders?: readonly AuthProviderFactory[];
  /** The build's checks on a publication unit (#3), on the deployment's origin. */
  readonly unitChecks?: (origin: string) => UnitChecks;
  /** Where a live manifest's rendering differs from the build's (#3). */
  readonly renderDrift?: (rendering: Rendering) => readonly RenderDrift[];
  /** Under `next dev`, owner's data directory when PORTFOLIO_DATA_DIR is unset (#3). */
  readonly devDataDir?: string;
}

export type StartupResult =
  | {
      readonly ok: true;
      readonly profile: Profile;
      readonly state: DeploymentState;
      readonly issues: ConfigIssue[];
      /** The redacted summary to log once as `deployment.config`. */
      readonly summary: ConfigSummary;
    }
  | { readonly ok: false; readonly profile?: Profile; readonly issues: ConfigIssue[] };

export async function runStartup(input: StartupInput): Promise<StartupResult> {
  const read = readDeploymentConfig(input.env, {
    cwd: input.cwd,
    readFile: input.readFile,
    ...(input.devDataDir ? { devDataDir: input.devDataDir } : {}),
  });
  if (!read.ok) return read;
  const { config } = read;
  const composed = await compose({
    config,
    examples: input.examples,
    catalog: input.catalog,
    extensions: input.extensions,
    validators: input.validators,
    report: input.report,
    authProviders: input.authProviders,
    unitChecks: input.unitChecks,
    renderDrift: input.renderDrift,
  });
  const issues = [...read.issues, ...composed.issues];
  return composed.ok
    ? {
        ok: true,
        profile: config.profile,
        state: composed.state,
        issues,
        summary: composed.summary,
      }
    : { ok: false, profile: config.profile, issues };
}
