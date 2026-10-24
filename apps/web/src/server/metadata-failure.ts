import 'server-only';
import { headers } from 'next/headers';
import { log } from './log';

// What a metadata route answers when it can't be built (#22), as the feed
// does: #1's fixed body with the request ID proxy.ts set, `no-store`, and a
// log line with a fixed code, never the cause, which can carry a path or a
// document's text. It reads the request ID alone, never a cookie.

/** The request's ID. Outside a request, as in a test, there is none to give. */
async function requestId(): Promise<string> {
  try {
    return (await headers()).get('x-request-id') ?? 'none';
  } catch {
    return 'none';
  }
}

/** The 500 for `route`, a route pattern, whose body names `what` failed. */
export async function metadataFailure(route: string, what: string): Promise<Response> {
  const id = await requestId();
  log({ level: 'error', event: 'metadata.failed', code: 'render_failed', route, requestId: id });
  return new Response(`${what} unavailable. Request ID: ${id}`, {
    status: 500,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
