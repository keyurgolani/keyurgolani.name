'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { MotionPolicy } from '@portfolio/schema';
import { useEnhancementRuntime, useFrameLoop } from '../runtime';
import { channels, useBoundaryColors } from './boundary-colors';

type Stop = [number, number, number];

/** The boundary's canvas, accent, and signature end, the wave's stops unless given (#19, Slice 4). */
const WAVE_ROLES = ['canvas', 'accent', 'signature-end'] as const;

interface WavePlaneCanvasProps {
  motionPreference?: MotionPolicy;
  /** Three RGB color stops [r,g,b] each 0-1. The boundary's canvas, accent, and signature end unless given. */
  colorA?: [number, number, number];
  colorB?: [number, number, number];
  colorC?: [number, number, number];
  /** Animation speed (cycles per minute). */
  speed?: number;
  /** Wave amplitude (0-1). */
  amplitude?: number;
  /** Visual frequency (higher = more peaks). */
  frequency?: number;
  /** z-index. */
  zIndex?: number;
}

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_amplitude;
uniform float u_frequency;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform vec3 u_colorC;

// Pseudo-noise (good enough for atmosphere)
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(in vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = v_uv;
  uv.x *= u_resolution.x / u_resolution.y;

  // Wave displacement
  float t = u_time * 0.05;
  float wave = sin(uv.y * u_frequency * 4.0 + t) * 0.5 + 0.5;
  float n = fbm(uv * u_frequency * 2.0 + vec2(t, t * 0.5));
  float field = mix(wave, n, 0.7);
  field = pow(field, 1.4);

  // Color gradient by Y + noise
  vec3 color = mix(u_colorA, u_colorB, smoothstep(0.0, 0.6, field));
  color = mix(color, u_colorC, smoothstep(0.55, 1.0, field));

  // Subtle horizon line lightening
  float horizon = smoothstep(0.45, 0.5, uv.y) * smoothstep(0.55, 0.5, uv.y) * 0.15;
  color += vec3(horizon);

  outColor = vec4(color, 1.0);
}
`;

/**
 * Vertex-displaced wave plane drawn as a single full-screen WebGL2 fragment
 * shader. No three.js, no R3F — just a raw canvas with a custom shader.
 *
 * It runs on the kit runtime: it draws one still frame once the page has
 * mounted, and animates only while the runtime is active, so reduced motion
 * keeps the still, and a hidden document or the visitor's pause holds the
 * wave where it is. Without WebGL2 it shows a gradient and runs no loop.
 */
export function WavePlaneCanvas({
  motionPreference = 'respect-os',
  colorA,
  colorB,
  colorC,
  speed = 1,
  amplitude = 0.4,
  frequency = 1.4,
  zIndex = 0,
}: WavePlaneCanvasProps) {
  const runtime = useEnhancementRuntime({
    motionPolicy: motionPreference,
    requires: ['webgl2'],
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { attachRoot } = runtime;
  const attach = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      attachRoot(node);
    },
    [attachRoot],
  );
  // Draws the wave `elapsed` ms in, while a program is compiled.
  const scene = useRef<((elapsed: number) => void) | null>(null);
  // How far the wave has run, kept across pauses so it picks up where it stopped.
  const elapsed = useRef(0);
  // The stops, once the boundary's colors are read: a new appearance builds the scene again.
  const boundary = useBoundaryColors(canvasRef, WAVE_ROLES);
  const a = colorA ?? channels(boundary?.canvas ?? null);
  const b = colorB ?? channels(boundary?.accent ?? null);
  const c = colorC ?? channels(boundary?.['signature-end'] ?? null);
  const stops: readonly [Stop, Stop, Stop] | null = a && b && c ? [a, b, c] : null;
  const stopsKey = stops ? JSON.stringify(stops) : '';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const canvas = canvasRef.current;
    if (!canvas || stopsKey === '') return;
    const [colorA, colorB, colorC] = JSON.parse(stopsKey) as [Stop, Stop, Stop];

    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) {
      canvas.style.background = `linear-gradient(180deg, rgb(${colorA.map((c) => c * 255).join(',')}) 0%, rgb(${colorC.map((c) => c * 255).join(',')}) 100%)`;
      return;
    }

    function compile(type: number, src: string): WebGLShader | null {
      const sh = gl!.createShader(type);
      if (!sh) return null;
      gl!.shaderSource(sh, src);
      gl!.compileShader(sh);
      if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) {
        console.error('WavePlaneCanvas shader error:', gl!.getShaderInfoLog(sh));
        gl!.deleteShader(sh);
        return null;
      }
      return sh;
    }

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('WavePlaneCanvas link error:', gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    // Fullscreen triangle
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, 'u_time');
    const uRes = gl.getUniformLocation(program, 'u_resolution');
    const uAmp = gl.getUniformLocation(program, 'u_amplitude');
    const uFreq = gl.getUniformLocation(program, 'u_frequency');
    const uA = gl.getUniformLocation(program, 'u_colorA');
    const uB = gl.getUniformLocation(program, 'u_colorB');
    const uC = gl.getUniformLocation(program, 'u_colorC');

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    function resize() {
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      canvas!.width = w;
      canvas!.height = h;
      canvas!.style.width = `${window.innerWidth}px`;
      canvas!.style.height = `${window.innerHeight}px`;
      gl!.viewport(0, 0, w, h);
      gl!.uniform2f(uRes, w, h);
    }

    gl.uniform1f(uAmp, amplitude);
    gl.uniform1f(uFreq, frequency);
    gl.uniform3f(uA, colorA[0], colorA[1], colorA[2]);
    gl.uniform3f(uB, colorB[0], colorB[1], colorB[2]);
    gl.uniform3f(uC, colorC[0], colorC[1], colorC[2]);

    function frame(ms: number) {
      gl!.uniform1f(uTime, (ms / 1000) * speed);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    }

    resize();
    window.addEventListener('resize', resize);
    frame(elapsed.current);
    scene.current = frame;

    return () => {
      scene.current = null;
      window.removeEventListener('resize', resize);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
  }, [stopsKey, speed, amplitude, frequency]);

  // Without WebGL2, nothing draws, so no loop runs at all, and none runs
  // before the boundary's colors are read, when there's no scene yet.
  const ready = runtime.eligible && stopsKey !== '';
  useFrameLoop({ state: ready ? runtime.state : 'static' }, (_, delta) => {
    const draw = scene.current;
    // A program that never compiled ends the loop.
    if (!draw) return false;
    elapsed.current += delta;
    draw(elapsed.current);
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
      }}
    />
  );
}
