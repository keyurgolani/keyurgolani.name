'use client';

import { useMemo, useRef } from 'react';
import type { RuntimeState } from '@portfolio/kit/runtime';
import {
  SpatialCanvas,
  useBoundaryColors,
  useFrame,
  type SpatialFailure,
} from '@portfolio/kit/spatial-canvas';
import { buildScene, SCENE_ROLES, type Scene, type SceneRole } from './scene';

// The spatial stage (#16), loaded only once the policy lets it run: the
// still's planes in three dimensions, drifting a little, with a field of
// particles around them, on the kit's SpatialCanvas. Its colors are the
// boundary's, read once and again on an appearance change, and it shows
// nothing the page doesn't: the canvas is hidden from assistive technology,
// takes no pointer or key, and no word is drawn in it. This module and the
// three.js it brings are the stage's own chunk, never on the static path.

/** How far the planes drift, in radians and scene units. */
const DRIFT = { tilt: 0.04, float: 0.06 } as const;

function Planes({
  scene,
  colors,
}: {
  readonly scene: Scene;
  readonly colors: Readonly<Record<SceneRole, string | null>>;
}) {
  const group = useRef<{ rotation: { z: number }; position: { y: number } } | null>(null);
  useFrame(({ clock }) => {
    const current = group.current;
    if (!current) return;
    const t = clock.getElapsedTime();
    current.rotation.z = -0.6 + Math.sin(t * 0.25) * DRIFT.tilt;
    current.position.y = Math.sin(t * 0.4) * DRIFT.float;
  });
  return (
    <group ref={group as never} rotation={[-0.95, 0, -0.6]}>
      {scene.planes.map((plane) => (
        <mesh key={plane.name} position={[...plane.position]}>
          <boxGeometry args={[plane.size[0], plane.size[1], 0.04]} />
          <meshStandardMaterial color={colors[plane.role] ?? undefined} roughness={0.8} />
        </mesh>
      ))}
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[scene.particles, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.025}
          color={colors['text-muted'] ?? undefined}
          transparent
          opacity={0.45}
        />
      </points>
    </group>
  );
}

export interface StageCanvasProps {
  readonly state: RuntimeState;
  /** The render's seed, `input.env.seed`, so the field is the same on every load. */
  readonly seed: number;
  readonly onFailure: (failure: SpatialFailure, error?: unknown) => void;
  readonly onFirstFrame: () => void;
}

export default function StageCanvas({ state, seed, onFailure, onFirstFrame }: StageCanvasProps) {
  const frame = useRef<HTMLDivElement | null>(null);
  const colors = useBoundaryColors(frame, SCENE_ROLES);
  const scene = useMemo(() => buildScene(seed), [seed]);
  return (
    <div ref={frame} className="sb-still__canvas">
      <SpatialCanvas
        state={state}
        onFailure={onFailure}
        onFirstFrame={onFirstFrame}
        camera={{ fov: 40, position: [0, 0, 7] }}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[2, 4, 5]} intensity={1.2} />
        {colors ? <Planes scene={scene} colors={colors} /> : null}
      </SpatialCanvas>
    </div>
  );
}
