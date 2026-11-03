'use client';

import { useEffect, useRef, useState } from 'react';
import {
  fillWithin,
  fitScale,
  fitWithin,
  FRAME_ATTRIBUTES,
  type Viewport,
} from '~/lib/preview-frame';
import type { ToFramePayload } from '~/preview/protocol';
import { openStudioChannel, type StudioChannel } from '~/preview/studio-channel';
import { innerSize, useSettled } from '../split/studio-split';
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
// reach neither Studio's storage nor its DOM. It holds no grant and never
// loads a /preview path: the demo mints nothing. Like
// #7's PreviewSurface, it lays the document out at the viewport's width and
// scales it to the room it has, from lib/preview-frame.ts, and stays hidden
// until the document has loaded. Its first document waits for frame-gate.ts:
// its stage near the window, or at a phone's width the visitor's "Show
// preview", with a poster that loads nothing in the stage's place.
//
// A scheme, a typography, a design language, or a display mode it shows in
// place (DEM-2), as Owner Studio's frame does. Each document it loads gets a
// channel nonce of its own in its fragment, as /preview/local's does, and
// the page's agent (preview/sample-agent.ts) says hello with it. Studio
// sends the document each new `appearance` over #7's channel at once, so it
// keeps its scroll and plays no opening again. Only a change to the document
// itself, frameDocument()'s composition, motion, source, or page, loads the
// frame again, once a run of picks settles. So does a change that couldn't
// go in place because no channel was open: a source with a fragment of its
// own takes no nonce, and a document the visitor reached by a link inside
// the frame, or one that hasn't said hello yet, has none open.
//
// The stage's own frame is double-buffered (P-5 slice 4, C P1-F and P2-5): a
// new document loads in a second, hidden frame over the one on screen, which
// stays until the new one has loaded and painted, then goes, so a pick never
// blanks the stage. That's two frames at most, MAX_LIVE's two live previews.
// The swap is instant, with no crossfade, so it holds under reduced motion
// too. Compare's frames and the Grid's plates already hold two and four, so
// they load as before, each in its one frame.

/** The one sandbox a demo frame gets, the sample's and the reference's alike: scripts, and nothing else. */
export const DEMO_FRAME_SANDBOX = 'allow-scripts';

/** A channel nonce: 128 random bits in base64url, as #7's protocol takes them. */
export function channelNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Where a frame document with `nonce` loads: `src` with the nonce as its
 * fragment, `#nonce=<token>`, as #7's local frame takes one, which the
 * page's agent reads once and takes out of the URL. A source with a fragment
 * of its own, such as Home's Work section, keeps it and takes no nonce, so
 * its document opens no channel.
 */
export function nonceSource(src: string, nonce: string | null): string {
  return nonce === null || src.includes('#') ? src : `${src}#nonce=${nonce}`;
}

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
  /**
   * Where the frame loads: /sample or /reference with the selection's query, from
   * lib/demo/url-state.ts, once a run of changes settles, unless it took the change in place.
   */
  readonly src: string;
  /**
   * Which document `src` is, apart from its packs and its display mode: frameDocument()'s
   * answer. A change to it always loads the frame again. Absent, `src` itself, so every change does.
   */
  readonly document?: string;
  /**
   * The selection's appearance as the frame shows it in place, over its channel, or null when
   * it can't, such as a scheme with no build stylesheet: a change to it then loads the frame.
   */
  readonly appearance?: ToFramePayload<'appearance'> | null;
  /**
   * The motion the frame's document shows in place, over its channel, with no load: a Compare
   * grid plate's, `full` while it holds the heavy slot, else `reduced`. Absent or null, the
   * document's motion is its `src`'s alone. The frame takes `full` only where neither the site's
   * policy nor the reader's own setting reduces it; `src` stays the held document's, so a frame
   * whose channel never opens stays still.
   */
  readonly motion?: ToFramePayload<'motion'>['motion'] | null;
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
  /**
   * How the frame fits its room: scaled to the stage's width, the default,
   * or contained in the workspace's stage, its width and its height.
   */
  readonly fit?: 'width' | 'contain' | 'fill';
  /** Hears the frame's scale, for the workspace bar's badge. */
  readonly onScale?: (scale: number) => void;
  /**
   * Whether a new document loads beside the one on screen, which stays until the new one has
   * painted (underNext()): the stage's own frame. Absent, false: a frame of Compare's or the
   * Grid's, which already count toward MAX_LIVE, loads in its one frame.
   */
  readonly twin?: boolean;
}

