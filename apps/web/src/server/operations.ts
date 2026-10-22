import { z } from 'zod';
import { CAPABILITIES, PROFILES, type Capability } from './capabilities';
import {
  AssetMissingDetails,
  CommittedSchema,
  DiagnosticsDetails,
  DraftConflictDetails,
  DraftCreateInput,
  DraftDiscardInput,
  DraftEditsInput,
  DraftIdSchema,
  DraftOutputSchema,
  DraftRebaseInput,
  DraftSaveInput,
  DraftSchema,
  HistoryListSchema,
  IncompatibleDetails,
  LiveConflictDetails,
  LiveSchema,
  moveInput,
  PageInput,
  PublishInputSchema,
  RevisionDetailSchema,
  RevisionIdSchema,
  RevisionListSchema,
  ServingStateSchema,
  Sha256Schema,
  DraftImportInput,
} from './store-schemas';

// The operation registry (#1, item 10): every query and command the Studio
// transport, /api/studio/[name], can run. Entries are data. They import no
// handlers; the composition root binds handlers by name, so loading the
// registry never loads owner code.

/**
 * Every error code the transport answers with: its status and its fixed
 * message, the only text an error carries. A new code is one entry here,
 * and an operation that can return it lists it in `errors`.
 */
export const ERRORS = {
  not_available_in_profile: {
    status: 404,
    message: "This deployment doesn't offer that operation.",
  },
  method_not_allowed: { status: 405, message: "That operation doesn't accept this method." },
  authentication_required: { status: 401, message: 'Sign in to use that operation.' },
  request_origin_rejected: { status: 403, message: "The request didn't come from this site." },
  capability_denied: { status: 403, message: "This session can't use that operation." },
  invalid_input: { status: 400, message: "The input doesn't match the operation." },
  // #7: preview.grant.mint, for a draft that moved past the version it names.
  version_conflict: { status: 409, message: 'The content changed since it was read.' },
  // #3's store, checked under the publication lock, in place of #1's version_conflict.
  draft_conflict: { status: 409, message: 'The draft changed since it was read.' },
  live_conflict: { status: 409, message: 'The live revision changed since it was read.' },
  nothing_to_publish: { status: 409, message: 'The draft is the same as the live revision.' },
  validation_failed: { status: 422, message: "The content doesn't validate." },
  revision_incompatible: { status: 422, message: "This build can't make that revision live." },
  asset_missing: { status: 422, message: "A file the content references isn't stored." },
  payload_too_large: { status: 413, message: 'A document is over the 1 MiB limit.' },
  // #3: a key already used for another request.
  idempotency_conflict: {
    status: 422,
    message: 'That idempotency key went with another request.',
  },
  // #3: both with Retry-After. Nothing moved, so a retry is safe.
  lock_timeout: { status: 503, message: 'Another publication is running. Try again shortly.' },
  lock_lost: { status: 503, message: 'Another publication took over. Try again shortly.' },
  storage_unavailable: { status: 503, message: "The data directory can't be used right now." },
  storage_full: { status: 507, message: 'The data directory is full.' },
  // #3: this server's claim on the data directory went to another owner server.
  data_dir_in_use: {
    status: 503,
    message: 'Another owner server holds the data directory. Stop it, or restart this one.',
  },
  // #2: auth.login. Every credential failure answers this one, whatever was wrong.
  credentials_rejected: { status: 401, message: "That password didn't work." },
  // #2: auth.login, with Retry-After.
  rate_limited: { status: 429, message: 'Too many attempts. Try again later.' },
  // #2: auth.login when the session store can't be written. No cookie goes with it.
  unavailable: { status: 503, message: "That can't be done right now. Try again soon." },
  // #3's store, and #7's preview.grant.mint: a draft, revision, or fixture it doesn't hold.
  not_found: { status: 404, message: "That draft, revision, or fixture doesn't exist." },
  internal_error: {
    status: 500,
    message: 'The operation failed. Quote the request ID when you report it.',
  },
} as const satisfies Record<string, { readonly status: number; readonly message: string }>;
export type ErrorCode = keyof typeof ERRORS;

