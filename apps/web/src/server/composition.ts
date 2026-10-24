import 'server-only';
import type { RenderDrift, Rendering, UnitChecks } from '@portfolio/core';
import {
  routedSlugs,
  validatePublicationUnit,
  type AppearanceCatalog,
  type ContentExtension,
  type UnitValidator,
} from '@portfolio/schema';
import type { PairFiles } from '@portfolio/schema/node';
import type { VariantRegistry } from '@portfolio/variant-contract';
import { compositionFor, REGISTRY } from '~/lib/variants';
import type { Profile } from './capabilities';
import type { CatalogReader, LiveRevision, PublicationUnit } from './catalog-port';
import { openSampleCatalog } from './catalog-sample';
import { openSourceCatalog, type OpenSourceCatalogResult } from './catalog-source';
import type { ConfigIssue, DeploymentConfig } from './config';
import { configSummary, type CatalogAdapter } from './config-summary';
import {
  setLiveCaseStudies,
  setLiveComposition,
  setServable,
  type DeploymentState,
} from './config-store';
import { createDispatcher, NO_BINDINGS, type Handler, type StudioBindings } from './dispatcher';
import { listOperations, type ConfigSummary } from './operations';
import type { GrantSessionPort, PreviewFixture, PreviewGrantsPort } from './preview-port';
import { publicViewOf } from './public-view';
import type { Session } from './session';
import type { StudioPages } from './studio-port';
import { liveVariantHealth } from './variant-health';

// The composition root (#1, item 14). It builds what one profile needs and
// nothing else: read-only reads its mounted documents through
// @portfolio/core's SourceCatalogReader, demo the bundled sample, and owner
// the revision store through RevisionCatalogReader (#3), into which owner's
// first start imports the mounted documents. Only the owner branch loads
// owner code, through import(). startup.ts imports this module in every
// profile, so check:deps fails any import of owner code here that isn't an
// import(). Around that it runs the named startup requirements, the hook #2,
// #3, and #4 implement their startup checks against.

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
  /**
   * A multi-step command's commit point, holding the session while it reads
   * it again and commits. Without one, no command commits.
   */
  readonly commitWithSession?: StudioBindings['commitWithSession'];
  /** Handlers for the provider's own entries, such as auth.login. */
  readonly handlers?: Readonly<Record<string, Handler>>;
  /** How Studio pages find their session, for requireOwnerPage. Without it, every one is refused. */
  readonly pages?: StudioPages;
  /**
   * The provider's sessions by digest, for #7's preview grants. Without it,
   * no grant is minted and no grant path is served.
   */
  readonly grantSessions?: GrantSessionPort;
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

/** The mounted documents, opened as a CatalogReader, or why they can't be. */
export type OpenDocumentsResult = OpenSourceCatalogResult;

