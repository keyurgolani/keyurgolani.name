import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { registerHostModules } from '../sections';
import * as entry from '.';
import { Enhancement } from '.';
import { EnhancementBoundary, loadModule, moduleFor } from './load';

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

test('it exports a component, which a server component renders, and no function to call', () => {
  // A server component can render a client module's export as an element,
  // and can't call one: Next swaps each export for a reference to it.
  assert.deepEqual(Object.keys(entry), ['Enhancement']);
  assert.equal(typeof Enhancement, 'function');
  assert.match(Enhancement.name, /^[A-Z]/);
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

test('a load that fails is dropped, so the next mount tries again', async () => {
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
    const again = moduleFor('kit-shared/orbit');
    assert.notEqual(again, failed);
    assert.equal((await again).default, Orbit);
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
    new EnhancementBoundary({ children: <p>enhanced</p> }).componentDidMount();
    const failed = new EnhancementBoundary({ children: <p>enhanced</p> });
    failed.state = { failed: true };
    failed.componentDidMount();
    assert.equal(globalThis.__portfolioMountedEnhancements, 2);
  } finally {
    globalThis.__portfolioMountedEnhancements = undefined;
  }
});
