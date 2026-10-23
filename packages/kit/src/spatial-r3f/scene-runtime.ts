'use client';

// The runtime a SpatialCanvas gives the scene inside it (#6, items 6 and 7).
// The canvas runs on the kit runtime and renders frames only while it's
// active, so a useFrame below it runs only then; what a component decides
// from it is whether to animate at all, which is false while the runtime is
// static (before the page has mounted, under reduced motion, or after a
// failure). R3F's Canvas carries React context into its scene, so the
// components read it here.

import { createContext, useContext } from 'react';
import type { MotionPolicy } from '@portfolio/schema';
import { useMotionPreference } from '../motion';
import type { RuntimeState } from '../runtime';

export const SceneRuntimeContext = createContext<RuntimeState | null>(null);

/**
 * Whether a component in a scene animates: the SpatialCanvas's runtime isn't
 * static, and its own policy isn't `reduce`. Outside a SpatialCanvas, in a
 * Canvas a variant made itself, the motion preference decides alone.
 */
export function useSceneAnimates(own?: MotionPolicy): boolean {
  const canvas = useContext(SceneRuntimeContext);
  const preference = useMotionPreference(own);
  if (canvas === null) return preference === 'full';
  return canvas !== 'static' && own !== 'reduce';
}
