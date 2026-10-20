import { authorize, type Authorized } from './authorize';
import { getDeploymentConfig, NOT_LOADED } from './config-store';
import { log } from './log';
import {
  ERRORS,
  MAX_BODY_BYTES,
  type BodyType,
  type ErrorCode,
  type Operation,
} from './operations';
import { capabilityPolicy } from './policy';
import { isMintedSession, type Session } from './session';
import { isStudioResult, type StudioResult } from './studio-result';
import type { Dispatch } from './studio-port';

// The one dispatcher behind /api/studio/[name] (#1, item 11). It runs its
// steps in order, each denying before the next, and reads the request body
// only at step 5:
//
//   1. unknown name, or capability absent in the profile: 404; wrong method: 405
//   2. resolveSession; a session required and none valid (#2): 401
//   3. commands, and any query that asks: checkOrigin, for origin, fetch
//      metadata, content type, and CSRF (#2): 403
//   4. authorize(capability, session): 403. Then touchSession may slide the
//      session, and throttle may answer instead, such as auth.login's 429 (#2)
//   5. input schema, on the search parameters or the JSON or form body: 400
//   6. expected draft version or live revision (#3): 409
//   7. handler, then output schema; anything unexpected: 500
//
// It decides with the policy of the deployment register() froze, read per
// request. Every response is `Cache-Control: no-store`. Errors are
// `{ "error": { "code", "message", "requestId" } }`, with the status and the
// message from ERRORS; a result is `{ "data" }`, or a 303. Headers that step
// 2 returns, such as a Set-Cookie that clears an ended session, go on every
// response after it.

/** What every binding gets: the request, its ID, and the registry entry it names. */
export interface OperationContext {
  readonly request: Request;
  readonly requestId: string;
  readonly operation: Operation;
}

/** The context once step 2 has resolved the session. */
export interface SessionContext extends OperationContext {
  readonly session: Session | null;
}

/** Where a handler's input came from: a query's search parameters, or a command's body. */
export type InputType = 'search' | BodyType;

export interface HandlerContext extends SessionContext {
  readonly inputType: InputType;
}

/** Step 2's answer. */
export interface SessionResolution {
  /** Only a session the provider minted counts; any other object is none. */
  readonly session: Session | null;
  /** For every response after step 2, such as a Set-Cookie that clears an ended session. */
  readonly headers?: HeadersInit;
}

/**
 * Runs one operation. It gets the authorize() token first, already checked,
 * and returns its output, or a StudioResult for a status, headers, a 303, or
 * an error the operation declares.
 */
export type Handler = (authorized: Authorized, input: unknown, context: HandlerContext) => unknown;

/** What the composition root binds for a profile. */
export interface StudioBindings {
  /** Handlers by operation name. */
  readonly handlers: Readonly<Record<string, Handler>>;
  /**
   * Step 2 (#2): the session the request carries. It runs before steps 3
   * and 4 pass, so it must not slide the session; touchSession does that.
   */
  readonly resolveSession: (context: OperationContext) => Promise<SessionResolution>;
  /**
   * Step 3 (#2): origin, fetch metadata, content type, and CSRF. It sees the
   * operation and the session, so auth.login can go without a CSRF token.
   */
  readonly checkOrigin: (context: SessionContext) => Promise<boolean>;
  /**
   * After step 4, for a request with a session (#2): slides its idle timer,
   * or not, by operation. A failure is logged, and the request goes on.
   */
  readonly touchSession: (context: SessionContext & { readonly session: Session }) => Promise<void>;
  /**
   * After step 4, before the body is read (#2): a result to answer with
   * instead, such as auth.login's `rate_limited` with Retry-After or a 303
   * for a form post, or null to go on.
   */
  readonly throttle: (context: SessionContext) => Promise<StudioResult | null>;
  /** Step 6 (#3): whether the version the input names is still current. */
  readonly checkVersion: (
    context: SessionContext & { readonly input: unknown },
  ) => Promise<boolean>;
}

/**
 * No handlers, no session, every origin and version refused, and nothing to
 * slide or throttle: read-only and demo, and the parts of owner that #2 and
 * #3 haven't supplied yet.
 */
export const NO_BINDINGS: StudioBindings = Object.freeze({
  handlers: Object.freeze({}),
  resolveSession: async () => ({ session: null }),
  checkOrigin: async () => false,
  touchSession: async () => {},
  throttle: async () => null,
  checkVersion: async () => false,
});

