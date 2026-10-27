'use client';

import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import type { MotionPolicy } from '@portfolio/schema';
import { useEnhancementRuntime, useFrameLoop } from '../runtime';
import { useBoundaryColors, withAlpha } from './boundary-colors';

const BOUNDARY_ROLES = ['accent'] as const;

interface ParticleField2DProps {
  motionPreference?: MotionPolicy;
  /** Density factor — multiplied by area to get particle count. */
  density?: number;
  /** Hard upper cap on particles (mobile safety). */
  maxParticles?: number;
  /** Particle radius (px). */
  particleSize?: number;
  /** Particle color (a CSS color a canvas takes). The boundary's accent unless given. */
  particleColor?: string;
  /** Connection line color (a CSS color a canvas takes). The boundary's accent, fainter, unless given. */
  lineColor?: string;
  /** Distance below which lines are drawn (px). */
  connectDistance?: number;
  /** Cursor pull radius. */
  cursorRadius?: number;
  /** Cursor pull strength. */
  cursorStrength?: number;
  /** z-index. */
  zIndex?: number;
  style?: CSSProperties;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * 2D canvas network of drifting particles connected by proximity-based lines.
 * Cursor exerts a soft attractive force. Pure canvas, no WebGL — affordable
 * on mobile. It runs on the kit runtime: it draws one still frame once the
 * page has mounted, and moves only while the runtime is active, so reduced
 * motion keeps the still, and a hidden document or the visitor's pause
 * holds the particles where they are.
 */
export function ParticleField2D({
  motionPreference = 'respect-os',
  density = 0.00012,
  maxParticles = 160,
  particleSize = 1.4,
  particleColor,
  lineColor,
  connectDistance = 140,
  cursorRadius = 220,
  cursorStrength = 0.06,
  zIndex = 0,
  style,
}: ParticleField2DProps) {
  const runtime = useEnhancementRuntime({ motionPolicy: motionPreference });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { attachRoot } = runtime;
  const attach = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      attachRoot(node);
    },
    [attachRoot],
  );
  // Draws a frame: moved first when `move`, else as the particles stand.
  const scene = useRef<((move: boolean) => void) | null>(null);
  // The boundary's accent, for the dots and the lines, unless given (#19, Slice 4).
  const boundary = useBoundaryColors(canvasRef, BOUNDARY_ROLES);
  const accent = boundary?.accent ?? null;
  const particle = particleColor ?? (accent ? withAlpha(accent, 0.85) : '');
  const line = lineColor ?? (accent ? withAlpha(accent, 0.18) : '');
  // What the frames draw with. A new appearance redraws the still frame;
  // while active, the next frame has it anyway. Before the scene below, so
  // its first frame has them.
  const paint = useRef({ particle: '', line: '' });
  useEffect(() => {
    paint.current = { particle, line };
    scene.current?.(false);
  }, [particle, line]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = window.innerWidth;
    let height = window.innerHeight;
    let particles: Particle[] = [];
    let mouseX = -9999;
    let mouseY = -9999;

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.scale(dpr, dpr);
      const count = Math.min(maxParticles, Math.floor(width * height * density));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
      }));
    }

    function step(move: boolean) {
      ctx!.clearRect(0, 0, width, height);

      for (const p of particles) {
        // Cursor pull
        if (move) {
          const dx = mouseX - p.x;
          const dy = mouseY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < cursorRadius && dist > 0.001) {
            const force = (cursorRadius - dist) / cursorRadius;
            p.vx += (dx / dist) * force * cursorStrength;
            p.vy += (dy / dist) * force * cursorStrength;
          }
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.96;
          p.vy *= 0.96;
          if (p.x < 0) p.x = width;
          if (p.x > width) p.x = 0;
          if (p.y < 0) p.y = height;
          if (p.y > height) p.y = 0;
        }
      }

      // Nothing draws until the boundary's colors are read.
      const { particle, line } = paint.current;
      if (particle === '' || line === '') return;

      // Lines
      ctx!.strokeStyle = line;
      ctx!.lineWidth = 0.5;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i]!;
          const b = particles[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < connectDistance) {
            const alpha = 1 - d / connectDistance;
            ctx!.globalAlpha = alpha;
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
      }
      ctx!.globalAlpha = 1;

      // Dots
      ctx!.fillStyle = particle;
      for (const p of particles) {
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, particleSize, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function onMove(e: PointerEvent) {
      mouseX = e.clientX;
      mouseY = e.clientY;
    }

    function onLeave() {
      mouseX = -9999;
      mouseY = -9999;
    }

    // A resize clears the canvas, so the still frame draws again with it.
    function onResize() {
      resize();
      step(false);
    }

    resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);
    step(false);
    scene.current = step;

    return () => {
      scene.current = null;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, [density, maxParticles, particleSize, connectDistance, cursorRadius, cursorStrength]);

  useFrameLoop(runtime, () => {
    scene.current?.(true);
  });

  return (
    <canvas
      ref={attach}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex,
        ...style,
      }}
    />
  );
}
