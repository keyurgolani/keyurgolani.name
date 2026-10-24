'use client';

import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import {
  fitScale,
  FRAME_ATTRIBUTES,
  frameOrigin,
  frameSource,
  heldToSystem,
  linkTarget,
  REDUCED_MOTION,
  type LinkTarget,
  type Viewport,
} from '~/lib/preview-frame';
import { announceSignedOut, AUTH_REQUIRED, onSignedOut, studioFetch } from '~/lib/studio-fetch';
import { openStudioChannel, type StudioChannel } from '~/preview/studio-channel';
import type { ToFramePayload } from '~/preview/protocol';
import type { ScrollPosition } from './frame-link';
import { pageLifecycle, type FrameLifecycle } from './frame-lifecycle';
import {
  createGrantSession,
  type GrantSession,
  type LeftGrant,
  type MintRequest,
} from './grant-session';
import { createRefreshThrottle, type RefreshThrottle } from './refresh-throttle';

// PreviewSurface (#7, Slice 4): one preview frame in Studio, its grant, its
// channel, and its states, outside the frame. It mints the frame's grant
// with #61's commands and keeps it (grant-session.ts), loads the frame
// sandboxed, talks to its agent through Studio's half of the channel, and
// sends it the environment, its lifecycle, and nothing before a handshake.
// Loading shows a neutral background with aria-busy; no ready within 10
// seconds, or a frame that fails to render, shows "Preview did not load"
// with Retry; a version mismatch asks for a reload; a link the frame
// cancelled shows its target and opens it only on a click. When the session
// ends, here or in another tab, the frame goes to about:blank, its port
// closes, and "Preview expired" offers sign-in again, keeping the page.
// Slice 5's comparison puts two side by side.
//
// What the frame sends is its own claim: a link's kind comes from its href,
// and nothing it sends moves Studio. A link opens only on the owner's click,
// in a new tab with no opener or referrer.

/** How long a frame has to say ready before it counts as not loaded. */
export const READY_TIMEOUT_MS = 10_000;
/** How long a load has to bring a valid hello before Studio asks for the grant's status. */
export const HELLO_TIMEOUT_MS = 2_000;

export interface PreviewSurfaceProps {
  /** The page's CSRF token, for the grant commands. */
  readonly csrfToken: string;
  /** What the frame shows and the environment it starts in. */
  readonly request: MintRequest;
  /** The frame's sandbox, which the page decided: '' when JavaScript is off. */
  readonly sandbox: string;
  /** The preview origin frames load from, or null for the deployment's own. */
  readonly previewOrigin: string | null;
  readonly viewport: Viewport;
  /** The frame's title: the state string, then the variant and the viewport. */
  readonly title: string;
  /** Changes to refresh the frame, at most once every 2 seconds: a save, or the Refresh control. */
  readonly refresh: number;
  /** Where "Sign in again" goes, back to this page. */
  readonly signIn: string;
  /** Called when the frame settles after a load: ready, or not loaded. */
  readonly onSettled?: () => void;
  /**
   * What the surface is called, in its region, its Skip link, and what its
   * live region says: Preview, or First preview and Second preview side by
   * side (#7, item 7).
   */
  readonly name?: string;
  /** Whether the frame tells Studio as its reader scrolls, which a linked pair turns on. */
  readonly scrollSync?: boolean;
  /** The frame loaded `route`: its ready. */
  readonly onArrived?: (route: string) => void;
  /** The frame moved to `route` itself: its navigated, the frame's claim. */
  readonly onNavigated?: (route: string) => void;
  /** The frame's reader scrolled: its scrolled, the frame's claim. */
  readonly onScrolled?: (position: ScrollPosition) => void;
  /** What a linked pair asks of this frame. */
  readonly handle?: Ref<PreviewSurfaceHandle>;
}

/** What a linked pair asks of a frame: false when it has no channel open to take it. */
export interface PreviewSurfaceHandle {
  navigate(route: string): boolean;
  scrollTo(position: ScrollPosition): boolean;
  /**
   * Item focus (#8, Slice 4 item 6): scrolls `anchor`'s section to the top
   * of the frame and outlines it there, from the frame's own `rect`. The
   * frame's document is left as a visitor's: nothing in it changes.
   */
  focus(anchor: string): boolean;
}

