import 'server-only';
import { compose, type AuthProvider } from './composition';
import { readDeploymentConfig, type ConfigIssue, type Env, type Profile } from './config';
import type { DeploymentState } from './config-store';

// Startup validation. instrumentation register() runs it once before the
// server handles a request; any fatal finding stops the process there.

export interface StartupInput {
  readonly env: Env;
  /** The server's working directory (apps/web), for relative paths. */
  readonly cwd: string;
  /** The bundled example document. */
  readonly examplePath: string;
  /** Receives findings made after startup (re-validation under next dev). */
  readonly report: (issue: ConfigIssue) => void;
  /** Reads <KEY>_FILE values; tests replace it. */
  readonly readFile?: (file: string) => string;
  /** Defaults to the providers the build registers; tests pass doubles. */
  readonly authProviders?: readonly AuthProvider[];
}

export type StartupResult =
  | {
      readonly ok: true;
      readonly profile: Profile;
      readonly state: DeploymentState;
      readonly issues: ConfigIssue[];
    }
  | { readonly ok: false; readonly profile?: Profile; readonly issues: ConfigIssue[] };

export async function runStartup(input: StartupInput): Promise<StartupResult> {
  const read = readDeploymentConfig(input.env, { cwd: input.cwd, readFile: input.readFile });
  if (!read.ok) return read;
  const { config } = read;
  const composed = await compose({
    config,
    examplePath: input.examplePath,
    report: input.report,
    authProviders: input.authProviders,
  });
  const issues = [...read.issues, ...composed.issues];
  return composed.ok
    ? { ok: true, profile: config.profile, state: composed.state, issues }
    : { ok: false, profile: config.profile, issues };
}
