import { z } from 'zod';
import { CAPABILITIES, PROFILES, type Capability } from './capabilities';

// The operation registry (#1, item 10): every query and command the Studio
// transport, /api/studio/[name], can run. Entries are data. They import no
// handlers; the composition root binds handlers by name, so loading the
// registry never loads owner code.

/** Every error the dispatcher answers with, and its status. */
export const ERROR_STATUS = {
  not_available_in_profile: 404,
  method_not_allowed: 405,
  authentication_required: 401,
  request_origin_rejected: 403,
  capability_denied: 403,
  invalid_input: 400,
  version_conflict: 409,
  internal_error: 500,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;

/** Queries are GET; commands are POST. */
export type OperationKind = 'query' | 'command';

export interface Operation {
  readonly name: string;
  readonly kind: OperationKind;
  readonly capability: Capability;
  /** Validates a query's search parameters or a command's JSON body. */
  readonly input: z.ZodType;
  /** Validates what the handler returns, before it leaves the server. */
  readonly output: z.ZodType;
  /** Needs an owner session (#2). */
  readonly session: boolean;
  /** Origin and CSRF checks (#2). Every command has them; no query does. */
  readonly originCheck: boolean;
  /** The version the input names, checked before the handler runs (#3). */
  readonly expects?: 'draft-version' | 'live-revision';
  /** Every error code the dispatcher can answer this operation with. */
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
