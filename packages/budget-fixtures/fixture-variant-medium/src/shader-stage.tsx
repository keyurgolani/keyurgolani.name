'use client';

import { useEffect, useRef, type ReactElement } from 'react';

// fixture-variant-medium's stage (#6, Slice 2): one WebGL2 fragment shader,
// drawn over the still the stylesheet gives the stage, which stays when the
// browser has no WebGL2. Until #6's Slice 4 moves it onto useFrameLoop, the
// loop is plain requestAnimationFrame, and it stops while the document is
// hidden or reduced motion is on, and starts again when neither holds.

const VERTEX = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform float time;
uniform vec2 size;
out vec4 shade;
void main() {
  vec2 uv = gl_FragCoord.xy / size;
  float wave = 0.5 + 0.5 * sin(uv.x * 6.0 + time) * cos(uv.y * 4.0 - time * 0.7);
  shade = vec4(vec3(wave), 1.0);
}`;

/** A compiled shader of `type`, or null when it doesn't compile. */
function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const compiled = gl.createShader(type);
  if (!compiled) return null;
  gl.shaderSource(compiled, source);
  gl.compileShader(compiled);
  return gl.getShaderParameter(compiled, gl.COMPILE_STATUS) ? compiled : null;
}

export function ShaderStage(): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const gl = element?.getContext('webgl2');
    if (!element || !gl) return;
    const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    // One triangle that covers the whole canvas.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(program, 'size'), element.width, element.height);
    const time = gl.getUniformLocation(program, 'time');

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let started: number | null = null;
    const draw = (now: number) => {
      started ??= now;
      gl.uniform1f(time, (now - started) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      frame = window.requestAnimationFrame(draw);
    };
    const update = () => {
      const run = document.visibilityState === 'visible' && !reduced.matches;
      if (run && frame === 0) {
        element.dataset.running = '';
        frame = window.requestAnimationFrame(draw);
      } else if (!run && frame !== 0) {
        window.cancelAnimationFrame(frame);
        frame = 0;
        delete element.dataset.running;
      }
    };
    update();
    document.addEventListener('visibilitychange', update);
    reduced.addEventListener('change', update);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', update);
      reduced.removeEventListener('change', update);
    };
  }, []);
  return <canvas ref={canvas} className="fvm-canvas" width={640} height={360} />;
}
