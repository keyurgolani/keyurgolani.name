'use client';

import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Action } from '@portfolio/appearance/primitives';
import { useBoundary } from '@portfolio/appearance/react';
import {
  PREVIEW_LIFECYCLE_EVENT,
  previewLifecycle,
  type RuntimeState,
} from '@portfolio/kit/runtime';
import type { SpatialFailure } from '@portfolio/kit/spatial-canvas';
import { decideStage, type StageReason } from './policy';
import { Runtime } from './runtime';

// The stage's slot (#16): the still, and on a device the policy lets run
// it, the spatial stage over it, with the visitor's exit beside it.
//
// - The exit is always there, on the server, in a plate, and in every
//   state, so the page's controls are the same whatever the device and
//   whether the stage runs: pressed while the stage runs, enabled while it
//   runs or could, and aria-disabled while it can't, so a stage that fails
//   while the exit has focus leaves the focus where it was.
// - A plate renders the still alone, before any runtime hook: no
//   subscription, observer, listener, or attribute of the runtime's.
// - The stage's module, with three.js, loads only once the policy says it
//   runs, so nothing of it is on the static path: the slot mounts the
//   stage it's given, stage.tsx's lazily loaded one, and imports none.
// - Any failure, its import rejected, no context, a lost context, a shader
//   that doesn't compile, a throw, or no first frame, tears the stage down
//   and leaves the still, the page's reading order and actions as they
//   were, since the canvas is decoration inside the still, hidden from
//   assistive technology. The runtime then stays static for the page.
// - One stage a document: the first slot to mount claims it.
// - A preview's messages only turn it off. Once the boundary's
//   `data-enhancement` is `off`, or, in a framed document, once its
//   contrast is `more`, its display mode `high-contrast`, or its motion
//   `reduced` or `static`, the stage stays off for the rest of the page,
//   whatever a later message sets.
// - In a framed document it waits for #7's lifecycle: none heard yet is
//   inactive, and a lifecycle pause unmounts the stage.
// - Under 768px wide, as a resize can make it, the stage unmounts.
// - It reads no storage, so a sandboxed preview frame, which blocks it,
//   changes nothing.

/** What the slot tells the stage it mounts. */
export interface StageCanvasProps {
  readonly state: RuntimeState;
  /** The render's seed, `input.env.seed`, so the field is the same on every load. */
  readonly seed: number;
  readonly onFailure: (failure: SpatialFailure, error?: unknown) => void;
  readonly onFirstFrame: () => void;
}

/**
 * The stage the slot mounts: stage.tsx's lazily loaded one on the page, and
 * the stage module's own StageCanvas when that module is what loaded, so
 * this module never imports the stage's, and the stage's can import it.
 */
export type StageCanvasComponent = ComponentType<StageCanvasProps>;

/** The exit's name, the same wherever it renders. */
const EXIT_LABEL = 'Spatial stage';

/** Why a disabled exit is disabled: its description, whatever the reason. */
const EXIT_UNAVAILABLE = "The 3D stage isn't available here.";

/**
 * The exit: a toggle, pressed while the stage runs. While the stage can't
 * run it's aria-disabled, so it keeps focus and its place in the tab order
 * and a press does nothing, and described by a line saying so, hidden as
 * the navigation's name is, so it shows nothing and moves nothing but is
 * read with the control. data-offered marks it while the stage runs or
 * could; the stylesheet hides it narrower than 768px only without that.
 */
function Exit({
  idPrefix,
  offered,
  pressed,
  onToggle,
}: {
  readonly idPrefix: string;
  readonly offered: boolean;
  readonly pressed: boolean;
  readonly onToggle?: () => void;
}) {
  const note = `${idPrefix}sb--stage-unavailable`;
  return (
    <span className="sb-stage__exit" data-offered={offered ? '' : undefined}>
      <Action
        pressed={pressed}
        disabled={!offered}
        keepsFocus
        describedBy={offered ? undefined : note}
        onClick={onToggle}
      >
        {EXIT_LABEL}
      </Action>
      {offered ? null : (
        <span id={note} hidden>
          {EXIT_UNAVAILABLE}
        </span>
      )}
    </span>
  );
}

