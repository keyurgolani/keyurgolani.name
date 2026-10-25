'use client';

import { useEffect, useRef, useState, type Ref } from 'react';
import type { LocalSources } from '~/lib/demo/browser-backend';
import type { DemoSelection } from '~/lib/demo/url-state';
import { fitScale, FRAME_ATTRIBUTES, type Viewport } from '~/lib/preview-frame';
import { LIMITS, sizeOf } from '~/preview/protocol';
import { openStudioChannel, type StudioChannel } from '~/preview/studio-channel';
import { DEMO_FRAME_SANDBOX } from './demo-frame';

// Demo Studio's local frame host (#9, design note section 3): while the
// visitor has imported a pair of their own, the frame is /preview/local, the
// frame that renders a document in the browser (9-4b1), and Demo Studio
// sends it the local source over #7's channel, `preview/studio-channel.ts`,
// with a nonce of its own in the frame's fragment. Never the owner's
// PreviewSurface, and never a grant. The frame keeps the demo frame's
// sandbox, `allow-scripts` alone, so its document's origin is opaque, and the
// source reaches it only over the port: the URL holds the nonce and nothing
// else, and Studio's own URL never names the source.

/** How long the frame has to say it rendered before Studio says it didn't load (#7). */
export const LOCAL_FRAME_TIMEOUT_MS = 10_000;

/**
 * What Studio says when the frame refuses or can't render the documents:
 * never that findings show, since a task without the import's report, or a
 * working copy whose check found nothing the frame did, shows none.
 */
export const LOCAL_FRAME_FAILED =
  "Your documents didn't render in the preview. Import another pair in Content, or use Reset demo in Appearance for the sample.";

/** The only source a local frame loads: /preview/local, with a channel nonce in its fragment. */
const LOCAL_SOURCE = /^\/preview\/local#nonce=[A-Za-z0-9_-]{22}$/;

/** Whether `src` is a local frame's source: /preview/local#nonce=<token>, and nothing else. */
export function isLocalFrameSource(src: string): boolean {
  return LOCAL_SOURCE.test(src);
}

/** A channel nonce: 128 random bits in base64url, as #7's protocol takes them. */
export function localNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The `document` message for the local source and the visitor's selection. */
export function documentMessage(sources: LocalSources, selection: DemoSelection) {
  return {
    sources: {
      portfolio: { ...sources.portfolio },
      site: { ...sources.site },
    },
    selection: { ...selection },
  };
}

const DISPLAY_MODES = new Set(['system', 'light', 'dark', 'high-contrast']);

/**
 * What one frame document may still take: #7's frame counts every
 * `document` it's sent against LIMITS.frame, 100 MiB in all, and drops one
 * past it without a word. So Studio counts the same way, and a document
 * that wouldn't fit goes to a new frame document, with a new nonce, instead.
 */
export function frameBudget(limit: number = LIMITS.frame) {
  let used = 0;
  return {
    /** Counts `payload` and says true, or says false when it wouldn't fit, counting nothing. */
    take(payload: unknown): boolean {
      const bytes = sizeOf(payload, LIMITS.document);
      if (bytes < 0 || used + bytes > limit) return false;
      used += bytes;
      return true;
    },
  };
}

/** What one frame document has taken: frameBudget's answer. */
export type FrameBudget = ReturnType<typeof frameBudget>;

/**
 * Sends `message` to the frame document showing now when its budget takes
 * it, or else calls `remount`, so the message goes to a new frame document
 * once that one says ready. Never to a document that would drop it.
 */
export function deliver<T>(
  budget: FrameBudget,
  message: T,
  send: (message: T) => void,
  remount: () => void,
): void {
  if (budget.take(message)) send(message);
  else remount();
}

export interface LocalFrameElementProps {
  readonly ref: Ref<HTMLIFrameElement>;
  readonly title: string;
  readonly viewport: Viewport;
  readonly scale: number;
}

/**
 * The iframe of the frame document that `nonce` names, keyed on it. A new
 * nonce is a new element, so a new browsing context and a new document. On
 * the same element, a `src` that differs only in its fragment is a
 * fragment navigation: the old document would stay, with its old nonce and
 * all it had taken, and never say ready on the new channel.
 */
