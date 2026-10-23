'use client';

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Float, MeshTransmissionMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { useBoundaryColors } from '../spatial/boundary-colors';
import { useSceneAnimates } from './scene-runtime';
import type { MotionPolicy } from '@portfolio/schema';

/** The boundary's accent for the core, and its primary text for the glass, unless given (#19, Slice 4). */
const GEM_ROLES = ['accent', 'text-primary'] as const;

interface TransmissionGemProps {
  motionPreference?: MotionPolicy;
  /** Geometry: 'icos' = icosahedron (default, faceted), 'sphere' = smooth. */
  geometry?: 'icos' | 'sphere';
  /** Detail level (icos subdivisions, sphere segments). */
  detail?: number;
  /** Radius. */
  radius?: number;
  /** Inner emissive core glow: a color, or null for none. The boundary's accent unless given. */
  coreGlow?: string | null;
  /** Position. */
  position?: [number, number, number];
  /** Glass tint color. The boundary's primary text color unless given. */
  color?: string;
  /** Idle rotation speed. */
  rotationSpeed?: number;
}

/**
 * Drei's MeshTransmissionMaterial wrapped in a Float for idle bobbing. The
 * gem refracts whatever's behind it (lighting, environment HDR, other
 * objects). An optional emissive inner core gives it a "lit from within"
 * feel that pairs well with bloom postprocessing.
 */
export function TransmissionGem({
  motionPreference = 'respect-os',
  geometry = 'icos',
  detail = 4,
  radius = 1.5,
  coreGlow,
  position = [0, 0, 0],
  color,
  rotationSpeed = 0.06,
}: TransmissionGemProps) {
  const groupRef = useRef<THREE.Group>(null);
  const canvas = useRef(useThree((three) => three.gl.domElement));
  const boundary = useBoundaryColors(canvas, GEM_ROLES);
  // `null` turns the core off; until the boundary's colors are read, there's none to draw.
  const glow = coreGlow === undefined ? (boundary?.accent ?? null) : coreGlow;
  const tint = color ?? boundary?.['text-primary'] ?? undefined;
  // In a SpatialCanvas, useFrame runs only while its runtime is active.
  const animate = useSceneAnimates(motionPreference);

  useFrame((_, delta) => {
    if (!animate) return;
    if (groupRef.current) {
      groupRef.current.rotation.y += rotationSpeed * delta;
      groupRef.current.rotation.x += rotationSpeed * 0.6 * delta;
    }
  });

  return (
    <Float
      speed={animate ? 1.2 : 0}
      rotationIntensity={animate ? 0.4 : 0}
      floatIntensity={animate ? 0.5 : 0}
      floatingRange={[-0.1, 0.1]}
    >
      <group ref={groupRef} position={position}>
        <mesh>
          {geometry === 'icos' ? (
            <icosahedronGeometry args={[radius, detail]} />
          ) : (
            <sphereGeometry args={[radius, detail * 8, detail * 6]} />
          )}
          <MeshTransmissionMaterial
            samples={6}
            resolution={256}
            transmission={1}
            thickness={1.6}
            ior={1.5}
            chromaticAberration={0.04}
            anisotropy={0.2}
            distortion={0.05}
            distortionScale={0.4}
            temporalDistortion={animate ? 0.06 : 0}
            roughness={0}
            {...(tint ? { color: tint } : {})}
          />
        </mesh>
        {glow ? (
          <mesh scale={radius * 0.4}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color={glow} toneMapped={false} />
          </mesh>
        ) : null}
      </group>
    </Float>
  );
}
