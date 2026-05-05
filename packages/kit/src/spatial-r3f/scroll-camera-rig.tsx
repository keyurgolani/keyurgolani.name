'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useMotionPreference } from '../motion';
import type { MotionPreference } from '@portfolio/schema';

interface ScrollCameraRigProps {
  motionPreference?: MotionPreference;
  /** Waypoints for the camera path — interpolated with Catmull-Rom. */
  positions: ReadonlyArray<[number, number, number]>;
  /** Look-at target waypoints (same length as positions). */
  lookAts?: ReadonlyArray<[number, number, number]>;
  /** Tension factor for path smoothing. */
  smoothing?: number;
}

/**
 * Drives the camera along a Catmull-Rom curve based on document scroll
 * progress. Used for "scroll IS a camera dolly" variants. Reduced motion:
 * camera locks at the first waypoint.
 */
export function ScrollCameraRig({
  motionPreference = 'respect-os',
  positions,
  lookAts,
  smoothing = 0.5,
}: ScrollCameraRigProps) {
  const motion = useMotionPreference(motionPreference);
  const { camera } = useThree();
  const progressRef = useRef(0);

  const positionCurve = useRef(
    new THREE.CatmullRomCurve3(
      positions.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      false,
      'catmullrom',
      smoothing,
    ),
  );

  const lookAtCurve = useRef(
    lookAts
      ? new THREE.CatmullRomCurve3(
          lookAts.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
          false,
          'catmullrom',
          smoothing,
        )
      : null,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (motion === 'reduce') {
      const start = positions[0];
      if (start) camera.position.set(start[0], start[1], start[2]);
      const lookStart = lookAts?.[0];
      if (lookStart) camera.lookAt(lookStart[0], lookStart[1], lookStart[2]);
      return;
    }

    function onScroll() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) {
        progressRef.current = 0;
        return;
      }
      progressRef.current = Math.max(0, Math.min(1, window.scrollY / max));
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [camera, motion, positions, lookAts]);

  useFrame(() => {
    if (motion === 'reduce') return;
    const t = progressRef.current;
    const p = positionCurve.current.getPointAt(t);
    camera.position.lerp(p, 0.08);
    if (lookAtCurve.current) {
      const target = lookAtCurve.current.getPointAt(t);
      camera.lookAt(target);
    }
  });

  return null;
}
