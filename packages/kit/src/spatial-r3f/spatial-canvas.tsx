'use client';

import { Canvas, type CanvasProps } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { useCallback, useRef, useState, type ReactNode, type Ref } from 'react';
import type { MotionPolicy } from '@portfolio/schema';
import { useEnhancementRuntime } from '../runtime';
import { useBoundaryColors } from '../spatial/boundary-colors';
import { SceneRuntimeContext } from './scene-runtime';

const CANVAS_ROLES = ['canvas'] as const;

/** CanvasProps, but `frameloop`, which the runtime sets: a variant can't run frames past a pause. */
export interface SpatialCanvasProps extends Omit<CanvasProps, 'children' | 'frameloop'> {
  motionPreference?: MotionPolicy;
  children: ReactNode;
  /** Maximum DPR. Lower = better mobile perf. */
  maxDpr?: number;
  /** Minimum DPR (used when PerformanceMonitor reports decline). */
  minDpr?: number;
}

function assign<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

/**
 * Wraps R3F's Canvas with sensible defaults for spatial variants:
 *   - Performance-adaptive DPR via drei PerformanceMonitor
 *   - The kit runtime: frames render continuously only while it's active.
 *     Otherwise the frameloop is 'demand', which draws the scene once and on
 *     resize, and runs no useFrame between, so reduced motion, a hidden
 *     document, a canvas scrolled offscreen, and the visitor's pause all
 *     leave the last frame standing
 *   - Sensible camera defaults (perspective, fov 50)
 *   - The boundary's canvas color behind and as the scene's background
 *     (#19, Slice 4), so the canvas is never a color the appearance didn't
 *     pick, before the first frame or after
 */
export function SpatialCanvas({
  motionPreference = 'respect-os',
  children,
  maxDpr = 1.5,
  minDpr = 0.7,
  ref,
  ...rest
}: SpatialCanvasProps) {
  const runtime = useEnhancementRuntime({ motionPolicy: motionPreference, requires: ['webgl2'] });
  const [dpr, setDpr] = useState<[number, number]>([minDpr, maxDpr]);
  const { attachRoot } = runtime;
  const element = useRef<HTMLCanvasElement | null>(null);
  const attach = useCallback(
    (node: HTMLCanvasElement | null) => {
      element.current = node;
      attachRoot(node);
      assign(ref, node);
    },
    [attachRoot, ref],
  );
  const state = runtime.eligible ? runtime.state : 'static';
  const background = useBoundaryColors(element, CANVAS_ROLES)?.canvas ?? null;

  return (
    <Canvas
      dpr={dpr}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 5], fov: 50 }}
      {...rest}
      style={{ background: 'var(--color-canvas)', ...rest.style }}
      ref={attach}
      // After the rest, so nothing a caller passes outside the type runs frames past a pause.
      frameloop={state === 'active' ? 'always' : 'demand'}
    >
      <SceneRuntimeContext.Provider value={state}>
        {/* A new appearance changes it, and the next frame, or the demand frame it asks for, draws it. */}
        {background ? <color attach="background" args={[background]} /> : null}
        <PerformanceMonitor
          onIncline={() => setDpr([minDpr, maxDpr])}
          onDecline={() => setDpr([minDpr, Math.max(minDpr, maxDpr * 0.7)])}
          flipflops={3}
        />
        {children}
      </SceneRuntimeContext.Provider>
    </Canvas>
  );
}
