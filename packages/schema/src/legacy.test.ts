import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { detectDocument, legacyFields, legacyMessage, SITE_SKELETON } from './legacy';
import { SiteSchema } from './compose';

test('detectDocument tells the two documents, the old format, and anything else apart', () => {
  // With schemaVersion, identity makes a portfolio and appearance a site.
  assert.equal(detectDocument({ schemaVersion: 2, identity: {} }), 'portfolio');
  assert.equal(detectDocument({ schemaVersion: 1, appearance: {} }), 'site');
  assert.equal(detectDocument({ schemaVersion: 2, identity: {}, appearance: {} }), 'unknown');
  assert.equal(detectDocument({ schemaVersion: 2, locale: 'en' }), 'unknown');
  // Without it, any old marker makes the old format.
  for (const marker of [
    'identity',
    'sections',
    'variant',
    'theme',
    'motionPreference',
    'colorScheme',
    'typography',
  ]) {
    assert.equal(detectDocument({ [marker]: 'x' }), 'legacy', marker);
  }
  assert.equal(detectDocument({ links: [], meta: {} }), 'unknown');
  for (const value of [null, 'text', 7, [], undefined]) {
    assert.equal(detectDocument(value), 'unknown', String(value));
  }
});

test('legacyFields lists each old field with its new home, in document order', () => {
  const fields = legacyFields({
    identity: { name: 'Rowan' },
    theme: 'dark',
    sections: [{ kind: 'lede' }, { kind: 'now', hidden: false }],
    meta: { title: 'Rowan', url: 'https://rowan.test' },
    variant: 'editorial',
    motionPreference: 'full',
    colorScheme: 'warm',
    typography: 'classic',
  });
  assert.deepEqual(
    fields.map(({ path, home }) => [path.join('/'), home]),
    [
      ['theme', 'appearance.displayMode in site.yml'],
      ['sections/1/hidden', 'sections.<id>.hidden in site.yml'],
      ['meta/url', 'the PORTFOLIO_ORIGIN setting'],
      ['variant', 'appearance.variant in site.yml'],
      ['motionPreference', 'motionPolicy in site.yml'],
      ['colorScheme', 'appearance.colorScheme in site.yml, as an id this release registers'],
      ['typography', 'appearance.typography in site.yml, as an id this release registers'],
    ],
  );
});

test('the legacy message names fields and the command, never a value', () => {
  const message = legacyMessage(
    {
      identity: { name: 'canary-name' },
      variant: 'canary-variant',
      meta: { url: 'https://canary.test' },
    },
    'portfolio.yml',
  );
  assert.equal(
    message,
    "portfolio.yml is in the old one-file format, which this release doesn't read. Its old fields move: /variant to appearance.variant in site.yml, and /meta/url to the PORTFOLIO_ORIGIN setting. Run pnpm config:migrate portfolio.yml to split it into portfolio.yml and site.yml.",
  );
  assert.ok(!message.includes('canary'));
});

test('the site skeleton is a site document once its ids are picked', () => {
  const filled = SITE_SKELETON.replace(/<a color scheme id[^>]*>/, 'warm').replace(
    /<a typography preset id[^>]*>/,
    'classic',
  );
  assert.ok(!filled.includes('<'));
  const result = SiteSchema.safeParse(parse(filled));
  assert.ok(result.success, JSON.stringify(result.error?.issues));
  assert.deepEqual(result.data.visitorControls, {
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'selectable',
    typography: 'locked',
    displayMode: 'selectable',
  });
});
