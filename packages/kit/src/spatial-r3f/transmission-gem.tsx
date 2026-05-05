'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Float, MeshTransmissionMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { useMotionPreference } from '../motion';
import type { MotionPreference } from '@portfolio/schema';

interface TransmissionGemProps {
  motionPreference?: MotionPreference;
  /** Geometry: 'icos' = icosahedron (default, faceted), 'sphere' = smooth. */
  geometry?: 'icos' | 'sphere';
  /** Detail level (icos subdivisions, sphere segments). */
  detail?: number;
  /** Radius. */
  radius?: number;
  /** Inner emissive core glow ('none', or hex). */
  coreGlow?: string | null;
  /** Position. */
  position?: [number, number, number];
  /** Glass tint color. */
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
  coreGlow = '#88e0ff',
  position = [0, 0, 0],
  color = '#ffffff',
  rotationSpeed = 0.06,
}: TransmissionGemProps) {
  const motion = useMotionPreference(motionPreference);
  const groupRef = useRef<THREE.Group>(null);
  const animate = motion === 'full';

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
            color={color}
          />
        </mesh>
        {coreGlow ? (
          <mesh scale={radius * 0.4}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color={coreGlow} toneMapped={false} />
          </mesh>
        ) : null}
      </group>
    </Float>
  );
}
