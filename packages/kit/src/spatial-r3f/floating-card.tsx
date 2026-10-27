'use client';

import type { ReactNode } from 'react';
import { extend } from '@react-three/fiber';
import { Html, Float } from '@react-three/drei';
import { PlaneGeometry as Plane, ShaderMaterial as Shader } from 'three';
import { useSceneAnimates } from './scene-runtime';
import type { MotionPolicy } from '@portfolio/schema';

interface FloatingCardProps {
  children: ReactNode;
  motionPreference?: MotionPolicy;
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
  // In a SpatialCanvas, Float drifts only while its runtime does.
  const animate = useSceneAnimates(motionPreference);
  // Html's blending occluder renders a plane with a shader material, which
  // SpatialCanvas's catalogue doesn't hold: registered here, where it's
  // drawn, not at import, so no bundler's tree-shaking can drop it.
  if (occlude) extend({ PlaneGeometry: Plane, ShaderMaterial: Shader });

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