/** Queries are GET; commands are POST. */
export type OperationKind = 'query' | 'command';

/** How a command's body may arrive. */
export type BodyType = 'json' | 'form';

/** Largest command body the dispatcher reads, unless the entry sets its own. */
export const MAX_BODY_BYTES = 1024 * 1024;

export interface Operation {
  readonly name: string;
  readonly kind: OperationKind;
  readonly capability: Capability;
  /** Validates a query's search parameters or a command's body. */
  readonly input: z.ZodType;
  /** Validates what the handler returns, before it leaves the server. */
  readonly output: z.ZodType;
  /** Needs an owner session (#2). */
  readonly session: boolean;
  /** Origin and CSRF checks (#2). Every command has them; no query does. */
  readonly originCheck: boolean;
  /** A command's body types. Default JSON only; #2's auth.login adds form posts. */
  readonly bodyTypes?: readonly BodyType[];
  /** A command's body cap in bytes. Default MAX_BODY_BYTES; #2's auth.login takes 4 KB. */
  readonly maxBodyBytes?: number;
  /** Every error code the dispatcher or the handler can answer this operation with. */
  readonly errors: readonly ErrorCode[];
  /**
   * The payload in `error.details`, by code (#3, amending #1 item 5): only
   * for an owner session, only on a 409 or a 422, and only once it passes
   * its schema. Every other error body is the fixed one.
   */
  readonly details?: Readonly<Partial<Record<ErrorCode, z.ZodType>>>;
}

const SecretState = z.enum(['set', 'unset']);

/**
 * The redacted deployment summary: the item 21 `deployment.config` fields,
 * with each secret as set or unset and no path or secret value.
 */
export const ConfigSummarySchema = z
  .object({
    profile: z.enum(PROFILES),
    origin: z.string(),
    previewOrigin: z.string().nullable(),
    proxyHops: z.number().int().nonnegative(),
    capabilities: z.array(
      z
        .object({
          id: z.enum(CAPABILITIES as [Capability, ...Capability[]]),
          access: z.enum(['public', 'session']),
        })
        .strict(),
    ),
    adapters: z.object({ catalog: z.enum(['documents', 'sample', 'revisions']) }).strict(),
    secrets: z
      .object({ PORTFOLIO_AUTH_PASSWORD_HASH: SecretState, GITHUB_TOKEN: SecretState })
      .strict(),
  })
  .strict();
export type ConfigSummary = z.infer<typeof ConfigSummarySchema>;

/**
 * Whether the selected variant renders, as #5's liveVariantHealth() reports
 * it: `degraded`, naming both ids, when the fallback composition stands in,
 * and `fail` when the revision or the variant's module doesn't load, with the
 * selection when the revision said it.
 */
export const VariantHealthSchema = z.union([
  z
    .object({
      status: z.enum(['ok', 'degraded']),
      requested: z.string(),
      rendered: z.string(),
    })
    .strict(),
  z.object({ status: z.literal('fail'), requested: z.string().nullable() }).strict(),
]);

/**
 * What serves (#3, item 23): the state, the revision the pointer names, the
 * one served, and where the live manifest's rendering differs from the
 * build's.
 */
export const CatalogStatusSchema = z
  .object({
    state: ServingStateSchema,
    liveRevisionId: RevisionIdSchema.nullable(),
    servingRevisionId: RevisionIdSchema.nullable(),
    renderDrift: z
      .array(
        z
          .object({
            kind: z.enum(['variant', 'pack', 'contract']),
            id: z.string(),
            revision: z.string(),
            build: z.string().nullable(),
          })
          .strict(),
      )
      .nullable(),
  })
  .strict();

/**
 * Whether owner writes go through (#3): `stopped`, with why, while another
 * owner server holds the data directory (`data_dir_in_use`), while this one
 * hasn't claimed it yet (`data_dir_unclaimed`), or while startup repair
 * still fails (`store_repair_failed`). Visitors are served either way.
 */
export const WriteStateSchema = z.union([
  z.object({ state: z.literal('open') }).strict(),
  z
    .object({
      state: z.literal('stopped'),
      code: z.enum(['data_dir_in_use', 'data_dir_unclaimed', 'store_repair_failed']),
    })
    .strict(),
]);
export type WriteState = z.infer<typeof WriteStateSchema>;

