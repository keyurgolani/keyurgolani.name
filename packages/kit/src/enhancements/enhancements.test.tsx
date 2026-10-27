import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { registerHostModules } from '../sections';
import * as entry from '.';
import { Enhancement } from '.';
import { EnhancementBoundary, enhancementsOff, loadModule, moduleFor } from './load';

// @portfolio/kit/enhancements (#5, Slice 2). What a browser does with it,
// loading, failing, and the throw switch, is Slice 6's harness to check in a
// page; here is everything short of mounting. apps/web's
// kit-enhancements.test.ts renders it from a server component through the
// RSC renderer Next uses.

// tsx compiles the kit's JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const INPUT = {
  variant: 'kit-shared',
  capabilities: {
    renderedKinds: [],
    unsupportedKinds: [],
    views: [],
    enhancements: [{ id: 'orbit', export: './enhancements/orbit', requires: [] }],
  },
} as unknown as VariantRenderInput;

const Orbit = () => <p>orbit</p>;

test('it is a client module, the one place the kit loads package code in a browser', () => {
  const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  assert.match(source, /^'use client';\n/);
});

test('it exports components, which a server component renders, and no function to call', () => {
  // A server component can render a client module's export as an element,
  // and can't call one: Next swaps each export for a reference to it.
  assert.deepEqual(Object.keys(entry).sort(), ['Enhancement', 'EnhancementIsland']);
  for (const component of Object.values(entry)) {
    assert.equal(typeof component, 'function');
    assert.match(component.name, /^[A-Z]/);
  }
});

test('the server renders nothing, so the page never waits on or depends on an enhancement', () => {
  registerHostModules({
    enhancementLoaders: { 'kit-shared/orbit': async () => ({ default: Orbit }) },
  });
  try {
    assert.equal(renderToStaticMarkup(<Enhancement input={INPUT} id="orbit" />), '');
    // Not even an undeclared one, or with the throw switch set, makes the server throw.
    assert.equal(renderToStaticMarkup(<Enhancement input={INPUT} id="missing" />), '');
    globalThis.__portfolioFailEnhancements = true;
    assert.equal(renderToStaticMarkup(<Enhancement input={INPUT} id="orbit" />), '');
  } finally {
    globalThis.__portfolioFailEnhancements = undefined;
    registerHostModules({});
  }
});

test('it loads the module the host registered under the variant and enhancement ids', async () => {
  registerHostModules({
    enhancementLoaders: { 'kit-shared/orbit': async () => ({ default: Orbit }) },
  });
  try {
    assert.equal((await loadModule('kit-shared/orbit')).default, Orbit);
    await assert.rejects(
      loadModule('kit-shared/comet'),
      /No enhancement kit-shared\/comet is registered/,
    );
    // One load per enhancement, kept, so a re-render never loads it twice.
    assert.equal(moduleFor('kit-shared/orbit'), moduleFor('kit-shared/orbit'));
    assert.equal((await moduleFor('kit-shared/orbit')).default, Orbit);
    await assert.rejects(moduleFor('kit-shared/comet'), /No enhancement kit-shared\/comet/);
  } finally {
    registerHostModules({});
  }
});

test("a load that fails stays failed for the page, whatever re-renders or remounts, and a new page's modules try again once", async () => {
  let attempts = 0;
  registerHostModules({
    enhancementLoaders: {
      'kit-shared/orbit': async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('chunk failed');
        return { default: Orbit };
      },
    },
  });
  try {
    const failed = moduleFor('kit-shared/orbit');
    await assert.rejects(failed, /chunk failed/);
    // React renders the suspended enhancement again once the load settles,
    // a parent re-renders, an island remounts under a new key: each asks
    // again, and gets the failure for its boundary, never a second load.
    for (let render = 0; render < 3; render++) {
      assert.equal(moduleFor('kit-shared/orbit'), failed);
    }
    assert.equal(attempts, 1);
    // A new page registers its host modules afresh, and tries once more.
    registerHostModules({
      enhancementLoaders: {
        'kit-shared/orbit': async () => {
          attempts += 1;
          return { default: Orbit };
        },
      },
    });
    const again = moduleFor('kit-shared/orbit');
    assert.notEqual(again, failed);
    assert.equal((await again).default, Orbit);
    assert.equal(moduleFor('kit-shared/orbit'), again);
    assert.equal(attempts, 2);
  } finally {
    registerHostModules({});
  }
});

test('registering host modules again starts over, so nothing loaded before is reused', async () => {
  const Comet = () => <p>comet</p>;
  registerHostModules({
    enhancementLoaders: { 'kit-shared/orbit': async () => ({ default: Orbit }) },
  });
  try {
    const before = moduleFor('kit-shared/orbit');
    assert.equal((await before).default, Orbit);
    registerHostModules({
      enhancementLoaders: { 'kit-shared/orbit': async () => ({ default: Comet }) },
    });
    const after = moduleFor('kit-shared/orbit');
    assert.notEqual(after, before);
    assert.equal((await after).default, Comet);
  } finally {
    registerHostModules({});
  }
});

test("a boundary with data-enhancement off turns every enhancement off, as a preview's environment asks (#7, Slice 4)", () => {
  const page = (attributes: Record<string, string> | null) => ({
    querySelector: (selector: string) => {
      assert.equal(selector, '[data-variant]');
      return attributes === null
        ? null
        : { getAttribute: (name: string) => attributes[name] ?? null };
    },
  });
  assert.equal(
    enhancementsOff(page({ 'data-variant': 'kit-shared', 'data-enhancement': 'off' })),
    true,
  );
  const others: Array<Record<string, string> | null> = [
    { 'data-variant': 'kit-shared', 'data-enhancement': 'on' },
    { 'data-variant': 'kit-shared' },
    null,
  ];
  for (const attributes of others) {
    assert.equal(enhancementsOff(page(attributes)), false, JSON.stringify(attributes));
  }
  // On the server there's no document, and nothing is off.
  assert.equal(enhancementsOff(undefined), false);
});

test('a failure below the boundary leaves nothing in its place', () => {
  assert.deepEqual(EnhancementBoundary.getDerivedStateFromError(), { failed: true });
  const boundary = new EnhancementBoundary({ children: <p>enhanced</p> });
  assert.notEqual(boundary.render(), null);
  boundary.state = { failed: true };
  assert.equal(boundary.render(), null);
});

test('each boundary that mounts adds one to a count a test has set, and writes nothing otherwise', () => {
  globalThis.__portfolioMountedEnhancements = undefined;
  new EnhancementBoundary({ children: <p>enhanced</p> }).componentDidMount();
  assert.equal(globalThis.__portfolioMountedEnhancements, undefined);
  globalThis.__portfolioMountedEnhancements = 0;
  try {
    // A boundary React builds but never mounts, as in a render it throws away, counts nothing.
    const built = new EnhancementBoundary({ children: <p>enhanced</p> });
    built.render();
    assert.equal(globalThis.__portfolioMountedEnhancements, 0);
    new EnhancementBoundary({ children: <p>enhanced</p> }).componentDidMount();
    const failed = new EnhancementBoundary({ children: <p>enhanced</p> });
    failed.state = { failed: true };
    failed.componentDidMount();
    assert.equal(globalThis.__portfolioMountedEnhancements, 2);
  } finally {
    globalThis.__portfolioMountedEnhancements = undefined;
  }
});
