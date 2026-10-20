import 'server-only';
import type { ContentExtension } from '@portfolio/schema';
import type { Profile } from './capabilities';
import { openDocumentsCatalog } from './catalog-documents';
import type { CatalogReader } from './catalog-port';
import { openSampleCatalog } from './catalog-sample';
import type { ConfigIssue, DeploymentConfig } from './config';
import { configSummary, type CatalogAdapter } from './config-summary';
import type { DeploymentState } from './config-store';
import { createDispatcher, NO_BINDINGS, type StudioBindings } from './dispatcher';
import { listOperations, type ConfigSummary } from './operations';
import type { Session } from './session';

// The composition root (#1, item 14). It builds what one profile needs and
// nothing else: read-only gets the documents adapter, demo the bundled
// sample, and only the owner branch loads owner code, through import().
// startup.ts imports this module in every profile, so check:deps fails any
// import of owner code here that isn't an import(). Around that it runs the
// named startup requirements, the hook #2, #3, and #4 implement their
// startup checks against.

/** What an auth provider binds into the dispatcher (#2). */
export interface AuthProvider {
  readonly resolveSession: StudioBindings['resolveSession'];
  readonly checkOrigin: StudioBindings['checkOrigin'];
  readonly touchSession: StudioBindings['touchSession'];
  /** auth.login's rate limit. Without one, nothing is throttled. */
  readonly throttle?: StudioBindings['throttle'];
}

/** What the owner branch hands a provider as it loads it. */
export interface ProviderTools {
  readonly config: DeploymentConfig;
  /** Makes the sessions resolveSession returns. The dispatcher and authorize() accept no other. */
  readonly mintSession: <T extends object>(fields?: T) => Session & Readonly<T>;
}

/**
 * An auth provider, by name. Only the owner branch calls `load`, after
 * owner code and the owner startup requirements, so a provider's module
 * loads through import() and no other profile evaluates it:
 * `load: (tools) => import('./owner/…').then((module) => module.provider(tools))`.
 */
export interface AuthProviderFactory {
  readonly name: string;
  readonly load: (tools: ProviderTools) => Promise<AuthProvider>;
}

/** The providers this build registers; the first one serves. #2 adds its own. */
export const AUTH_PROVIDERS: readonly AuthProviderFactory[] = [];

export interface RequirementContext {
  readonly config: DeploymentConfig;
  readonly authProviders: readonly AuthProviderFactory[];
}

export type RequirementCheck = (context: RequirementContext) => Promise<readonly ConfigIssue[]>;

export interface StartupRequirement {
  /** Stable name. Each issue implements its check against it. */
  readonly id: string;
  /** The issue that owns the check. */
  readonly issue: string;
  readonly profiles: readonly Profile[];
  /**
   * What a fatal finding does. `fatal` stops startup. `degraded` starts
   * anyway, logs the finding as a warning, and lists the requirement in
   * DeploymentState.degraded, so #3 can serve the last-known-good revision.
   */
  readonly failure: 'fatal' | 'degraded';
  /** A check that needs no owner code. It runs first, before the profile's code loads. */
  readonly check?: RequirementCheck;
  /**
   * Owner only: imports a check that lives in owner code, such as #2's
   * auth.secret. It runs after the owner branch imports server/owner/index
   * and before the provider loads:
   * `load: () => import('./owner/…').then((module) => module.check)`.
   */
  readonly load?: () => Promise<RequirementCheck>;
}