/**
 * Whether the mounted pair is what was last imported (#3, item 24):
 * `changed`, with the message, when its sourceHash isn't the one the newest
 * event carrying one recorded; `unknown` with no pair to read or nothing
 * imported. Drift never publishes: Studio offers Import as draft.
 */
export const SourceStatusSchema = z.union([
  z
    .object({
      state: z.literal('changed'),
      message: z.literal('Source files changed since the live revision'),
      mountedSourceHash: Sha256Schema,
      importedSourceHash: Sha256Schema,
    })
    .strict(),
  z
    .object({
      state: z.enum(['unchanged', 'unknown']),
      mountedSourceHash: Sha256Schema.nullable(),
      importedSourceHash: Sha256Schema.nullable(),
    })
    .strict(),
]);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

/**
 * What config.status answers: the summary, how the live site's variant
 * renders, what serves, whether owner writes go through, and whether the
 * mounted pair drifted from the last import.
 */
export const ConfigStatusSchema = ConfigSummarySchema.extend({
  variant: VariantHealthSchema,
  catalog: CatalogStatusSchema,
  writes: WriteStateSchema,
  source: SourceStatusSchema,
}).strict();
export type ConfigStatus = z.infer<typeof ConfigStatusSchema>;

const Instant = z.string().datetime();

/** When a session ends if nothing slides it, and when it ends regardless. */
export const SessionExpirySchema = z
  .object({ idleExpiresAt: Instant, absoluteExpiresAt: Instant })
  .strict();

/** auth.session and a JSON auth.login: who is signed in, the CSRF token, and the expiry times. */
export const AuthSessionSchema = z
  .object({
    principal: z
      .object({ id: z.literal('owner'), method: z.literal('password'), authTime: Instant })
      .strict(),
    csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    idleExpiresAt: Instant,
    absoluteExpiresAt: Instant,
  })
  .strict();
export type AuthSessionView = z.infer<typeof AuthSessionSchema>;

/** One owner session, as the session list shows it: never its token or digest. */
export const SessionSummarySchema = z
  .object({
    ref: z.string().regex(/^[0-9a-f]{8}$/),
    browser: z.enum(['chrome', 'edge', 'firefox', 'safari', 'other']),
    createdAt: Instant,
    lastSeenAt: Instant,
    current: z.boolean(),
  })
  .strict();

/**
 * What auth.login reads. Any password at all, up to the body cap, so a
 * missing, empty, malformed, or overlong one is a credential failure that
 * costs one verification, not an invalid_input that costs none. Extra form
 * fields are ignored.
 */
export const LoginInputSchema = z.object({ password: z.unknown().optional() }).passthrough();

/**
 * A preview grant (#7, Slice 2): 128 bits in base64url, which only a frame's
 * URL carries, in its grant path. Studio sends it to the grant commands in
 * the body, never a query, so it reaches no URL but the grant path.
 */
export const GrantTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

/** What a grant is now: preview.grant.status, and why a frame renders nothing. */
export const GrantStatusSchema = z.enum([
  'active',
  'superseded',
  'expired',
  'unknown',
  'session_ended',
]);

/** The environment a frame starts in, from Slice 4's controls, which its grant fixes for first paint. */
export const PreviewEnvironmentSchema = z
  .object({
    displayMode: z.enum(['system', 'light', 'dark', 'high-contrast']),
    contrast: z.enum(['system', 'more']),
    motion: z.enum(['system', 'reduce']),
    enhancement: z.enum(['on', 'off']),
  })
  .strict();

/** What a grant renders: a draft's version, a published revision, or one of #5's fixtures. */
export const GrantSubjectSchema = z.union([
  z
    .object({
      draft: z.string().regex(/^drf_[0-9a-f]{32}$/),
      version: z.number().int().positive(),
    })
    .strict(),
  z.object({ revision: z.string().regex(/^rev_[0-9a-f]{32}$/) }).strict(),
  z.object({ fixture: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) }).strict(),
]);