/** What the attribute on a double-buffered stage's frames says: the one going, or the one replacing it. */
export type TwinRole = 'leaving' | 'incoming';

/**
 * How long a double-buffered stage's next document loads before the stage says it's loading:
 * after the show-delay, so a pick that loads quickly never flashes the mark.
 */
export const PENDING_MS = 150;

/**
 * A double-buffered stage's pending state, while its next document has loaded for PENDING_MS
 * and the one before it is still on screen: a quiet mark over the stage's corner, for sighted
 * visitors, and the same words in a polite live region beside the stage, outside its aria-busy,
 * for a reader. Static, so reduced motion needs nothing of it. The region is always there, empty
 * when nothing loads, so a reader hears it when the words come.
 */
export function SwapPending({ shown }: { readonly shown: boolean }) {
  return (
    // A polite live region with no status role, so the page's one status stays the page's.
    <p className="studio-visually-hidden demo-frame__status" aria-live="polite">
      {shown ? LOADING_TEXT : ''}
    </p>
  );
}

/** The mark over the stage's corner while its next document loads: the status says it for readers. */
export function SwapMark() {
  return (
    <span className="demo-frame__pending" aria-hidden="true">
      {LOADING_TEXT}
    </span>
  );
}

/**
 * The load a double-buffered stage keeps under the next one, as a new load replaces `current`:
 * `current` itself when its document has loaded, so it's the one on screen; else the one already
 * kept under it, so a pick that replaces a load still loading keeps what the stage shows. Always
 * a frame the stage has mounted, so keeping it never loads it again: none when the stage isn't
 * double-buffered, and none when `current` wasn't mounted, as a source the demo refuses isn't.
 * The stage so holds two frames at most and, once it has shown a document, never none.
 */
export function underNext<T extends Pick<FrameLoad, 'id'>>({
  twin,
  current,
  mounted,
  loaded,
  under,
}: {
  readonly twin: boolean;
  /** The load being replaced. */
  readonly current: T;
  /** Whether its frame is on the stage: the stage may load, and the demo allows its source. */
  readonly mounted: boolean;
  /** Which load's document has loaded, by its id. */
  readonly loaded: number | null;
  /** The load kept under `current`, if any. */
  readonly under: T | null;
}): T | null {
  if (!twin || !mounted) return null;
  return loaded === current.id ? current : under;
}

/** A frame document as it was loaded: its source, which document it is, and the appearance it renders. */
export interface FrameLoad {
  /** Where it loads, with its nonce in the fragment, or as given for a source that takes none. */
  readonly src: string;
  readonly document: string;
  /** The appearance its query renders, as appearanceKey() spells it. */
  readonly shows: string;
  /** The nonce its agent says hello with, or null when it opens no channel. */
  readonly nonce: string | null;
  /**
   * Which load it is, one of its own each time, so its frame is a new element even when its
   * source is one a frame had before, as one with a fragment of its own and no nonce can be.
   */
  readonly id: number;
}

let loads = 0;

/** A new frame document for `src`, with a nonce of its own when it can take one. */
export function frameLoad(src: string, document: string, shows: string): FrameLoad {
  const nonce = src.includes('#') ? null : channelNonce();
  loads += 1;
  return { src: nonceSource(src, nonce), document, shows, nonce, id: loads };
}

/** An appearance as the frame compares it: its JSON, or '' for none it can show in place. */
export const appearanceKey = (appearance: ToFramePayload<'appearance'> | null | undefined) =>
  appearance ? JSON.stringify(appearance) : '';

/**
 * Whether a settled change needs a new frame document: one that isn't the
 * document `load` is, or an appearance its document doesn't show, which
 * couldn't go to it in place.
 */
