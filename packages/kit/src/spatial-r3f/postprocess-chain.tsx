'use client';

import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing';
import { useMotionPreference } from '../motion';
import type { MotionPreference } from '@portfolio/schema';

interface PostprocessChainProps {
  motionPreference?: MotionPreference;
  /** Bloom intensity. */
  bloomIntensity?: number;
  /** Bloom luminance threshold. Higher = only brightest highlights bloom. */
  bloomThreshold?: number;
  /** Film-grain noise opacity (0-1). */
  noise?: number;
  /** Vignette darkness (0-1). */
  vignette?: number;
}

/**
 * Standard post-process chain for spatial-aesthetic R3F variants. Bloom
 * dominates the look; noise + vignette cement the cinematic feel.
 */
export function PostprocessChain({
  motionPreference = 'respect-os',
  bloomIntensity = 1.2,
  bloomThreshold = 0.85,
  noise = 0.04,
  vignette = 0.45,
}: PostprocessChainProps) {
  const motion = useMotionPreference(motionPreference);
  // Even in reduced mode we keep the static effects (bloom, vignette) — only
  // the noise grain "shimmer" is naturally unsteady, but it animates per-frame
  // anyway in the implementation, so we leave it on.
  void motion;

  return (
    <EffectComposer>
      <Bloom
        intensity={bloomIntensity}
        luminanceThreshold={bloomThreshold}
        luminanceSmoothing={0.7}
        mipmapBlur
      />
      <Noise opacity={noise} />
      <Vignette eskil={false} offset={0.2} darkness={vignette} />
    </EffectComposer>
  );
}
