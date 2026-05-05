'use client';

import type { ReactNode } from 'react';
import { Html, Float } from '@react-three/drei';
import { useMotionPreference } from '../motion';
import type { MotionPreference } from '@portfolio/schema';

interface FloatingCardProps {
  children: ReactNode;
  motionPreference?: MotionPreference;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Float intensity for idle drift. */
  floatIntensity?: number;
  /** Render the HTML at this distance factor (drei param). */
  distanceFactor?: number;
  /** When true, occluding meshes hide the card. */
  occlude?: boolean;
  /** CSS class on the wrapping HTML element. */
  className?: string;
  /** Width of the HTML container (px). */
  width?: number;
}

/**
 * A piece of HTML content positioned in 3D space using drei's <Html>. Used
 * by gallery-style heavy variants to float project cards in z-depth.
 */
export function FloatingCard({
  children,
  motionPreference = 'respect-os',
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  floatIntensity = 0.4,
  distanceFactor = 4,
  occlude = false,
  className,
  width = 320,
}: FloatingCardProps) {
  const motion = useMotionPreference(motionPreference);
  const animate = motion === 'full';

  return (
    <Float
      speed={animate ? 1 : 0}
      rotationIntensity={animate ? floatIntensity * 0.5 : 0}
      floatIntensity={animate ? floatIntensity : 0}
    >
      <group position={position} rotation={rotation}>
        <Html
          transform
          distanceFactor={distanceFactor}
          occlude={occlude ? 'blending' : undefined}
          className={className}
          style={{ width, pointerEvents: 'auto' }}
        >
          {children}
        </Html>
      </group>
    </Float>
  );
}
