'use client';

import { Canvas, type CanvasProps } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { useState, type ReactNode } from 'react';
import { useMotionPreference } from '../motion';
import type { MotionPreference } from '@portfolio/schema';

interface SpatialCanvasProps extends Omit<CanvasProps, 'children'> {
  motionPreference?: MotionPreference;
  children: ReactNode;
  /** Maximum DPR. Lower = better mobile perf. */
  maxDpr?: number;
  /** Minimum DPR (used when PerformanceMonitor reports decline). */
  minDpr?: number;
}

/**
 * Wraps R3F's Canvas with sensible defaults for spatial variants:
 *   - Performance-adaptive DPR via drei PerformanceMonitor
 *   - Reduced motion: pauses the frameloop ('demand'), skipping all useFrame loops
 *   - Sensible camera defaults (perspective, fov 50)
 *   - Black clear color to prevent flash on hydration
 */
export function SpatialCanvas({
  motionPreference = 'respect-os',
  children,
  maxDpr = 1.5,
  minDpr = 0.7,
  ...rest
}: SpatialCanvasProps) {
  const motion = useMotionPreference(motionPreference);
  const [dpr, setDpr] = useState<[number, number]>([minDpr, maxDpr]);

  return (
    <Canvas
      frameloop={motion === 'reduce' ? 'demand' : 'always'}
      dpr={dpr}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 5], fov: 50 }}
      {...rest}
    >
      <PerformanceMonitor
        onIncline={() => setDpr([minDpr, maxDpr])}
        onDecline={() => setDpr([minDpr, Math.max(minDpr, maxDpr * 0.7)])}
        flipflops={3}
      />
      {children}
    </Canvas>
  );
}
