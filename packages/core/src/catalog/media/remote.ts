import { lookup as dnsLookup } from 'node:dns/promises';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { isHttpsMediaUrl } from '@portfolio/schema';
import { isAddressLiteral, isPublicAddress, literalAddress } from './address';
import { MEDIA_LIMITS, MediaSourceError, refused } from './limits';

// Remote media sources (#10, slice 2 item 3, SSRF): https only, images only.
// Every hop, the first request and each redirect, resolves its host, refuses
// it when any address it resolves to is loopback, private, link-local, or a
// metadata address (address.ts), and connects to the address it checked, so
// a second lookup can't swap one in (DNS rebinding). At most 3 redirects,
// each https too, and 15 s for the whole fetch. The body is read to 20 MiB at
// most, with no content coding. Whether it's an image, and which, the bytes
// alone decide, later (sniff.ts): this module never trusts Content-Type.
// Ingestion calls it at an owner draft save or import, and at read-only's
// startup; nothing fetches on a visitor request, and demo never fetches.

/** One address a host resolved to. */
export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

/** Resolves a host name to every address it has. */
export type Resolve = (hostname: string) => Promise<readonly ResolvedAddress[]>;

/** One response, as far as the fetch reads it. */
export interface RemoteResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
  /** Lets the response go unread, as after a redirect. */
  cancel(): void;
}

/** Sends one GET for `url`, connected to `address` and to nothing else. */
export type RemoteTransport = (request: {
  readonly url: URL;
  readonly address: string;
  readonly family: 4 | 6;
  readonly signal: AbortSignal;
}) => Promise<RemoteResponse>;

export interface RemoteFetcherOptions {
  readonly resolve?: Resolve;
  readonly transport?: RemoteTransport;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
  readonly maxBytes?: number;
}

/** Fetches an https image source's bytes, or throws a MediaSourceError that says why not. */
export type RemoteFetcher = (url: string) => Promise<Uint8Array>;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const systemResolve: Resolve = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/** A lookup that answers every name with the one address the fetch checked. */
export function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return ((_hostname: string, options: unknown, callback?: unknown) => {
    const done = (typeof options === 'function' ? options : callback) as (
      error: Error | null,
      address: string | readonly { address: string; family: number }[],
      family?: number,
    ) => void;
    if (typeof options === 'object' && options !== null && (options as { all?: boolean }).all) {
      done(null, [{ address, family }]);
    } else {
      done(null, address, family);
    }
  }) as LookupFunction;
}

/**
 * The transport outside tests: node:https, its own connection each time (no
 * shared agent, so no proxy from the environment), certificates checked
 * against the URL's host, and the connection pinned to the checked address.
 */
export const httpsTransport: RemoteTransport = ({ url, address, family, signal }) =>
  new Promise((resolve, reject) => {
    const host = literalAddress(url.hostname);
    const request = https.request(
      {
        protocol: 'https:',
        hostname: host,
        port: url.port === '' ? 443 : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        agent: false,
        lookup: pinnedLookup(address, family),
        ...(isAddressLiteral(host) ? {} : { servername: host }),
        headers: {
          accept: 'image/avif,image/webp,image/png,image/jpeg',
          'accept-encoding': 'identity',
          'user-agent': 'portfolio-media/1',
        },
        signal,
      },
      (response) =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          cancel: () => response.destroy(),
        }),
    );
    request.on('error', reject);
    request.end();
  });

/**
 * Names that are never a public host (RFC 6761, 6762, 8375, and ICANN's
 * reserved .internal): localhost and anything under it, .local, .test,
 * .example, .invalid, .internal, and .home.arpa. A fetch refuses them before
 * any lookup, so a test fixture's source makes no DNS query either.
 */
export function isSpecialUseName(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, '');
  return (
    name === 'localhost' ||
    /\.(?:localhost|local|test|example|invalid|internal|home\.arpa)$/.test(name) ||
    /^(?:local|test|example|invalid|internal)$/.test(name)
  );
}

const unreachable = (code: string, message: string) =>
  new MediaSourceError('unreachable', code, message);

/** The one header value, or undefined. */
function header(response: RemoteResponse, name: string): string | undefined {
  const value = response.headers[name];
  return Array.isArray(value) ? value[0] : (value as string | undefined);
}

/** `value` as an https URL a source may name, or a refusal. */
function httpsUrl(value: string, base?: URL): URL {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw refused('url_invalid', 'The source is not a URL.');
  }
  if (url.protocol !== 'https:')
    throw refused('scheme', 'A remote source is fetched only over https.');
  if (url.username !== '' || url.password !== '') {
    throw refused('credentials', 'A remote source carries no credentials.');
  }
  if (!isHttpsMediaUrl(url.href)) throw refused('url_invalid', 'The source is not an https URL.');
  return url;
}