export interface RequirementContext {
  readonly config: DeploymentConfig;
  readonly authProviders: readonly AuthProviderFactory[];
  /**
   * The mounted document pair, opened once for owner and read-only, before
   * any requirement runs, so the pair is checked once. read-only serves it,
   * and its documents.pair requirement reports the findings; owner imports
   * it at first start, and its documents.shape requirement reports them.
   */
  readonly documents?: OpenDocumentsResult;
  /**
   * Owner only: what the owner branch made once owner code loaded, for the
   * owner checks to share, such as #3's revision store. Owner code knows its
   * shape; here it's opaque.
   */
  readonly owner?: object;
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
  // and old-shape rows for read-only; documents.shape covers them for owner.
  {
    id: 'documents.pair',
    issue: '#4',
    profiles: ['read-only'],
    failure: 'fatal',
    check: async ({ documents }) => documents?.issues ?? [],
  },
  // The store's repair, then the live revision as served (#3, item 21): a
  // damaged one serves the last known good, and owner starts degraded.
  {
    id: 'revision.integrity',
    issue: '#3',
    profiles: ['owner'],
    failure: 'degraded',
    load: () => import('./owner/revision-integrity').then((module) => module.check),
  },
  // The mounted pair under owner (#3, item 24), after the repair. An empty
  // store imports it at first start, and one that can't go live stops
  // startup, as documents.pair stops read-only; once a revision exists, its
  // findings only warn, since the store is what serves.
  {
    id: 'documents.shape',
    issue: '#3',
    profiles: ['owner'],
    failure: 'fatal',
    load: () => import('./owner/first-start').then((module) => module.check),
  },
  // Media renditions (#10, Risk 1): sharp loads, and the media root is a
  // directory the server only reads. Warnings: without sharp, draft saves
  // derive nothing new, and every rendition already derived keeps serving.
  {
    id: 'media.renditions',
    issue: '#10',
    profiles: ['owner'],
    failure: 'degraded',
    load: () => import('./owner/media').then((module) => module.check),
  },
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
  /**
   * #5's contract fixtures by id, which owner's fixture grants render (#7).
   * None until #5's fixtures ship with the build; tests pass their own.
   */
  readonly previewFixtures?: (id: string) => PreviewFixture | null;
  /**
   * The build's checks on a publication unit (#3), on the deployment's
   * origin: unit-checks.ts's, which register() passes, with the variant
   * registry behind them. Without them, a unit is checked with `catalog`,
   * `extensions`, and `validators` alone, for publish and serving alike.
   */
  readonly unitChecks?: (origin: string) => UnitChecks;
  /** Where a live manifest's rendering differs from the build's (#3, item 21). */
  readonly renderDrift?: (rendering: Rendering) => readonly RenderDrift[];
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
  // read-only serves them, and owner imports them into an empty store.
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
      // The mounted pair's findings are documents.shape's to report: fatal
      // only for a first-start import, since a store with a revision serves.
      let issues = early.issues;
      // The one place owner code loads.
      const owner = await import('./owner/index');
      // The revision store (#3), which the owner requirements check, claim,
      // and import the mounted pair into, and the reader visitors are served
      // through. An empty store serves nothing, and visitors get 503.
      const store = owner.ownerStore({
        config,
        checks: unitChecks(input),
        examples: input.examples,
        pairContext: { catalog: input.catalog, extensions: input.extensions },
        ...(input.renderDrift ? { renderDrift: input.renderDrift } : {}),
        setServable,
      });
      const late = await runRequirements(requirements, { ...context, owner: store }, async (row) =>
        row.load?.(),
      );
      issues = [...issues, ...late.issues];
      if (failed(late.issues)) {
        store.release();
        return { ok: false, issues };
      }
      // The auth.provider requirement made sure of one.
      const factory = authProviders[0];
      if (!factory) throw new Error('The owner profile has no authentication provider.');
      const provider = await factory.load({ config, mintSession: owner.mintSession });
      // #7's preview grants, bound to the provider's sessions by digest, and
      // checked against what startup checks the live pair against.
      const previews = provider.grantSessions
        ? owner.ownerPreviews({
            config,
            sessions: provider.grantSessions,
            ...(input.catalog ? { catalog: input.catalog } : {}),
            ...(input.extensions ? { extensions: input.extensions } : {}),
            ...(input.validators ? { validators: input.validators } : {}),
            ...(input.previewFixtures ? { fixtures: input.previewFixtures } : {}),
          })
        : undefined;
      const catalog: CatalogAdapter = 'revisions';
      // Every read of the live revision records its composition, Studio's
      // own included: after a publish from beside the server, a config.status
      // read can be the one that sees it first (#6, Slice 2).
      const reader = recordingLive(store.reader);
      const bindings: StudioBindings = {
        ...NO_BINDINGS,
        handlers: {
          ...owner.ownerHandlers({
            config,
            catalog,
            store: { ...store, studio: refreshingOnCommit(store.studio, reader) },
            variantHealth: () =>
              liveVariantHealth(async () => selectedVariant(await reader.getLive())),
          }),
          ...provider.handlers,
          ...previews?.handlers,
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
        commitWithSession: (context, commit) =>
          provider.commitWithSession
            ? provider.commitWithSession(context, commit)
            : NO_BINDINGS.commitWithSession(context, commit),
      };
      return built(config, {
        reader,
        adapter: catalog,
        bindings,
        issues,
        degraded: [...early.degraded, ...late.degraded],
        pages: provider.pages,
        ...(previews ? { previews: previews.port } : {}),
        dataDirectory: () => store.probe(),
        release: () => store.release(),
        // The live media's blobs, for /media (#10).
        mediaBlobs: (hash) => store.store.assets.open(hash),
      });
    }
  }
}

/** The variant the live revision's site selects. It throws when nothing serves. */
function selectedVariant(live: LiveRevision): string {
  if (!live.unit) throw new Error('Nothing is servable.');
  return live.unit.site.appearance.variant;
}

/**
 * The build's checks on the deployment's origin, or, without them, #4's
 * validator with the context the input gives, for publish and serving alike.
 */
function unitChecks(input: CompositionInput): UnitChecks {
  if (input.unitChecks) return input.unitChecks(input.config.origin);
  const context = {
    catalog: input.catalog,
    extensions: input.extensions,
    validators: input.validators,
    canonicalOrigin: input.config.origin,
  };
  return { validate: (pair) => validatePublicationUnit(pair, context), appVersion: '' };
}