export interface DispatcherOptions extends StudioBindings {
  readonly operations: readonly Operation[];
}

type HeaderList = readonly (readonly [name: string, value: string])[];

/** Headers only the dispatcher sets. */
const RESERVED = new Set(['content-type', 'cache-control', 'location', 'content-length']);

const INVALID = Symbol('invalid input');

interface Input {
  readonly type: InputType;
  readonly value: unknown;
}

export function createDispatcher(options: DispatcherOptions): Dispatch {
  const { operations, handlers } = options;
  const byName = new Map(operations.map((operation) => [operation.name, operation]));

  return async function dispatch(request, name) {
    // proxy.ts sets a fresh one on every request, whatever the client sent.
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    // Step 2's headers, once it has run.
    let kept: HeaderList = [];
    const fail = (code: ErrorCode, extra: HeaderList = []) => {
      const { status, message } = ERRORS[code];
      return json(status, { error: { code, message, requestId } }, [...kept, ...extra]);
    };

    /** Output, checked against the entry's schema. */
    const data = (operation: Operation, value: unknown, status: number, extra: HeaderList) => {
      const output = operation.output.safeParse(value);
      if (!output.success) throw new Error(`${operation.name} returned output outside its schema.`);
      return json(status, { data: output.data }, [...kept, ...extra]);
    };
    /** The handler's or the throttle's answer, checked against the entry. */
    const respond = (operation: Operation, answer: unknown): Response => {
      if (!isStudioResult(answer)) return data(operation, answer, 200, []);
      const extra = headerList(answer.headers);
      if (answer.kind === 'data') {
        if (![200, 201, 202].includes(answer.status)) {
          throw new Error(`${operation.name} answered with status ${answer.status}.`);
        }
        return data(operation, answer.data, answer.status, extra);
      }
      if (answer.kind === 'redirect') {
        if (!isSitePath(answer.location)) {
          throw new Error(`${operation.name} redirected off the site.`);
        }
        return new Response(null, {
          status: 303,
          headers: headers({ location: answer.location }, [...kept, ...extra]),
        });
      }
      if (!Object.hasOwn(ERRORS, answer.code) || !operation.errors.includes(answer.code)) {
        throw new Error(`${operation.name} answered with an error it doesn't declare.`);
      }
      return fail(answer.code, extra);
    };

    try {
      const deployment = getDeploymentConfig();
      if (!deployment) throw new Error(NOT_LOADED);
      const policy = capabilityPolicy(deployment.profile);

      const operation = byName.get(name);
      if (!operation || policy.access(operation.capability) === 'absent') {
        return fail('not_available_in_profile');
      }
      const method = request.method === 'HEAD' ? 'GET' : request.method;
      const allowed = operation.kind === 'query' ? 'GET' : 'POST';
      if (method !== allowed) return fail('method_not_allowed', [['allow', allowed]]);

      const resolved = await options.resolveSession({ request, requestId, operation });
      kept = headerList(resolved.headers);
      const session = isMintedSession(resolved.session) ? resolved.session : null;
      if (operation.session && !session) return fail('authentication_required');
      const context: SessionContext = { request, requestId, operation, session };

      // Every command, and any query that asks for it.
      const checksOrigin = operation.kind === 'command' || operation.originCheck;
      if (checksOrigin && !(await options.checkOrigin(context))) {
        return fail('request_origin_rejected');
      }

      const authorized = authorize(operation.capability, session);
      if (!authorized) return fail('capability_denied');
      if (session) await touch(options, { ...context, session });
      const throttled = await options.throttle(context);
      if (throttled) {
        if (throttled.kind === 'data') {
          throw new Error('A throttle answers with an error or a 303.');
        }
        return respond(operation, throttled);
      }

      const read: Input | typeof INVALID =
        operation.kind === 'query' ? searchInput(request) : await bodyInput(request, operation);
      const input = read === INVALID ? undefined : operation.input.safeParse(read.value);
      if (read === INVALID || !input?.success) return fail('invalid_input');

      if (operation.expects && !(await options.checkVersion({ ...context, input: input.data }))) {
        return fail('version_conflict');
      }

      const handler = handlers[operation.name];
      if (!handler) throw new Error(`No handler is bound for ${operation.name}.`);
      const answer = await handler(authorized, input.data, { ...context, inputType: read.type });
      return respond(operation, answer);
    } catch {
      // The error itself stays out of the log: it can carry draft content.
      // So does a name no entry has, which is only part of a URL.
      log({
        level: 'error',
        event: 'operation.failed',
        profile: getDeploymentConfig()?.profile,
        operation: byName.has(name) ? name : undefined,
        requestId,
      });
      return fail('internal_error');
    }
  };
}