export function needsLoad(
  load: Pick<FrameLoad, 'document'>,
  shows: string,
  settled: { readonly document: string; readonly shows: string },
): boolean {
  return load.document !== settled.document || shows !== settled.shows;
}

/**
 * Sends `appearance` to the frame's document in place, when its channel is
 * open and the document doesn't show it already, and says whether it went.
 * One the protocol refuses never goes, and the settled change loads instead.
 */
export function sendInPlace(
  open: Pick<StudioChannel, 'connected' | 'send'> | null,
  appearance: ToFramePayload<'appearance'> | null,
  key: string,
  shows: string,
): boolean {
  if (!open?.connected || appearance === null || key === shows) return false;
  try {
    return open.send('appearance', appearance);
  } catch {
    return false;
  }
}

/**
 * A Compare grid plate's motion in place: `full` while it holds the heavy slot, and never while
 * the visitor's own reduced-motion preview (`reduced`) asks for less; else `reduced`. The
 * frame floors it again at the site's policy and the reader's own setting.
 */
export function plateMotion(heavy: boolean, reduced: boolean): ToFramePayload<'motion'>['motion'] {
  return heavy && !reduced ? 'full' : 'reduced';
}

/**
 * Sends `motion` to the frame's document in place, when its channel is open and it isn't the
 * motion sent last (`sent`), and returns the motion the document now shows by message, or
 * `sent` when nothing went. One the protocol refuses never goes.
 */
export function sendMotion(
  open: Pick<StudioChannel, 'connected' | 'send'> | null,
  motion: ToFramePayload<'motion'>['motion'] | null,
  sent: ToFramePayload<'motion'>['motion'] | null,
): ToFramePayload<'motion'>['motion'] | null {
  if (!open?.connected || motion === null || motion === sent) return sent;
  try {
    return open.send('motion', { motion }) ? motion : sent;
  } catch {
    return sent;
  }
}

