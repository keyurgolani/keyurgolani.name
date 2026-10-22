import {
  envelope,
  FRAME_HANDSHAKE,
  isRoute,
  LIMITS,
  LOCAL_ONLY,
  readMessage,
  reportDrop,
  SCROLLED_PER_SECOND,
  sizeOf,
  TO_FRAME,
  TO_STUDIO,
  TOKEN,
  type DropReason,
  type ToFramePayload,
  type ToStudioPayload,
  type ToStudioType,
} from './protocol';

// The frame's half of the preview channel (#7, Slice 3), which the preview
// agent runs: the handshake, the port, the link guard, scrolling, and the
// lifecycle state, with no DOM, CSS, or UI of its own. It does nothing when
// the document isn't in a frame, so the dev fixture route still renders top
// level. It reads its settings from what the server rendered, and in local
// mode the nonce from the fragment Studio set, never from the query.
//
// In server mode every move is a document load under the grant: an internal
// link and Studio's `navigate` both load the frame, with `navigated` first,
// and the new document says hello again. Fragments scroll in place. Every
// other link is cancelled and sent to Studio as `link`: other sites,
// mailto: and tel:, downloads, and the site's own pages outside the grant.

export interface FrameChannelOptions {
  readonly mode: 'server' | 'local';
  /** Studio's origin: the only one `hello` goes to, and the only one `connect` comes from. */
  readonly studioOrigin: string;
  /** Where the frame's internal links start: /preview/<grant> in server mode. */
  readonly linkBase: string;
  /** The grant's channel nonce, which the server renders. A local frame reads its own from the fragment. */
  readonly nonce?: string;
  /** What `ready` says the frame renders: a draft grant's pinned version, or null. */
  readonly renderedVersion: number | null;
}

/** The event #6's runtime listens for on window to pause and resume: its detail is the lifecycle. */
export const LIFECYCLE_EVENT = 'kgn-preview-lifecycle';
/** Where window holds the last lifecycle Studio sent, for a runtime that starts after it. */
export const LIFECYCLE_STATE = Symbol.for('kgn-preview.lifecycle');

/** A state the frame reports instead of `ready`. */
export type FrameStatus = ToStudioPayload<'status'>;

let reported: FrameStatus | null = null;
const statusListeners = new Set<(status: FrameStatus) => void>();

/**
 * Reports a state the frame's page is in, such as a render failure with
 * the reference the server log carries, which the channel sends Studio in
 * place of `ready`. A preview route's error or not-found boundary calls it.
 */
export function reportFrameStatus(status: FrameStatus): void {
  reported = status;
  for (const listener of statusListeners) listener(status);
}

/** A random token in TOKEN's format: 128 bits in base64url. */
function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The id this document says hello with, made once as it loads, however often the agent starts. */
const INSTANCE = randomToken();

/** The nonce a local frame's fragment holds, `#nonce=<token>`, or null. */
export function nonceFromFragment(hash: string): string | null {
  const nonce = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).getAll('nonce');
  return nonce.length === 1 && TOKEN.test(nonce[0]!) ? nonce[0]! : null;
}

/** What a click on a link does in a frame. */
export type LinkKind =
  'fragment' | 'internal' | 'external' | 'live' | 'mailto' | 'tel' | 'download' | 'unsupported';

/** Whether `pathname` is the link base or below it. */
const under = (pathname: string, linkBase: string) =>
  pathname === linkBase || pathname.startsWith(`${linkBase}/`);

/**
 * What a link to `url` is in a frame at `here`: a fragment of the page it's
 * on, an internal path under `linkBase`, or one the frame never follows:
 * another site, mailto: or tel:, a download, or the site's own pages
 * outside the grant (`live`, on the frame's origin or Studio's). Any other
 * scheme is unsupported, and goes nowhere.
 */
export function classifyLink(
  url: URL,
  context: {
    readonly here: URL;
    readonly linkBase: string;
    readonly studioOrigin: string;
    readonly download?: boolean;
  },
): LinkKind {
  if (url.protocol === 'mailto:') return 'mailto';
  if (url.protocol === 'tel:') return 'tel';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'unsupported';
  if (context.download) return 'download';
  const { here } = context;
  if (url.origin === here.origin && under(url.pathname, context.linkBase)) {
    return url.hash !== '' && url.pathname === here.pathname && url.search === here.search
      ? 'fragment'
      : 'internal';
  }
  return url.origin === here.origin || url.origin === context.studioOrigin ? 'live' : 'external';
}