/**
 * preview.grant.mint's input. The appearance override is a selection in the
 * site document's own shape, which the handler checks with #4's schema and
 * this build's registries; it never reaches the draft or a URL.
 */
export const GrantMintInputSchema = z
  .object({
    subject: GrantSubjectSchema,
    appearance: z.record(z.string(), z.unknown()).optional(),
    environment: PreviewEnvironmentSchema,
  })
  .strict();

const GrantExpiry = { idleExpiresAt: Instant, absoluteExpiresAt: Instant };

/**
 * A new grant, or `preview_blocked` with how many #4 `blocks-preview`
 * diagnostics the version has, for which no grant is minted. The frame keeps
 * the grant it has (Slice 2, item 6).
 */
export const GrantMintOutputSchema = z.union([
  z
    .object({
      status: z.literal('active'),
      grant: GrantTokenSchema,
      /** The channel nonce the frame's agent says back (Slice 3). */
      nonce: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
      ...GrantExpiry,
    })
    .strict(),
  z
    .object({ status: z.literal('preview_blocked'), diagnostics: z.number().int().positive() })
    .strict(),
]);

/** preview.grant.renew's answer: the new limits, or why the grant renders nothing now. */
export const GrantRenewOutputSchema = z.union([
  z.object({ status: z.literal('active'), ...GrantExpiry }).strict(),
  z.object({ status: GrantStatusSchema.exclude(['active']) }).strict(),
]);

/** The codes every entry can get from the dispatcher's own steps. */
const BASE_ERRORS = ['not_available_in_profile', 'method_not_allowed'] as const;
const SESSION_QUERY_ERRORS: readonly ErrorCode[] = [
  ...BASE_ERRORS,
  'authentication_required',
  'capability_denied',
  'invalid_input',
  'internal_error',
];
const SESSION_COMMAND_ERRORS: readonly ErrorCode[] = [
  ...BASE_ERRORS,
  'authentication_required',
  'request_origin_rejected',
  'capability_denied',
  'invalid_input',
  'internal_error',
];
const NO_INPUT = z.object({}).strict();

// #3's store entries (item 22). A store query can find the data directory
// unreadable; a store write can also wait out the lock, lose it to another
// holder before it moves anything, find the disk full, or find another
// owner server holding the directory.
const STORE_FAILURES: readonly ErrorCode[] = [
  'lock_timeout',
  'lock_lost',
  'storage_unavailable',
  'storage_full',
  'data_dir_in_use',
];
/** Every outcome a draft command can return. */
const DRAFT_OUTCOMES: readonly ErrorCode[] = [
  'draft_conflict',
  'live_conflict',
  'payload_too_large',
  'asset_missing',
  'validation_failed',
  'not_found',
];
const DRAFT_DETAILS = {
  draft_conflict: DraftConflictDetails,
  live_conflict: LiveConflictDetails,
  validation_failed: DiagnosticsDetails,
  asset_missing: AssetMissingDetails,
};
/** The largest draft body: three documents of 1 MiB, with room for JSON's escapes. */
const DRAFT_BODY_BYTES = 4 * 1024 * 1024;

function storeQuery(
  name: string,
  capability: Capability,
  input: z.ZodType,
  output: z.ZodType,
  errors: readonly ErrorCode[] = [],
): Operation {
  return {
    name,
    kind: 'query',
    capability,
    input,
    output,
    session: true,
    originCheck: false,
    errors: [...SESSION_QUERY_ERRORS, 'storage_unavailable', ...errors],
  };
}

function storeCommand(
  name: string,
  capability: Capability,
  input: z.ZodType,
  output: z.ZodType,
  errors: readonly ErrorCode[],
  details: Operation['details'],
  maxBodyBytes?: number,
): Operation {
  return {
    name,
    kind: 'command',
    capability,
    input,
    output,
    session: true,
    originCheck: true,
    errors: [...SESSION_COMMAND_ERRORS, ...errors, ...STORE_FAILURES],
    details,
    ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }),
  };
}