export function remoteImageFetcher({
  resolve = systemResolve,
  transport = httpsTransport,
  timeoutMs = MEDIA_LIMITS.remoteTimeoutMs,
  maxRedirects = MEDIA_LIMITS.redirects,
  maxBytes = MEDIA_LIMITS.sourceBytes,
}: RemoteFetcherOptions = {}): RemoteFetcher {
  /** The address to connect to for `url`: checked, whether a literal or every address DNS gives. */
  async function addressOf(url: URL, signal: AbortSignal): Promise<ResolvedAddress> {
    const host = literalAddress(url.hostname);
    if (isAddressLiteral(host)) {
      if (!isPublicAddress(host)) {
        throw refused('address_blocked', 'The source is on an address a fetch never reaches.');
      }
      return { address: host, family: host.includes(':') ? 6 : 4 };
    }
    // A special-use name is never a public host, and isn't worth a lookup.
    if (isSpecialUseName(host)) {
      throw refused('host_reserved', 'The source is on a name no public host has.');
    }
    let found: readonly ResolvedAddress[];
    try {
      found = await Promise.race([
        resolve(host),
        new Promise<never>((_, reject) => {
          if (signal.aborted) reject(signal.reason);
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
      ]);
    } catch (error) {
      if (signal.aborted) throw unreachable('timeout', 'The fetch took longer than 15 s.');
      const code = (error as NodeJS.ErrnoException)?.code;
      throw code === 'ENOTFOUND' || code === 'ENODATA'
        ? new MediaSourceError('missing', 'host_not_found', "The source's host doesn't resolve.")
        : unreachable('dns_failed', "The source's host couldn't be resolved.");
    }
    if (found.length === 0) {
      throw new MediaSourceError('missing', 'host_not_found', "The source's host doesn't resolve.");
    }
    // One blocked address refuses the host: which one a client would get is the resolver's call.
    if (found.some(({ address }) => !isPublicAddress(address))) {
      throw refused('address_blocked', 'The source resolves to an address a fetch never reaches.');
    }
    return found[0]!;
  }

  async function body(response: RemoteResponse, signal: AbortSignal): Promise<Uint8Array> {
    const coding = header(response, 'content-encoding');
    if (coding !== undefined && coding.trim().toLowerCase() !== 'identity') {
      response.cancel();
      throw refused('content_encoding', 'The source came with a content coding.');
    }
    const length = header(response, 'content-length');
    if (length !== undefined && /^\d+$/.test(length.trim()) && Number(length) > maxBytes) {
      response.cancel();
      throw refused('too_large', 'The source is larger than 20 MiB.');
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      if (signal.aborted) break;
      total += chunk.byteLength;
      if (total > maxBytes) {
        response.cancel();
        throw refused('too_large', 'The source is larger than 20 MiB.');
      }
      chunks.push(chunk);
    }
    if (signal.aborted) throw unreachable('timeout', 'The fetch took longer than 15 s.');
    return new Uint8Array(Buffer.concat(chunks));
  }

  return async (source) => {
    const url = httpsUrl(source);
    // A timer of its own, which holds the process open the way a socket
    // does: AbortSignal.timeout's doesn't, so a fetch stuck on a lookup in
    // a process with nothing else to do would end it before the limit.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = controller.signal;
    try {
      return await fetchFrom(url, signal);
    } finally {
      clearTimeout(timer);
    }
  };

  async function fetchFrom(start: URL, signal: AbortSignal): Promise<Uint8Array> {
    let url = start;
    for (let hop = 0; ; hop++) {
      const { address, family } = await addressOf(url, signal);
      let response: RemoteResponse;
      try {
        response = await transport({ url, address, family: family === 6 ? 6 : 4, signal });
      } catch {
        if (signal.aborted) throw unreachable('timeout', 'The fetch took longer than 15 s.');
        throw unreachable('connect_failed', "The source's host couldn't be reached.");
      }
      try {
        if (REDIRECTS.has(response.status)) {
          response.cancel();
          const location = header(response, 'location');
          if (location === undefined)
            throw unreachable('redirect_invalid', 'A redirect named nowhere.');
          if (hop >= maxRedirects)
            throw refused('redirects', 'The source redirects more than 3 times.');
          url = httpsUrl(location, url);
          continue;
        }
        if (response.status === 404 || response.status === 410) {
          response.cancel();
          throw new MediaSourceError(
            'missing',
            'not_found',
            'The source answered that it is gone.',
          );
        }
        if (response.status !== 200) {
          response.cancel();
          throw unreachable('status', `The source answered ${response.status}.`);
        }
        return await body(response, signal);
      } catch (error) {
        if (error instanceof MediaSourceError) throw error;
        if (signal.aborted) throw unreachable('timeout', 'The fetch took longer than 15 s.');
        throw unreachable('read_failed', "The source's answer couldn't be read.");
      }
    }
  }
}
