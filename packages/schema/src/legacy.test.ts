import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import {
  detectDocument,
  legacyFields,
  legacyMessage,
  legacyNeeds,
  shellQuote,
  SITE_SKELETON,
  SITE_SKELETON_JSON,
} from './legacy';
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
    sections: [
      { kind: 'lede', hidden: true },
      { kind: 'now', hidden: false },
    ],
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
      ['sections/0/hidden', 'sections.<id>.hidden in site.yml'],
      // hidden: false goes away: a section shows unless the site document hides it.
      ['sections/1/hidden', undefined],
      ['meta/url', 'the PORTFOLIO_ORIGIN setting'],
      ['variant', 'appearance.variant in site.yml'],
      ['motionPreference', 'motionPolicy in site.yml'],
      ['colorScheme', 'appearance.colorScheme in site.yml, as an id this release registers'],
      ['typography', 'appearance.typography in site.yml, as an id this release registers'],
    ],
  );
});

test('names on Object.prototype are not old fields', () => {
  const data = JSON.parse(
    '{"identity":{"name":"R"},"constructor":1,"toString":2,"valueOf":3,"__proto__":4,"hasOwnProperty":5}',
  );
  assert.deepEqual(legacyFields(data), []);
  assert.equal(
    legacyMessage(data, 'portfolio.yml'),
    "portfolio.yml is in the old one-file format, which this release doesn't read. Run pnpm config:migrate portfolio.yml to split it into portfolio.yml and site.yml.",
  );
  // An inherited meta.url isn't one either.
  assert.deepEqual(legacyFields(JSON.parse('{"meta":{"__proto__":{"url":"x"}}}')), []);
});

test('the legacy message names fields and the command, never a value', () => {
  const message = legacyMessage(
    {
      identity: { name: 'canary-name' },
      variant: 'canary-variant',
      meta: { url: 'https://canary.test' },
      sections: [{ kind: 'lede', hidden: false }],
    },
    'portfolio.yml',
  );
  assert.equal(
    message,
    "portfolio.yml is in the old one-file format, which this release doesn't read. Its old fields move: /variant to appearance.variant in site.yml and /meta/url to the PORTFOLIO_ORIGIN setting. /sections/0/hidden goes: a section shows unless site.yml hides it. Run pnpm config:migrate portfolio.yml to split it into portfolio.yml and site.yml.",
  );
  assert.ok(!message.includes('canary'));
});

test('a JSON file is named as JSON, and a path is quoted for the shell', () => {
  const message = legacyMessage({ identity: { name: 'R' }, variant: 'x' }, "config/rowan's.json");
  assert.equal(
    message,
    "config/rowan's.json is in the old one-file format, which this release doesn't read. Its old fields move: /variant to appearance.variant in site.json. Run pnpm config:migrate 'config/rowan'\\''s.json' to split it into portfolio.json and site.json.",
  );
  assert.equal(shellQuote('config/portfolio.yml'), 'config/portfolio.yml');
  assert.equal(shellQuote('my docs/a b.yml'), "'my docs/a b.yml'");
  assert.equal(shellQuote('$(touch x)'), "'$(touch x)'");
});

test('legacyNeeds lists the --set values a migration stops on', () => {
  assert.deepEqual(legacyNeeds({ identity: {} }), [
    'site.appearance.colorScheme',
    'site.appearance.typography',
  ]);
  assert.deepEqual(
    legacyNeeds({ variant: 'retro', theme: 'bright', motionPreference: 'wild' }, [
      'editorial',
      'kinetic-cosmos',
    ]),
    [
      'site.appearance.variant',
      'site.appearance.colorScheme',
      'site.appearance.typography',
      'site.appearance.displayMode',
      'site.motionPolicy',
    ],
  );
  // full becomes respect-os, and dark is a display mode, so neither needs a value.
  assert.deepEqual(
    legacyNeeds({ variant: 'editorial', theme: 'dark', motionPreference: 'full' }, ['editorial']),
    ['site.appearance.colorScheme', 'site.appearance.typography'],
  );
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
  // The JSON skeleton is the same document.
  const json = SITE_SKELETON_JSON.replace(/<a color scheme id[^>]*>/, 'warm').replace(
    /<a typography preset id[^>]*>/,
    'classic',
  );
  assert.deepEqual(JSON.parse(json), parse(filled));
});