/** How long a focused section's outline shows. */
const FOCUS_OUTLINE_MS = 2500;

type Phase = 'loading' | 'ready' | 'failed' | 'blocked' | 'outdated' | 'expired';

const ANNOUNCEMENTS: Readonly<Record<Phase, string>> = {
  loading: 'Loading the preview.',
  ready: 'Preview ready.',
  failed: 'Preview did not load.',
  blocked: "This version can't be previewed yet.",
  outdated: 'This preview is out of date.',
  expired: 'Preview expired.',
};

/** The parts of the request a new grant needs; the rest the agent applies in place. */
const mintKey = ({ subject, appearance, environment }: MintRequest) =>
  JSON.stringify([subject, appearance ?? null, environment.enhancement]);

/** The sessionStorage key a page that goes keeps its grants' refs under (#7). */
export const LEFT_GRANTS_KEY = 'studio.preview.left-grants';

/**
 * This tab's sessionStorage, as the grant session keeps the refs of the
 * grants a page held as it goes: synchronous, so the write is done before
 * the page is. Only refs, never a token. A duplicated tab gets a copy, but
 * a live page never wrote one, so it carries none. Storage that throws
 * keeps nothing, and the keepalive revoke and the idle limit still bound
 * the grant.
 */
const TAB_LEFT_GRANTS: LeftGrant = {
  keep(ref) {
    try {
      const kept = JSON.parse(sessionStorage.getItem(LEFT_GRANTS_KEY) ?? '[]') as unknown;
      const refs = Array.isArray(kept) ? kept.filter((each) => typeof each === 'string') : [];
      sessionStorage.setItem(LEFT_GRANTS_KEY, JSON.stringify([...refs, ref].slice(-16)));
    } catch {
      // Nothing kept.
    }
  },
  take() {
    try {
      const kept = JSON.parse(sessionStorage.getItem(LEFT_GRANTS_KEY) ?? '[]') as unknown;
      sessionStorage.removeItem(LEFT_GRANTS_KEY);
      return Array.isArray(kept)
        ? kept.filter((each): each is string => typeof each === 'string')
        : [];
    } catch {
      return [];
    }
  },
};

/**
 * `request` as a grant is minted for it: motion held to the owner's system,
 * which the first mint goes out before the controls have read.
 */
const heldRequest = (request: MintRequest): MintRequest => ({
  ...request,
  environment: heldToSystem(request.environment, window.matchMedia(REDUCED_MOTION).matches),
});

/**
 * Sends a linked pair's move over `channel`: false with no channel open, or
 * for a payload the protocol refuses, which reaches the frame never.
 */
function sendSafely<K extends 'navigate' | 'scroll-to'>(
  channel: StudioChannel | null,
  type: K,
  payload: ToFramePayload<K>,
): boolean {
  try {
    return channel?.send(type, payload) ?? false;
  } catch {
    return false;
  }
}

/** `text`, as the live region of the surface called `name` says it. */
const announced = (name: string, text: string) => (name === 'Preview' ? text : `${name}: ${text}`);

/** `name` inside a sentence: First preview becomes first preview. */
const lowered = (name: string) => `${name.charAt(0).toLowerCase()}${name.slice(1)}`;