const STORE_OPERATIONS: readonly Operation[] = [
  // history.read
  storeQuery('live.get', 'history.read', NO_INPUT, LiveSchema),
  storeQuery('revision.list', 'history.read', PageInput, RevisionListSchema),
  storeQuery(
    'revision.get',
    'history.read',
    z.object({ revisionId: RevisionIdSchema }).strict(),
    RevisionDetailSchema,
    ['not_found'],
  ),
  storeQuery('history.list', 'history.read', PageInput, HistoryListSchema),
  // draft.read
  storeQuery(
    'draft.getWorking',
    'draft.read',
    NO_INPUT,
    z.object({ draft: DraftSchema.nullable() }).strict(),
  ),
  storeQuery(
    'draft.get',
    'draft.read',
    z.object({ draftId: DraftIdSchema }).strict(),
    DraftOutputSchema,
    ['not_found'],
  ),
  // draft.write
  storeCommand(
    'draft.create',
    'draft.write',
    DraftCreateInput,
    DraftOutputSchema,
    DRAFT_OUTCOMES,
    DRAFT_DETAILS,
  ),
  storeCommand(
    'draft.save',
    'draft.write',
    DraftSaveInput,
    DraftOutputSchema,
    DRAFT_OUTCOMES,
    DRAFT_DETAILS,
    DRAFT_BODY_BYTES,
  ),
  storeCommand(
    'draft.applyEdits',
    'draft.write',
    DraftEditsInput,
    DraftOutputSchema,
    DRAFT_OUTCOMES,
    DRAFT_DETAILS,
    DRAFT_BODY_BYTES,
  ),
  storeCommand(
    'draft.rebase',
    'draft.write',
    DraftRebaseInput,
    DraftOutputSchema,
    DRAFT_OUTCOMES,
    DRAFT_DETAILS,
    DRAFT_BODY_BYTES,
  ),
  // config.import: the mounted pair as the working draft, its sourceHash kept.
  storeCommand(
    'draft.importSource',
    'config.import',
    DraftImportInput,
    DraftOutputSchema,
    DRAFT_OUTCOMES,
    DRAFT_DETAILS,
  ),
  // draft.write
  storeCommand(
    'draft.discard',
    'draft.write',
    DraftDiscardInput,
    z.object({ discarded: DraftIdSchema }).strict(),
    ['draft_conflict', 'not_found'],
    { draft_conflict: DraftConflictDetails },
  ),
  // publish
  storeCommand(
    'publish',
    'publish',
    PublishInputSchema,
    CommittedSchema,
    [
      'live_conflict',
      'draft_conflict',
      'nothing_to_publish',
      'validation_failed',
      'asset_missing',
      'not_found',
      'idempotency_conflict',
    ],
    {
      live_conflict: LiveConflictDetails,
      draft_conflict: DraftConflictDetails,
      validation_failed: DiagnosticsDetails,
      asset_missing: AssetMissingDetails,
    },
  ),
  // rollback
  ...(['rollback', 'recover'] as const).map((name) =>
    storeCommand(
      name,
      'rollback',
      moveInput(name === 'rollback' ? 'required' : 'optional'),
      CommittedSchema,
      [
        'live_conflict',
        'nothing_to_publish',
        'revision_incompatible',
        'not_found',
        'idempotency_conflict',
      ],
      { live_conflict: LiveConflictDetails, revision_incompatible: IncompatibleDetails },
    ),
  ),
];

