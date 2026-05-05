'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { useMotionPreference } from '../motion';
import type { MotionPreference } from '@portfolio/schema';

interface ParticleField2DProps {
  motionPreference?: MotionPreference;
  /** Density factor — multiplied by area to get particle count. */
  density?: number;
  /** Hard upper cap on particles (mobile safety). */
  maxParticles?: number;
  /** Particle radius (px). */
  particleSize?: number;
  /** Particle color (CSS color). */
  particleColor?: string;
  /** Connection line color (CSS color). */
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
 * on mobile. Reduced-motion: renders one static frame, no animation.
 */
export function ParticleField2D({
  motionPreference = 'respect-os',
  density = 0.00012,
  maxParticles = 160,
  particleSize = 1.4,
  particleColor = 'rgba(168, 218, 220, 0.85)',
  lineColor = 'rgba(168, 218, 220, 0.18)',
  connectDistance = 140,
  cursorRadius = 220,
  cursorStrength = 0.06,
  zIndex = 0,
  style,
}: ParticleField2DProps) {
  const motion = useMotionPreference(motionPreference);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    let raf = 0;

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

    function step() {
      ctx!.clearRect(0, 0, width, height);

      for (const p of particles) {
        // Cursor pull
        if (motion === 'full') {
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

      // Lines
      ctx!.strokeStyle = lineColor;
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
      ctx!.fillStyle = particleColor;
      for (const p of particles) {
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, particleSize, 0, Math.PI * 2);
        ctx!.fill();
      }

      if (motion === 'full') raf = requestAnimationFrame(step);
    }

    function onMove(e: PointerEvent) {
      mouseX = e.clientX;
      mouseY = e.clientY;
    }

    function onLeave() {
      mouseX = -9999;
      mouseY = -9999;
    }

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);
    step();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, [
    motion,
    density,
    maxParticles,
    particleSize,
    particleColor,
    lineColor,
    connectDistance,
    cursorRadius,
    cursorStrength,
  ]);

  return (
    <canvas
      ref={canvasRef}
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
