'use client';

/**
 * Falling code-glyph particle field — the kinetic-cosmos signature backdrop.
 *
 * Reads CSS custom properties (`--kc-glyph-rgb`, `--kc-grid-rgb`,
 * `--kc-grid-opacity`, `--kc-glyph-opacity-multiplier`) at frame time so it
 * adapts to scheme/theme changes without remounting. Reduced-motion mounts
 * a single static frame and skips the requestAnimationFrame loop.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useMotionPreference } from '@portfolio/kit';

interface Particle {
  x: number;
  y: number;
  char: string;
  speed: number;
  opacity: number;
  size: number;
}

const CODE_CHARS = [
  '{', '}', '[', ']', '(', ')', '<', '>', '/', '\\',
  ';', ':', '=', '+', '-', '*', '&', '|', '!', '?',
  '0', '1', '#', '$', '%', '@', '^', '~', '`',
  'fn', 'if', 'let', 'var', 'const', 'return', '=>', '&&', '||', '!=',
];

function readVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}
function readNum(el: HTMLElement, name: string, fallback: number): number {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function AnimatedBackground() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const particlesRef = useRef<Particle[]>([]);
  const reduceMotion = useMotionPreference() === 'reduce';

  const particleCount = useMemo(() => {
    if (typeof window === 'undefined') return 50;
    return Math.min(120, Math.floor((window.innerWidth * window.innerHeight) / 25000));
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeCanvas();

    const initParticles = () => {
      particlesRef.current = Array.from({ length: particleCount }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        char: CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]!,
        speed: 0.2 + Math.random() * 0.5,
        opacity: 0.04 + Math.random() * 0.08,
        size: 10 + Math.random() * 14,
      }));
    };
    initParticles();

    const drawFrame = () => {
      // Read variant tokens fresh each frame (cheap; getComputedStyle reads cache).
      const glyphRgb = readVar(wrapper, '--kc-glyph-rgb', '139, 92, 246');
      const gridRgb = readVar(wrapper, '--kc-grid-rgb', '139, 92, 246');
      const gridOpacity = readNum(wrapper, '--kc-grid-opacity', 0.04);
      const glyphMult = readNum(wrapper, '--kc-glyph-opacity-multiplier', 1);

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // Grid lines.
      ctx.strokeStyle = `rgba(${gridRgb}, ${gridOpacity})`;
      ctx.lineWidth = 1;
      const gridSize = 60;
      for (let x = 0; x < window.innerWidth; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, window.innerHeight);
        ctx.stroke();
      }
      for (let y = 0; y < window.innerHeight; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(window.innerWidth, y);
        ctx.stroke();
      }

      // Glyph particles.
      for (const p of particlesRef.current) {
        ctx.font = `${p.size}px "JetBrains Mono", "Fira Code", monospace`;
        ctx.fillStyle = `rgba(${glyphRgb}, ${p.opacity * glyphMult})`;
        ctx.fillText(p.char, p.x, p.y);
        if (!reduceMotion) {
          p.y -= p.speed;
          if (p.y < -20) {
            p.y = window.innerHeight + 20;
            p.x = Math.random() * window.innerWidth;
            p.char = CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]!;
          }
        }
      }
    };

    const tick = () => {
      drawFrame();
      animationRef.current = requestAnimationFrame(tick);
    };

    if (reduceMotion) {
      drawFrame();
    } else {
      tick();
    }

    window.addEventListener('resize', resizeCanvas);
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current !== undefined) cancelAnimationFrame(animationRef.current);
    };
  }, [particleCount, reduceMotion]);

  return (
    <div ref={wrapperRef} className="kc-backdrop" aria-hidden="true">
      <canvas ref={canvasRef} className="kc-backdrop__canvas" />
      <div className="kc-backdrop__glow kc-backdrop__glow--a" />
      <div className="kc-backdrop__glow kc-backdrop__glow--b" />
      <div className="kc-backdrop__glow kc-backdrop__glow--c" />
    </div>
  );
}
