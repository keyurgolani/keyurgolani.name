import {
  envelope,
  FRAME_HANDSHAKE,
  isRoute,
  LIMITS,
  LOCAL_ONLY,
  PACK_STYLESHEET,
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
import {
  DEFAULT_SELECTION,
  ENVIRONMENT_ATTRIBUTES,
  environmentAttributes,
  type EnvironmentSelection,
} from '../lib/environment';

// The frame's half of the preview channel (#7, Slice 3), which the preview
// agent runs: the handshake, the port, the link guard, scrolling, the
// lifecycle state, and the environment Studio's controls set on the
// presentation boundary (Slice 4), and an appearance Studio's controls show in
// place (showAppearance, below), with no UI of its own. It does nothing when
// the document isn't in a frame, so the dev fixture route still renders top
// level. It reads its settings from what the server rendered, and in local
// mode the nonce from the fragment Studio set, never from the query.
//
// In server mode every move is a document load under the grant: an internal
// link and Studio's `navigate` both load the frame, with `navigated` first,
// and the new document says hello again. Fragments scroll in place. Every
// other link is cancelled and sent to Studio as `link`: other sites,
// mailto: and tel:, downloads, and the site's own pages outside the grant.
// The guard reads clicks and middle clicks on window, in the capture phase,
// so no listener on the document or below can keep a link from it. Where
// the frame's document has the Navigation API, which an opaque origin
// doesn't, its `navigate` event backs the guard up for what a click doesn't
// show: a link in a closed shadow root, a script's own navigation, a
// reload, and a history change.
//
// In sample mode (DEM-2) the agent runs in Demo Studio's /sample or
// /reference frame, a public page, and does one thing: it shows an
// appearance in place. It takes `connect` as the other modes do, from its
// parent window and Studio's origin alone, and over the port only
// `appearance`, and only one whose every pack is one the server rendered as
// this build's own, with that stylesheet. It sends no scroll and guards no
// link but the page's own: a plain click on a link to another of its pages
// loads that page with the appearance it shows, its query's own keys for the
// three packs and the display mode set to them, so the visitor lands on the
// look they picked, and with the nonce in its fragment, so the next document
// says hello too. Every other link goes where it went before the agent.

/**
 * The packs this build registers on each axis an `appearance` swaps, by id,
 * each with its build stylesheet: what a sample frame's server rendered, and
 * the only packs it shows.
 */
export type RegisteredPacks = Readonly<
  Record<(typeof SWAPPED_AXES)[number][0], Readonly<Record<string, string>>>
>;

/**
 * The query keys a sample page's links carry its appearance under, by axis:
 * #19's, which the server renders the links with.
 */
export type SampleQueryKeys = Readonly<
  Record<(typeof SWAPPED_AXES)[number][0] | 'displayMode', string>
>;

/** A query key, as #19 spells one. */
const QUERY_KEY = /^[a-z]{1,32}$/;

/**
 * Where a plain click on a link to `url`, another page of the sample, goes:
 * `url` with each of `keys` its query already holds set to `shown`'s value on
 * that axis, never a key it doesn't hold, so the query stays the canonical
 * one the server rendered, and with `nonce` as its fragment when it has none.
 */
export function sampleDestination(
  url: URL,
  shown: ToFramePayload<'appearance'> | null,
  keys: SampleQueryKeys | undefined,
  nonce: string | null,
): string {
  const next = new URL(url.href);
  if (shown && keys) {
    const values = {
      designLanguage: shown.designLanguage.id,
      colorScheme: shown.colorScheme.id,
      typography: shown.typography.id,
      displayMode: shown.displayMode,
    };
    for (const [axis, value] of Object.entries(values)) {
      const key = keys[axis as keyof SampleQueryKeys];
      if (typeof key === 'string' && QUERY_KEY.test(key) && next.searchParams.has(key)) {
        next.searchParams.set(key, value);
      }
    }
  }
  if (nonce !== null && TOKEN.test(nonce) && next.hash === '') next.hash = `nonce=${nonce}`;
  return next.href;
}

/** The only message a sample frame takes over its port. */
const SAMPLE_TAKES: ReadonlySet<string> = new Set(['appearance']);

/**
 * Whether every pack `appearance` names is one `registered` lists, with the
 * same stylesheet. An own property alone counts, so no id such as
 * `constructor` reads through to an object's prototype.
 */
export function registeredAppearance(
  appearance: ToFramePayload<'appearance'>,
  registered: RegisteredPacks | undefined,
): boolean {
  if (!registered) return false;
  return SWAPPED_AXES.every(([axis]) => {
    const packs = registered[axis];
    const { id, stylesheet } = appearance[axis];
    return (
      typeof packs === 'object' &&
      packs !== null &&
      Object.hasOwn(packs, id) &&
      packs[id] === stylesheet
    );
  });
}

export interface FrameChannelOptions {
  /**
   * A grant's frame, a local frame (#9), or Demo Studio's /sample or
   * /reference frame, which shows an appearance in place and nothing else (DEM-2).
   */
  readonly mode: 'server' | 'local' | 'sample';
  /** Studio's origin: the only one `hello` goes to, and the only one `connect` comes from. */
  readonly studioOrigin: string;
  /** Where the frame's internal links start: /preview/<grant> in server mode. */
  readonly linkBase: string;
  /** The grant's channel nonce, which the server renders. A local frame reads its own from the fragment. */
  readonly nonce?: string;
  /** What `ready` says the frame renders: a draft grant's pinned version, or null. */
  readonly renderedVersion: number | null;
  /**
   * What the frame's site publishes, which Studio's `environment` sets the
   * boundary against (Slice 4). Without one, the system's own display mode
   * and motion.
   */
  readonly selection?: EnvironmentSelection;
  /** In local mode (Slice 6), what renders a `document` Studio sends: Demo Studio's local frame (#9). */
  readonly onDocument?: (document: ToFramePayload<'document'>) => void;
  /**
   * In local mode, where the frame goes: an internal link or Studio's
   * `navigate` keeps the route in memory and hands it here, with no
   * document load, and the frame says `navigated`.
   */
  readonly onRoute?: (route: string) => void;
  /** In sample mode, the packs the frame may show: an appearance with any other does nothing. */
  readonly registered?: RegisteredPacks;
  /** In sample mode, the query keys the page's links carry the appearance under. */
  readonly queryKeys?: SampleQueryKeys;
}

/**
 * When the agent says hello again, in milliseconds after its first, whether
 * or not a connect came. Studio closes its port on every load of the frame,
 * so a connect that answered a hello before Studio saw this document's load
 * is closed by it, and only a later hello opens another. Studio takes a
 * hello from the document holding its open port as one it already answered.
 */
export const HELLO_AGAIN_MS: readonly number[] = Object.freeze([250, 750, 1750, 3750]);

/**
 * The frame agent's marker (#7, Slice 3): a string only the agent's own code
 * carries, which the chunk specs look for to tell where the agent loads. The
 * agent sets it on its window as it starts (startFrameChannel), so no build
 * can drop it. Never use a string the protocol shares with Studio's half of
 * the channel, such as its name 'kgn-preview' or a message type, as the
 * marker: Studio loads those wherever it has a stage.
 */
export const FRAME_AGENT_MARKER = 'kgn-frame-agent/1';

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

const routeListeners = new Set<(route: string) => void>();

/**
 * Reports a route a local frame moved to on its own, such as a redirect its
 * renderer followed, which the channel keeps as the route it shows and sends
 * Studio as `navigated`. A server frame's moves are document loads, so it
 * takes none.
 */
export function reportLocalRoute(route: string): void {
  for (const listener of routeListeners) listener(route);
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

/**
 * The link a click went to, from the innermost element out, through open
 * shadow roots too: an HTML or SVG `<a>`, by `href` or SVG's `xlink:href`,
 * or an image map's `<area>`. A closed shadow root hides its nodes from the
 * path, so the `navigate` backstop is what sees a link in one.
 */
function linkOf(
  event: Event,
): { readonly href: string; readonly download: boolean; readonly target: string } | null {
  for (const node of event.composedPath()) {
    const element = node as Partial<Element>;
    if (element.localName !== 'a' && element.localName !== 'area') continue;
    const href = element.getAttribute?.('href') ?? element.getAttributeNS?.(XLINK, 'href');
    if (href === null || href === undefined) continue;
    return {
      href,
      download: element.hasAttribute?.('download') ?? false,
      target: element.getAttribute?.('target') ?? '',
    };
  }
  return null;
}

/**
 * Whether a click on a link asks for it somewhere other than the frame: a
 * middle click, or a click with a modifier key, each of which opens a tab
 * or a window, or downloads, where a plain click would scroll in place.
 */
const elsewhere = (event: MouseEvent) =>
  event.type === 'auxclick' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;

/**
 * The Navigation API's `navigate` event, as the backstop reads it, where
 * the browser has one. TypeScript's DOM types don't have it yet.
 */
interface NavigateEventLike extends Event {
  readonly navigationType: string;
  readonly destination: { readonly url: string };
  readonly downloadRequest: string | null;
}

/**
 * Sets the environment Studio's controls chose on the document's
 * presentation boundary, the outermost element with data-variant, through
 * environmentAttributes(), as the server rendered the grant's. A document
 * with no boundary, such as a status page, has nothing to set.
 */
export function setEnvironment(
  document: Document,
  selection: EnvironmentSelection,
  environment: ToFramePayload<'environment'>,
): void {
  const boundary = document.querySelector('[data-variant]');
  if (!boundary) return;
  const attributes = environmentAttributes(selection, environment);
  for (const name of ENVIRONMENT_ATTRIBUTES) boundary.setAttribute(name, attributes[name]);
}

/**
 * Sets a display mode an `appearance` brought on the presentation boundary,
 * as setEnvironment() would against a site that publishes it, in a sample
 * frame, which takes no environment, so nothing else on the boundary moves.
 */
export function setDisplayMode(
  document: Document,
  displayMode: ToFramePayload<'appearance'>['displayMode'],
): void {
  document.querySelector('[data-variant]')?.setAttribute('data-display-mode', displayMode);
}

/** The element of the section `anchor` names, found by its data-section-id. */
function sectionOf(document: Document, anchor: string): Element | null {
  for (const element of document.querySelectorAll('[data-section-id]')) {
    if (element.getAttribute('data-section-id') === anchor) return element;
  }
  return null;
}

/**
 * The nonce each local frame's document read from its fragment, by window:
 * read once, as the document loads, so a channel started again in the same
 * document, as React's Strict Mode starts every effect twice under next dev,
 * says hello with it though the fragment is gone.
 */
const fragmentNonces = new WeakMap<object, string | null>();

/** The local frame's nonce: from the fragment the first time, which then leaves the URL. */
function localNonce(win: Window): string | null {
  if (fragmentNonces.has(win)) return fragmentNonces.get(win)!;
  const nonce = nonceFromFragment(win.location.hash);
  fragmentNonces.set(win, nonce);
  if (win.location.hash !== '') {
    // The nonce leaves the URL once read, so nothing reads it later.
    try {
      win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search);
    } catch {
      // A frame that can't rewrite its URL keeps it.
    }
  }
  return nonce;
}

/**
 * Starts the frame's channel in `win`, with the settings the server
 * rendered. Returns what stops it, or null when the document isn't framed.
 */
export function startFrameChannel(win: Window, options: FrameChannelOptions): (() => void) | null {
  if (win.parent === win) return null;
  // The window says the agent runs in it, under the agent's own marker, which keeps that marker
  // in every build of this code. Shared protocol strings, as 'kgn-preview', are never the
  // marker: Studio's half carries them too.
  Object.defineProperty(win, Symbol.for(FRAME_AGENT_MARKER), { value: true, configurable: true });
  const { mode, studioOrigin, linkBase } = options;
  // A local or sample frame's nonce is the one Studio put in its fragment.
  const nonce = mode === 'server' ? (options.nonce ?? null) : localNonce(win);
  const sample = mode === 'sample';
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
  /** What the site publishes, which an `appearance` message's display mode replaces. */
  let selection: EnvironmentSelection = options.selection ?? DEFAULT_SELECTION;
  /** The environment Studio set last, which a new display mode is set against again. */
  let environment: ToFramePayload<'environment'> | null = null;
  /** What cancels an appearance switch still waiting for its sheets. */
  let switching: () => void = () => {};
  /** In a sample frame, the appearance it last showed in place, which its own links carry on. */
  let shownInPlace: ToFramePayload<'appearance'> | null = null;

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
        route: mode === 'local' ? localRoute : routeOf(win.location.pathname, linkBase),
      });
    }
  };
  const onStatus = (status: FrameStatus) => send('status', status);
  const onLocalRoute = (route: string) => {
    if (mode !== 'local' || !isRoute(route)) return;
    localRoute = route;
    send('navigated', { route });
  };

  /** The route a local frame shows, which it keeps in memory. */
  let localRoute = '/';

  /**
   * Loads `url`, a path under the link base, after telling Studio where to.
   * A local frame keeps the route in memory instead and renders it there.
   */
  const load = (url: URL) => {
    const route = routeOf(url.pathname, linkBase);
    send('navigated', { route });
    if (mode === 'local') {
      localRoute = route;
      options.onRoute?.(route);
      return;
    }
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

  /**
   * The section at the top of the viewport, and how far through it the reader is. A section
   * that starts less than a pixel below the top is the one at the top: a scroll lands on a
   * whole pixel and a section can start a fraction of one past it, which would name the
   * section before, at its end, and send the other frame to the gap above the reader's.
   */
  const position = (): ToStudioPayload<'scrolled'> | null => {
    let found: { readonly anchor: string; readonly top: number; readonly height: number } | null =
      null;
    for (const element of win.document.querySelectorAll('[data-section-id]')) {
      const { top, height } = element.getBoundingClientRect();
      const anchor = element.getAttribute('data-section-id') ?? '';
      if (found && top >= 1) break;
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
    if (sample && !SAMPLE_TAKES.has(message.type)) return drop('type', message.type);
    // A sample frame shows only what its server rendered as this build's own packs.
    if (sample && message.type === 'appearance') {
      if (!registeredAppearance(message.payload, options.registered)) {
        return drop('payload', 'appearance');
      }
    }
    switch (message.type) {
      case 'environment':
        environment = message.payload;
        return setEnvironment(win.document, selection, message.payload);
      case 'appearance': {
        const shown = message.payload;
        switching();
        switching = showAppearance(
          {
            document: win.document,
            requestFrame: (run) => win.requestAnimationFrame(run),
          },
          shown,
          () => {
            selection = { ...selection, displayMode: shown.displayMode };
            if (environment) setEnvironment(win.document, selection, environment);
            // A sample frame takes no environment: its display mode goes on the boundary alone,
            // and its contrast, motion, and enhancement stay as the server rendered them.
            else if (sample) {
              setDisplayMode(win.document, shown.displayMode);
              shownInPlace = shown;
            }
          },
        );
        return;
      }
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
        if (!take(sizeOf(message.payload, LIMITS.document))) return drop('size', 'document');
        // A new document starts at its home page.
        localRoute = '/';
        return options.onDocument?.(message.payload);
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

  /** What a click or a middle click on a link does: the same for both, in the capture phase. */
  const onClick = (event: MouseEvent) => {
    // A middle click opens a link; a click of another button opens nothing.
    if (event.type === 'auxclick' && event.button !== 1) return;
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
    if (kind === 'fragment') {
      // A plain click scrolls in place. Anything else would open the
      // grant's page in a tab or a window of its own.
      if (elsewhere(event)) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (kind === 'internal') return load(url);
    if (kind !== 'unsupported') send('link', { href: url.href, kind });
  };

  /**
   * A sample frame's one guard: a plain click on a link to another of its
   * own pages, which loads it with the appearance shown in place and the
   * nonce. A middle or modified click, a download, a link with a target, a
   * fragment, and a link anywhere else go on as they did before the agent.
   */
  const onSampleClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || elsewhere(event)) return;
    const link = linkOf(event);
    if (!link || link.download || (link.target !== '' && link.target !== '_self')) return;
    let url: URL;
    try {
      url = new URL(link.href, win.document.baseURI);
    } catch {
      return;
    }
    const kind = classifyLink(url, { here: new URL(win.location.href), linkBase, studioOrigin });
    if (kind !== 'internal') return;
    event.preventDefault();
    win.location.assign(sampleDestination(url, shownInPlace, options.queryKeys, nonce));
  };

  /**
   * The backstop: a navigation of the frame that no click the guard saw
   * started, such as a link in a closed shadow root, a script's
   * location.assign(), a reload, or a pushState() or replaceState(). It
   * goes on to the grant's own paths and fragments, and else is cancelled
   * and sent to Studio as a link, as a click on it would be. Only back and
   * forward go on unread: they go where the frame has been, and with every
   * other move held to the grant, that's the grant's paths alone.
   */
  const onNavigate = (event: Event) => {
    const { navigationType, destination, downloadRequest } = event as NavigateEventLike;
    if (navigationType === 'traverse') return;
    let url: URL;
    try {
      url = new URL(destination.url);
    } catch {
      return;
    }
    const kind = classifyLink(url, {
      here: new URL(win.location.href),
      linkBase,
      studioOrigin,
      download: downloadRequest !== null,
    });
    if (kind === 'internal' || kind === 'fragment' || !event.cancelable) return;
    event.preventDefault();
    if (kind !== 'unsupported') send('link', { href: url.href, kind });
  };
  const navigation = (win as unknown as { readonly navigation?: EventTarget }).navigation;

  const hello = () => {
    if (stopped || nonce === null || !TOKEN.test(nonce)) return;
    helloSent = true;
    try {
      win.parent.postMessage(envelope('hello', { nonce, instance: INSTANCE }, ++seq), studioOrigin);
    } catch {
      // A Studio origin that isn't one gets no hello.
    }
  };
  const helloTimers: Array<ReturnType<typeof setTimeout>> = [];
  const helloAfterLoad = () => {
    for (const delay of [0, ...HELLO_AGAIN_MS]) helloTimers.push(setTimeout(hello, delay));
  };

  win.addEventListener('message', fromWindow);
  // A sample frame reports no scroll, and guards only a plain click to another of its own pages.
  if (sample) win.addEventListener('click', onSampleClick, true);
  else {
    win.addEventListener('click', onClick, true);
    win.addEventListener('auxclick', onClick, true);
    navigation?.addEventListener('navigate', onNavigate);
    win.addEventListener('scroll', onScroll, { passive: true });
  }
  statusListeners.add(onStatus);
  routeListeners.add(onLocalRoute);
  // After the document's own load, so the frame's load event in Studio's
  // window comes first nearly always. When it doesn't, the hellos after it
  // open the channel again.
  if (win.document.readyState === 'complete') helloAfterLoad();
  else win.addEventListener('load', helloAfterLoad, { once: true });

  return () => {
    stopped = true;
    switching();
    if (trailing !== undefined) clearTimeout(trailing);
    for (const timer of helloTimers) clearTimeout(timer);
    win.removeEventListener('message', fromWindow);
    win.removeEventListener('click', onClick, true);
    win.removeEventListener('click', onSampleClick, true);
    win.removeEventListener('auxclick', onClick, true);
    navigation?.removeEventListener('navigate', onNavigate);
    win.removeEventListener('scroll', onScroll);
    win.removeEventListener('load', helloAfterLoad);
    statusListeners.delete(onStatus);
    routeListeners.delete(onLocalRoute);
    if (port) {
      port.onmessage = null;
      port.close();
      port = null;
    }
  };
}

// The in-place appearance switch lives in this module, not its own, because the
// agent may import only the frame half of the channel, the protocol, and the
// environment function (the dependency rule preview-agent-imports-the-frame-channel-only).

// An appearance a frame shows in place (owner direction, 2026-10-25): the
// design language, color scheme, and typography packs, and the site's
// display mode, from Studio's `appearance` message, with no load, so the
// reader's scroll and section stay where they are. The composition is the
// server-rendered document's own, so it never changes here.
//
// Each pack's sheet is one the build's registry wrote under /_portfolio/pack/,
// which the protocol already held the message to. A new sheet is linked
// beside the old one, with the document's own CSP nonce, and only once every
// new sheet has loaded does the boundary switch, in one frame, with
// transitions held off for it, so colours never smear and nothing shows
// unstyled. A later message replaces one still loading.

type Appearance = ToFramePayload<'appearance'>;

/** The pack axes a frame swaps, with the boundary attribute each sets. */
export const SWAPPED_AXES = [
  ['designLanguage', 'data-design-language', 'design-language'],
  ['colorScheme', 'data-color-scheme', 'color-scheme'],
  ['typography', 'data-typography', 'typography'],
] as const;

/** What holds transitions off while the boundary switches. */
export const NO_TRANSITIONS = '*,*::before,*::after{transition:none!important}';

/** The parts of the DOM this reads and writes, so a test can stand in for them. */
export interface AppearanceDom {
  readonly document: Document;
  readonly requestFrame: (run: () => void) => void;
}

/** The presentation boundaries a document has: every one, outermost first. */
function boundaries(document: Document): Element[] {
  const marked = [...document.querySelectorAll('[data-appearance-boundary]')];
  return marked.length > 0 ? marked : [...document.querySelectorAll('[data-variant]')].slice(0, 1);
}

/** The pack id a stylesheet link loads, or null for any other link. */
function packOf(link: Element): string | null {
  const href = link.getAttribute('href') ?? '';
  let path: string;
  try {
    path = new URL(href, 'http://frame.invalid').pathname;
  } catch {
    return null;
  }
  return PACK_STYLESHEET.exec(path)?.[1] ?? null;
}

/** The nonce the document's own sheets and scripts carry, which its CSP wants on a new one. */
function documentNonce(document: Document): string {
  for (const element of document.querySelectorAll('link[rel~="stylesheet"], style, script')) {
    const nonce = (element as HTMLElement).nonce;
    if (nonce) return nonce;
  }
  return '';
}

/** Whether `boundary` already shows `appearance`'s packs. */
const shows = (boundary: Element, appearance: Appearance) =>
  SWAPPED_AXES.every(
    ([axis, attribute]) => boundary.getAttribute(attribute) === appearance[axis].id,
  );

/**
 * Starts showing `appearance` in `dom`'s document, and calls `done` once the
 * boundary has switched: at once when it shows it already, else once the new
 * sheets have loaded or failed. Returns what cancels a switch still waiting.
 */
export function showAppearance(
  dom: AppearanceDom,
  appearance: Appearance,
  done: () => void,
): () => void {
  const { document } = dom;
  const found = boundaries(document);
  if (found.length === 0) return () => {};
  if (found.every((boundary) => shows(boundary, appearance))) {
    done();
    return () => {};
  }
  const current = found[0]!;
  const links = [...document.querySelectorAll('link[rel~="stylesheet"]')];
  const nonce = documentNonce(document);
  // Each axis whose pack changes: the old link, if the document has one, and the new one beside it.
  const swaps: { old: Element | null; added: HTMLLinkElement | null }[] = [];
  let waiting = 0;
  let cancelled = false;
  // Once the switch has happened its sheets are the document's own: a later message's
  // cancel must leave them, or an axis it doesn't change loses its stylesheet.
  let finished = false;
  const finish = () => {
    if (cancelled) return;
    finished = true;
    const hold = document.createElement('style');
    if (nonce) hold.nonce = nonce;
    hold.textContent = NO_TRANSITIONS;
    document.head.append(hold);
    for (const boundary of found) {
      for (const [axis, attribute, name] of SWAPPED_AXES) {
        boundary.setAttribute(attribute, appearance[axis].id);
        boundary.removeAttribute(`data-requested-${name}`);
      }
      const fallback = (boundary.getAttribute('data-appearance-fallback') ?? '')
        .split(/\s+/)
        .filter((axis) => axis !== '' && !SWAPPED_AXES.some(([, , name]) => name === axis));
      if (fallback.length > 0)
        boundary.setAttribute('data-appearance-fallback', fallback.join(' '));
      else boundary.removeAttribute('data-appearance-fallback');
    }
    for (const { old } of swaps) old?.remove();
    // The switch paints with transitions off, then they come back on the frame after.
    void getComputedStyle(document.body).color;
    dom.requestFrame(() => dom.requestFrame(() => hold.remove()));
    done();
  };
  const settled = () => {
    waiting -= 1;
    if (waiting === 0) finish();
  };
  for (const [axis, attribute] of SWAPPED_AXES) {
    const { id, stylesheet } = appearance[axis];
    const before = current.getAttribute(attribute);
    if (before === id) continue;
    const old = links.find((link) => before !== null && packOf(link) === before) ?? null;
    if (links.some((link) => packOf(link) === id)) {
      swaps.push({ old, added: null });
      continue;
    }
    const added = document.createElement('link');
    added.rel = 'stylesheet';
    added.href = stylesheet;
    if (nonce) added.nonce = nonce;
    // Beside the axis's old sheet, or else after the last pack sheet, in the same precedence.
    const anchor = old ?? links.filter((link) => packOf(link) !== null).at(-1) ?? null;
    const precedence = anchor?.getAttribute('data-precedence');
    if (precedence) added.setAttribute('data-precedence', precedence);
    waiting += 1;
    added.addEventListener('load', settled, { once: true });
    added.addEventListener('error', settled, { once: true });
    if (anchor) anchor.after(added);
    else document.head.append(added);
    swaps.push({ old, added });
  }
  if (waiting === 0) finish();
  return () => {
    if (cancelled || finished) return;
    cancelled = true;
    // A switch that never happened takes its new sheets with it.
    for (const { added } of swaps) added?.remove();
  };
}
