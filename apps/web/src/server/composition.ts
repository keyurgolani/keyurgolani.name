import 'server-only';
import type { AppearanceCatalog, ContentExtension, UnitValidator } from '@portfolio/schema';
import type { PairFiles } from '@portfolio/schema/node';
import type { Profile } from './capabilities';
import { openDocumentsCatalog, type OpenDocumentsResult } from './catalog-documents';
import type { CatalogReader } from './catalog-port';
import { openSampleCatalog } from './catalog-sample';
import type { ConfigIssue, DeploymentConfig } from './config';
import { configSummary, type CatalogAdapter } from './config-summary';
import type { DeploymentState } from './config-store';
import { createDispatcher, NO_BINDINGS, type Handler, type StudioBindings } from './dispatcher';
import { listOperations, type ConfigSummary } from './operations';
import type { Session } from './session';
import type { StudioPages } from './studio-port';
import { liveVariantHealth } from './variant-health';

// The composition root (#1, item 14). It builds what one profile needs and
// nothing else: read-only gets the documents adapter, demo the bundled
// sample, and only the owner branch loads owner code, through import().
// startup.ts imports this module in every profile, so check:deps fails any
// import of owner code here that isn't an import(). Around that it runs the
// named startup requirements, the hook #2, #3, and #4 implement their
// startup checks against.

/**
 * What an auth provider binds into the dispatcher (#2). @portfolio/core's
 * AuthProvider is a different thing, which checks a password.
 */
export interface AuthBindings {
  readonly resolveSession: StudioBindings['resolveSession'];
  readonly checkOrigin: StudioBindings['checkOrigin'];
  readonly touchSession: StudioBindings['touchSession'];
  /** auth.login's rate limit. Without one, nothing is throttled. */
  readonly throttle?: StudioBindings['throttle'];
  /** What a malformed input gets instead of 400, such as the sign-in form's 303. */
  readonly invalidInput?: StudioBindings['invalidInput'];
  /**
   * The session read again before a multi-step command's commit point.
   * Without one, a command that asks is stopped whenever it has a session.
   */
  readonly recheckSession?: StudioBindings['recheckSession'];
  /** Handlers for the provider's own entries, such as auth.login. */
  readonly handlers?: Readonly<Record<string, Handler>>;
  /** How Studio pages find their session, for requireOwnerPage. Without it, every one is refused. */
  readonly pages?: StudioPages;
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
  readonly load: (tools: ProviderTools) => Promise<AuthBindings>;
}

/**
 * The owner's password provider (#2): sign-in, sessions in the data
 * directory, and the origin and CSRF checks.
 */
export const OWNER_PASSWORD_PROVIDER: AuthProviderFactory = Object.freeze({
  name: 'owner-password',
  load: (tools: ProviderTools) => import('./owner/auth').then((module) => module.provider(tools)),
});

/** The providers this build registers; the first one serves. */
export const AUTH_PROVIDERS: readonly AuthProviderFactory[] = [OWNER_PASSWORD_PROVIDER];

export interface RequirementContext {
  readonly config: DeploymentConfig;
  readonly authProviders: readonly AuthProviderFactory[];
  /**
   * The mounted document pair, opened once for the profiles that serve it
   * (owner and read-only), before any requirement runs. The documents.pair
   * requirement reports its findings, and the profile's branch serves it, so
   * the pair is checked once.
   */
  readonly documents?: OpenDocumentsResult;
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
  {
    id: 'auth.secret',
    issue: '#2',
    profiles: ['owner'],
    failure: 'fatal',
    load: () => import('./owner/auth-secret').then((module) => module.check),
  },
  // Sign-in's limits (#2, Risk 1): with no trusted proxy hop nothing names a
  // client, so sign-in has only its global limits. A warning: the owner may
  // run with nothing in front on purpose.
  {
    id: 'auth.limits',
    issue: '#2',
    profiles: ['owner'],
    failure: 'fatal',
    check: async ({ config, authProviders }) =>
      config.trustedProxyHops > 0 || authProviders.length === 0
        ? []
        : [
            {
              severity: 'warning',
              key: 'PORTFOLIO_TRUSTED_PROXY_HOPS',
              code: 'no_source_limits',
              message:
                'With no trusted proxy hop, sign-in has only its global limits, so one client ' +
                "can hold off the owner's own sign-in. Run owner behind a proxy and set " +
                'PORTFOLIO_TRUSTED_PROXY_HOPS (docs/deployment.md, Owner authentication).',
            },
          ],
  },
  {
    id: 'data.directory',
    issue: '#2, #3',
    profiles: ['owner'],
    failure: 'fatal',
    load: () => import('./owner/data-directory').then((module) => module.check),
  },
  // The mounted pair (#4, item 6): a missing or doubled document, an
  // old-format one, and every record validatePublicationUnit finds. Startup
  // treats the pair as live, so a blocks-preview or blocks-publish record
  // stops it, and warnings are logged. It covers the matrix's invalid-document
  // and old-shape rows for both profiles; there's no second check.
  {
    id: 'documents.pair',
    issue: '#4',
    profiles: ['owner', 'read-only'],
    failure: 'fatal',
    check: async ({ documents }) => documents?.issues ?? [],
  },
  // Old-shape documents with no valid revision to fall back on: #3 adds the
  // revision check for owner, on top of documents.pair.
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
  /** The bundled example pair: demo's sample, and what next dev renders with no documents. */
  readonly examples: PairFiles;
  /** The appearance ids this build registers, which the pair is checked against. */
  readonly catalog?: AppearanceCatalog;
  /** The content extensions documents are checked against. */
  readonly extensions?: readonly ContentExtension[];
  /** The contract's checks on the pair, live (#5). */
  readonly validators?: readonly UnitValidator[];
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
  // Until #3, owner serves the mounted documents too.
  const documents =
    config.profile === 'owner' || config.profile === 'read-only' ? openDocuments(input) : undefined;
  const context: RequirementContext = { config, authProviders, documents };
  const early = await runRequirements(requirements, context, async (row) => row.check);
  if (failed(early.issues)) return { ok: false, issues: early.issues };

