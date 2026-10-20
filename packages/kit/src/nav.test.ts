import test from 'node:test';
import assert from 'node:assert/strict';
import { PortfolioSchema } from '@portfolio/schema';
import { deriveNavItems } from './nav';

test('navigation links to each section by its content id', () => {
  const portfolio = PortfolioSchema.parse({
    schemaVersion: 2,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Test' },
    sections: [
      { kind: 'hero', id: 'top' },
      { kind: 'lede', id: 'about-me', title: 'About', body: 'x' },
      { kind: 'now', id: 'lately', title: 'About', body: 'y' },
      { kind: 'quote', id: 'quote', text: 'z' },
    ],
  });
  assert.deepEqual(deriveNavItems(portfolio), [
    { label: 'About', href: '#about-me' },
    { label: 'About', href: '#lately' },
  ]);
});

test('navigation never links a section from a content extension', () => {
  const portfolio = PortfolioSchema.parse({
    schemaVersion: 2,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Test' },
    sections: [
      { kind: 'lede', id: 'about', title: 'About', body: 'x' },
      {
        kind: '@acme/portfolio-photography/exhibitions',
        id: 'exhibitions',
        title: 'Exhibitions',
        data: {},
      },
    ],
  });
  assert.deepEqual(deriveNavItems(portfolio), [{ label: 'About', href: '#about' }]);
});
