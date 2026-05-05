'use client';

import type { CSSProperties } from 'react';
import { useMotionPreference } from '../motion';
import type { MotionPreference } from '@portfolio/schema';

interface AuroraGradientProps {
  motionPreference?: MotionPreference;
  /** 2-5 colors for the gradient stops. */
  colors?: string[];
  /** Animation duration (seconds). */
  speed?: number;
  /** Blend mode for stacked layers. */
  blend?: 'soft-light' | 'screen' | 'overlay' | 'normal';
  /** Opacity of the entire effect (0-1). */
  opacity?: number;
  /** Render as fixed full-viewport (default) or absolute within parent. */
  position?: 'fixed' | 'absolute';
  /** z-index. */
  zIndex?: number;
  /** Optional grain overlay opacity (0-1). 0 disables. */
  grain?: number;
}

/**
 * Animated multi-layer gradient backdrop ("aurora wash"). Pure CSS — three
 * stacked conic + radial gradients drifting with phase-offset keyframes. No
 * canvas, no shader, runs everywhere.
 *
 * Reduced motion freezes the layers in place.
 */
export function AuroraGradient({
  motionPreference = 'respect-os',
  colors = ['#0a1f3d', '#5a2a82', '#0d4f5c', '#1a0a2e'],
  speed = 28,
  blend = 'screen',
  opacity = 1,
  position = 'fixed',
  zIndex = 0,
  grain = 0.04,
}: AuroraGradientProps) {
  const motion = useMotionPreference(motionPreference);
  const animate = motion === 'full';

  const [c0, c1, c2, c3] = padColors(colors);

  const baseStyle: CSSProperties = {
    position,
    inset: 0,
    pointerEvents: 'none',
    zIndex,
    overflow: 'hidden',
    opacity,
  };

  const layerStyleA: CSSProperties = {
    position: 'absolute',
    inset: '-25%',
    background: `radial-gradient(60% 80% at 30% 30%, ${c0} 0%, transparent 60%), radial-gradient(50% 70% at 70% 70%, ${c1} 0%, transparent 65%)`,
    filter: 'blur(40px)',
    animation: animate ? `aurora-drift-a ${speed}s ease-in-out infinite` : undefined,
  };

  const layerStyleB: CSSProperties = {
    position: 'absolute',
    inset: '-20%',
    background: `radial-gradient(45% 65% at 65% 35%, ${c2} 0%, transparent 60%), radial-gradient(55% 75% at 25% 75%, ${c3} 0%, transparent 65%)`,
    filter: 'blur(60px)',
    mixBlendMode: blend,
    animation: animate ? `aurora-drift-b ${speed * 1.4}s ease-in-out infinite` : undefined,
  };

  return (
    <div style={baseStyle} aria-hidden="true">
      <div style={layerStyleA} />
      <div style={layerStyleB} />
      {grain > 0 ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: grain,
            mixBlendMode: 'overlay',
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.7'/></svg>\")",
          }}
        />
      ) : null}
      <style>{`
        @keyframes aurora-drift-a {
          0%, 100% { transform: translate3d(0,0,0) rotate(0deg); }
          50%      { transform: translate3d(3%, -2%, 0) rotate(8deg); }
        }
        @keyframes aurora-drift-b {
          0%, 100% { transform: translate3d(0,0,0) rotate(0deg); }
          50%      { transform: translate3d(-4%, 3%, 0) rotate(-10deg); }
        }
      `}</style>
    </div>
  );
}

function padColors(colors: string[]): [string, string, string, string] {
  const c0 = colors[0] ?? '#0a1f3d';
  const c1 = colors[1] ?? c0;
  const c2 = colors[2] ?? c1;
  const c3 = colors[3] ?? c2;
  return [c0, c1, c2, c3];
}