export function DemoFrame({
  src: latestSrc,
  document: latestDocument,
  appearance = null,
  motion = null,
  title,
  viewport,
  gate = 'visible',
  requested: given,
  onRequest,
  onAnnounce,
  fit = 'width',
  onScale,
  twin = false,
}: DemoFrameProps) {
  const stage = useRef<HTMLDivElement | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const channel = useRef<StudioChannel | null>(null);
  const [scale, setScale] = useState(1);
  // Which load's document has loaded, by its id.
  const [loaded, setLoaded] = useState<number | null>(null);
  // The load a double-buffered stage keeps on screen under the latest, until the latest has
  // loaded and painted (underNext()).
  const [under, setUnder] = useState<FrameLoad | null>(null);
  // Whether the frame's document holds an open channel, so a change goes to it in place.
  const [connected, setConnected] = useState(false);
  // Whether the stage may load a document yet: once it may, it never waits again.
  const [own, setOwn] = useState(false);
  const requested = given ?? own;
  const documentKey = latestDocument ?? latestSrc;
  const shown = appearanceKey(appearance);
  // A run of changes loads once: the source, its document, and its appearance, settled together.
  const [settledSrc, settledDocument, settledShows] = JSON.parse(
    useSettled(JSON.stringify([latestSrc, documentKey, shown])),
  ) as [string, string, string];
  // The document the frame has, and what it was loaded for.
  const [load, setLoad] = useState(() => frameLoad(settledSrc, settledDocument, settledShows));
  // The appearance the frame's document shows: what it loaded with, or what went to it in place since.
  const shows = useRef(load.shows);
  // What a document that says ready gets: the latest appearance, when it's for this document.
  const latest = useRef({ documentKey, appearance, shown, motion });
  useEffect(() => {
    latest.current = { documentKey, appearance, shown, motion };
  }, [documentKey, appearance, shown, motion]);
  // The motion the frame's document was last sent in place, or null: none since it loaded.
  const moved = useRef<ToFramePayload<'motion'>['motion'] | null>(null);
  const src = load.src;
  const allowed = isDemoFrameSource(src);
  // Whether the visitor asked here, so the stage takes focus and its load is announced.
  const [asked, setAsked] = useState(false);
  const waiting = gate === 'asked' && !requested;

  // A settled change the document can't show loads a new one, over the one on screen when the
  // stage is double-buffered.
  useEffect(() => {
    const settled = { document: settledDocument, shows: settledShows };
    if (!needsLoad(load, shows.current, settled)) return;
    shows.current = settledShows;
    const mounted = requested && allowed;
    setUnder((kept) => underNext({ twin, current: load, mounted, loaded, under: kept }));
    setLoad(frameLoad(settledSrc, settledDocument, settledShows));
  }, [load, settledSrc, settledDocument, settledShows, twin, requested, allowed, loaded]);

  // The channel to each frame document that takes a nonce, open as it starts to load.
  useEffect(() => {
    const iframe = frame.current;
    if (!iframe || load.nonce === null || waiting || !allowed) return;
    const open = openStudioChannel({
      iframe,
      nonce: load.nonce,
      on: {
        connection: setConnected,
        // A document that loaded while the selection moved on catches up at once.
        ready: () => {
          const now = latest.current;
          if (now.documentKey !== load.document) return;
          if (sendInPlace(open, now.appearance, now.shown, shows.current))
            shows.current = now.shown;
          // A new document shows its src's motion: it takes the latest at once.
          moved.current = sendMotion(open, now.motion, null);
        },
      },
    });
    channel.current = open;
    return () => {
      open.close();
      if (channel.current === open) channel.current = null;
      setConnected(false);
    };
  }, [load, waiting, allowed]);

  // Each new appearance goes in place at once, to a document that is the selection's own.
  useEffect(() => {
    if (documentKey !== load.document) return;
    if (sendInPlace(channel.current, appearance, shown, shows.current)) shows.current = shown;
  }, [documentKey, appearance, shown, load]);

  // Each new motion goes in place at once, with no load, to a document that is the selection's own.
  useEffect(() => {
    if (documentKey !== load.document) return;
    moved.current = sendMotion(channel.current, motion, moved.current);
  }, [documentKey, motion, load, connected]);

  // Fit: the frame scales down to the room it has, its layout width the viewport's.
  // Filled, at a phone's width, it fits across and its viewport's height follows the room's.
  const fill = fit === 'fill';
  const contain = fit === 'contain' || fill;
  const [fillHeight, setFillHeight] = useState<number | null>(null);
  const area = fill && fillHeight ? { ...viewport, height: fillHeight } : viewport;
  useEffect(() => {
    const surface = stage.current;
    const room = contain
      ? (surface?.closest<HTMLElement>('[data-fit-room]') ?? surface?.parentElement)
      : surface;
    if (!surface || !room) return;
    const resize = () => {
      if (fill) {
        const fitted = fillWithin(innerSize(room).width, innerSize(room).height, viewport);
        setScale(fitted.scale);
        setFillHeight(fitted.height);
        return;
      }
      setFillHeight(null);
      setScale(
        contain
          ? fitWithin(innerSize(room).width, innerSize(room).height, viewport)
          : fitScale(surface.clientWidth, viewport),
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(room);
    return () => observer.disconnect();
  }, [viewport, waiting, contain, fill]);
  useEffect(() => {
    onScale?.(scale);
  }, [scale, onScale]);

  // The visible gate: the first document loads once the stage comes near the window.
  useEffect(() => {
    const surface = stage.current;
    if (requested || gate !== 'visible' || !surface) return;
    return whenOnScreen(surface, () => {
      setOwn(true);
      onRequest?.();
    });
  }, [requested, gate, allowed, onRequest]);

  // The latest document is on screen once it has loaded and the page has drawn two frames since:
  // the first commits it visible, the second paints it. Only then does a double-buffered stage
  // let the one under it go.
  const painted = requested && loaded === load.id;
  const leaving = twin && requested ? under : null;
  // Pending once the next document has loaded for PENDING_MS under the one on screen, by the
  // kept load's id, so a pick that replaces the next one mid-load keeps the mark up.
  const swapping = leaving?.id ?? null;
  const [pendingFor, setPendingFor] = useState<number | null>(null);
  useEffect(() => {
    if (swapping === null) return;
    const timer = setTimeout(() => setPendingFor(swapping), PENDING_MS);
    return () => clearTimeout(timer);
  }, [swapping]);
  const pending = swapping !== null && pendingFor === swapping;
  useEffect(() => {
    if (!painted || under === null) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setUnder(null));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [painted, under]);

  // Asked for, the stage takes the focus the button had, as the button goes with the poster.
  useEffect(() => {
    // Without a scroll: the stage's room clips, and the bar over the frame stays in view.
    if (asked) stage.current?.focus({ preventScroll: true });
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
          onClick={() =>
            askForPreview({
              request: () => {
                setOwn(true);
                onRequest?.();
              },
              focus: () => setAsked(true),
              ...(onAnnounce ? { announce: onAnnounce } : {}),
            })
          }
        >
          {ASK_LABEL}
        </button>
      </div>
    );
  }
  const ready = painted;
  const frameStyle = {
    inlineSize: `${viewport.width}px`,
    blockSize: `${area.height}px`,
    transform: `scale(${scale})`,
  };
  const stageElement = (
    <div
      ref={stage}
      className="preview-surface__stage"
      data-phase={ready ? 'ready' : 'loading'}
      aria-busy={ready ? undefined : true}
      // Named and focusable where a visitor asks for it, so focus has somewhere to go.
      {...(gate === 'asked' ? { role: 'group', 'aria-label': title, tabIndex: -1 } : {})}
      style={{
        blockSize: `${Math.ceil(area.height * scale)}px`,
        ...(contain ? { inlineSize: `${Math.ceil(viewport.width * scale)}px` } : {}),
      }}
      // Open while the document takes changes in place, for the specs and the walkthrough to wait on.
      data-channel={connected ? 'open' : 'closed'}
    >
      {leaving !== null ? (
        <iframe
          // The document on screen, kept under the next one until that one has painted: the same
          // element it was, so it doesn't load again, and it takes no pointer, Tab, or reader.
          key={leaving.id}
          className="preview-surface__frame demo-frame__leaving"
          data-twin={'leaving' satisfies TwinRole}
          title={title}
          src={leaving.src}
          sandbox={DEMO_FRAME_SANDBOX}
          referrerPolicy={FRAME_ATTRIBUTES.referrerPolicy}
          allow={FRAME_ATTRIBUTES.allow}
          aria-hidden="true"
          tabIndex={-1}
          inert
          style={frameStyle}
        />
      ) : null}
      <iframe
        // A new element, so a new browsing context and document, for each load, with its own nonce.
        key={load.id}
        ref={frame}
        className="preview-surface__frame"
        {...(leaving !== null ? { 'data-twin': 'incoming' satisfies TwinRole } : {})}
        title={title}
        // No source until the gate lets the stage load: then this one, and each after it.
        src={stageSource(src, requested)}
        sandbox={DEMO_FRAME_SANDBOX}
        referrerPolicy={FRAME_ATTRIBUTES.referrerPolicy}
        allow={FRAME_ATTRIBUTES.allow}
        // A frame with no source loads about:blank, which isn't the document.
        onLoad={() => {
          if (!requested) return;
          setLoaded(load.id);
          if (asked && loaded === null) onAnnounce?.(LOADED_TEXT);
        }}
        style={{
          ...frameStyle,
          // Over the one it replaces, which sits at the stage's start, while there is one.
          ...(leaving !== null ? { position: 'relative' as const } : {}),
          visibility: ready ? 'visible' : 'hidden',
        }}
      />
      {pending ? <SwapMark /> : null}
    </div>
  );
  if (!twin) return stageElement;
  return (
    <>
      {stageElement}
      <SwapPending shown={pending} />
    </>
  );
}

/**
 * What Show preview does: lets the stage load, moves focus to it once it's
 * there, and says in the page's status that the preview is loading.
 */
export function askForPreview({
  request,
  focus,
  announce,
}: {
  readonly request: () => void;
  readonly focus: () => void;
  readonly announce?: (text: string) => void;
}): void {
  request();
  focus();
  announce?.(LOADING_TEXT);
}

/** The frame's `src`: none until the stage may load, then the source it shows. */
export function stageSource(src: string, requested: boolean): string | undefined {
  return requested ? src : undefined;
}
