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
  // #2: auth.login, with Retry-After.
  rate_limited: { status: 429, message: 'Too many attempts. Try again later.' },
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

const OPERATIONS: readonly Operation[] = [
  {
    name: 'config.status',
    kind: 'query',
    capability: 'config.status',
    input: z.object({}).strict(),
    output: ConfigSummarySchema,
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
];

export function listOperations(): readonly Operation[] {
  return OPERATIONS;
}
