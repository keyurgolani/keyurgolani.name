import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_SECTION_KINDS,
  toPublicView,
  type AppearanceCatalog,
  type ParsedPair,
} from '@portfolio/schema';
import { loadPair } from '@portfolio/schema/node';
import { buildRenderInput } from '../render-input';
import { validateManifest } from '../validate-manifest';
import { CONTRACT_FIXTURES, contractFixture, FIXTURES_DIR, HIDDEN_CANARY } from './fixtures';

// The contract fixtures (#5, Slice 6): each loads clean, selects
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

/** Every image source in a pair: each `src`. */
const imageSources = (pair: ParsedPair) =>
  strings(pair.portfolio)
    .filter(([key]) => key === 'src')
    .map(([, text]) => text);

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
      // No GitHub data: #10 hands a variant that in input.derived.
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

test('complete holds every core kind, with every image bundled', () => {
  const pair = load('complete');
  assert.deepEqual(
    [...new Set(pair.portfolio.sections.map(({ kind }) => kind))].sort(),
    [...ALL_SECTION_KINDS].sort(),
  );
  const sources = imageSources(pair);
  assert.ok(sources.length >= 8);
  for (const src of sources) assert.match(src, /^data:image\/png;base64,/);
});

test('large holds a hundred projects, photos, and skills', () => {
  const lengths = load('large').portfolio.sections.flatMap((section) => {
    const lists: unknown[][] = [];
    if ('items' in section && Array.isArray(section.items)) lists.push(section.items);
    if ('groups' in section && Array.isArray(section.groups)) {
      for (const group of section.groups) lists.push(group.items);
    }
    return lists.map((list) => [section.kind, list.length] as const);
  });
  assert.deepEqual(lengths, [
    ['projects', 100],
    ['gallery', 100],
    ['skills', 100],
  ]);
});

test('long-text has long and unbroken text, titles in other scripts, and repeated titles', () => {
  const { sections } = load('long-text').portfolio;
  const titles = sections.map(({ title }) => title ?? '');
  assert.ok(titles.some((title) => title.length > 120));
  // A word no line can break, far wider than a phone.
  assert.ok(strings(sections).some(([, text]) => /\S{80,}/.test(text)));
  // Two sections share a title, and so do two items.
  assert.ok(titles.some((title, index) => title && titles.indexOf(title) !== index));
  const items = sections.flatMap((section) =>
    'items' in section && Array.isArray(section.items)
      ? section.items.map((item) => (item as { title?: string; name?: string }).title ?? '')
      : [],
  );
  assert.ok(items.some((title, index) => title && items.indexOf(title) !== index));
  // Titles in Japanese, Greek, and Hindi, each section marking its language.
  for (const lang of ['ja', 'el', 'hi']) {
    const section = sections.find((each) => each.lang === lang);
    assert.ok(section && /[^\p{Script=Latin}\p{P}\s\d]/u.test(section.title ?? ''), lang);
  }
});

test('missing-media points every image at a file the app lacks, and some items carry none', () => {
  const pair = load('missing-media');
  const sources = imageSources(pair);
  assert.ok(sources.length >= 5);
  for (const src of sources) assert.match(src, /^\/media\/missing-/);
  const items: unknown[] = pair.portfolio.sections.flatMap((section): unknown[] =>
    'items' in section && Array.isArray(section.items) ? section.items : [],
  );
  assert.ok(items.some((item) => imageSources({ portfolio: item } as never).length === 0));
});

test('rtl runs right to left, with one section in English', () => {
  const { portfolio } = load('rtl');
  assert.equal(portfolio.direction, 'rtl');
  assert.equal(portfolio.locale, 'he');
  assert.deepEqual(
    portfolio.sections.filter(({ lang }) => lang !== undefined).map(({ lang }) => lang),
    ['en'],
  );
});

test('hidden-canary holds the marker in the pair, and no public view or render input carries it', () => {
  const pair = load('hidden-canary');
  const text = JSON.stringify(pair);
  for (const place of ['identity', 'link', 'item', 'section', 'gallery', 'roles', 'skill']) {
    assert.ok(text.includes(`${HIDDEN_CANARY}-${place}`), place);
  }
  const view = toPublicView(pair);
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
  for (const hidden of ['roles-draft', 'skills-draft', 'drafts', 'gallery']) {
    assert.ok(!ids.includes(hidden), hidden);
  }
  assert.deepEqual(ids, ['top', 'work', 'essays', 'contact']);
});