export function PreviewSurface(props: PreviewSurfaceProps) {
  const { request, sandbox, viewport, title } = props;
  const name = props.name ?? 'Preview';
  const javascript = sandbox !== '';
  const after = useId();
  const stage = useRef<HTMLDivElement | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const channel = useRef<StudioChannel | null>(null);
  const session = useRef<GrantSession | null>(null);
  const lifecycle = useRef<FrameLifecycle | null>(null);
  const throttle = useRef<RefreshThrottle | null>(null);
  const latest = useRef({ props, held: null as { grant: string; nonce: string } | null });
  useEffect(() => {
    latest.current.props = props;
  });
  const timers = useRef<{
    ready?: ReturnType<typeof setTimeout>;
    hello?: ReturnType<typeof setTimeout>;
  }>({});

  const [phase, setPhase] = useState<Phase>('loading');
  const [blocked, setBlocked] = useState({ diagnostics: 0, kept: false });
  const [link, setLink] = useState<LinkTarget | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [scale, setScale] = useState(1);
  /** The section item focus asked for, and where the frame says it is, in its own viewport. */
  const focusing = useRef<string | null>(null);
  const [outline, setOutline] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const settle = useCallback((next: Phase) => {
    clearTimeout(timers.current.ready);
    setPhase(next);
    if (next === 'ready' || next === 'failed') latest.current.props.onSettled?.();
  }, []);

  /** The environment the agent applies in place, sent after every handshake and each change. */
  const sendEnvironment = useCallback(() => {
    channel.current?.send('environment', latest.current.props.request.environment);
  }, []);

  /** Loads the frame of `held` into the current element, its channel opened first. */
  const load = useCallback(
    (held: { grant: string; nonce: string }) => {
      const element = frame.current;
      if (!element) return;
      latest.current.held = held;
      clearTimeout(timers.current.ready);
      clearTimeout(timers.current.hello);
      setPhase('loading');
      if (latest.current.props.sandbox !== '') {
        if (channel.current) channel.current.reset(held.nonce);
        else {
          const { sandbox, previewOrigin } = latest.current.props;
          const origin = frameOrigin(sandbox, previewOrigin);
          channel.current = openStudioChannel({
            iframe: element,
            nonce: held.nonce,
            ...(origin === undefined ? {} : { frameOrigin: origin }),
            on: {
              ready: ({ route }) => {
                settle('ready');
                latest.current.props.onArrived?.(route);
              },
              navigated: ({ route }) => latest.current.props.onNavigated?.(route),
              scrolled: (position) => latest.current.props.onScrolled?.(position),
              rect: ({ anchor, rect }) => {
                if (focusing.current !== anchor) return;
                focusing.current = null;
                setOutline(rect);
              },
              status: ({ state }) => {
                if (state === 'ready') settle('ready');
                else if (state === 'version_mismatch') settle('outdated');
                else settle('failed');
              },
              link: ({ href }) =>
                setLink(
                  linkTarget(href, window.location.origin, latest.current.props.previewOrigin),
                ),
              connection: (connected) => {
                if (!connected) return;
                clearTimeout(timers.current.hello);
                sendEnvironment();
                channel.current?.send('sync', { scroll: latest.current.props.scrollSync ?? false });
                if (lifecycle.current) {
                  channel.current?.send('lifecycle', lifecycle.current.current);
                }
              },
            },
          });
        }
      }
      timers.current.ready = setTimeout(() => settle('failed'), READY_TIMEOUT_MS);
      element.src = frameSource(latest.current.props.previewOrigin, held.grant);
    },
    [sendEnvironment, settle],
  );

  /** The session ended: blank the frame, close its port, and keep the page. */
  const expire = useCallback(() => {
    clearTimeout(timers.current.ready);
    clearTimeout(timers.current.hello);
    throttle.current?.cancel();
    session.current?.end();
    channel.current?.close();
    channel.current = null;
    latest.current.held = null;
    if (frame.current) frame.current.src = 'about:blank';
    setLink(null);
    setPhase('expired');
  }, []);

  // The grant: minted as the frame mounts, kept, and revoked as it goes.
  useEffect(() => {
    const pending = timers.current;
    const grants = createGrantSession({
      call: studioFetch,
      csrfToken: latest.current.props.csrfToken,
      left: TAB_LEFT_GRANTS,
      onState: (state) => {
        if (state.kind === 'minting') setPhase((now) => (now === 'expired' ? now : 'loading'));
        else if (state.kind === 'active') load(state);
        else if (state.kind === 'blocked') {
          setBlocked({ diagnostics: state.diagnostics, kept: state.kept !== null });
          setPhase('blocked');
        } else if (state.kind === 'ended') {
          // A grant whose session ended is news to the other tabs: a 401 told them already.
          if (state.announce) announceSignedOut();
          expire();
        } else settle('failed');
      },
    });
    session.current = grants;
    throttle.current = createRefreshThrottle({
      run: () => void grants.mint(heldRequest(latest.current.props.request)),
    });
    void grants.mint(heldRequest(latest.current.props.request));
    // A reload or a closed tab unmounts nothing, so the grant goes with the
    // page, and a page back from the back-forward cache mints a new one.
    const onPageHide = () => grants.leave();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void grants.mint(heldRequest(latest.current.props.request));
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      throttle.current?.cancel();
      grants.stop();
      channel.current?.close();
      channel.current = null;
      clearTimeout(pending.ready);
      clearTimeout(pending.hello);
    };
  }, [expire, load, settle]);

  // A new subject, appearance, or enhancement needs a new grant; a refresh asks for one too.
  const key = mintKey(request);
  const minted = useRef(key);
  const refreshed = useRef(props.refresh);
  useEffect(() => {
    if (key === minted.current && props.refresh === refreshed.current) return;
    minted.current = key;
    refreshed.current = props.refresh;
    throttle.current?.request();
  }, [key, props.refresh]);

  // The display mode, contrast, and motion change in place.
  const { displayMode, contrast, motion } = request.environment;
  useEffect(() => {
    sendEnvironment();
  }, [displayMode, contrast, motion, sendEnvironment]);

  // Scroll sync, which a linked pair turns on and off: sent again after every handshake.
  const scrollSync = props.scrollSync ?? false;
  useEffect(() => {
    channel.current?.send('sync', { scroll: scrollSync });
  }, [scrollSync]);

  // What a linked pair asks of this frame, over its own channel alone.
  const scrollSteps = useRef(0);
  useImperativeHandle(
    props.handle,
    () => ({
      navigate: (route) => sendSafely(channel.current, 'navigate', { route }),
      scrollTo: ({ anchor, progress }) =>
        sendSafely(channel.current, 'scroll-to', {
          anchor,
          progress,
          seq: (scrollSteps.current += 1),
        }),
      focus: (anchor) => {
        focusing.current = anchor;
        return sendSafely(channel.current, 'scroll-to', {
          anchor,
          progress: 0,
          seq: (scrollSteps.current += 1),
        });
      },
    }),
    [],
  );

  // A focused section's outline fades after a moment, and goes with the frame's next load.
  useEffect(() => {
    if (!outline) return;
    const timer = setTimeout(() => setOutline(null), FOCUS_OUTLINE_MS);
    return () => clearTimeout(timer);
  }, [outline]);

  // JavaScript on or off is a frame of its own, with its own sandbox, for the same grant.
  const wasJavaScript = useRef(javascript);
  useEffect(() => {
    if (wasJavaScript.current === javascript) return;
    wasJavaScript.current = javascript;
    channel.current?.close();
    channel.current = null;
    setFrameKey((count) => count + 1);
  }, [javascript]);
  useEffect(() => {
    if (frameKey === 0) return;
    const held = latest.current.held;
    if (held) load(held);
  }, [frameKey, load]);

  // A load with no valid hello within 2 seconds: ask for the grant's status.
  // A frame with JavaScript off has no port, and counts as ready once it loads.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onLoad = () => {
      if (!latest.current.held || element.src === 'about:blank') return;
      if (!javascript) return settle('ready');
      clearTimeout(timers.current.hello);
      timers.current.hello = setTimeout(() => {
        if (!channel.current?.connected) void session.current?.check();
      }, HELLO_TIMEOUT_MS);
    };
    element.addEventListener('load', onLoad);
    return () => element.removeEventListener('load', onLoad);
  }, [frameKey, javascript, settle]);

  // The session ending, here or in another tab.
  useEffect(() => {
    const onAuthRequired = (event: Event) => {
      // Keep the page and its local work: the surface says the session expired.
      event.preventDefault();
      expire();
    };
    window.addEventListener(AUTH_REQUIRED, onAuthRequired);
    const stop = onSignedOut(expire);
    return () => {
      window.removeEventListener(AUTH_REQUIRED, onAuthRequired);
      stop();
    };
  }, [expire]);

  // Its lifecycle: hidden off screen or in a background tab, focused when used last.
  useEffect(() => {
    const element = frame.current;
    const surface = stage.current;
    if (!element || !surface) return;
    const handle = pageLifecycle().register((state) => {
      channel.current?.send('lifecycle', state);
    });
    lifecycle.current = handle;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) handle.setOnScreen(entry.isIntersecting);
    });
    observer.observe(element);
    const used = () => handle.used();
    const onBlur = () => {
      if (document.activeElement === element) handle.used();
    };
    surface.addEventListener('pointerdown', used);
    surface.addEventListener('focusin', used);
    window.addEventListener('blur', onBlur);
    return () => {
      observer.disconnect();
      surface.removeEventListener('pointerdown', used);
      surface.removeEventListener('focusin', used);
      window.removeEventListener('blur', onBlur);
      handle.unregister();
      lifecycle.current = null;
    };
  }, [frameKey]);

  // Fit: the frame scales down to the room it has, its layout width the viewport's.
  useEffect(() => {
    const surface = stage.current;
    if (!surface) return;
    const resize = () => setScale(fitScale(surface.clientWidth, viewport));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [viewport]);

  const retry = () => {
    setPhase('loading');
    void session.current?.mint(heldRequest(latest.current.props.request));
  };
  const openLink = () => {
    if (link) window.open(link.href, '_blank', 'noopener,noreferrer');
    setLink(null);
  };

  return (
    <section className="preview-surface" aria-label={name}>
      <a className="preview-surface__skip" href={`#${after}`}>
        Skip {lowered(name)}
      </a>
      <div
        ref={stage}
        className="preview-surface__stage"
        data-phase={phase}
        aria-busy={phase === 'loading' ? true : undefined}
        style={{ blockSize: `${Math.ceil(viewport.height * scale)}px` }}
      >
        <iframe
          key={frameKey}
          ref={frame}
          className="preview-surface__frame"
          title={title}
          sandbox={sandbox}
          referrerPolicy={FRAME_ATTRIBUTES.referrerPolicy}
          allow={FRAME_ATTRIBUTES.allow}
          style={{
            inlineSize: `${viewport.width}px`,
            blockSize: `${viewport.height}px`,
            transform: `scale(${scale})`,
          }}
        />
        {outline && phase === 'ready' ? (
          <div
            className="preview-surface__focus"
            aria-hidden="true"
            data-testid="preview-focus"
            style={{
              insetInlineStart: `${Math.max(0, outline.x) * scale}px`,
              insetBlockStart: `${Math.max(0, outline.y) * scale}px`,
              inlineSize: `${outline.width * scale}px`,
              blockSize: `${Math.min(outline.height, viewport.height) * scale}px`,
            }}
          />
        ) : null}
      </div>
      {phase === 'failed' ? (
        <div className="preview-surface__state">
          <p className="studio-label">Preview did not load</p>
          <button type="button" className="studio-button" onClick={retry}>
            Retry
          </button>
        </div>
      ) : null}
      {phase === 'blocked' ? (
        <div className="preview-surface__state">
          <p className="studio-label">
            {blocked.diagnostics === 1
              ? 'One problem keeps this version from a preview.'
              : `${blocked.diagnostics} problems keep this version from a preview.`}{' '}
            {blocked.kept
              ? 'The preview shows the last version that worked, and tries again after the next save.'
              : 'The preview tries again after the next save.'}
          </p>
        </div>
      ) : null}
      {phase === 'outdated' ? (
        <div className="preview-surface__state">
          <p className="studio-label">This preview is out of date.</p>
          <button type="button" className="studio-button" onClick={() => window.location.reload()}>
            Reload Studio
          </button>
        </div>
      ) : null}
      {phase === 'expired' ? (
        <div className="preview-surface__state">
          <p className="studio-label">Preview expired</p>
          <a className="studio-button" href={props.signIn}>
            Sign in again
          </a>
        </div>
      ) : null}
      {link ? (
        <div className="preview-surface__link">
          <p>
            The preview tried to open {link.description}:{' '}
            <span className="preview-surface__href">{link.href}</span>
          </p>
          <button type="button" className="studio-button" onClick={openLink}>
            Open link
          </button>
          <button
            type="button"
            className="studio-button studio-button--quiet"
            onClick={() => setLink(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <p id={after} className="preview-surface__after" tabIndex={-1}>
        End of {lowered(name)}
      </p>
      <p className="preview-surface__live" role="status" aria-live="polite">
        {announced(name, ANNOUNCEMENTS[phase])}
      </p>
    </section>
  );
}
