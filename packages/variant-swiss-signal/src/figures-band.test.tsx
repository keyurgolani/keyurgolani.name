import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolvePortfolioView } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import {
  buildRenderInput,
  validateManifest,
  type VariantManifest,
} from '@portfolio/variant-contract';
import { contractFixture } from '@portfolio/variant-contract/node';
import SwissSignal from '.';

// The figures band with a long figure (tip fix F, from C's identities survey: "4,100," over
// "000" at 1440): the number is one unbroken run, sized to its cell by its length, and a word
// unit after it is the one place the figure may break.

Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics));
  return result.manifest as VariantManifest;
})();

function band(value: number, unit: string): string {
  const read = readPair(contractFixture('complete').files);
  assert.ok(read.ok);
  const pair = structuredClone(read.pair);
  const tenure = pair.portfolio.evidence!.find((entry) => entry.id === 'tenure-years')!;
  tenure.metric = { ...tenure.metric!, value, unit };
  tenure.statement = 'Monthly readers';
  const input = buildRenderInput({
    view: resolvePortfolioView(pair, { snapshots: {} }, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-11-01T12:00:00Z',
  });
  const markup = renderToStaticMarkup(<SwissSignal input={input} />);
  const value_ = /<p class="ss-fig__value[^"]*"[^>]*>[\s\S]*?<\/p>/.exec(markup);
  assert.ok(value_, 'the band sets the figure');
  return value_![0];
}

test('a nine-digit figure never breaks inside its number, and is sized to its cell by its length', () => {
  const figure = band(410_000_000, 'users');
  assert.match(figure, /style="--layout-ss-fig:11"/);
  assert.match(figure, /<span class="ss-fig__run">410,000,000<\/span> users<\/p>$/);
});

test('a tight unit stays in the unbroken run', () => {
  const figure = band(4_100_000, '+');
  assert.match(figure, /<span class="ss-fig__run">4,100,000\+<\/span><\/p>$/);
  assert.match(figure, /--layout-ss-fig:10/);
});
