import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VISITOR_CONTROLS, PLATFORM_DEFAULTS } from '@portfolio/appearance';
import type { MotionPolicy } from '@portfolio/schema';
import { FALLBACK_ID } from '@portfolio/variant-contract';
import type { RegisteredIds } from './sample';
import {
  canonicalLocation,
  isCanonical,
  isDotSegment,
  SAMPLE_QUERY_KEYS,
  sampleQuery,
  type SampleQuery,
} from './sample-query';

// /sample's query under demo (#9): each key checked against what this
// build registers, a value that doesn't count dropped on its own axis, and
// the canonical URL a request with any other query is sent to.

const SITE = {
  appearance: {
    ...PLATFORM_DEFAULTS,
    variant: 'editorial-evidence',
    displayMode: 'system' as const,
  },
  // Locked everywhere: demo makes every axis the visitor's anyway.
  visitorControls: {
    ...DEFAULT_VISITOR_CONTROLS,
    colorScheme: 'locked' as const,
    displayMode: 'locked' as const,
  },
  motionPolicy: 'respect-os' as MotionPolicy,
};

const BUILD: RegisteredIds = [
  { manifest: { id: FALLBACK_ID } },
  { manifest: { id: 'acme-ocean' } },
];

const read = (text: string) => sampleQuery(new URLSearchParams(text), SITE, { registered: BUILD });

/** A selection every axis of which this build registers. */
const FULL = [
  'variant=acme-ocean',
  `language=${PLATFORM_DEFAULTS.designLanguage}`,
  `scheme=${PLATFORM_DEFAULTS.colorScheme}`,
  `type=${PLATFORM_DEFAULTS.typography}`,
  'mode=dark',
  'motion=reduce',
].join('&');

test('the keys are the five #19 selection keys, then motion', () => {
  assert.deepEqual(SAMPLE_QUERY_KEYS, ['variant', 'language', 'scheme', 'type', 'mode', 'motion']);
});

test('no query is canonical, and selects the sample site as it is', () => {
  const none = read('');
  assert.deepEqual(none, { query: {}, reduceMotion: false });
  assert.equal(isCanonical(new URLSearchParams(''), none), true);
});

test('every registered value counts on its own axis, in key order, and is canonical as sent', () => {
  const full = read(FULL);
  assert.deepEqual(full, {
    selected: 'acme-ocean',
    query: {
      variant: 'acme-ocean',
      language: PLATFORM_DEFAULTS.designLanguage,
      scheme: PLATFORM_DEFAULTS.colorScheme,
      type: PLATFORM_DEFAULTS.typography,
      mode: 'dark',
      motion: 'reduce',
    },
    reduceMotion: true,
  });
  assert.equal(isCanonical(new URLSearchParams(FULL), full), true);
  // Every display mode is one.
  for (const mode of ['system', 'light', 'dark', 'high-contrast']) {
    assert.deepEqual(read(`mode=${mode}`).query, { mode }, mode);
  }
});

test('a value the registry does not accept falls back on its axis alone, and the query is not canonical', () => {
  for (const [text, kept] of [
    ['variant=canary-variant&mode=dark', { mode: 'dark' }],
    [`variant=${FALLBACK_ID}&mode=dark`, { mode: 'dark' }],
    ['variant=acme-ocean&language=no-such-language', { variant: 'acme-ocean' }],
    // Another axis's id, another case, an empty value, two values.
    [`variant=acme-ocean&language=${PLATFORM_DEFAULTS.typography}`, { variant: 'acme-ocean' }],
    ['mode=DARK&variant=acme-ocean', { variant: 'acme-ocean' }],
    ['scheme=&mode=light', { mode: 'light' }],
    ['mode=dark&mode=light&variant=acme-ocean', { variant: 'acme-ocean' }],
    ['mode=sepia', {}],
    // Keys outside the six, and motion other than reduce.
    ['utm_source=mail&mode=dark', { mode: 'dark' }],
    ['motion=full&mode=dark', { mode: 'dark' }],
    ['motion=reduce&motion=reduce', {}],
    // Markup and URLs in a value never count.
    ['mode=%3Cscript%3E', {}],
    ['language=https%3A%2F%2Fevil.example', {}],
  ] as const) {
    const selection = read(text);
    assert.deepEqual(selection.query, kept, text);
    assert.equal(isCanonical(new URLSearchParams(text), selection), false, text);
  }
});

test('the right values in another order are not canonical, and their canonical order is', () => {
  const sent = new URLSearchParams('mode=dark&variant=acme-ocean');
  const selection = read(sent.toString());
  assert.deepEqual(selection.query, { variant: 'acme-ocean', mode: 'dark' });
  assert.equal(isCanonical(sent, selection), false);
  assert.equal(isCanonical(new URLSearchParams('variant=acme-ocean&mode=dark'), selection), true);
});

test("the canonical URL is the deployment's own origin, the asked path, and the canonical query alone", () => {
  const origin = 'https://demo.example.test';
  const selection: SampleQuery = {
    query: { variant: 'acme-ocean', mode: 'dark' },
    reduceMotion: false,
  };
  assert.equal(
    canonicalLocation(origin, ['sample', 'chapters', 'about'], selection),
    'https://demo.example.test/sample/chapters/about?variant=acme-ocean&mode=dark',
  );
  assert.equal(
    canonicalLocation(origin, ['sample'], { query: {}, reduceMotion: false }),
    `${origin}/sample`,
  );
});

test('no segment, however it is spelled, moves the canonical URL to another host', () => {
  const origin = 'https://demo.example.test';
  const selection: SampleQuery = { query: { mode: 'dark' }, reduceMotion: false };
  for (const segments of [
    ['sample', '', 'evil.example'],
    ['', 'evil.example'],
    ['', '', 'evil.example'],
    ['sample', '//evil.example'],
    ['//evil.example'],
    ['sample', 'https:', 'evil.example'],
    ['https://evil.example'],
    ['https:', '', 'evil.example'],
    ['sample', '\\\\evil.example'],
    ['\\evil.example'],
    ['sample', '..', '..', 'evil.example'],
    ['..', '..', '//evil.example'],
    ['sample', '.'],
    ['sample', '%2e%2e'],
    ['sample', '%252e%252e'],
    ['sample', 'a?b=c#d'],
    ['sample', 'user@evil.example'],
    ['sample', 'user:pass@evil.example'],
    ['sample', 'javascript:alert(1)'],
  ]) {
    const location = new URL(canonicalLocation(origin, segments, selection));
    const label = JSON.stringify(segments);
    assert.equal(location.origin, origin, label);
    assert.equal(location.search, '?mode=dark', label);
    assert.equal(location.hash, '', label);
    assert.equal(location.username, '', label);
    assert.equal(location.password, '', label);
    // A segment that isn't a dot segment stays one segment of the path.
    if (!segments.some(isDotSegment)) {
      assert.equal(location.pathname.split('/').length, segments.length + 1, label);
      if (segments[0] === 'sample') assert.match(location.pathname, /^\/sample\//, label);
    }
  }
});

test('dot segments are spotted however their dots are spelled', () => {
  for (const segment of ['.', '..', '%2e', '%2E%2e', '.%2e', '%2e.']) {
    assert.equal(isDotSegment(segment), true, segment);
  }
  for (const segment of ['...', '.a', 'a.', '%252e', '', 'sample']) {
    assert.equal(isDotSegment(segment), false, segment);
  }
});