export function localFrameElement(nonce: string, props: LocalFrameElementProps) {
  const { ref, title, viewport, scale } = props;
  return (
    <iframe
      key={nonce}
      ref={ref}
      className="preview-surface__frame"
      title={title}
      sandbox={DEMO_FRAME_SANDBOX}
      referrerPolicy={FRAME_ATTRIBUTES.referrerPolicy}
      allow={FRAME_ATTRIBUTES.allow}
      style={{
        inlineSize: `${viewport.width}px`,
        blockSize: `${viewport.height}px`,
        transform: `scale(${scale})`,
      }}
    />
  );
}

export interface LocalFrameHostProps {
  readonly sources: LocalSources;
  readonly selection: DemoSelection;
  readonly title: string;
  readonly viewport: Viewport;
  /** Studio's simulated reduced motion, which the frame gets as its environment. */
  readonly reduced: boolean;
}

type Phase = 'loading' | 'ready' | 'failed' | 'timeout';

export function LocalFrameHost({
  sources,
  selection,
  title,
  viewport,
  reduced,
}: LocalFrameHostProps) {
  const stage = useRef<HTMLDivElement | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const channel = useRef<StudioChannel | null>(null);
  const [scale, setScale] = useState(1);
  const [nonce, setNonce] = useState(localNonce);
  const [phase, setPhase] = useState<Phase>('loading');
  // What this frame document has taken so far, which a new nonce starts again.
  const budget = useRef(frameBudget());
  // What the next `ready` gets: the latest source and selection.
  const latest = useRef({ sources, selection, reduced });
  useEffect(() => {
    latest.current = { sources, selection, reduced };
  }, [sources, selection, reduced]);

  useEffect(() => {
    const surface = stage.current;
    if (!surface) return;
    const resize = () => setScale(fitScale(surface.clientWidth, viewport));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [viewport]);

  const src = `/preview/local#nonce=${nonce}`;

  /** A new frame element and document, with a new nonce, which says ready and gets the latest document. */
  function remount() {
    setPhase('loading');
    setNonce(localNonce());
  }

  // The channel opens before the frame loads, as #7's Studio half asks.
  useEffect(() => {
    const iframe = frame.current;
    if (!iframe || !isLocalFrameSource(src)) return;
    budget.current = frameBudget();
    const send = () => {
      const open = channel.current;
      if (!open?.connected) return;
      const { sources: now, selection: chosen, reduced: still } = latest.current;
      let sent = false;
      deliver(
        budget.current,
        documentMessage(now, chosen),
        (message) => {
          open.send('document', message);
          sent = true;
        },
        remount,
      );
      if (sent && still) {
        open.send('environment', {
          displayMode: DISPLAY_MODES.has(chosen.displayMode)
            ? (chosen.displayMode as 'system')
            : 'system',
          contrast: 'system',
          motion: 'reduce',
          enhancement: 'on',
        });
      }
    };
    channel.current = openStudioChannel({
      iframe,
      nonce,
      on: {
        ready: send,
        status: ({ state }) => {
          if (state === 'ready') setPhase('ready');
          else setPhase('failed');
        },
      },
    });
    iframe.src = src;
    return () => {
      channel.current?.close();
      channel.current = null;
    };
  }, [nonce, src]);

  // Every new source or selection goes to the frame as a document of its own,
  // or to a new frame document once this one has taken all it may.
  useEffect(() => {
    const open = channel.current;
    if (!open?.connected) return;
    deliver(
      budget.current,
      documentMessage(sources, selection),
      (message) => open.send('document', message),
      remount,
    );
  }, [sources, selection]);

  // A frame that never says it rendered says so, rather than loading forever.
  useEffect(() => {
    if (phase !== 'loading') return;
    const timer = setTimeout(() => setPhase('timeout'), LOCAL_FRAME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (!isLocalFrameSource(src)) {
    return (
      <p className="studio-alert" role="alert">
        This preview can only show your imported documents.
      </p>
    );
  }
  return (
    <>
      {phase === 'failed' ? (
        <p className="studio-alert" role="alert">
          {LOCAL_FRAME_FAILED}
        </p>
      ) : phase === 'timeout' ? (
        <p className="studio-alert" role="alert">
          Preview did not load. Reload the page to try again.
        </p>
      ) : null}
      <div
        ref={stage}
        className="preview-surface__stage"
        data-phase={phase === 'ready' ? 'ready' : 'loading'}
        data-source="local"
        aria-busy={phase === 'loading' ? true : undefined}
        style={{ blockSize: `${Math.ceil(viewport.height * scale)}px` }}
      >
        {localFrameElement(nonce, { ref: frame, title, viewport, scale })}
      </div>
    </>
  );
}
