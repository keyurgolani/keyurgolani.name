import { z } from 'zod';
import { CAPABILITIES, PROFILES, type Capability } from './capabilities';

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
  version_conflict: { status: 409, message: 'The content changed since it was read.' },
  // #2: auth.login. Every credential failure answers this one, whatever was wrong.
  credentials_rejected: { status: 401, message: "That password didn't work." },
  // #2: auth.login, with Retry-After.
  rate_limited: { status: 429, message: 'Too many attempts. Try again later.' },
  // #2: auth.login when the session store can't be written. No cookie goes with it.
  unavailable: { status: 503, message: "That can't be done right now. Try again soon." },
  // #7: preview.grant.mint for a draft, revision, or fixture the store doesn't hold.
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
  /** The version the input names, checked before the handler runs (#3). */
  readonly expects?: 'draft-version' | 'live-revision';
  /** A command's body types. Default JSON only; #2's auth.login adds form posts. */
  readonly bodyTypes?: readonly BodyType[];
  /** A command's body cap in bytes. Default MAX_BODY_BYTES; #2's auth.login takes 4 KB. */
  readonly maxBodyBytes?: number;
  /** Every error code the dispatcher or the handler can answer this operation with. */
  readonly errors: readonly ErrorCode[];
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
    adapters: z.object({ catalog: z.enum(['documents', 'sample']) }).strict(),
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

/** What config.status answers: the summary, and how the live site's variant renders. */
export const ConfigStatusSchema = ConfigSummarySchema.extend({
  variant: VariantHealthSchema,
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
];

export function listOperations(): readonly Operation[] {
  return OPERATIONS;
}