const OPERATIONS: readonly Operation[] = [
  {
    name: 'config.status',
    kind: 'query',
    capability: 'config.status',
    input: z.object({}).strict(),
    output: ConfigStatusSchema,
    session: true,
    originCheck: false,
    errors: [
      'not_available_in_profile',
      'method_not_allowed',
      'authentication_required',
      'capability_denied',
      'invalid_input',
      'internal_error',
    ],
  },
  // #2's auth entries. auth.login takes a JSON body or the sign-in form's,
  // and answers a form with a 303. auth.session never slides the session.
  {
    name: 'auth.session',
    kind: 'query',
    capability: 'auth.session',
    input: NO_INPUT,
    output: AuthSessionSchema,
    session: true,
    originCheck: false,
    errors: SESSION_QUERY_ERRORS,
  },
  {
    name: 'auth.login',
    kind: 'command',
    capability: 'auth.session',
    input: LoginInputSchema,
    output: AuthSessionSchema,
    session: false,
    originCheck: true,
    bodyTypes: ['json', 'form'],
    maxBodyBytes: 4096,
    errors: [
      ...BASE_ERRORS,
      'request_origin_rejected',
      'capability_denied',
      'invalid_input',
      'credentials_rejected',
      'rate_limited',
      'unavailable',
      'internal_error',
    ],
  },
  {
    name: 'auth.logout',
    kind: 'command',
    capability: 'auth.session',
    input: NO_INPUT,
    output: z.object({ signedOut: z.literal(true) }).strict(),
    // Signing out answers as signed out with or without a session that
    // counts, so a cookie the store couldn't check, or one that ended, is
    // cleared all the same. The Origin check still applies.
    session: false,
    originCheck: true,
    errors: [
      ...BASE_ERRORS,
      'request_origin_rejected',
      'capability_denied',
      'invalid_input',
      'internal_error',
    ],
  },
  {
    name: 'auth.session.extend',
    kind: 'command',
    capability: 'auth.session',
    input: NO_INPUT,
    output: SessionExpirySchema,
    session: true,
    originCheck: true,
    errors: SESSION_COMMAND_ERRORS,
  },
  {
    name: 'auth.sessions.list',
    kind: 'query',
    capability: 'studio.view',
    input: NO_INPUT,
    output: z.object({ sessions: z.array(SessionSummarySchema).max(5) }).strict(),
    session: true,
    originCheck: false,
    errors: SESSION_QUERY_ERRORS,
  },
  {
    name: 'auth.sessions.revoke',
    kind: 'command',
    capability: 'studio.view',
    input: z.object({ ref: z.string().regex(/^[0-9a-f]{8}$/) }).strict(),
    output: z.object({ revoked: z.boolean() }).strict(),
    session: true,
    originCheck: true,
    errors: SESSION_COMMAND_ERRORS,
  },
  {
    name: 'auth.sessions.revokeAll',
    kind: 'command',
    capability: 'studio.view',
    input: NO_INPUT,
    output: z.object({ revoked: z.number().int().nonnegative() }).strict(),
    session: true,
    originCheck: true,
    errors: SESSION_COMMAND_ERRORS,
  },
  // #7's preview grants, each Studio's own: commands, so a grant travels in
  // a body Studio's session sends, never in a URL. renew and status never
  // slide the session (owner/auth.ts), so a heartbeat can't keep it alive.
  {
    name: 'preview.grant.mint',
    kind: 'command',
    capability: 'preview.grant',
    input: GrantMintInputSchema,
    output: GrantMintOutputSchema,
    session: true,
    originCheck: true,
    errors: [...SESSION_COMMAND_ERRORS, 'not_found', 'version_conflict'],
  },
  {
    name: 'preview.grant.renew',
    kind: 'command',
    capability: 'preview.grant',
    input: z.object({ grant: GrantTokenSchema }).strict(),
    output: GrantRenewOutputSchema,
    session: true,
    originCheck: true,
    errors: SESSION_COMMAND_ERRORS,
  },
  {
    name: 'preview.grant.revoke',
    kind: 'command',
    capability: 'preview.grant',
    input: z.object({ grant: GrantTokenSchema }).strict(),
    output: z.object({ revoked: z.boolean() }).strict(),
    session: true,
    originCheck: true,
    errors: SESSION_COMMAND_ERRORS,
  },
  {
    name: 'preview.grant.status',
    kind: 'command',
    capability: 'preview.grant',
    input: z.object({ grant: GrantTokenSchema }).strict(),
    output: z.object({ status: GrantStatusSchema }).strict(),
    session: true,
    originCheck: true,
    errors: SESSION_COMMAND_ERRORS,
  },
  // #3's store: its queries (history.read, draft.read) and commands
  // (draft.write, publish, rollback).
  ...STORE_OPERATIONS,
];

export function listOperations(): readonly Operation[] {
  return OPERATIONS;
}