/** The route below `linkBase` that `pathname` names, or `/` when it names none the protocol takes. */
export function routeOf(pathname: string, linkBase: string): string {
  if (!under(pathname, linkBase)) return '/';
  const rest = pathname.slice(linkBase.length) || '/';
  return isRoute(rest) ? rest : '/';
}

const XLINK = 'http://www.w3.org/1999/xlink';

/** The link a click went to, from the innermost element out, through shadow roots too. */
function linkOf(event: Event): { readonly href: string; readonly download: boolean } | null {
  for (const node of event.composedPath()) {
    const element = node as Partial<Element>;
    if (element.localName !== 'a' && element.localName !== 'area') continue;
    const href = element.getAttribute?.('href') ?? element.getAttributeNS?.(XLINK, 'href');
    if (href === null || href === undefined) continue;
    return { href, download: element.hasAttribute?.('download') ?? false };
  }
  return null;
}

/** The element of the section `anchor` names, found by its data-section-id. */
function sectionOf(document: Document, anchor: string): Element | null {
  for (const element of document.querySelectorAll('[data-section-id]')) {
    if (element.getAttribute('data-section-id') === anchor) return element;
  }
  return null;
}

/**
 * Starts the frame's channel in `win`, with the settings the server
 * rendered. Returns what stops it, or null when the document isn't framed.
 */
