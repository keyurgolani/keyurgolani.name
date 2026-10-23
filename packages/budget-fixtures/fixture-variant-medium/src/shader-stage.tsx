'use client';

import { useEffect, useRef, type ReactElement } from 'react';
import { useEnhancementRuntime, useFrameLoop } from '@portfolio/kit/runtime';

// fixture-variant-medium's stage (#6, Slice 2): one WebGL2 fragment shader,
// drawn over the still the stylesheet gives the stage, which stays when the
// browser has no WebGL2, and a mark on an infinite CSS animation. Both run
// on the kit runtime (#6, items 6 and 7): the shader through useFrameLoop,
// and the mark under the stage's root, which pauses CSS animations whenever
// the runtime isn't active.

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
  const runtime = useEnhancementRuntime({ requires: ['webgl2'] });
  const scene = useRef<{ gl: WebGL2RenderingContext; time: WebGLUniformLocation | null } | null>(
    null,
  );
  const started = useRef<number | null>(null);

  // The program, once, as soon as WebGL2 is there to draw with.
  useEffect(() => {
    const element = canvas.current;
    if (!element || !runtime.eligible || scene.current) return;
    const gl = element.getContext('webgl2');
    if (!gl) return;
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
    scene.current = { gl, time: gl.getUniformLocation(program, 'time') };
  }, [runtime.eligible]);

  // Frames only while the runtime is active: hidden, offscreen, paused by
  // the visitor or a preview, or reduced, the still shows and nothing draws.
  // Without WebGL2, nothing draws, so no loop runs at all.
  useFrameLoop({ state: runtime.eligible ? runtime.state : 'static' }, (now) => {
    const drawing = scene.current;
    // A context that never compiled ends the loop.
    if (!drawing) return false;
    started.current ??= now;
    drawing.gl.uniform1f(drawing.time, (now - started.current) / 1000);
    drawing.gl.drawArrays(drawing.gl.TRIANGLES, 0, 3);
  });

  return (
    <div className="fvm-stage" ref={runtime.rootRef} aria-hidden="true">
      <canvas
        ref={canvas}
        className="fvm-canvas"
        width={640}
        height={360}
        data-running={runtime.state === 'active' && runtime.eligible ? '' : undefined}
      />
      <span className="fvm-pulse" />
    </div>
  );
}
