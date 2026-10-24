'use client';

import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import {
  advance,
  createRoot,
  extend,
  type ReconcilerRoot,
  type RootState,
  type RootStore,
} from '@react-three/fiber';
import { useFrameLoop, type RuntimeState } from '../runtime';
import { useBoundaryColors } from '../spatial/boundary-colors';
import { SceneRuntimeContext } from './scene-runtime';

// SpatialCanvas (#16): a three.js scene on its caller's runtime, built so
// every way it can fail is seen, and torn down when one is. It owns its
// canvas and creates the renderer itself, inside a try, rather than through
// R3F's <Canvas>, which creates it in a promise nothing awaits, so a context
// that never comes would be an unhandled rejection no error boundary sees.
// Then, explicitly:
//
//   context       the renderer couldn't get a WebGL context
//   configure     R3F's root couldn't be configured on it
//   context-lost  the canvas lost its context (`webglcontextlost`)
//   shader        a program failed to compile or link
//   render        the scene threw, while rendering or in a frame
//   first-frame   the runtime was active and no frame came in time
//
// Each calls `onFailure` once, after the teardown has begun: the
// `webglcontextlost` listener comes off first, since disposing of the
// renderer and forcing its context lost both fire it, then the root
// unmounts and the renderer is disposed of.
//
// Frames: the root's frameloop is always `never`, so R3F never renders on
// its own, not even on a resize, and nothing renders while the runtime is
// paused or static. While it's active, the runtime's frame loop renders, at
// most `fps` a second. The pixel ratio starts at the device's, capped at
// `maxDpr`, and steps down to `minDpr` while frames come slower than the
// cap allows; it never goes back up past where it started. The renderer
// asks for the default, low-power GPU, never `high-performance`. A resize
// while the runtime isn't active leaves the canvas cleared, so it carries
// `data-stale` until the next frame, for the caller to show its still.

export type SpatialFailure =
  | 'context'
  | 'configure'
  | 'context-lost'
  | 'shader'
  | 'render'
  | 'first-frame';

export interface SpatialCanvasProps {
  /** The caller's runtime state: frames render only while it's active. */
  readonly state: RuntimeState;
  /** Called once, on the first failure, with what failed. The canvas has begun tearing down. */
  readonly onFailure: (failure: SpatialFailure, error?: unknown) => void;
  /** Called once, when the first frame has rendered. */
  readonly onFirstFrame?: () => void;
  /** The scene, inside the R3F root. */
  readonly children: ReactNode;
  /** The highest pixel ratio it renders at. Default 1.5. */
  readonly maxDpr?: number;
  /** The lowest it steps down to. Default 0.75. */
  readonly minDpr?: number;
  /** The most frames a second. Default 30. */
  readonly fps?: number;
  /** How long an active runtime waits for the first frame before it's a failure, in ms. Default 4000. */
  readonly firstFrameMs?: number;
  /** The camera's field of view and position. */
  readonly camera?: { readonly fov?: number; readonly position?: readonly [number, number, number] };
  /** A hook for the variant's layout. */
  readonly className?: string;
}

const CANVAS_ROLES = ['canvas'] as const;
/** How much the pixel ratio steps down at a time. */
const DPR_STEP = 0.25;
/** Frames measured before the pixel ratio may step down. */
const DPR_WINDOW = 30;

/** Catches what the scene throws while it renders, inside the R3F tree. */
class SceneBoundary extends Component<
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

/** The pixel ratio a scene starts at: the device's, capped. */
export function startingDpr(device: number, maxDpr: number, minDpr: number): number {
  return Math.max(minDpr, Math.min(maxDpr, Number.isFinite(device) && device > 0 ? device : 1));
}

/** The next pixel ratio after a window of frames: a step down while they're slow, never up. */
export function nextDpr(current: number, meanFrameMs: number, budgetMs: number, minDpr: number) {
  return meanFrameMs > budgetMs * 1.5 ? Math.max(minDpr, current - DPR_STEP) : current;
}

