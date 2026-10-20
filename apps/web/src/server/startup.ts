import 'server-only';
import { openDocumentsCatalog } from './catalog-documents';
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
  /** Slugs of the registered variants. */
  readonly variantSlugs: readonly string[];
  /** Receives findings made after startup (re-validation under next dev). */
  readonly report: (issue: ConfigIssue) => void;
  /** Reads <KEY>_FILE values; tests replace it. */
  readonly readFile?: (file: string) => string;
}

export type StartupResult =
  | {
      readonly ok: true;
      readonly profile: Profile;
      readonly state: DeploymentState;
      readonly issues: ConfigIssue[];
    }
  | { readonly ok: false; readonly profile?: Profile; readonly issues: ConfigIssue[] };

export function runStartup(input: StartupInput): StartupResult {
  const read = readDeploymentConfig(input.env, { cwd: input.cwd, readFile: input.readFile });
  if (!read.ok) return read;
  const { config } = read;
  const issues = [...read.issues];
  const refuse = (code: string, message: string): StartupResult => ({
    ok: false,
    profile: config.profile,
    issues: [...issues, { severity: 'fatal', key: 'PORTFOLIO_PROFILE', code, message }],
  });

  switch (config.profile) {
    case 'owner':
      // No build registers an authentication provider yet, so owner never starts.
      return refuse(
        'auth_provider_missing',
        'The owner profile needs an authentication provider, and this build registers none. ' +
          'Configure authentication, or set PORTFOLIO_PROFILE=read-only.',
      );
    case 'demo':
      return refuse(
        'profile_unavailable',
        'The demo profile is not available in this build yet. Set PORTFOLIO_PROFILE=read-only.',
      );
    case 'read-only': {
      const opened = openDocumentsCatalog({
        // readDeploymentConfig requires it for read-only.
        sourceDir: config.sourceDir ?? '',
        mode: config.mode,
        examplePath: input.examplePath,
        variantSlugs: input.variantSlugs,
        report: input.report,
      });
      if (!opened.ok) {
        return { ok: false, profile: config.profile, issues: [...issues, ...opened.issues] };
      }
      return {
        ok: true,
        profile: config.profile,
        state: Object.freeze({ config, catalog: opened.reader }),
        issues: [...issues, ...opened.issues],
      };
    }
  }
}
