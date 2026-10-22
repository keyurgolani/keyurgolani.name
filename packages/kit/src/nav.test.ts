import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PortfolioSchema,
  resolvePortfolioView,
  SiteSchema,
  type ParsedPair,
} from '@portfolio/schema';
import { deriveNavItems } from './nav';

// The navigation (#10, slice 1, item 9): each visible, titled section of the
// published view, linked by its content id, and nothing for a section the
// page leaves out.

const SITE = SiteSchema.parse({
  schemaVersion: 2,
  appearance: {
    variant: 'missing-variant',
    designLanguage: 'platform-neutral',
    colorScheme: 'warm',
    typography: 'classic',
    displayMode: 'system',
  },
  visitorControls: {
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'locked',
    typography: 'locked',
    displayMode: 'locked',
  },
  motionPolicy: 'respect-os',
  features: { feed: true },
  sections: { 'hidden-notes': { hidden: true } },
});

function view(portfolio: unknown) {
  const pair = { portfolio: PortfolioSchema.parse(portfolio), site: SITE } as ParsedPair;
  return resolvePortfolioView(pair, {}, { mediaBase: '/media' });
}

const BASE = {
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Test' },
};

test('navigation links to each section by its content id', () => {
  const portfolio = view({
    ...BASE,
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
  // A render input's id prefix reaches each link.
  assert.deepEqual(deriveNavItems({ ...portfolio, ids: { prefix: 'pv-' } }), [
    { label: 'About', href: '#pv-about-me' },
    { label: 'About', href: '#pv-lately' },
  ]);
});

test('navigation never links a section from a content extension', () => {
  const portfolio = view({
    ...BASE,
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

test("navigation leaves out what the page does: a section with nothing public, or of a kind the composition doesn't render", () => {
  const published = view({
    ...BASE,
    works: [{ id: 'tide', title: 'Tide', medium: 'writing' }],
    sections: [
      { kind: 'works', id: 'selected-work', title: 'Selected work', items: ['tide'] },
      { kind: 'github', id: 'code', title: 'Code', username: 'rowan' },
    ],
  });
  const hrefs = (source: Parameters<typeof deriveNavItems>[0]) =>
    deriveNavItems(source).map(({ href }) => href);
  assert.deepEqual(hrefs(published), ['#selected-work', '#code']);
  // A section handed in from elsewhere, listing only a record the view doesn't hold.
  const elsewhere = {
    ...published,
    portfolio: {
      ...published.portfolio,
      sections: [
        ...published.portfolio.sections,
        { kind: 'works' as const, id: 'drafts', title: 'Drafts', items: ['draft'] },
      ],
    },
  };
  assert.deepEqual(hrefs(elsewhere), ['#selected-work', '#code']);
  // A kind the manifest's unsupportedKinds lists renders nothing, so it isn't linked.
  assert.deepEqual(hrefs({ ...published, capabilities: { unsupportedKinds: ['github'] } }), [
    '#selected-work',
  ]);
});

test('navigation leaves out a hidden section and one with nothing public, as the page does', () => {
  const portfolio = view({
    ...BASE,
    works: [
      { id: 'tide', title: 'Tide', medium: 'writing' },
      { id: 'draft', title: 'Draft', medium: 'writing', visibility: 'private' },
    ],
    sections: [
      { kind: 'works', id: 'selected-work', title: 'Selected work', items: ['tide'] },
      { kind: 'works', id: 'drafts', title: 'Drafts', items: ['draft'] },
      { kind: 'lede', id: 'hidden-notes', title: 'Hidden notes', body: 'x' },
    ],
  });
  assert.deepEqual(deriveNavItems(portfolio), [{ label: 'Selected work', href: '#selected-work' }]);
});
