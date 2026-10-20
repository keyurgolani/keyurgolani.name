import 'server-only';
import type { Profile } from './capabilities';
import { openDocumentsCatalog } from './catalog-documents';
import type { CatalogReader } from './catalog-port';
import type { ConfigIssue, DeploymentConfig } from './config';
import type { CatalogAdapter } from './config-summary';
import type { DeploymentState } from './config-store';
import { createDispatcher, NO_BINDINGS, type StudioBindings } from './dispatcher';
import { listOperations } from './operations';
import { capabilityPolicy, type Session } from './policy';

// The composition root (#1, item 14). It builds what one profile needs and
// nothing else: read-only and demo get their catalog adapter, and only the
// owner branch loads owner code, through import(). Before any of that it
// runs the named startup requirements, the hook #2, #3, and #4 implement
// their startup checks against.

/** An authentication provider. #2 registers one; this build registers none. */
export interface AuthProvider {
  readonly name: string;
  /** Dispatcher step 2: the owner session a request carries, or null. */
  readonly resolveSession: (request: Request) => Promise<Session | null>;
  /** Dispatcher step 3: origin and CSRF checks for a command. */
  readonly checkOrigin: (request: Request) => Promise<boolean>;
}

/** The providers this build registers. #2 adds its own here. */
export const AUTH_PROVIDERS: readonly AuthProvider[] = [];

export interface RequirementContext {
  readonly config: DeploymentConfig;
  readonly authProviders: readonly AuthProvider[];
}

export interface StartupRequirement {
  /** Stable name. Each issue implements its check against it. */
  readonly id: string;
  /** The issue that owns the check. */
  readonly issue: string;
  readonly profiles: readonly Profile[];
  /** `degraded` serves the last-known-good revision instead of stopping. */
  readonly failure: 'fatal' | 'degraded';
  /** The check, once its issue implements it. Until then the requirement is a named slot. */
  readonly check?: (context: RequirementContext) => readonly ConfigIssue[];
}

/** The tagged rows of the #1 startup matrix, plus the provider check this build makes itself. */
export const STARTUP_REQUIREMENTS: readonly StartupRequirement[] = [
  {
    id: 'auth.provider',
    issue: '#1',
    profiles: ['owner'],
    failure: 'fatal',
    check: ({ authProviders }) =>
      authProviders.length > 0
        ? []
        : [
            {
              severity: 'fatal',
              key: 'PORTFOLIO_PROFILE',
              code: 'auth_provider_missing',
              message:
                'The owner profile needs an authentication provider, and this build registers none. ' +
                'Configure authentication, or set PORTFOLIO_PROFILE=read-only.',
            },
          ],
  },
  { id: 'auth.secret', issue: '#2', profiles: ['owner'], failure: 'fatal' },
  { id: 'data.directory', issue: '#2, #3', profiles: ['owner'], failure: 'fatal' },
  // Old-shape documents with no valid revision to fall back on. #4's half
  // already stops startup in the documents adapter, which refuses a document
  // without schemaVersion 2; #3 adds the revision check for owner.
  { id: 'documents.shape', issue: '#3', profiles: ['owner'], failure: 'fatal' },
  { id: 'revision.integrity', issue: '#3', profiles: ['owner'], failure: 'degraded' },
];

/** The startup-requirement hook: every implemented requirement for the profile, in order. */
export function checkStartupRequirements(context: RequirementContext): ConfigIssue[] {
  return STARTUP_REQUIREMENTS.flatMap((requirement) =>
    requirement.check && requirement.profiles.includes(context.config.profile)
      ? requirement.check(context)
      : [],
  );
}

export interface CompositionInput {
  readonly config: DeploymentConfig;
  /** The bundled example document. */
  readonly examplePath: string;
  /** Receives findings made after startup (re-validation under next dev). */
  readonly report: (issue: ConfigIssue) => void;
  /** Defaults to AUTH_PROVIDERS. In-process owner tests pass a test double. */
  readonly authProviders?: readonly AuthProvider[];
}

export type Composition =
  | { readonly ok: true; readonly state: DeploymentState; readonly issues: ConfigIssue[] }
  | { readonly ok: false; readonly issues: ConfigIssue[] };

export async function compose(input: CompositionInput): Promise<Composition> {
  const { config } = input;
  const authProviders = input.authProviders ?? AUTH_PROVIDERS;
  const required = checkStartupRequirements({ config, authProviders });
  if (required.some((issue) => issue.severity === 'fatal')) return { ok: false, issues: required };

  switch (config.profile) {
    case 'demo':
      return {
        ok: false,
        issues: [
          ...required,
          {
            severity: 'fatal',
            key: 'PORTFOLIO_PROFILE',
            code: 'profile_unavailable',
            message:
              'The demo profile is not available in this build yet. Set PORTFOLIO_PROFILE=read-only.',
          },
        ],
      };
    case 'read-only': {
      const documents = openDocuments(input);
      if (!documents.ok) return { ok: false, issues: [...required, ...documents.issues] };
      return built(config, documents.reader, NO_BINDINGS, [...required, ...documents.issues]);
    }
    case 'owner': {
      // Until #3, owner serves the mounted documents too.
      const documents = openDocuments(input);
      if (!documents.ok) return { ok: false, issues: [...required, ...documents.issues] };
      // The one place owner code loads. checkStartupRequirements made sure of a provider.
      const owner = await import('./owner/index');
      const provider = authProviders[0]!;
      const catalog: CatalogAdapter = 'documents';
      return built(
        config,
        documents.reader,
        {
          ...NO_BINDINGS,
          handlers: owner.ownerHandlers({ config, catalog }),
          resolveSession: (request) => provider.resolveSession(request),
          checkOrigin: (request) => provider.checkOrigin(request),
        },
        [...required, ...documents.issues],
      );
    }
  }
}

function openDocuments(input: CompositionInput) {
  return openDocumentsCatalog({
    // readDeploymentConfig requires it for owner and read-only.
    sourceDir: input.config.sourceDir ?? '',
    mode: input.config.mode,
    examplePath: input.examplePath,
    report: input.report,
  });
}

function built(
  config: DeploymentConfig,
  catalog: CatalogReader,
  bindings: StudioBindings,
  issues: ConfigIssue[],
): Composition {
  const dispatch = createDispatcher({
    ...bindings,
    policy: capabilityPolicy(config.profile),
    operations: listOperations(),
  });
  return { ok: true, state: Object.freeze({ config, catalog, dispatch }), issues };
}
