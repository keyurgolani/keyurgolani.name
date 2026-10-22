import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { parsePortfolio, parseSite, resolvePortfolioView } from '@portfolio/schema';
import { href } from '@portfolio/variant-contract';
import { resolveVisitorPath } from '~/lib/visitor-routes';
import {
  PREVIEW_FAILED_TEXT,
  PREVIEW_STATUS,
  PREVIEW_STATUS_DOCUMENT,
  PREVIEW_UNAVAILABLE_TEXT,
} from '~/preview/status';
import PreviewError from './preview/[grant]/error';
import PreviewNotFound from './preview/[grant]/not-found';

// A grant's frame (#7, Slice 2): its link base is the grant path, so every
// internal link stays under the grant, and what it shows when it can't
// render is the status texts alone, with no link out of the frame, no host
// chrome, and no error text.

/** A grant token, as a mint makes one: 16 random bytes of base64url. */
const token = () => randomBytes(16).toString('base64url');

test("a frame's link base is its grant path, for any grant a mint makes, so its internal links stay under the grant", async () => {
  const portfolio = parsePortfolio(
    'schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: Frame Person\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n',
    'yaml',
  );
  const site = parseSite(
    [
      'schemaVersion: 2',
      'appearance:',
      '  variant: missing-variant',
      '  designLanguage: platform-neutral',
      '  colorScheme: warm',
      '  typography: classic',
      '  displayMode: system',
      'visitorControls:',
      '  variant: locked',
      '  designLanguage: locked',
      '  colorScheme: locked',
      '  typography: locked',
      '  displayMode: selectable',
      'motionPolicy: respect-os',
      'features:',
      '  feed: true',
      '',
    ].join('\n'),
    'yaml',
  );
  assert.ok(portfolio.ok && site.ok);
  for (let i = 0; i < 64; i++) {
    const grant = token();
    const basePath = `/preview/${grant}` as const;
    // The view a grant's frame renders, its renditions under the grant's own path.
    const view = resolvePortfolioView(
      { portfolio: portfolio.value, site: site.value },
      {},
      { mediaBase: `/preview-assets/${grant}` },
    );
    assert.equal(href({ route: 'home' }, { basePath }), basePath);
    assert.equal(
      href({ route: 'work', slug: 'tide-tables' }, { basePath }),
      `${basePath}/work/tide-tables`,
    );
    const home = await resolveVisitorPath({ segments: [], basePath }, async () => view);
    assert.equal(home.kind, 'render', basePath);
  }
});

test("the frame's 404 and error boundaries show the status texts, with no link, class, id, or error text", () => {
  const missing = renderToStaticMarkup(<PreviewNotFound />);
  assert.equal(missing, `<main><p>${PREVIEW_UNAVAILABLE_TEXT}</p></main>`);
  const error = Object.assign(new Error('canary-error /srv/config/portfolio.yml'), {
    digest: '1234567890',
  });
  const failed = renderToStaticMarkup(<PreviewError error={error} />);
  assert.equal(
    failed,
    `<main><p>${PREVIEW_FAILED_TEXT.replace("'", '&#x27;')}</p><p>Reference: 1234567890</p></main>`,
  );
  assert.equal(
    renderToStaticMarkup(<PreviewError error={new Error('canary')} />),
    `<main><p>${PREVIEW_FAILED_TEXT.replace("'", '&#x27;')}</p></main>`,
  );
});

test('the status document says only that the preview is unavailable: no script, style, link, id, class, or path', () => {
  assert.equal(PREVIEW_STATUS, 404);
  assert.ok(PREVIEW_STATUS_DOCUMENT.includes(`<p>${PREVIEW_UNAVAILABLE_TEXT}</p>`));
  assert.ok(PREVIEW_STATUS_DOCUMENT.includes('<meta name="robots" content="noindex, nofollow">'));
  for (const forbidden of [
    /<script/i,
    /<style/i,
    /<link/i,
    /<a[\s>]/i,
    /\bid=/i,
    /\bclass=/i,
    /\//,
  ]) {
    const body = PREVIEW_STATUS_DOCUMENT.replace(/<\/[a-z]+>/g, '').replace('<!doctype html>', '');
    assert.doesNotMatch(body, forbidden, String(forbidden));
  }
});