  switch (config.profile) {
    case 'demo': {
      const sample = openSampleCatalog({
        examples: input.examples,
        catalog: input.catalog,
        extensions: input.extensions,
        validators: input.validators,
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
      // documents.pair reported its findings, and stopped startup on a fatal one.
      if (!documents?.ok) return refusedDocuments(early.issues, documents);
      return built(config, {
        reader: documents.reader,
        adapter: 'documents',
        bindings: NO_BINDINGS,
        issues: early.issues,
        degraded: early.degraded,
      });
    }
    case 'owner': {
      if (!documents?.ok) return refusedDocuments(early.issues, documents);
      let issues = early.issues;
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
      const reader = documents.reader;
      const bindings: StudioBindings = {
        ...NO_BINDINGS,
        handlers: {
          ...owner.ownerHandlers({
            config,
            catalog,
            variantHealth: () =>
              liveVariantHealth(async () => (await reader.getLive()).unit.site.appearance.variant),
          }),
          ...provider.handlers,
        },
        resolveSession: (context) => provider.resolveSession(context),
        checkOrigin: (context) => provider.checkOrigin(context),
        touchSession: (context) => provider.touchSession(context),
        throttle: (context) =>
          provider.throttle ? provider.throttle(context) : NO_BINDINGS.throttle(context),
        invalidInput: (context) =>
          provider.invalidInput
            ? provider.invalidInput(context)
            : NO_BINDINGS.invalidInput(context),
        recheckSession: (context) =>
          provider.recheckSession
            ? provider.recheckSession(context)
            : NO_BINDINGS.recheckSession(context),
      };
      return built(config, {
        reader: documents.reader,
        adapter: catalog,
        bindings,
        issues,
        degraded: [...early.degraded, ...late.degraded],
        pages: provider.pages,
      });
    }
  }
}

function openDocuments(input: CompositionInput): OpenDocumentsResult {
  return openDocumentsCatalog({
    // readDeploymentConfig requires it for owner and read-only.
    sourceDir: input.config.sourceDir ?? '',
    mode: input.config.mode,
    examples: input.examples,
    catalog: input.catalog,
    extensions: input.extensions,
    validators: input.validators,
    origin: input.config.origin,
    report: input.report,
  });
}

/**
 * A pair that can't be served. documents.pair has already reported why;
 * without that row (a test's own table), the findings come along here.
 */
function refusedDocuments(
  issues: ConfigIssue[],
  documents: OpenDocumentsResult | undefined,
): Composition {
  return { ok: false, issues: [...issues, ...(documents?.issues ?? [])] };
}

interface Built {
  readonly reader: CatalogReader;
  readonly adapter: CatalogAdapter;
  readonly bindings: StudioBindings;
  readonly issues: ConfigIssue[];
  readonly degraded: readonly string[];
  /** Owner only: the provider's Studio page sessions. */
  readonly pages?: StudioPages;
}

function built(config: DeploymentConfig, parts: Built): Composition {
  // It reads the policy from the deployment register() stores, per request.
  const dispatch = createDispatcher({ ...parts.bindings, operations: listOperations() });
  const state = Object.freeze({
    config,
    catalog: parts.reader,
    dispatch,
    degraded: Object.freeze([...parts.degraded]),
    ...(parts.pages ? { pages: parts.pages } : {}),
  });
  return { ok: true, state, issues: parts.issues, summary: configSummary(config, parts.adapter) };
}
