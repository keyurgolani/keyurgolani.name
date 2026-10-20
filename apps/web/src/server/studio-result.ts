import type { ErrorCode } from './operations';

// What a Studio handler, or the dispatcher's throttle binding, can answer
// with besides plain output: a status and headers with the data (login's
// Set-Cookie), a 303 for a form post, or an error the operation declares,
// with headers such as Retry-After. A handler that returns anything else
// returns its output, validated and sent as `{ "data": ... }` with 200.
// Headers can't replace content-type, cache-control, location, or
// content-length: the dispatcher sets those.

const RESULT: unique symbol = Symbol.for('keyurgolani.portfolio.studio-result');

export type StudioResult = { readonly [RESULT]: true; readonly headers?: HeadersInit } & (
  | { readonly kind: 'data'; readonly data: unknown; readonly status: 200 | 201 | 202 }
  | { readonly kind: 'redirect'; readonly location: string }
  | { readonly kind: 'error'; readonly code: ErrorCode }
);

export interface ResultOptions {
  readonly headers?: HeadersInit;
}

/** Output with a status and headers. Validated against the output schema like plain output. */
export function dataResult(
  data: unknown,
  options: ResultOptions & { readonly status?: 200 | 201 | 202 } = {},
): StudioResult {
  const status = options.status ?? 200;
  return Object.freeze({
    [RESULT]: true as const,
    kind: 'data' as const,
    data,
    status,
    headers: options.headers,
  });
}

/** A 303 to a path on this site, such as login's answer to a form post. */
export function redirectResult(location: string, options: ResultOptions = {}): StudioResult {
  return Object.freeze({
    [RESULT]: true as const,
    kind: 'redirect' as const,
    location,
    headers: options.headers,
  });
}

/** An error the operation declares in `errors`, such as `rate_limited` with Retry-After. */
export function errorResult(code: ErrorCode, options: ResultOptions = {}): StudioResult {
  return Object.freeze({
    [RESULT]: true as const,
    kind: 'error' as const,
    code,
    headers: options.headers,
  });
}

export function isStudioResult(value: unknown): value is StudioResult {
  return typeof value === 'object' && value !== null && RESULT in value;
}
