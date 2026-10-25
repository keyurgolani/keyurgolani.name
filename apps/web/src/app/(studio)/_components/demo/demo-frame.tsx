'use client';

import { useEffect, useRef, useState } from 'react';
import { fitScale, FRAME_ATTRIBUTES, type Viewport } from '~/lib/preview-frame';
import {
  ASK_LABEL,
  ASK_TEXT,
  LOADED_TEXT,
  LOADING_TEXT,
  whenOnScreen,
  type FrameGate,
} from './frame-gate';

// Demo Studio's preview frame (#9, design note section 1): the server-rendered
// sample at /sample, or the read-only reference at /reference, with the
// selection in its query, in an iframe sandboxed
// to `allow-scripts` alone, so its document has an opaque origin and can
// reach neither Studio's storage nor its DOM. It holds no grant, opens no
// channel, and never loads a /preview path: the demo mints nothing. Like
// #7's PreviewSurface, it lays the document out at the viewport's width and
// scales it to the room it has, from lib/preview-frame.ts, and stays hidden
// until the document has loaded. Its first document waits for frame-gate.ts:
// its stage near the window, or at a phone's width the visitor's "Show
// preview", with a poster that loads nothing in the stage's place.

/** The one sandbox a demo frame gets, the sample's and the reference's alike: scripts, and nothing else. */
export const DEMO_FRAME_SANDBOX = 'allow-scripts';

/**
 * Whether `src` is a frame source Demo Studio may load: a path on its own
 * origin under /sample, or under /reference but for its renditions route,
 * /reference/media, which is no page. Its path is read decoded, as
 * proxy.ts's demoPagePath() reads it, so /%72eference counts as /reference;
 * one that doesn't decode, or that decodes to a dot segment or a backslash,
 * such as /sample/..%2fstudio, is refused.
 */
export function isDemoFrameSource(src: string): boolean {
  if (!src.startsWith('/') || src.startsWith('//')) return false;
  const base = 'http://studio.invalid';
  let path: string;
  try {
    const url = new URL(src, base);
    if (url.origin !== base) return false;
    path = decodeURIComponent(url.pathname);
    // Decoded, it names the same path a browser would resolve it to.
    if (path.includes('\\') || new URL(path, base).pathname !== path) return false;
  } catch {
    return false;
  }
  if (/^\/sample(?:\/|$)/.test(path)) return true;
  return /^\/reference(?:\/|$)/.test(path) && !/^\/reference\/media(?:\/|$)/.test(path);
}

export interface DemoFrameProps {
  /** Where the frame loads: /sample or /reference with the selection's query, from lib/demo/url-state.ts. */
  readonly src: string;
  /** What the frame shows, for its accessible name. */
  readonly title: string;
  readonly viewport: Viewport;
  /**
   * How the stage waits for its first document (frame-gate.ts): until it's
   * near the window, the default, or at a phone's width until the visitor
   * asks. Every source after that loads straight away.
   */
  readonly gate?: FrameGate;
  /**
   * Whether a stage on this page was already let load, which the page keeps
   * across its tasks, so a visitor asks once. Absent, the frame keeps its own.
   */
  readonly requested?: boolean;
  /** Hears that the stage was let load, by its gate or by the visitor. */
  readonly onRequest?: () => void;
  /** Says, in the page's status, that an asked-for preview is loading, then that it loaded. */
  readonly onAnnounce?: (text: string) => void;
}

export function DemoFrame({
  src,
  title,
  viewport,
  gate = 'visible',
  requested: given,
  onRequest,
  onAnnounce,
}: DemoFrameProps) {
  const stage = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [loaded, setLoaded] = useState<string | null>(null);
  // Whether the stage may load a document yet: once it may, it never waits again.
  const [own, setOwn] = useState(false);
  const requested = given ?? own;
  const allowed = isDemoFrameSource(src);
  // Whether the visitor asked here, so the stage takes focus and its load is announced.
  const [asked, setAsked] = useState(false);
  const waiting = gate === 'asked' && !requested;

  // Fit: the frame scales down to the room it has, its layout width the viewport's.
  useEffect(() => {
    const surface = stage.current;
    if (!surface) return;
    const resize = () => setScale(fitScale(surface.clientWidth, viewport));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [viewport, waiting]);

  // The visible gate: the first document loads once the stage comes near the window.
  useEffect(() => {
    const surface = stage.current;
    if (requested || gate !== 'visible' || !surface) return;
    return whenOnScreen(surface, () => {
      setOwn(true);
      onRequest?.();
    });
  }, [requested, gate, allowed, onRequest]);

  // Asked for, the stage takes the focus the button had, as the button goes with the poster.
  useEffect(() => {
    if (asked) stage.current?.focus();
  }, [asked]);

  if (!allowed) {
    return (
      <p className="studio-alert" role="alert">
        This preview can only show the demo&apos;s own pages.
      </p>
    );
  }
  if (waiting) {
    return (
      <div className="demo-frame__poster" data-phase="waiting">
        <p className="demo-frame__ask">{ASK_TEXT}</p>
        <p className="demo-frame__what">{title}</p>
        <button
          type="button"
          className="studio-button"
          onClick={() => {
            setOwn(true);
            setAsked(true);
            onRequest?.();
            onAnnounce?.(LOADING_TEXT);
          }}
        >
          {ASK_LABEL}
        </button>
      </div>
    );
  }
  const ready = requested && loaded === src;
  return (
    <div
      ref={stage}
      className="preview-surface__stage"
      data-phase={ready ? 'ready' : 'loading'}
      aria-busy={ready ? undefined : true}
      // Named and focusable where a visitor asks for it, so focus has somewhere to go.
      {...(gate === 'asked' ? { role: 'group', 'aria-label': title, tabIndex: -1 } : {})}
      style={{ blockSize: `${Math.ceil(viewport.height * scale)}px` }}
    >
      <iframe
        key={src}
        className="preview-surface__frame"
        title={title}
        // No source until the gate lets the stage load: then this one, and each after it.
        src={stageSource(src, requested)}
        sandbox={DEMO_FRAME_SANDBOX}
        referrerPolicy={FRAME_ATTRIBUTES.referrerPolicy}
        allow={FRAME_ATTRIBUTES.allow}
        // A frame with no source loads about:blank, which isn't the document.
        onLoad={() => {
          if (!requested) return;
          setLoaded(src);
          if (asked && loaded === null) onAnnounce?.(LOADED_TEXT);
        }}
        style={{
          inlineSize: `${viewport.width}px`,
          blockSize: `${viewport.height}px`,
          transform: `scale(${scale})`,
          visibility: ready ? 'visible' : 'hidden',
        }}
      />
    </div>
  );
}

/** The frame's `src`: none until the stage may load, then the source it shows. */
export function stageSource(src: string, requested: boolean): string | undefined {
  return requested ? src : undefined;
}
