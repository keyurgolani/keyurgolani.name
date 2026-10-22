import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_SECTION_KINDS,
  CHRONOLOGY_KINDS,
  EVIDENCE_TYPES,
  MEDIA_KINDS,
  resolvePortfolioView,
  type AppearanceCatalog,
  type ParsedPair,
} from '@portfolio/schema';
import { loadPair } from '@portfolio/schema/node';
import { buildRenderInput } from '../render-input';
import { validateManifest } from '../validate-manifest';
import { CONTRACT_FIXTURES, contractFixture, FIXTURES_DIR, HIDDEN_CANARY } from './fixtures';

// The contract fixtures (#5, Slice 6; #10): each loads clean, selects
// missing-variant, reaches no host outside .test, and is what its name says.

/** #4's profession pairs, which the contract fixtures hold as they are. */
const SCHEMA_PAIRS = fileURLToPath(
  new URL('../../../schema/src/__fixtures__/pairs/', import.meta.url),
);

/** The color schemes and typography presets the fixtures name, and every display mode, as #4's tests list them. */
const IDS = {
  colorScheme: ['warm', 'noir', 'ink-and-paper', 'nebula', 'aurora', 'solar'],
  typography: ['classic', 'modernist', 'geometric', 'humanist'],
  displayMode: ['system', 'light', 'dark', 'high-contrast'],
} as const;
const CATALOG: AppearanceCatalog = {
  ids: (axis) => (axis in IDS ? IDS[axis as keyof typeof IDS] : null),
  generatorInput: () => undefined,
};

function load(name: string): ParsedPair {
  const result = loadPair(path.join(FIXTURES_DIR, name), { catalog: CATALOG });
  assert.ok(result.ok, `${name}: ${JSON.stringify(result.diagnostics, null, 2)}`);
  return result.pair;
}

/** Every string in `value`, with the key it sits under. */
function strings(value: unknown, key = ''): [key: string, text: string][] {
  if (typeof value === 'string') return [[key, value]];
  if (Array.isArray(value)) return value.flatMap((item) => strings(item, key));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([name, item]) => strings(item, name));
  }
  return [];
}

/** The published view, as a host builds it with no media document and no snapshot. */
const viewOf = (pair: ParsedPair) => resolvePortfolioView(pair, {}, { mediaBase: '/media' });

/** The distinct values, sorted. */
const distinct = (values: readonly string[]) => [...new Set(values)].sort();

const UNAVAILABLE = { state: 'unavailable', reason: 'processing', since: null };

test('the fixtures directory holds exactly the fixtures the module lists', () => {
  const dirs = fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(
    dirs,
    CONTRACT_FIXTURES.map(({ name }) => name),
  );
  for (const { name, files } of CONTRACT_FIXTURES) {
    assert.deepEqual(fs.readdirSync(path.join(FIXTURES_DIR, name)).sort(), [
      'portfolio.yml',
      'site.yml',
    ]);
    assert.ok(fs.existsSync(files.portfolio) && fs.existsSync(files.site), name);
  }
  assert.throws(() => contractFixture('no-such-fixture'), /No contract fixture/);
});

test('every fixture loads clean, selects missing-variant, and reaches no host outside .test', () => {
  for (const { name } of CONTRACT_FIXTURES) {
    const pair = load(name);
    assert.equal(pair.site.appearance.variant, 'missing-variant', name);
    for (const [key, text] of strings(pair)) {
      for (const [url] of text.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
        assert.match(new URL(url).hostname, /\.test$/, `${name} ${key}: ${url}`);
      }
      // No snapshot: #10 hands a variant that in input.derived, from beside the pair.
      assert.notEqual(key, 'derived', name);
    }
  }
});

test("the profession fixtures are #4's pairs, as they are", () => {
  const practices = fs.readdirSync(SCHEMA_PAIRS).sort();
  assert.equal(practices.length, 8);
  for (const practice of practices) {
    for (const file of ['portfolio.yml', 'site.yml']) {
      assert.equal(
        fs.readFileSync(path.join(FIXTURES_DIR, practice, file), 'utf8'),
        fs.readFileSync(path.join(SCHEMA_PAIRS, practice, 'yaml', file), 'utf8'),
        `${practice}/${file}`,
      );
    }
  }
});

test('complete holds every core kind, evidence type, chronology kind, and media kind, none derived yet', () => {
  const pair = load('complete');
  const { portfolio } = pair;
  assert.deepEqual(
    distinct((portfolio.sections ?? []).map(({ kind }) => kind)),
    [...ALL_SECTION_KINDS].sort(),
  );
  assert.deepEqual(
    distinct((portfolio.evidence ?? []).map(({ type }) => type)),
    [...EVIDENCE_TYPES].sort(),
  );
  assert.deepEqual(
    distinct((portfolio.chronology ?? []).map(({ kind }) => kind)),
    [...CHRONOLOGY_KINDS].sort(),
  );
  assert.deepEqual(
    distinct((portfolio.media ?? []).map(({ kind }) => kind)),
    [...MEDIA_KINDS].sort(),
  );
  // Every curation list, and a signature with a case study.
  assert.ok(portfolio.signature !== undefined);
  assert.ok(portfolio.featured?.length && portfolio.proof?.length && portfolio.archive?.length);
  assert.ok(portfolio.works?.find(({ id }) => id === portfolio.signature)?.caseStudy);
  // A placement that overrides its asset's alt text and focal point.
  const cover = portfolio.works?.find(({ id }) => id === portfolio.signature)?.cover;
  assert.ok(cover?.alt !== undefined && cover.focalPoint !== undefined, JSON.stringify(cover));
  // No data: URL: each asset names a path under the media root, or a .test URL, with no
  // rendition yet, so each one in the view is unavailable.
  const ids = (portfolio.media ?? []).map(({ id }) => id);
  assert.equal(new Set(ids).size, 13);
  for (const { source } of portfolio.media ?? []) assert.doesNotMatch(source, /^data:/);
  const view = viewOf(pair);
  assert.deepEqual(Object.keys(view.media).sort(), [...ids].sort());
  for (const asset of Object.values(view.media)) assert.deepEqual(asset.derived, UNAVAILABLE);
});