export function SpatialCanvas({
  state,
  onFailure,
  onFirstFrame,
  children,
  maxDpr = 1.5,
  minDpr = 0.75,
  fps = 30,
  firstFrameMs = 4000,
  camera,
  className,
}: SpatialCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const background = useBoundaryColors(canvasRef, CANVAS_ROLES)?.canvas ?? null;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // What the frame loop and the teardown share.
  const live = useRef<{
    root: ReconcilerRoot<HTMLCanvasElement>;
    store: RootStore | null;
    fail: (failure: SpatialFailure, error?: unknown) => void;
  } | null>(null);
  const latest = useRef({ onFailure, onFirstFrame, state });
  useEffect(() => {
    latest.current = { onFailure, onFirstFrame, state };
  });

  // The renderer and the root, once, for as long as the canvas is mounted.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Failed once, and torn down: a failure reports once, and the teardown runs once.
    let done = false;
    let tornDown = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
    let resize: ResizeObserver | null = null;
    const lost = (event: Event) => {
      event.preventDefault();
      fail('context-lost');
    };
    const teardown = () => {
      if (tornDown) return;
      tornDown = true;
      done = true;
      // First, since disposing of the renderer and forcing its context lost both fire it.
      canvas.removeEventListener('webglcontextlost', lost);
      resize?.disconnect();
      live.current = null;
      try {
        root?.unmount();
      } catch {
        // The root may already be gone with its context; the canvas goes regardless.
      }
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
      }
    };
    function fail(failure: SpatialFailure, error?: unknown) {
      if (done) return;
      // A shader error or a throw can come from inside a frame: tear down after it.
      queueMicrotask(teardown);
      done = true;
      setFailed(true);
      latest.current.onFailure(failure, error);
    }
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'low-power',
      });
    } catch (error) {
      done = true;
      setFailed(true);
      latest.current.onFailure('context', error);
      return;
    }
    canvas.addEventListener('webglcontextlost', lost);
    renderer.debug.checkShaderErrors = true;
    renderer.debug.onShaderError = (gl, program) => {
      fail('shader', gl.getProgramInfoLog(program));
    };
    extend(THREE as unknown as Parameters<typeof extend>[0]);
    root = createRoot(canvas);
    const measured = () => {
      const box = canvas.getBoundingClientRect();
      return { width: box.width, height: box.height, top: box.top, left: box.left };
    };
    const owned = root;
    root
      .configure({
        gl: renderer,
        size: measured(),
        dpr: startingDpr(window.devicePixelRatio, maxDpr, minDpr),
        frameloop: 'never',
        camera: { fov: camera?.fov ?? 50, position: [...(camera?.position ?? [0, 0, 6])] },
      })
      .then(
        () => {
          if (done) return;
          live.current = { root: owned, store: null, fail };
          resize = new ResizeObserver(() => {
            owned.configure({ size: measured() }).catch((error: unknown) => fail('configure', error));
            // A resize clears the canvas, and nothing renders it again until the runtime is active.
            if (latest.current.state !== 'active') canvas.setAttribute('data-stale', '');
          });
          resize.observe(canvas);
          setReady(true);
        },
        (error: unknown) => fail('configure', error),
      );
    return teardown;
    // The renderer is made once: a new pixel ratio range or camera takes a new canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The scene, and what it reads of the runtime, rendered into the root.
  useEffect(() => {
    const current = live.current;
    if (!ready || !current) return;
    current.store = current.root.render(
      <SceneBoundary onError={(error) => current.fail('render', error)}>
        <SceneRuntimeContext.Provider value={state}>
          {background ? <color attach="background" args={[background]} /> : null}
          {children}
        </SceneRuntimeContext.Provider>
      </SceneBoundary>,
    );
  }, [ready, state, background, children]);

  // No first frame in time, while the runtime is active, is a failure.
  const frames = useRef(0);
  const running = ready && !failed && state === 'active';
  useEffect(() => {
    if (!running || frames.current > 0) return;
    const timer = setTimeout(() => {
      if (frames.current === 0) live.current?.fail('first-frame');
    }, firstFrameMs);
    return () => clearTimeout(timer);
  }, [running, firstFrameMs]);

  // Frames, at most `fps` a second, only while the runtime is active.
  const pacing = useRef({ since: 0, window: 0, spent: 0 });
  useFrameLoop({ state: running ? 'active' : 'static' }, (time, delta) => {
    const current = live.current;
    const store = current?.store;
    if (!current || !store) return;
    const budget = 1000 / fps;
    const pace = pacing.current;
    pace.since += delta;
    if (frames.current > 0 && pace.since < budget) return;
    const spent = pace.since;
    pace.since = 0;
    try {
      advance(time, true, store.getState() as RootState);
    } catch (error) {
      current.fail('render', error);
      return false;
    }
    canvasRef.current?.removeAttribute('data-stale');
    frames.current += 1;
    if (frames.current === 1) latest.current.onFirstFrame?.();
    // The pixel ratio, from how long the frames took to come.
    pace.window += 1;
    pace.spent += spent;
    if (pace.window >= DPR_WINDOW) {
      const state = store.getState();
      const next = nextDpr(state.viewport.dpr, pace.spent / pace.window, budget, minDpr);
      if (next !== state.viewport.dpr) state.setDpr(next);
      pace.window = 0;
      pace.spent = 0;
    }
  });

  return failed ? null : (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      data-spatial-canvas=""
      style={{ display: 'block', inlineSize: '100%', blockSize: '100%' }}
    />
  );
}

// The boundary's colors for the scene, read once and again on an appearance
// change (#19, Slice 4), from the same subpath, so a stage imports nothing
// of the kit's other spatial effects.
export { useBoundaryColors } from '../spatial/boundary-colors';

// The scene's frame hook, so a stage animates through this subpath alone.
export { useFrame } from '@react-three/fiber';
