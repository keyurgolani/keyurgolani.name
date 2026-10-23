// The kit's effects on the runtime (#6, items 6 and 7), as the server
// renders them: the runtime is static there, so nothing animates, and what
// shows is what the page reads as without JavaScript.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnimatedCounter } from '../animated-counter';
import { MotionPolicyProvider } from '../motion';
import { AuroraGradient, MagneticCursor, ScanlineOverlay } from '../spatial';
import { hidesSystemCursor } from '../spatial/magnetic-cursor';
import type { SpatialCanvasProps } from '../spatial-r3f/spatial-canvas';
import { TypingAnimation } from '../typing-animation';

// The kit compiles JSX with `preserve`, so tsx gives the components the classic runtime.
Object.assign(globalThis, { React });

test('the CSS effects carry no animation on the server', () => {
  for (const html of [
    renderToStaticMarkup(<AuroraGradient />),
    renderToStaticMarkup(<ScanlineOverlay />),
  ]) {
    assert.doesNotMatch(html, /animation:/);
    // The keyframes ship, for once the runtime runs.
    assert.match(html, /@keyframes/);
  }
});

test('the typing animation shows its first text whole on the server, under any policy', () => {
  for (const policy of ['respect-os', 'reduce'] as const) {
    const html = renderToStaticMarkup(
      <MotionPolicyProvider policy={policy}>
        <TypingAnimation texts={['Builds things', 'Writes things']} />
      </MotionPolicyProvider>,
    );
    assert.match(html, /<span>Builds things<\/span>/);
    // No live region announces it as it types, and no label of the kit's own.
    assert.doesNotMatch(html, /aria-live|role="status"|aria-label|Currently displaying/);
    assert.match(html, /<span class="kc-typing__caret" aria-hidden="true">/);
  }
});

test('the counter and the cursor render as the server can know them', () => {
  // The server shows the real value, under any policy (#14); the ramp from 0
  // shows only once the runtime runs it. Its label always says the value.
  for (const policy of ['respect-os', 'reduce'] as const) {
    const counter = renderToStaticMarkup(
      <MotionPolicyProvider policy={policy}>
        <AnimatedCounter end={42} suffix="+" />
      </MotionPolicyProvider>,
    );
    assert.match(counter, /aria-label="42\+"/);
    assert.match(counter, />42\+</);
    assert.doesNotMatch(counter, />0\+</);
  }
  // The server can't see a pointer, and the runtime is static there.
  assert.equal(renderToStaticMarkup(<MagneticCursor />), '');
});

test("a SpatialCanvas's frame loop is the runtime's, never a prop", () => {
  const props: SpatialCanvasProps = {
    children: null,
    // @ts-expect-error frameloop isn't a SpatialCanvas prop: the runtime sets it.
    frameloop: 'always',
  };
  assert.ok(props);
});

test('the custom cursor hides the system pointer only while it runs', () => {
  assert.equal(hidesSystemCursor('active', false, true), true);
  // Paused or static, the visitor keeps a pointer they can see.
  assert.equal(hidesSystemCursor('paused', false, true), false);
  assert.equal(hidesSystemCursor('static', false, true), false);
  assert.equal(hidesSystemCursor('active', true, true), false);
  assert.equal(hidesSystemCursor('active', false, false), false);
});
