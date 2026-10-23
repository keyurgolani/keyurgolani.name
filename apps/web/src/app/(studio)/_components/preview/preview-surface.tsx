'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
import { pageLifecycle, type FrameLifecycle } from './frame-lifecycle';
import { createGrantSession, type GrantSession, type MintRequest } from './grant-session';
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
}

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

/**
 * `request` as a grant is minted for it: motion held to the owner's system,
 * which the first mint goes out before the controls have read.
 */
const heldRequest = (request: MintRequest): MintRequest => ({
  ...request,
  environment: heldToSystem(request.environment, window.matchMedia(REDUCED_MOTION).matches),
});

export function PreviewSurface(props: PreviewSurfaceProps) {
  const { request, sandbox, viewport, title } = props;
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
              ready: () => settle('ready'),
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
    return () => {
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
    void session.current?.mint(latest.current.props.request);
  };
  const openLink = () => {
    if (link) window.open(link.href, '_blank', 'noopener,noreferrer');
    setLink(null);
  };

  return (
    <section className="preview-surface" aria-label="Preview">
      <a className="preview-surface__skip" href={`#${after}`}>
        Skip preview
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
        End of preview
      </p>
      <p className="preview-surface__live" role="status" aria-live="polite">
        {ANNOUNCEMENTS[phase]}
      </p>
    </section>
  );
}