/** The tagged rows of the #1 startup matrix, plus the provider check this build makes itself. */
export const STARTUP_REQUIREMENTS: readonly StartupRequirement[] = [
  {
    id: 'auth.provider',
    issue: '#1',
    profiles: ['owner'],
    failure: 'fatal',
    check: async ({ authProviders }) =>
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

interface Checked {
  readonly issues: ConfigIssue[];
  readonly degraded: string[];
}

/**
 * The startup-requirement hook: runs each requirement for the profile that
 * `pick` finds a check for, in table order. A degraded requirement's fatal
 * findings become warnings, and its ID joins `degraded`.
 */
async function runRequirements(
  requirements: readonly StartupRequirement[],
  context: RequirementContext,
  pick: (requirement: StartupRequirement) => Promise<RequirementCheck | undefined>,
): Promise<Checked> {
  const checked: Checked = { issues: [], degraded: [] };
  for (const requirement of requirements) {
    if (!requirement.profiles.includes(context.config.profile)) continue;
    const check = await pick(requirement);
    if (!check) continue;
    for (const issue of await check(context)) {
      if (issue.severity === 'fatal' && requirement.failure === 'degraded') {
        checked.issues.push({ ...issue, severity: 'warning' });
        if (!checked.degraded.includes(requirement.id)) checked.degraded.push(requirement.id);
      } else {
        checked.issues.push(issue);
      }
    }
  }
  return checked;
}

const failed = (issues: readonly ConfigIssue[]) =>
  issues.some((issue) => issue.severity === 'fatal');

export interface CompositionInput {
  readonly config: DeploymentConfig;
  /** The bundled example document. */
  readonly examplePath: string;
  /** The content extensions documents are checked against. */
  readonly extensions?: readonly ContentExtension[];
  /** Receives findings made after startup (re-validation under next dev). */
  readonly report: (issue: ConfigIssue) => void;
  /** Defaults to AUTH_PROVIDERS. In-process owner tests pass a test double. */
  readonly authProviders?: readonly AuthProviderFactory[];
  /** Defaults to STARTUP_REQUIREMENTS. Tests pass their own. */
  readonly requirements?: readonly StartupRequirement[];
}

export type Composition =
  | {
      readonly ok: true;
      readonly state: DeploymentState;
      readonly issues: ConfigIssue[];
      /** The redacted summary register() logs once as `deployment.config` (#1, item 20). */
      readonly summary: ConfigSummary;
    }
  | { readonly ok: false; readonly issues: ConfigIssue[] };

export async function compose(input: CompositionInput): Promise<Composition> {
  const { config } = input;
  const authProviders = input.authProviders ?? AUTH_PROVIDERS;
  const requirements = input.requirements ?? STARTUP_REQUIREMENTS;
  const context: RequirementContext = { config, authProviders };
  const early = await runRequirements(requirements, context, async (row) => row.check);
  if (failed(early.issues)) return { ok: false, issues: early.issues };

  switch (config.profile) {
    case 'demo': {
      const sample = openSampleCatalog({
        examplePath: input.examplePath,
        extensions: input.extensions,
      });
      const issues = [...early.issues, ...sample.issues];
      if (!sample.ok) return { ok: false, issues };
      return built(config, {
        reader: sample.reader,
        adapter: 'sample',
        bindings: NO_BINDINGS,
        issues,
        degraded: early.degraded,
      });
    }
    case 'read-only': {
      const documents = openDocuments(input);
      const issues = [...early.issues, ...documents.issues];
      if (!documents.ok) return { ok: false, issues };
      return built(config, {
        reader: documents.reader,
        adapter: 'documents',
        bindings: NO_BINDINGS,
        issues,
        degraded: early.degraded,
      });
    }
    case 'owner': {
      // Until #3, owner serves the mounted documents too.
      const documents = openDocuments(input);
      let issues = [...early.issues, ...documents.issues];
      if (!documents.ok) return { ok: false, issues };
      // The one place owner code loads.
      const owner = await import('./owner/index');
      const late = await runRequirements(requirements, context, async (row) => row.load?.());
      issues = [...issues, ...late.issues];
      if (failed(late.issues)) return { ok: false, issues };
      // The auth.provider requirement made sure of one.
      const factory = authProviders[0];
      if (!factory) throw new Error('The owner profile has no authentication provider.');
      const provider = await factory.load({ config, mintSession: owner.mintSession });
      const catalog: CatalogAdapter = 'documents';
      const bindings: StudioBindings = {
        ...NO_BINDINGS,
        handlers: owner.ownerHandlers({ config, catalog }),
        resolveSession: (context) => provider.resolveSession(context),
        checkOrigin: (context) => provider.checkOrigin(context),
        touchSession: (context) => provider.touchSession(context),
        throttle: (context) =>
          provider.throttle ? provider.throttle(context) : NO_BINDINGS.throttle(context),
      };
      return built(config, {
        reader: documents.reader,
        adapter: catalog,
        bindings,
        issues,
        degraded: [...early.degraded, ...late.degraded],
      });
    }
  }
}

function openDocuments(input: CompositionInput) {
  return openDocumentsCatalog({
    // readDeploymentConfig requires it for owner and read-only.
    sourceDir: input.config.sourceDir ?? '',
    mode: input.config.mode,
    examplePath: input.examplePath,
    extensions: input.extensions,
    report: input.report,
  });
}

interface Built {
  readonly reader: CatalogReader;
  readonly adapter: CatalogAdapter;
  readonly bindings: StudioBindings;
  readonly issues: ConfigIssue[];
  readonly degraded: readonly string[];
}

function built(config: DeploymentConfig, parts: Built): Composition {
  // It reads the policy from the deployment register() stores, per request.
  const dispatch = createDispatcher({ ...parts.bindings, operations: listOperations() });
  const state = Object.freeze({
    config,
    catalog: parts.reader,
    dispatch,
    degraded: Object.freeze([...parts.degraded]),
  });
  return { ok: true, state, issues: parts.issues, summary: configSummary(config, parts.adapter) };
}
