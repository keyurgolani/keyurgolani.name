'use client';

import { useEffect, useRef } from 'react';
import { useMotionPreference } from '../motion';
import type { MotionPreference } from '@portfolio/schema';

interface WavePlaneCanvasProps {
  motionPreference?: MotionPreference;
  /** Three RGB color stops [r,g,b] each 0-1. */
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
 * Reduced motion: renders one frame, no animation.
 */
export function WavePlaneCanvas({
  motionPreference = 'respect-os',
  colorA = [0.04, 0.07, 0.13],
  colorB = [0.18, 0.32, 0.55],
  colorC = [0.55, 0.7, 0.95],
  speed = 1,
  amplitude = 0.4,
  frequency = 1.4,
  zIndex = 0,
}: WavePlaneCanvasProps) {
  const motion = useMotionPreference(motionPreference);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

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
        // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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

    let raf = 0;
    const start = performance.now();

    function frame() {
      const t = ((performance.now() - start) / 1000) * speed;
      gl!.uniform1f(uTime, t);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      if (motion === 'full') raf = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener('resize', resize);
    frame();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
  }, [motion, colorA, colorB, colorC, speed, amplitude, frequency]);

  return (
    <canvas
      ref={canvasRef}
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
