import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { EnhancementIsland } from '../enhancements';
import { meetsRequirement, meetsRequirements, type CapabilityProbe } from './requirements';
import { MotionControl } from '.';
import { motionReduced, PENDING, resolveRuntime, type RuntimeInputs } from './state';
import { readLifecycle, SERVER_INPUTS } from './store';

// @portfolio/kit/runtime (#6, items 6 and 7). What a browser does with it,
// pausing and resuming under each input, is pnpm test:trace's to check in a
// page (tests/trace/modes.spec.ts); here are the rules, the requirement
// checks, and the server render.

Object.assign(globalThis, { React });

/** Every input as a running page has it. */
const RUNNING: RuntimeInputs = {
  mounted: true,
  osReduced: false,
  policy: 'respect-os',
  environmentMotion: null,
  documentVisible: true,
  intersecting: true,
  visitorPaused: false,
  lifecycle: null,
  failed: false,
};

test('nothing stops a mounted, visible, in-view effect that nothing reduces or pauses', () => {
  assert.deepEqual(resolveRuntime(RUNNING), { state: 'active', reason: 'running' });
});

test('the server render and the first client render are static, whatever else holds', () => {
  assert.deepEqual(resolveRuntime({ ...RUNNING, mounted: false }), PENDING);
  assert.deepEqual(PENDING, { state: 'static', reason: 'pending' });
  assert.deepEqual(SERVER_INPUTS, {
    osReduced: false,
    documentVisible: true,
    visitorPaused: false,
    lifecycle: null,
  });
});

test('reduced motion from the OS, the site policy, or a preview environment makes it static, and nothing turns it back on', () => {
  for (const reduce of [
    { osReduced: true },
    { policy: 'reduce' },
    { environmentMotion: 'reduced' },
  ] as const) {
    assert.deepEqual(resolveRuntime({ ...RUNNING, ...reduce }), {
      state: 'static',
      reason: 'reduced',
    });
    // A preview environment of `full` can't undo the OS's reduce.
    assert.equal(motionReduced({ ...RUNNING, environmentMotion: 'full', ...reduce }), true);
  }
  assert.equal(motionReduced({ ...RUNNING, environmentMotion: 'full' }), false);
});

test('a hidden document, an offscreen root, the visitor, and an unfocused or hidden preview frame each pause it', () => {
  const cases: [Partial<RuntimeInputs>, string][] = [
    [{ documentVisible: false }, 'hidden'],
    [{ intersecting: false }, 'offscreen'],
    [{ visitorPaused: true }, 'visitor'],
    [{ lifecycle: { state: 'hidden', focused: false } }, 'lifecycle'],
    [{ lifecycle: { state: 'hidden', focused: true } }, 'lifecycle'],
    [{ lifecycle: { state: 'visible', focused: false } }, 'lifecycle'],
  ];
  for (const [inputs, reason] of cases) {
    assert.deepEqual(resolveRuntime({ ...RUNNING, ...inputs }), { state: 'paused', reason });
  }
  // A visible, focused frame runs.
  assert.deepEqual(resolveRuntime({ ...RUNNING, lifecycle: { state: 'visible', focused: true } }), {
    state: 'active',
    reason: 'running',
  });
  // A failure is static for good, and reduced motion is named first.
  assert.deepEqual(resolveRuntime({ ...RUNNING, failed: true }), {
    state: 'static',
    reason: 'failed',
  });
  assert.equal(resolveRuntime({ ...RUNNING, failed: true, osReduced: true }).reason, 'reduced');
});

test('only a lifecycle as the preview agent dispatches it is read', () => {
  assert.deepEqual(readLifecycle({ state: 'visible', focused: true }), {
    state: 'visible',
    focused: true,
  });
  for (const value of [null, 'visible', { state: 'shown', focused: true }, { state: 'hidden' }]) {
    assert.equal(readLifecycle(value), null, JSON.stringify(value));
  }
});

const probe = (webgl2: boolean, matching: readonly string[]): CapabilityProbe => ({
  webgl2: () => webgl2,
  matches: (query) => matching.includes(query),
});

test("an enhancement's requires are capability checks, and one this build doesn't know fails", () => {
  const all = probe(true, ['(pointer: fine)', '(min-width: 768px)']);
  assert.equal(meetsRequirements([], probe(false, []), false), true);
  assert.equal(meetsRequirements(['webgl2', 'fine-pointer', 'min-width:768'], all, true), true);
  assert.equal(meetsRequirement('webgl2', probe(false, []), true), false);
  assert.equal(meetsRequirement('fine-pointer', probe(true, []), true), false);
  assert.equal(
    meetsRequirement('min-width:768', probe(true, ['(min-width: 1024px)']), true),
    false,
  );
  assert.equal(meetsRequirement('motion-allowed', all, true), true);
  assert.equal(meetsRequirement('motion-allowed', all, false), false);
  for (const unknown of ['webgpu', 'min-width:', 'min-width:0', 'MIN-WIDTH:768', 'chrome']) {
    assert.equal(meetsRequirement(unknown, all, true), false, unknown);
  }
});

test('MotionControl renders a toggle on #19 Action with a polite status line, running until the page knows better', () => {
  const html = renderToStaticMarkup(<MotionControl />);
  assert.match(html, /<button[^>]*aria-pressed="false"[^>]*>.*Pause motion.*<\/button>/);
  assert.match(html, /<span role="status" aria-live="polite">Motion is on\.<\/span>/);
  const own = renderToStaticMarkup(
    <MotionControl label="Hold still" status={{ running: 'Moving.' }} />,
  );
  assert.match(own, /Hold still/);
  assert.match(own, />Moving\.</);
});

test('an island renders its server markup on the server, in an element its runtime watches, and loads nothing there', () => {
  const input = {
    variant: 'kit-shared',
    capabilities: {
      enhancements: [{ id: 'orbit', export: './enhancements/orbit', requires: ['webgl2'] }],
    },
  } as unknown as VariantRenderInput;
  const html = renderToStaticMarkup(
    <EnhancementIsland input={input} id="orbit" className="slot">
      <img src="/still.png" alt="A still of the orbit" width={4} height={3} />
    </EnhancementIsland>,
  );
  // React adds an image preload of its own beside the markup.
  assert.match(
    html,
    /<div class="slot" data-enhancement-island="orbit" data-island="markup"><img src="\/still\.png" alt="A still of the orbit" width="4" height="3"\/><\/div>$/,
  );
});

test('only the runtime asks the browser about reduced motion or runs a frame loop', () => {
  // Every kit effect goes through the runtime, so none keeps a query or a loop of its own.
  const store = readFileSync(new URL('./store.ts', import.meta.url), 'utf8');
  assert.match(store, /prefers-reduced-motion: reduce/);
  const loop = readFileSync(new URL('./use-frame-loop.ts', import.meta.url), 'utf8');
  assert.match(loop, /requestAnimationFrame\(tick\)/);
});
