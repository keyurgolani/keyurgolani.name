import 'server-only';
import { z } from 'zod';
import {
  APPEARANCE_AXES,
  QUERY_KEYS,
  parseSelection,
  serializeSelection,
  type SelectionValues,
} from '@portfolio/appearance';
import { APPEARANCE_COOKIE } from '~/lib/document-appearance';

// POST /api/appearance (#19, Slice 4): the visitor's appearance preference,
// which the document boundary reads back from the portfolio_appearance
// cookie under owner and read-only. Demo has none: its appearance is the
// query's. The route reads no session and sets nothing but this cookie.
//
// What it takes, from VisitorAppearance's form or its JSON save:
// - the selectable axes' values under the query keys parseSelection()
//   reads, each a well-formed id or display mode, or a reset, which clears
//   the cookie;
// - with a form, `return`, the page to go back to, which must resolve
//   against the canonical origin to that origin, with no backslash or
//   control character in it;
// - at most MAX_BODY_BYTES, as JSON or a form, from an Origin exactly the
//   canonical origin, and, when the browser says, Sec-Fetch-Site:
//   same-origin.
//
// The cookie holds the ids alone, as serializeSelection() writes them:
// Path=/, no Domain, SameSite=Lax, HttpOnly, and Secure on an https origin.
// Whether this build registers an id is the resolver's to say when a page
// renders: one it doesn't falls back on its axis, with a diagnostic for the
// owner, as a published one does. The variant isn't kept: the host renders
// the page's composition, so a visitor's variant waits on the experience
// segment following the cookie (the backlog's).
//
// A form gets a 303 to its page and the JSON save a 204, each no-store.
// Anything else is refused with nothing set: 403 for the origin, 413 past
// the cap, 415 for another body type, and 400 for a body the schema doesn't
// take.

/** Room for every axis's value and a long return path, and far less than anything that's neither. */
export const MAX_BODY_BYTES = 4096;

/** How long the preference lasts: 180 days. */
export const PREFERENCE_MAX_AGE = 180 * 24 * 60 * 60;

/** The longest return path a form may name. */
const MAX_RETURN = 2048;

const KEYS = APPEARANCE_AXES.map((axis) => QUERY_KEYS[axis]);
const value = z.string().min(1).max(64);
const selectionShape = Object.fromEntries(KEYS.map((key) => [key, value.optional()])) as Record<
  string,
  z.ZodOptional<z.ZodString>
>;

/** The JSON save's body: values, or a reset. */
const JsonBody = z.union([
  z.object({ reset: z.literal(true) }).strict(),
  z.object(selectionShape).strict(),
]);

/** The form's fields: values, `return`, and the reset button's `reset=1`. */
const FormBody = z
  .object({
    ...selectionShape,
    return: z.string().max(MAX_RETURN).optional(),
    reset: z.literal('1').optional(),
  })
  .strict();

export interface PreferenceOptions {
  /** The canonical origin, never one read from the request. */
  readonly origin: string;
}

export async function appearancePreference(
  request: Request,
  { origin }: PreferenceOptions,
): Promise<Response> {
  if (!fromOrigin(request, origin)) return refused(403, 'Forbidden.');
  const type = bodyType(request.headers.get('content-type'));
  if (type === null) return refused(415, 'Unsupported media type.');
  const text = await readText(request);
  if (text === TOO_LARGE) return refused(413, 'Payload too large.');
  if (text === null) return refused(400, 'Bad request.');
  const body = type === 'json' ? jsonBody(text) : formBody(text);
  if (body === null) return refused(400, 'Bad request.');
  let location: string | null = null;
  if (type === 'form') {
    location = body.returnTo === undefined ? '/' : sitePath(body.returnTo, origin);
    if (location === null) return refused(400, 'Bad request.');
  }
  const cookie = body.reset
    ? preferenceCookie('', origin, 0)
    : preferenceCookie(serializeSelection(body.values), origin, PREFERENCE_MAX_AGE);
  const headers = new Headers({ 'cache-control': 'no-store', 'set-cookie': cookie });
  if (location === null) return new Response(null, { status: 204, headers });
  headers.set('location', location);
  return new Response(null, { status: 303, headers });
}

/** An Origin exactly the canonical origin, and a same-origin fetch whenever the browser says. */
function fromOrigin(request: Request, origin: string): boolean {
  if (request.headers.get('origin') !== origin) return false;
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin';
}

function bodyType(contentType: string | null): 'json' | 'form' | null {
  const essence = contentType?.split(';')[0]?.trim().toLowerCase();
  if (essence === 'application/json') return 'json';
  if (essence === 'application/x-www-form-urlencoded') return 'form';
  return null;
}

const TOO_LARGE = Symbol('too large');

/** The body as UTF-8 text, TOO_LARGE past the cap, or null when it isn't UTF-8. */
async function readText(request: Request): Promise<string | null | typeof TOO_LARGE> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return TOO_LARGE;
  if (!request.body) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return TOO_LARGE;
    }
    chunks.push(chunk);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    return null;
  }
}

interface Preference {
  readonly reset: boolean;
  readonly values: SelectionValues;
  readonly returnTo?: string;
}

function jsonBody(text: string): Preference | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = JsonBody.safeParse(parsed);
  if (!result.success) return null;
  if ('reset' in result.data) return { reset: true, values: {} };
  return selection(result.data as Record<string, string | undefined>);
}

function formBody(text: string): Preference | null {
  const params = new URLSearchParams(text);
  const entries = [...params];
  // A name given twice is invalid, never last-wins.
  if (new Set(entries.map(([name]) => name)).size !== entries.length) return null;
  const result = FormBody.safeParse(Object.fromEntries(entries));
  if (!result.success) return null;
  const { return: returnTo, reset, ...given } = result.data;
  const returned = returnTo === undefined ? {} : { returnTo };
  if (reset !== undefined) return { reset: true, values: {}, ...returned };
  const chosen = selection(given as Record<string, string | undefined>);
  return chosen && { ...chosen, ...returned };
}

/** The values given, every one well formed for its axis, or null; the variant left out. */
function selection(given: Record<string, string | undefined>): Preference | null {
  const named = Object.fromEntries(
    Object.entries(given).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const values = parseSelection(named);
  if (Object.keys(values).length !== Object.keys(named).length) return null;
  if (Object.keys(values).length === 0) return null;
  const kept: SelectionValues = Object.fromEntries(
    Object.entries(values).filter(([axis]) => axis !== 'variant'),
  );
  return { reset: false, values: kept };
}

/**
 * The path, query, and fragment `returnTo` names on the canonical origin,
 * or null for anything that isn't a path there: another origin, a
 * protocol-relative or scheme URL, or a backslash, space, or control
 * character anywhere in it.
 */
export function sitePath(returnTo: string, origin: string): string | null {
  if (!returnTo.startsWith('/') || returnTo.startsWith('//')) return null;
  if (/[\\\s\p{Cc}]/u.test(returnTo)) return null;
  let url: URL;
  try {
    url = new URL(returnTo, origin);
  } catch {
    return null;
  }
  return url.origin === new URL(origin).origin ? `${url.pathname}${url.search}${url.hash}` : null;
}

/** The Set-Cookie value: the ids, for `maxAge` seconds, 0 clearing it. */
export function preferenceCookie(value: string, origin: string, maxAge: number): string {
  const secure = new URL(origin).protocol === 'https:' ? '; Secure' : '';
  return `${APPEARANCE_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function refused(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