/** The planes the still draws, back to front. */
const PLANES = ['far', 'middle', 'near', 'signature'] as const;

/** The still of the stage: decoration, with no word, link, or control. */
function Still({ children, drawn }: { readonly children?: ReactNode; readonly drawn?: boolean }) {
  return (
    <div className="sb-still" aria-hidden="true" data-stage={drawn ? 'live' : undefined}>
      {PLANES.map((plane) => (
        <span key={plane} className={`sb-still__plane sb-still__plane--${plane}`} />
      ))}
      {children}
    </div>
  );
}

/** Catches the stage's import rejected, or anything it throws as it renders. */
class StageBoundary extends Component<
  { readonly onError: (error: unknown) => void; readonly children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

// The document's one stage, its owner's listeners, and whether this page's failed already.
let owner: object | null = null;
const owners = new Set<() => void>();
let pageFailed = false;

function subscribeOwner(change: () => void): () => void {
  owners.add(change);
  return () => owners.delete(change);
}

function setOwner(next: object | null): void {
  owner = next;
  for (const change of owners) change();
}

/** The width the stage needs, the same as its runtime requirement `min-width:768`. */
const WIDE = '(min-width: 768px)';

/** Whether this document is in a frame. A top window another origin hides counts as one. */
function framed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** #7's last lifecycle here, as the kit runtime reads it: none yet, visible and focused, or anything else. */
function lifecycle(): 'none' | 'active' | 'inactive' {
  const last = previewLifecycle();
  if (!last) return 'none';
  return last.state === 'visible' && last.focused ? 'active' : 'inactive';
}

// A preview's off signals, latched for the page: once any is seen, the stage stays off.
let previewLatched = false;

/** Whether a preview has turned the stage off, now or before, on this page. */
function previewOff(boundary: Element | null, inFrame: boolean): boolean {
  const attribute = (name: string) => boundary?.getAttribute(name) ?? null;
  const motion = attribute('data-motion');
  if (
    attribute('data-enhancement') === 'off' ||
    (inFrame &&
      (attribute('data-contrast') === 'more' ||
        attribute('data-display-mode') === 'high-contrast' ||
        motion === 'reduced' ||
        motion === 'static'))
  ) {
    previewLatched = true;
  }
  return previewLatched;
}

/** What the page and the browser say, read live, as one string so a snapshot that hasn't changed compares equal. */
function readSignals(): string {
  if (typeof document === 'undefined') return '';
  const boundary = document.querySelector('[data-appearance-boundary]');
  const media = (query: string) => typeof matchMedia === 'function' && matchMedia(query).matches;
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  const inFrame = framed();
  return JSON.stringify({
    forcedColors: media('(forced-colors: active)'),
    moreContrast:
      media('(prefers-contrast: more)') || boundary?.getAttribute('data-contrast') === 'more',
    highContrast: boundary?.getAttribute('data-display-mode') === 'high-contrast',
    enhancement: previewOff(boundary, inFrame) ? 'off' : 'on',
    wide: media(WIDE),
    framed: inFrame,
    lifecycle: inFrame ? lifecycle() : 'none',
    deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    saveData: nav.connection?.saveData === true,
  });
}

const QUERIES = ['(forced-colors: active)', '(prefers-contrast: more)', WIDE] as const;

function subscribeSignals(change: () => void): () => void {
  const lists = QUERIES.map((query) => matchMedia(query));
  for (const list of lists) list.addEventListener('change', change);
  window.addEventListener(PREVIEW_LIFECYCLE_EVENT, change);
  const boundary = document.querySelector('[data-appearance-boundary]');
  const observer = boundary ? new MutationObserver(change) : null;
  observer?.observe(boundary!, {
    attributes: true,
    attributeFilter: ['data-contrast', 'data-display-mode', 'data-enhancement', 'data-motion'],
  });
  return () => {
    for (const list of lists) list.removeEventListener('change', change);
    window.removeEventListener(PREVIEW_LIFECYCLE_EVENT, change);
    observer?.disconnect();
  };
}

/** The slot on its runtime: the only path that calls the hook, observes, or listens. */
function LiveSlot({
  seed,
  idPrefix,
  Canvas,
}: {
  readonly seed: number;
  readonly idPrefix: string;
  readonly Canvas: StageCanvasComponent;
}) {
  const runtime = Runtime.useEnhancementRuntime({ requires: ['webgl2', 'min-width:768'] });
  const { attachRoot, state, reason, eligible, fail } = runtime;
  const signals = useSyncExternalStore(subscribeSignals, readSignals, () => '');
  const [exited, setExited] = useState(false);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(pageFailed);
  const [live, setLive] = useState(false);

  // The document's one stage: the first slot to mount claims it, and gives it up as it unmounts.
  const [token] = useState(() => ({}));
  const claimed = useSyncExternalStore(
    subscribeOwner,
    () => owner === token,
    () => false,
  );
  useEffect(() => {
    if (owner === null) setOwner(token);
    return () => {
      if (owner === token) setOwner(null);
    };
  }, [token]);

  const read =
    signals === ''
      ? null
      : (JSON.parse(signals) as Omit<
          Parameters<typeof decideStage>[0],
          'state' | 'reason' | 'eligible' | 'failed' | 'exited' | 'claimed' | 'started'
        >);
  const decision =
    read === null
      ? { mount: false, offered: false, reason: 'pending' as StageReason }
      : decideStage({
          ...read,
          state,
          reason,
          eligible,
          failed,
          exited,
          claimed,
          started,
        });

  // What this render learns for the next: the stage has started once it mounts on an active
  // runtime, and a stage that unmounts is no longer drawn.
  if (!started && decision.mount && state === 'active') setStarted(true);
  if (live && !decision.mount) setLive(false);

  const onFailure = useCallback(
    (failure: SpatialFailure | 'import', error?: unknown) => {
      pageFailed = true;
      setFailed(true);
      setLive(false);
      fail();
      // Said once, for whoever reads the console: the page reads the same either way.
      console.warn(`[spatial-bento] the stage stopped (${failure}); the still stays.`, error ?? '');
    },
    [fail],
  );

  return (
    <div className="sb-stage" ref={attachRoot} data-stage-reason={decision.reason}>
      <Still drawn={live}>
        {decision.mount ? (
          <StageBoundary onError={(error) => onFailure('import', error)}>
            <Suspense fallback={null}>
              <Canvas
                state={state}
                seed={seed}
                onFailure={onFailure}
                onFirstFrame={() => setLive(true)}
              />
            </Suspense>
          </StageBoundary>
        ) : null}
      </Still>
      <Exit
        idPrefix={idPrefix}
        offered={decision.offered}
        pressed={decision.offered && !exited}
        onToggle={() => setExited((value) => !value)}
      />
    </div>
  );
}

/**
 * The stage's slot. In a plate it's the still alone, before any runtime
 * hook. Anywhere else it's the live slot, which shows the still until the
 * stage runs, and whenever it doesn't.
 */
export function Slot({
  seed,
  idPrefix,
  Canvas,
}: {
  readonly seed: number;
  /** The render's id prefix, `input.ids.prefix`, for the exit's description. */
  readonly idPrefix: string;
  readonly Canvas: StageCanvasComponent;
}) {
  const { plate } = useBoundary();
  return plate ? (
    <div className="sb-stage">
      <Still />
      <Exit idPrefix={idPrefix} offered={false} pressed={false} />
    </div>
  ) : (
    <LiveSlot seed={seed} idPrefix={idPrefix} Canvas={Canvas} />
  );
}
