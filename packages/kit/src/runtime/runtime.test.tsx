import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { EnhancementIsland } from '../enhancements';
import { meetsRequirement, meetsRequirements, type CapabilityProbe } from './requirements';
import { MotionControl } from '.';
import { MotionPolicyProvider } from '../motion';
import { runtimeAnimation } from './animation';
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
  boundaryRead: true,
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
  // Mounted, it stays pending until the boundary's motion has been read, so
  // nothing runs one commit under a site's reduce it hasn't seen yet.
  assert.deepEqual(resolveRuntime({ ...RUNNING, boundaryRead: false }), PENDING);
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
    { environmentMotion: 'static' },
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

test("the site's reduce reaches the runtime as the boundary's data-motion, with no policy of the effect's own, and MotionControl given it renders nothing (#6, #19 Slice 4)", () => {
  // The document boundary renders the site's `reduce` as data-motion="reduced".
  for (const environmentMotion of ['reduced', 'static']) {
    assert.deepEqual(resolveRuntime({ ...RUNNING, policy: null, environmentMotion }), {
      state: 'static',
      reason: 'reduced',
    });
  }
  assert.equal(renderToStaticMarkup(<MotionControl policy="reduce" />), '');
  // Nothing in the kit reads the attribute the boundary no longer renders.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(here, { recursive: true })
    .map(String)
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
  assert.ok(sources.includes('use-runtime.ts'), sources.join(' '));
  for (const file of sources) {
    assert.doesNotMatch(readFileSync(path.join(here, file), 'utf8'), /data-motion-policy/, file);
  }
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

test("MotionControl renders nothing from the server's render on under a reduce policy, the site's or a provider's", () => {
  assert.equal(renderToStaticMarkup(<MotionControl policy="reduce" />), '');
  assert.equal(
    renderToStaticMarkup(
      <MotionPolicyProvider policy="reduce">
        <MotionControl />
      </MotionPolicyProvider>,
    ),
    '',
  );
  assert.notEqual(renderToStaticMarkup(<MotionControl policy="respect-os" />), '');
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
      {/* eslint-disable-next-line @next/next/no-img-element -- a server-rendered still, as a variant gives it */}
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

  const kit = fileURLToPath(new URL('..', import.meta.url));
  const own: string[] = [];
  for (const file of readdirSync(kit, { recursive: true, encoding: 'utf8' })) {
    if (!/\.(?:tsx?|css)$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
    if (file.startsWith('test-support')) continue;
    const rel = file.split(path.sep).join('/');
    own.push(...offRuntime(rel, readFileSync(path.join(kit, file), 'utf8')));
  }
  assert.deepEqual(own, []);
});

/** `source` without its comments, so a rule never fires on prose. URLs' `//` stay. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** The text of the function named `name` in `source`, from its declaration to its closing brace. */
function functionBody(source: string, name: string): string | null {
  const start = new RegExp(
    `(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[\\w$]+\\s*=>))`,
  ).exec(source);
  if (!start) return null;
  const open = source.indexOf('{', start.index);
  if (open < 0) return null;
  let depth = 0;
  for (let at = open; at < source.length; at++) {
    if (source[at] === '{') depth++;
    else if (source[at] === '}' && --depth === 0) return source.slice(open, at + 1);
  }
  return null;
}

/**
 * What in a kit file keeps motion off the runtime (#6, items 6 and 7). A
 * frame loop is useFrameLoop's alone, which runs only while its runtime is
 * active, and an inline animation is runtimeAnimation()'s alone, which
 * holds it static or paused with its runtime. Nothing else asks about
 * reduced motion, keeps an interval, reschedules itself on a timer, or
 * animates forever.
 */
function offRuntime(rel: string, source: string): string[] {
  const found: string[] = [];
  if (rel.endsWith('.css')) {
    if (/animation(?:-iteration-count)?\s*:[^;}]*\binfinite\b/.test(source)) {
      found.push(`${rel} declares an infinite animation, which no runtime can stop`);
    }
    return found;
  }
  const text = code(source);
  if (rel !== 'runtime/store.ts' && /prefers-reduced-motion/.test(text)) {
    found.push(`${rel} asks about reduced motion`);
  }
  if (/\buseReducedMotion\b/.test(text))
    found.push(`${rel} asks framer-motion about reduced motion`);
  if (rel !== 'runtime/use-frame-loop.ts' && /\brequestAnimationFrame\b/.test(text)) {
    found.push(`${rel} runs a frame loop`);
  }
  if (/\bsetInterval\b/.test(text)) found.push(`${rel} runs an interval`);
  const timers = /setTimeout\s*(?:\?\.)?\s*\(\s*(?:\(\s*\)\s*=>\s*)?([\w$]+)/g;
  for (const [, name] of text.matchAll(timers)) {
    const body = functionBody(text, name!);
    if (
      body &&
      new RegExp(`setTimeout\\s*(?:\\?\\.)?\\s*\\(\\s*(?:\\(\\s*\\)\\s*=>\\s*)?${name}\\b`).test(
        body,
      )
    ) {
      found.push(`${rel} reschedules ${name} on a timer`);
    }
  }
  if (/\.animate\s*(?:\?\.)?\s*\(/.test(text) && /\bInfinity\b/.test(text)) {
    found.push(`${rel} runs a Web Animation forever`);
  }
  if (rel !== 'runtime/animation.ts') {
    if (
      /\banimation(?:Name|Duration|TimingFunction|IterationCount|PlayState|Delay|Direction|FillMode)?\s*:/.test(
        text,
      )
    ) {
      found.push(`${rel} animates inline, off runtimeAnimation()`);
    }
    if (/\binfinite\b/.test(text)) found.push(`${rel} has an infinite animation off the runtime`);
  }
  return found;
}

test("the scan finds motion kept off the runtime in each spelling it's written in", () => {
  const offending: [string, string][] = [
    ['x.tsx', 'window.requestAnimationFrame(tick);'],
    ['x.tsx', 'globalThis.requestAnimationFrame?.(tick);'],
    ['x.tsx', 'const raf = requestAnimationFrame; raf(tick);'],
    ['x.tsx', 'const id = window.setInterval(step, 16);'],
    ['x.tsx', 'function step() { draw(); setTimeout(step, 16); }'],
    ['x.tsx', 'const step = () => { draw(); timer = setTimeout(() => step(), 16); };'],
    ['x.tsx', 'node.animate([{ opacity: 0 }], { duration: 900, iterations: Infinity });'],
    ['x.tsx', "import { useReducedMotion } from 'framer-motion';"],
    ['x.tsx', "matchMedia('(prefers-reduced-motion: reduce)')"],
    // An effect on the runtime whose animation still runs while it's paused.
    [
      'x.tsx',
      "const runtime = useEnhancementRuntime(); const style = { animation: runtime.state !== 'static' ? 'spin 2s linear infinite' : undefined };",
    ],
    ['x.tsx', "const style = { animationName: 'spin', animationIterationCount: 'infinite' };"],
    // On the runtime is no excuse: the animation itself has to follow it.
    [
      'x.tsx',
      "useEnhancementRuntime(); node.style.setProperty('animation-iteration-count', 'infinite');",
    ],
    ['styles.css', '.spin { animation: spin 2s linear infinite; }'],
    ['styles.css', '.spin { animation-iteration-count: infinite; }'],
  ];
  for (const [rel, source] of offending) {
    assert.notDeepEqual(offRuntime(rel, source), [], source);
  }
  // On the runtime, and prose about motion, it finds nothing.
  for (const [rel, source] of [
    [
      'x.tsx',
      "useFrameLoop(runtime, draw); const style = runtimeAnimation(runtime.state, { name: 'spin', seconds: 2 });",
    ],
    [
      'x.tsx',
      '// requestAnimationFrame loops and prefers-reduced-motion queries live in the runtime.',
    ],
    ['x.tsx', "const id = setTimeout(() => setPhase('pausing'), 0);"],
    ['x.tsx', "const url = 'https://example.invalid/a'; // infinite scroll"],
    ['styles.css', '.fade { animation: fade 200ms ease-out 1; }'],
  ] as const) {
    assert.deepEqual(offRuntime(rel, source), [], source);
  }
});

test('runtimeAnimation runs an animation only while its runtime is active, and holds it paused in place', () => {
  const spin = { name: 'spin', seconds: 2 };
  assert.deepEqual(runtimeAnimation('static', spin), {});
  assert.deepEqual(runtimeAnimation('active', spin), {
    animationName: 'spin',
    animationDuration: '2s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
    animationPlayState: 'running',
  });
  const paused = runtimeAnimation('paused', { ...spin, timing: 'ease-in-out' });
  assert.equal(paused.animationPlayState, 'paused');
  assert.equal(paused.animationTimingFunction, 'ease-in-out');
  // No shorthand, which would reset the play-state experience-base.css pauses.
  assert.ok(!('animation' in paused));
});
