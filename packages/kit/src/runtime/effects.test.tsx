// The kit's effects on the runtime (#6, items 6 and 7), as the server
// renders them: the runtime is static there, so nothing animates, and what
// shows is what the page reads as without JavaScript.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { catalogPacks, packPackages, REDUCED_MOTION } from '@portfolio/appearance/node';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnimatedCounter } from '../animated-counter';
import { MotionPolicyProvider } from '../motion';
import {
  AuroraGradient,
  HolographicPanel,
  MagneticCursor,
  ScanlineOverlay,
  SpotlightMask,
} from '../spatial';
import { hidesSystemCursor } from '../spatial/magnetic-cursor';
import { nextDpr, startingDpr, type SpatialCanvasProps } from '../spatial-r3f/spatial-canvas';
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

test("the holographic panel's glass is the design language's backdrop blur unless a caller gives one (#19, Slice 5)", () => {
  const glass = (html: string) => /backdrop-filter:([^;"]*)/.exec(html)?.[1];
  assert.equal(
    glass(renderToStaticMarkup(<HolographicPanel>x</HolographicPanel>)),
    'blur(var(--ui-backdrop-blur)) saturate(140%)',
  );
  assert.equal(
    glass(renderToStaticMarkup(<HolographicPanel blur={6}>x</HolographicPanel>)),
    'blur(6px) saturate(140%)',
  );
});

test('the typing animation shows its first text whole on the server, under any policy', () => {
  for (const policy of ['respect-os', 'reduce'] as const) {
    const html = renderToStaticMarkup(
      <MotionPolicyProvider policy={policy}>
        <TypingAnimation texts={['Builds things', 'Writes things']} />
      </MotionPolicyProvider>,
    );
    // The animated text is hidden from assistive technology, which reads every text once instead.
    assert.match(html, /<span aria-hidden="true">Builds things<\/span>/);
    assert.match(
      html,
      /<span style="[^"]*clip-path:inset\(50%\)[^"]*">Builds things and Writes things<\/span>/,
    );
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

test("a SpatialCanvas's frames are its caller's runtime's, never a prop", () => {
  const props: SpatialCanvasProps = {
    state: 'paused',
    onFailure: () => {},
    children: null,
    // @ts-expect-error frameloop isn't a SpatialCanvas prop: the runtime's state decides.
    frameloop: 'always',
  };
  assert.ok(props);
});

test("a SpatialCanvas's pixel ratio starts at the device's, capped, and only ever steps down", () => {
  assert.equal(startingDpr(3, 1.5, 0.75), 1.5);
  assert.equal(startingDpr(1, 1.5, 0.75), 1);
  assert.equal(startingDpr(0.5, 1.5, 0.75), 0.75);
  assert.equal(startingDpr(Number.NaN, 1.5, 0.75), 1);
  // Slow frames step it down, to the floor and no further; fast ones never raise it.
  assert.equal(nextDpr(1.5, 60, 33, 0.75), 1.25);
  assert.equal(nextDpr(0.75, 60, 33, 0.75), 0.75);
  assert.equal(nextDpr(1, 10, 33, 0.75), 1);
});

test('the SpatialCanvas asks for no high-performance GPU and never renders on its own', () => {
  const source = readFileSync(
    new URL('../spatial-r3f/spatial-canvas.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /high-performance'/);
  assert.match(source, /powerPreference: 'low-power'/);
  assert.match(source, /frameloop: 'never'/);
  assert.doesNotMatch(source, /frameloop: '(?:always|demand)'/);
  // No CDN-backed helper, and none of the reads the scope rules out.
  assert.doesNotMatch(source, /@react-three\/drei|userAgent|WEBGL_debug_renderer_info|getBattery/);
});

test('the custom cursor hides the system pointer only while it runs', () => {
  assert.equal(hidesSystemCursor('active', false, true), true);
  // Paused or static, the visitor keeps a pointer they can see.
  assert.equal(hidesSystemCursor('paused', false, true), false);
  assert.equal(hidesSystemCursor('static', false, true), false);
  assert.equal(hidesSystemCursor('active', true, true), false);
  assert.equal(hidesSystemCursor('active', false, false), false);
});

test("under reduced motion the spotlight mask's fade runs at the language's fast duration, in every registered language (#11)", () => {
  const html = renderToStaticMarkup(<SpotlightMask />);
  const transition = /transition:([^;"]*)/.exec(html)?.[1]?.trim();
  assert.equal(transition, 'opacity var(--ui-motion-standard) var(--ui-motion-easing)');
  const duration = transition!.split(' ')[1]!;
  const resolve = (value: string, tokens: Readonly<Record<string, string>>) => {
    let resolved = value;
    for (let depth = 0; depth < 8 && /var\(--ui-/.test(resolved); depth++) {
      resolved = resolved.replace(/var\((--ui-[a-z0-9-]+)\)/g, (_, name: string) => tokens[name]!);
    }
    return resolved;
  };
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const languages = catalogPacks(root, packPackages(root)).filter(
    ({ axis }) => axis === 'designLanguage',
  );
  assert.ok(languages.length >= 30, `${languages.length} languages`);
  for (const pack of languages) {
    const own = (pack.manifest as { tokens: Record<string, string> }).tokens;
    const language = Object.fromEntries(
      Object.entries(own).map(([key, value]) => [`--ui-${key}`, value]),
    );
    assert.equal(
      resolve(duration, { ...language, ...REDUCED_MOTION }),
      own['motion-fast'],
      pack.id,
    );
  }
});
