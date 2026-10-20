import { authorize, type Authorized } from './authorize';
import { ERROR_STATUS, type ErrorCode, type Operation } from './operations';
import type { CapabilityPolicy, Session } from './policy';

// The one dispatcher behind /api/studio/[name] (#1, item 11). It runs its
// steps in order, each denying before the next, and reads the request body
// only at step 5:
//
//   1. unknown name, or capability absent in the profile: 404; wrong method: 405
//   2. session required and missing (#2): 401
//   3. commands only, origin and CSRF (#2): 403
//   4. authorize(capability, session): 403
//   5. input schema: 400
//   6. expected draft version or live revision (#3): 409
//   7. handler, then output schema; anything unexpected: 500
//
// Every response is `Cache-Control: no-store`. Errors are
// `{ "error": { "code", "message", "requestId" } }`; a result is `{ "data" }`.

export interface DispatchContext {
  readonly requestId: string;
}

/** Runs one operation. It gets the authorize() token first, already checked. */
export type Handler = (authorized: Authorized, input: unknown, context: DispatchContext) => unknown;

/** What the composition root binds for a profile. */
export interface StudioBindings {
  /** Handlers by operation name. */
  readonly handlers: Readonly<Record<string, Handler>>;
  /** Step 2 (#2): the session the request carries, or null. */
  readonly resolveSession: (request: Request) => Promise<Session | null>;
  /** Step 3 (#2): origin and CSRF checks for a command. */
  readonly checkOrigin: (request: Request) => Promise<boolean>;
  /** Step 6 (#3): whether the version the input names is still current. */
  readonly checkVersion: (operation: Operation, input: unknown) => Promise<boolean>;
}

/**
 * No handlers, no session, and every origin and version refused: read-only
 * and demo, and the parts of owner #2 and #3 haven't supplied yet.
 */
export const NO_BINDINGS: StudioBindings = Object.freeze({
  handlers: Object.freeze({}),
  resolveSession: async () => null,
  checkOrigin: async () => false,
  checkVersion: async () => false,
});

export type Dispatch = (request: Request, name: string) => Promise<Response>;

export interface DispatcherOptions extends StudioBindings {
  readonly policy: CapabilityPolicy;
  readonly operations: readonly Operation[];
}

const MESSAGES: Record<ErrorCode, string> = {
  not_available_in_profile: "This deployment doesn't offer that operation.",
  method_not_allowed: "That operation doesn't accept this method.",
  authentication_required: 'Sign in to use that operation.',
  request_origin_rejected: "The request didn't come from this site.",
  capability_denied: "This session can't use that operation.",
  invalid_input: "The input doesn't match the operation.",
  version_conflict: 'The content changed since it was read.',
  internal_error: 'The operation failed. Quote the request ID when you report it.',
};

/** Largest command body step 5 reads. */
const MAX_BODY_BYTES = 1024 * 1024;

const INVALID = Symbol('invalid input');

export function createDispatcher(options: DispatcherOptions): Dispatch {
  const { policy, operations, handlers } = options;
  const byName = new Map(operations.map((operation) => [operation.name, operation]));

  return async function dispatch(request, name) {
    // proxy.ts sets a fresh one on every request, whatever the client sent.
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    const fail = (code: ErrorCode, headers?: Record<string, string>) =>
      reply(ERROR_STATUS[code], { error: { code, message: MESSAGES[code], requestId } }, headers);

    try {
      const operation = byName.get(name);
      if (!operation || policy.access(operation.capability) === 'absent') {
        return fail('not_available_in_profile');
      }
      const method = request.method === 'HEAD' ? 'GET' : request.method;
      const allowed = operation.kind === 'query' ? 'GET' : 'POST';
      if (method !== allowed) return fail('method_not_allowed', { allow: allowed });

      const session = await options.resolveSession(request);
      if (operation.session && !session) return fail('authentication_required');

      // Every command, and any query that asks for it.
      const checksOrigin = operation.kind === 'command' || operation.originCheck;
      if (checksOrigin && !(await options.checkOrigin(request))) {
        return fail('request_origin_rejected');
      }

      const authorized = authorize(policy, operation.capability, session);
      if (!authorized) return fail('capability_denied');

      const raw =
        operation.kind === 'query'
          ? Object.fromEntries(new URL(request.url).searchParams)
          : await readJson(request);
      const input = raw === INVALID ? undefined : operation.input.safeParse(raw);
      if (!input?.success) return fail('invalid_input');

      if (operation.expects && !(await options.checkVersion(operation, input.data))) {
        return fail('version_conflict');
      }

      const handler = handlers[operation.name];
      if (!handler) throw new Error(`No handler is bound for ${operation.name}.`);
      const output = operation.output.safeParse(
        await handler(authorized, input.data, { requestId }),
      );
      if (!output.success) throw new Error(`${operation.name} returned output outside its schema.`);
      return reply(200, { data: output.data });
    } catch {
      // The error itself stays out of the log: it can carry draft content.
      console.error(
        JSON.stringify({ level: 'error', event: 'operation.failed', operation: name, requestId }),
      );
      return fail('internal_error');
    }
  };
}

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

/** A command's JSON body: an empty body is `{}`, and anything else must be JSON under the size limit. */
async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return INVALID;
  if (!request.body) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return INVALID;
    }
    chunks.push(value);
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  if (text.trim() === '') return {};
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json(;|$)/i.test(type)) return INVALID;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return INVALID;
  }
}
