import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PortfolioSchema } from '@portfolio/schema';
import { FallbackSection } from './fallback-section';

// tsx compiles the kit's JSX (tsconfig `jsx: preserve`) to React.createElement
// calls, which Next's compiler never does, so the test supplies React itself.
Object.assign(globalThis, { React });

const portfolio = PortfolioSchema.parse({
  schemaVersion: 2,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Test' },
  sections: [
    { kind: 'lede', id: 'about', title: 'About', body: 'Hello there.' },
    {
      kind: '@acme/portfolio-photography/exhibitions',
      id: 'exhibitions',
      title: 'canary-extension-title',
      data: { items: [{ title: 'canary-extension-data' }] },
    },
  ],
});

const render = (index: number) =>
  renderToStaticMarkup(
    React.createElement(FallbackSection, { section: portfolio.sections[index]!, portfolio }),
  );

test('the fallback renders a core section under its content id', () => {
  const html = render(0);
  assert.match(html, /<section id="about"/);
  assert.match(html, /Hello there\./);
});

test('the fallback renders nothing for a section from a content extension', () => {
  assert.equal(render(1), '');
});