async function touch(
  bindings: StudioBindings,
  context: SessionContext & { readonly session: Session },
): Promise<void> {
  try {
    await bindings.touchSession(context);
  } catch {
    // #2: a failed lastSeenAt write serves the request. The error stays out
    // of the log, as a handler's does.
    log({
      level: 'warn',
      event: 'session.touch_failed',
      operation: context.operation.name,
      requestId: context.requestId,
    });
  }
}

function json(status: number, body: unknown, extra: HeaderList): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers({ 'content-type': 'application/json; charset=utf-8' }, extra),
  });
}

/** The dispatcher's own headers, then the bindings' and the result's: each Set-Cookie added, others set. */
function headers(own: Record<string, string>, extra: HeaderList): Headers {
  const result = new Headers({ ...own, 'cache-control': 'no-store' });
  for (const [name, value] of extra) {
    if (name === 'set-cookie') result.append(name, value);
    else result.set(name, value);
  }
  return result;
}

/** A binding's or a result's headers. Throws on one the dispatcher sets itself. */
function headerList(init: HeadersInit | undefined): HeaderList {
  if (init === undefined) return [];
  const list = [...new Headers(init)];
  for (const [name] of list) {
    if (RESERVED.has(name)) throw new Error(`The dispatcher sets ${name} itself.`);
  }
  return list;
}

/** A path on this site: one leading slash, no scheme or host, no backslash, space, or control character. */
function isSitePath(location: string): boolean {
  if (!location.startsWith('/') || location.startsWith('//')) return false;
  if (/[\\\s\p{Cc}]/u.test(location)) return false;
  const base = 'https://site.invalid';
  try {
    return new URL(location, base).origin === base;
  } catch {
    return false;
  }
}

/** A query's input: its search parameters. */
function searchInput(request: Request): Input | typeof INVALID {
  const value = record(new URL(request.url).searchParams);
  return value === INVALID ? INVALID : { type: 'search', value };
}

/**
 * A command's input. An empty body is `{}`. Any other body needs a content
 * type the entry accepts (JSON unless it says otherwise) and stays under its
 * cap. A body of a type the entry doesn't accept is never read.
 */
async function bodyInput(request: Request, operation: Operation): Promise<Input | typeof INVALID> {
  const accepts: readonly BodyType[] = operation.bodyTypes ?? ['json'];
  const declared = request.headers.get('content-type');
  const type = declared === null ? null : bodyType(declared);
  if (declared !== null && (type === null || !accepts.includes(type))) return INVALID;
  const text = await readText(request, operation.maxBodyBytes ?? MAX_BODY_BYTES);
  if (text === INVALID) return INVALID;
  if (text.trim() === '') return { type: type ?? accepts[0] ?? 'json', value: {} };
  if (type === null) return INVALID;
  if (type === 'form') {
    const value = record(new URLSearchParams(text));
    return value === INVALID ? INVALID : { type, value };
  }
  try {
    return { type, value: JSON.parse(text) as unknown };
  } catch {
    return INVALID;
  }
}

function bodyType(contentType: string): BodyType | null {
  const essence = contentType.split(';')[0]!.trim().toLowerCase();
  if (essence === 'application/json') return 'json';
  if (essence === 'application/x-www-form-urlencoded') return 'form';
  return null;
}

/** Search or form parameters as a record. A name given twice is invalid, never last-wins. */
function record(params: URLSearchParams): Record<string, string> | typeof INVALID {
  const entries = [...params];
  const names = new Set(entries.map(([name]) => name));
  return names.size === entries.length ? Object.fromEntries(entries) : INVALID;
}

/** The body as UTF-8 text, or INVALID past `limit` bytes or on malformed UTF-8. */
async function readText(request: Request, limit: number): Promise<string | typeof INVALID> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) return INVALID;
  if (!request.body) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return INVALID;
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    return INVALID;
  }
}
