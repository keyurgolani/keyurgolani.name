'use client';

import { useEffect, useRef, useState } from 'react';
import { fitScale, FRAME_ATTRIBUTES, type Viewport } from '~/lib/preview-frame';
import { whenOnScreen } from './frame-gate';

// Demo Studio's preview frame (#9, design note section 1): the server-rendered
// sample at /sample, or the read-only reference at /reference, with the
// selection in its query, in an iframe sandboxed
// to `allow-scripts` alone, so its document has an opaque origin and can
// reach neither Studio's storage nor its DOM. It holds no grant, opens no
// channel, and never loads a /preview path: the demo mints nothing. Like
// #7's PreviewSurface, it lays the document out at the viewport's width and
// scales it to the room it has, from lib/preview-frame.ts, and stays hidden
// until the document has loaded. Its first document waits for its stage to
// come on screen (frame-gate.ts).

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
   * Whether a stage on this page was already let load, which the page keeps
   * across its tasks. Absent, the frame keeps its own.
   */
  readonly requested?: boolean;
  /** Hears that the stage was let load. */
  readonly onRequest?: () => void;
}

export function DemoFrame({ src, title, viewport, requested: given, onRequest }: DemoFrameProps) {
  const stage = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [loaded, setLoaded] = useState<string | null>(null);
  // Whether the stage may load a document yet: once it may, it never waits again.
  const [own, setOwn] = useState(false);
  const requested = given ?? own;
  const allowed = isDemoFrameSource(src);

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

  // The gate: the first document loads once the stage comes on screen.
  useEffect(() => {
    const surface = stage.current;
    if (requested || !surface) return;
    return whenOnScreen(surface, () => {
      setOwn(true);
      onRequest?.();
    });
  }, [requested, allowed, onRequest]);

  if (!allowed) {
    return (
      <p className="studio-alert" role="alert">
        This preview can only show the demo&apos;s own pages.
      </p>
    );
  }
  const ready = requested && loaded === src;
  return (
    <div
      ref={stage}
      className="preview-surface__stage"
      data-phase={ready ? 'ready' : 'loading'}
      aria-busy={ready ? undefined : true}
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
          if (requested) setLoaded(src);
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
