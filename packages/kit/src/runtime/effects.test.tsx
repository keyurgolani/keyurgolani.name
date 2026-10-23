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
  }
});

test('the counter and the cursor render as the server can know them', () => {
  // The ramp starts from 0 once the runtime runs; its label always says the value.
  const counter = renderToStaticMarkup(<AnimatedCounter end={42} suffix="+" />);
  assert.match(counter, /aria-label="42\+"/);
  assert.match(counter, />0\+</);
  // The server can't see a pointer, and the runtime is static there.
  assert.equal(renderToStaticMarkup(<MagneticCursor />), '');
});
