import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { registerHostModules } from '../sections';
import { loadEnhancement } from '.';
import { EnhancementBoundary, loadModule, moduleFor } from './load';

// @portfolio/kit/enhancements (#5, Slice 2). What a browser does with it,
// loading, failing, and the throw switch, is Slice 6's harness to check in a
// page; here is everything short of mounting.

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

test('the server renders nothing, so the page never waits on or depends on an enhancement', () => {
  registerHostModules({
    enhancementLoaders: { 'kit-shared/orbit': async () => ({ default: Orbit }) },
  });
  try {
    assert.equal(renderToStaticMarkup(loadEnhancement(INPUT, 'orbit')), '');
    // Not even an undeclared one, or with the throw switch set, makes the server throw.
    assert.equal(renderToStaticMarkup(loadEnhancement(INPUT, 'missing')), '');
    globalThis.__portfolioFailEnhancements = true;
    assert.equal(renderToStaticMarkup(loadEnhancement(INPUT, 'orbit')), '');
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

test('a failure below the boundary leaves nothing in its place', () => {
  assert.deepEqual(EnhancementBoundary.getDerivedStateFromError(), { failed: true });
  const boundary = new EnhancementBoundary({ children: <p>enhanced</p> });
  assert.notEqual(boundary.render(), null);
  boundary.state = { failed: true };
  assert.equal(boundary.render(), null);
});