export function startFrameChannel(win: Window, options: FrameChannelOptions): (() => void) | null {
  if (win.parent === win) return null;
  const { mode, studioOrigin, linkBase } = options;
  const nonce = mode === 'server' ? (options.nonce ?? null) : nonceFromFragment(win.location.hash);
  if (mode === 'local' && win.location.hash !== '') {
    // The nonce leaves the URL once read, so nothing reads it later.
    try {
      win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search);
    } catch {
      // A frame that can't rewrite its URL keeps it.
    }
  }
  const now = () => win.performance.now();
  let seq = 0;
  let port: MessagePort | null = null;
  let helloSent = false;
  let stopped = false;
  /** What `document` and `asset` messages brought, all told. */
  let received = 0;
  let scrollSync = false;
  let scrolledAt = Number.NEGATIVE_INFINITY;
  let suppressUntil = Number.NEGATIVE_INFINITY;
  let trailing: ReturnType<typeof setTimeout> | undefined;

  const drop = (reason: DropReason, type?: string) =>
    reportDrop({ side: 'frame', reason, ...(type === undefined ? {} : { type }) });

  /** Sends Studio a message over the port, if one is open and the protocol takes it. */
  const send = <K extends ToStudioType>(type: K, payload: ToStudioPayload<K>): boolean => {
    if (!port) return false;
    const message = envelope(type, payload, seq + 1);
    if (!readMessage(message, TO_STUDIO).ok) return false;
    seq += 1;
    port.postMessage(message);
    return true;
  };

  const announce = () => {
    if (reported) send('status', reported);
    else {
      send('ready', {
        renderedVersion: options.renderedVersion,
        route: routeOf(win.location.pathname, linkBase),
      });
    }
  };
  const onStatus = (status: FrameStatus) => send('status', status);

  /** Loads `url`, a path under the link base, after telling Studio where to. */
  const load = (url: URL) => {
    send('navigated', { route: routeOf(url.pathname, linkBase) });
    win.location.assign(url.href);
  };

  const scrollTo = ({ anchor, progress }: ToFramePayload<'scroll-to'>) => {
    const target = sectionOf(win.document, anchor);
    if (!target) return;
    const box = target.getBoundingClientRect();
    // The scroll this causes isn't the reader's, so it isn't sent back.
    suppressUntil = now() + 250;
    win.scrollTo({ top: win.scrollY + box.top + progress * box.height, behavior: 'instant' });
    const { x, y, width, height } = target.getBoundingClientRect();
    send('rect', { anchor, rect: { x, y, width, height } });
  };

  /** The section at the top of the viewport, and how far through it the reader is. */
  const position = (): ToStudioPayload<'scrolled'> | null => {
    let found: { readonly anchor: string; readonly top: number; readonly height: number } | null =
      null;
    for (const element of win.document.querySelectorAll('[data-section-id]')) {
      const { top, height } = element.getBoundingClientRect();
      const anchor = element.getAttribute('data-section-id') ?? '';
      if (found && top > 0) break;
      found = { anchor, top, height };
    }
    if (!found) return null;
    const progress = found.height > 0 ? Math.min(1, Math.max(0, -found.top / found.height)) : 0;
    return { anchor: found.anchor, progress };
  };

  const reportScroll = () => {
    const where = position();
    if (!where) return;
    scrolledAt = now();
    send('scrolled', where);
  };

  const onScroll = () => {
    if (!scrollSync || now() < suppressUntil) return;
    const wait = scrolledAt + 1000 / SCROLLED_PER_SECOND - now();
    if (wait <= 0) return reportScroll();
    trailing ??= setTimeout(() => {
      trailing = undefined;
      if (scrollSync && now() >= suppressUntil) reportScroll();
    }, wait);
  };

  const lifecycle = (state: ToFramePayload<'lifecycle'>) => {
    const detail = Object.freeze({ ...state });
    (win as unknown as Record<symbol, unknown>)[LIFECYCLE_STATE] = detail;
    win.dispatchEvent(new CustomEvent(LIFECYCLE_EVENT, { detail }));
  };

  /** Counts `bytes` against the frame's total, or says they'd pass it. */
  const take = (bytes: number) => {
    if (bytes < 0 || received + bytes > LIMITS.frame) return false;
    received += bytes;
    return true;
  };

  const fromPort = (data: unknown) => {
    const read = readMessage(data, TO_FRAME);
    if (!read.ok) return drop(read.reason, read.type);
    const { message } = read;
    if (LOCAL_ONLY.has(message.type) && mode !== 'local') return drop('type', message.type);
    switch (message.type) {
      case 'environment':
        // Slice 4 applies it to the presentation boundary.
        return;
      case 'scroll-to':
        return scrollTo(message.payload);
      case 'navigate': {
        const { route } = message.payload;
        const url = new URL(route === '/' ? linkBase : `${linkBase}${route}`, win.location.href);
        if (url.origin !== win.location.origin || !under(url.pathname, linkBase)) {
          return drop('payload', 'navigate');
        }
        return load(url);
      }
      case 'lifecycle':
        return lifecycle(message.payload);
      case 'sync':
        scrollSync = message.payload.scroll;
        return;
      case 'document':
        // Slice 6 renders it.
        if (!take(sizeOf(message.payload, LIMITS.document))) return drop('size', 'document');
        return;
      case 'asset':
        if (!take(message.payload.blob.size)) return drop('size', 'asset');
        return;
    }
  };

  const fromWindow = (event: MessageEvent) => {
    if (event.source !== win.parent) return drop('source');
    if (event.origin !== studioOrigin) return drop('origin');
    const read = readMessage(event.data, FRAME_HANDSHAKE);
    if (!read.ok) return drop(read.reason, read.type);
    const [transferred, ...extra] = event.ports;
    if (!transferred || extra.length > 0) return drop('payload', 'connect');
    if (!helloSent) return drop('state', 'connect');
    if (port) {
      port.onmessage = null;
      port.close();
    }
    port = transferred;
    port.onmessage = (portEvent: MessageEvent) => fromPort(portEvent.data);
    announce();
  };

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const link = linkOf(event);
    if (!link) return;
    let url: URL;
    try {
      url = new URL(link.href, win.document.baseURI);
    } catch {
      return;
    }
    const kind = classifyLink(url, {
      here: new URL(win.location.href),
      linkBase,
      studioOrigin,
      download: link.download,
    });
    if (kind === 'fragment') return;
    event.preventDefault();
    if (kind === 'internal') return load(url);
    if (kind !== 'unsupported') send('link', { href: url.href, kind });
  };

  const hello = () => {
    if (stopped || nonce === null || !TOKEN.test(nonce)) return;
    helloSent = true;
    try {
      win.parent.postMessage(envelope('hello', { nonce, instance: INSTANCE }, ++seq), studioOrigin);
    } catch {
      // A Studio origin that isn't one gets no hello.
    }
  };
  const helloAfterLoad = () => setTimeout(hello, 0);

  win.addEventListener('message', fromWindow);
  win.addEventListener('click', onClick, true);
  win.addEventListener('scroll', onScroll, { passive: true });
  statusListeners.add(onStatus);
  // After the document's own load, so the frame's load event in Studio's
  // window comes first nearly always; the channel copes either way.
  if (win.document.readyState === 'complete') helloAfterLoad();
  else win.addEventListener('load', helloAfterLoad, { once: true });

  return () => {
    stopped = true;
    if (trailing !== undefined) clearTimeout(trailing);
    win.removeEventListener('message', fromWindow);
    win.removeEventListener('click', onClick, true);
    win.removeEventListener('scroll', onScroll);
    win.removeEventListener('load', helloAfterLoad);
    statusListeners.delete(onStatus);
    if (port) {
      port.onmessage = null;
      port.close();
      port = null;
    }
  };
}