function openDocuments(input: CompositionInput): OpenDocumentsResult {
  return openSourceCatalog({
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
  /** Owner only: the preview grants proxy.ts and the preview routes check (#7). */
  readonly previews?: PreviewGrantsPort;
  /** Owner only: readiness's data-directory probe (#3). */
  readonly dataDirectory?: () => Promise<boolean>;
  /** Owner only: lets the data directory's server claim go as the process exits (#3). */
  readonly release?: () => void;
  /** Owner only: the live media's blobs, from the AssetStore (#10). */
  readonly mediaBlobs?: DeploymentState['mediaBlobs'];
}

/** The slugs a unit's public view routes, or none when the view won't build. */
function caseStudiesOf(unit: PublicationUnit): ReadonlySet<string> | undefined {
  try {
    return routedSlugs(publicViewOf(unit));
  } catch {
    return undefined;
  }
}

/** The Studio moves that change what's live. */
const MOVES = ['publish', 'rollback', 'recover'] as const;

type Move = (...args: never[]) => Promise<{ readonly kind: string }>;

/**
 * `studio`, its publish, rollback, and recover reading the live revision
 * through `reader`, the composition root's, once one commits and before it
 * answers (#10b). So the slugs /work serves and the live composition are the
 * new revision's by the time Studio hears the publish went through, and the
 * owner's new case study isn't a 404 on the next request. proxy.ts still
 * reads memory alone. A publish from the CLI, outside this process, shows
 * on the next read instead. A read that fails leaves what was recorded.
 */
export function refreshingOnCommit<S extends Record<(typeof MOVES)[number], Move>>(
  studio: S,
  reader: CatalogReader,
): S {
  const refreshed = { ...studio };
  for (const name of MOVES) {
    const move = studio[name];
    refreshed[name] = (async (...args: Parameters<Move>) => {
      const outcome = await move(...args);
      if (outcome.kind === 'committed') await reader.getLive().catch(() => undefined);
      return outcome;
    }) as S[typeof name];
  }
  return Object.freeze(refreshed);
}

/** The readers recordingLive() made. */
const RECORDING = new WeakSet<CatalogReader>();

/**
 * `reader`, recording in config-store the composition each live revision
 * renders, on every getLive() (#6, Slice 2): the id of the variant its site
 * selects, or the fallback composition's when this build doesn't register
 * that one. proxy.ts sends each visitor page to that composition's
 * experience segment, and the page there checks the same value once it has
 * read the revision. Every profile's reader goes through here, built()
 * wraps whichever one compose() made: owner's RevisionCatalogReader,
 * read-only's SourceCatalogReader, and demo's sample adapter. The id comes
 * from the unit this getLive() returned, so it's never another read's; with
 * nothing servable, an empty or incompatible store, it's unset, and
 * visitor pages answer 503 meanwhile. In the same step it records the slugs
 * /work/<slug> serves (#10b): the routed case studies of that unit's public
 * view, or none when there's no unit or its view won't build, so /work fails
 * closed. Tests pass a registry of their own.
 */
export function recordingLive(
  reader: CatalogReader,
  registry: VariantRegistry = REGISTRY,
): CatalogReader {
  // A reader that records already is used as it is: built() wraps whichever
  // reader it gets, and owner's comes wrapped for Studio's reads too.
  if (RECORDING.has(reader)) return reader;
  const recording: CatalogReader = Object.freeze({
    async getLive() {
      const live = await reader.getLive();
      setLiveComposition(
        live.unit
          ? compositionFor(live.unit.site.appearance.variant, registry).rendered.manifest.id
          : undefined,
      );
      setLiveCaseStudies(live.unit ? caseStudiesOf(live.unit) : undefined);
      return live;
    },
  });
  RECORDING.add(recording);
  return recording;
}

function built(config: DeploymentConfig, parts: Built): Composition {
  // It reads the policy from the deployment register() stores, per request.
  const dispatch = createDispatcher({ ...parts.bindings, operations: listOperations() });
  const state = Object.freeze({
    config,
    catalog: recordingLive(parts.reader),
    dispatch,
    degraded: Object.freeze([...parts.degraded]),
    ...(parts.pages ? { pages: parts.pages } : {}),
    ...(parts.previews ? { previews: parts.previews } : {}),
    ...(parts.dataDirectory ? { dataDirectory: parts.dataDirectory } : {}),
    ...(parts.release ? { release: parts.release } : {}),
    ...(parts.mediaBlobs ? { mediaBlobs: parts.mediaBlobs } : {}),
  });
  return { ok: true, state, issues: parts.issues, summary: configSummary(config, parts.adapter) };
}