test('large holds a hundred works, a series of a hundred photos, and a hundred skills', () => {
  const { portfolio } = load('large');
  assert.deepEqual(
    (portfolio.sections ?? []).flatMap((section) =>
      section.kind === 'works' ? [[section.id, section.items.length]] : [],
    ),
    [
      ['projects', 100],
      ['gallery', 1],
    ],
  );
  const series = portfolio.works?.find(({ id }) => id === 'a-hundred-photos');
  assert.equal(series?.media?.length, 100);
  assert.equal(new Set(series?.media?.map(({ asset }) => asset)).size, 100);
  assert.deepEqual(
    portfolio.practice?.skills?.map(({ items }) => items.length),
    [100],
  );
});

test('long-text has long and unbroken text, titles in other scripts, and repeated titles', () => {
  const { portfolio } = load('long-text');
  const sections = portfolio.sections ?? [];
  const titles = sections.map(({ title }) => title ?? '');
  assert.ok(titles.some((title) => title.length > 120));
  // A word no line can break, far wider than a phone.
  assert.ok(strings(sections).some(([, text]) => /\S{80,}/.test(text)));
  // Two sections share a title, and so do two works, whose ids still differ.
  assert.ok(titles.some((title, index) => title && titles.indexOf(title) !== index));
  const works = (portfolio.works ?? []).map(({ title }) => title);
  assert.ok(works.some((title, index) => works.indexOf(title) !== index));
  assert.ok(works.some((title) => title.length > 120));
  // Titles in Japanese, Greek, and Hindi, each section marking its language.
  for (const lang of ['ja', 'el', 'hi']) {
    const section = sections.find((each) => each.lang === lang);
    assert.ok(section && /[^\p{Script=Latin}\p{P}\s\d]/u.test(section.title ?? ''), lang);
  }
});

test('missing-media names a file the app lacks for every image, and some items carry none', () => {
  const pair = load('missing-media');
  const media = pair.portfolio.media ?? [];
  assert.ok(media.length >= 5);
  for (const { source } of media) assert.match(source, /^missing\//);
  const view = viewOf(pair);
  for (const asset of Object.values(view.media)) assert.deepEqual(asset.derived, UNAVAILABLE);
  // A work with no image, and a testimonial with no avatar, keep their place.
  assert.ok(view.portfolio.works.some((work) => !work.cover && !work.media));
  assert.ok(view.portfolio.evidence.some((evidence) => !evidence.source?.avatar));
});

test('rtl runs right to left, with one section in English', () => {
  const { portfolio } = load('rtl');
  assert.equal(portfolio.direction, 'rtl');
  assert.equal(portfolio.locale, 'he');
  assert.deepEqual(
    (portfolio.sections ?? []).filter(({ lang }) => lang !== undefined).map(({ lang }) => lang),
    ['en'],
  );
});

test('hidden-canary holds the marker in the pair, and no published view or render input carries it', () => {
  const pair = load('hidden-canary');
  const text = JSON.stringify(pair);
  for (const place of [
    'identity',
    'link',
    'item',
    'section',
    'gallery',
    'roles',
    'skill',
    // #10: a record only a hidden section lists, its media, a practice part and the
    // contact record only hidden sections place, and a private work and asset.
    'record',
    'media',
    'practice',
    'contact',
    'private',
  ]) {
    assert.ok(text.includes(`${HIDDEN_CANARY}-${place}`), place);
  }
  const view = viewOf(pair);
  assert.ok(!JSON.stringify(view).includes(HIDDEN_CANARY));
  const raw = JSON.parse(
    fs.readFileSync(new URL('../__fixtures__/manifest.json', import.meta.url), 'utf8'),
  );
  const manifest = validateManifest(raw, { packageName: '@acme/ocean' });
  assert.ok(manifest.ok);
  const input = buildRenderInput({
    view,
    manifest: manifest.manifest,
    route: { route: 'home' },
    basePath: '',
    origin: 'https://hidden.test',
    requestTime: '2026-01-01T00:00:00Z',
  });
  assert.ok(!JSON.stringify(input).includes(HIDDEN_CANARY));
  // Each hidden section is out of the input, and each visible one is in it.
  const ids = input.portfolio.sections.map(({ id }) => id);
  for (const hidden of ['roles-draft', 'skills-draft', 'services-draft', 'drafts', 'gallery']) {
    assert.ok(!ids.includes(hidden), hidden);
  }
  assert.deepEqual(ids, ['top', 'work', 'essays']);
  // So is what only they reach: the practice, the contact record, and every asset.
  assert.deepEqual(
    input.portfolio.works.map(({ id }) => id),
    ['notes-on-visible-things'],
  );
  assert.equal(input.portfolio.practice, undefined);
  assert.equal(input.portfolio.contact, undefined);
  assert.deepEqual(input.media, {});
});
