import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize, yamlComments, type SourceDocument } from '@portfolio/schema';
import { runImport, type ImportResult } from '../import/pipeline';
import { bytes, EXAMPLE, exampleData } from '../import/test-support/hostile';
import { BROWSER_ONLY_OMISSIONS, exportUnit, type ExportFormat } from './index';

// The export (#9, PR 3): separate portfolio and site documents, the same
// bytes for the same input, schema order whatever the source's own, the
// versions stated, the omissions disclosed, and a round trip through the
// import to the same models in both formats.

const yamlSources = {
  portfolio: { text: EXAMPLE.portfolio, format: 'yaml', name: 'portfolio.yml' },
  site: { text: EXAMPLE.site, format: 'yaml', name: 'site.yml' },
} satisfies Record<string, SourceDocument>;

type Imported = Extract<ImportResult, { kind: 'imported' }>;

function importTexts(portfolio: string, site: string): Imported {
  const result = runImport([
    { name: 'a', bytes: bytes(portfolio) },
    { name: 'b', bytes: bytes(site) },
  ]);
  assert.equal(result.kind, 'imported');
  return result as Imported;
}

/** The same data with every mapping's keys reversed, written as JSON. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, reversed(child)]),
    );
  }
  return value;
}

test('an export is two documents, portfolio then site, named for the format, each stating its schema version', () => {
  for (const format of ['yaml', 'json'] as const) {
    const { files, disclosure } = exportUnit({ sources: yamlSources }, format);
    const extension = format === 'json' ? 'json' : 'yml';
    assert.deepEqual(
      files.map(({ name }) => name),
      [`portfolio.${extension}`, `site.${extension}`],
    );
    assert.deepEqual(disclosure.schemaVersions, { portfolio: 3, site: 2 });
    if (format === 'json') {
      assert.equal(JSON.parse(files[0]!.text).schemaVersion, 3);
      assert.equal(JSON.parse(files[1]!.text).schemaVersion, 2);
    } else {
      assert.match(files[0]!.text, /^schemaVersion: 3\n/m);
      assert.match(files[1]!.text, /^schemaVersion: 2\n/);
    }
    for (const { text } of files) {
      assert.ok(text.endsWith('\n'));
      assert.equal(text.includes('\r'), false);
    }
  }
});

test('the same sources export byte for byte the same twice, and the same data in another key order or format exports the same bytes', () => {
  for (const format of ['yaml', 'json'] as const) {
    const first = exportUnit({ sources: yamlSources }, format);
    const second = exportUnit({ sources: structuredClone(yamlSources) }, format);
    assert.deepEqual(second, first);
    assert.equal(second.files[0]!.text, first.files[0]!.text);
    assert.equal(second.files[1]!.text, first.files[1]!.text);
    const shuffled = {
      portfolio: {
        text: JSON.stringify(reversed(exampleData('portfolio')), null, 4),
        format: 'json',
        name: 'portfolio.json',
      },
      site: {
        text: JSON.stringify(reversed(exampleData('site'))),
        format: 'json',
        name: 'site.json',
      },
    } satisfies Record<string, SourceDocument>;
    const other = exportUnit({ sources: shuffled }, format);
    assert.equal(other.files[0]!.text, first.files[0]!.text, format);
    assert.equal(other.files[1]!.text, first.files[1]!.text, format);
  }
});

test('the keys come out in schema order: schemaVersion first, then the order the schema declares', () => {
  const { files } = exportUnit({ sources: yamlSources }, 'json');
  const portfolio = JSON.parse(files[0]!.text) as Record<string, unknown>;
  assert.deepEqual(Object.keys(portfolio).slice(0, 4), [
    'schemaVersion',
    'locale',
    'direction',
    'identity',
  ]);
  const site = JSON.parse(files[1]!.text) as Record<string, unknown>;
  assert.deepEqual(Object.keys(site).slice(0, 2), ['schemaVersion', 'appearance']);
  assert.equal(files[0]!.text, serialize(exampleData('portfolio'), 'json'));
});

test('an exported pair imports to the same models in both formats, and exporting that import again gives the same bytes', () => {
  const original = importTexts(EXAMPLE.portfolio, EXAMPLE.site);
  for (const format of ['yaml', 'json'] as ExportFormat[]) {
    const exported = exportUnit({ sources: original.unit.sources }, format);
    const again = importTexts(exported.files[1]!.text, exported.files[0]!.text);
    assert.deepEqual(again.unit.models, original.unit.models, format);
    assert.deepEqual(again.unit.schemaVersions, original.unit.schemaVersions, format);
    assert.equal(again.unit.sources.portfolio.format, format);
    const twice = exportUnit({ sources: again.unit.sources }, format);
    assert.deepEqual(twice.files, exported.files, format);
    const crossed = exportUnit(
      { sources: again.unit.sources },
      format === 'yaml' ? 'json' : 'yaml',
    );
    assert.deepEqual(
      importTexts(crossed.files[0]!.text, crossed.files[1]!.text).unit.models,
      original.unit.models,
      format,
    );
  }
});

test('the disclosure lists the browser-only data left out, and YAML comments when a source has them', () => {
  assert.deepEqual(BROWSER_ONLY_OMISSIONS, ['appearance-selection', 'local-images']);
  assert.deepEqual(exportUnit({ sources: yamlSources }, 'yaml').disclosure.omitted, [
    'appearance-selection',
    'local-images',
    'yaml-comments',
  ]);
  const plain = exportUnit({ sources: yamlSources }, 'yaml');
  const uncommented = {
    portfolio: { text: plain.files[0]!.text, format: 'yaml', name: 'portfolio.yml' },
    site: { text: plain.files[1]!.text, format: 'yaml', name: 'site.yml' },
  } satisfies Record<string, SourceDocument>;
  assert.deepEqual(exportUnit({ sources: uncommented }, 'json').disclosure.omitted, [
    'appearance-selection',
    'local-images',
  ]);
  for (const { text } of plain.files) assert.deepEqual(yamlComments(text), []);
});

test('a source that does not parse, or has no schemaVersion, throws without quoting it', () => {
  const canary = 'kgn-export-canary-31c8';
  for (const text of [`a: [${canary}`, `name: ${canary}\n`]) {
    assert.throws(
      () =>
        exportUnit(
          { sources: { ...yamlSources, site: { text, format: 'yaml', name: 'site.yml' } } },
          'yaml',
        ),
      (error: Error) => !error.message.includes(canary) && /site source/.test(error.message),
    );
  }
});

/** The example site with record maps in the order `keys` gives. */
function siteWithMaps(keys: (list: string[]) => string[]): string {
  const site = exampleData('site');
  const map = <T>(entries: Record<string, T>) =>
    Object.fromEntries(keys(Object.keys(entries)).map((key) => [key, entries[key]!]));
  site.sections = map({ patents: { hidden: true }, awards: { hidden: false }, about: {} });
  site.routes = map({
    work: { enabled: true },
    home: { enabled: true },
    notes: { enabled: false },
  });
  site.appearanceInputs = map({
    'material-hct': { seedColor: '#336699' },
    'brand-seed': { seedColor: '#993366' },
  });
  site.variantControls = map({
    'kinetic-cosmos': { version: 1, values: map({ zeta: 'z', alpha: 'a', mid: 'm' }) },
    'spatial-bento': { version: 2, values: {} },
  });
  return serialize(site, 'json');
}

test('record maps export in one order whatever their authored order, since no reader gives it a meaning', () => {
  const forward = siteWithMaps((list) => list);
  const backward = siteWithMaps((list) => [...list].reverse());
  assert.notEqual(forward, backward);
  for (const format of ['yaml', 'json'] as const) {
    const exportOf = (site: string) =>
      exportUnit(
        {
          sources: {
            portfolio: yamlSources.portfolio,
            site: { text: site, format: 'json', name: 'site.json' },
          },
        },
        format,
      ).files[1]!.text;
    assert.equal(exportOf(backward), exportOf(forward), format);
  }
  const site = JSON.parse(
    exportUnit(
      { sources: { ...yamlSources, site: { text: backward, format: 'json', name: 'site.json' } } },
      'json',
    ).files[1]!.text,
  ) as Record<string, Record<string, Record<string, unknown>>>;
  // Sorted by code unit, as canonicalize() sorts; the schema's own keys keep schema order.
  assert.deepEqual(Object.keys(site.sections!), ['about', 'awards', 'patents']);
  assert.deepEqual(Object.keys(site.routes!), ['home', 'notes', 'work']);
  assert.deepEqual(Object.keys(site.appearanceInputs!), ['brand-seed', 'material-hct']);
  assert.deepEqual(Object.keys(site.variantControls!), ['kinetic-cosmos', 'spatial-bento']);
  assert.deepEqual(Object.keys(site.variantControls!['kinetic-cosmos']!), ['version', 'values']);
  assert.deepEqual(Object.keys(site.variantControls!['kinetic-cosmos']!.values as object), [
    'alpha',
    'mid',
    'zeta',
  ]);
  assert.deepEqual(Object.keys(site).slice(0, 2), ['schemaVersion', 'appearance']);
});

test('an exported document over the 1 MiB import cap is listed in overImportCap, and it does not import again', () => {
  const data = exampleData('portfolio');
  const links = data.links as Record<string, unknown>[];
  // Minified JSON just under the cap in bytes, which pretty JSON then passes.
  // The labels are three-byte characters, so in UTF-16 units every text here
  // stays far under the cap: only a count of bytes finds the export over it.
  const size = (text: string) => new TextEncoder().encode(text).byteLength;
  for (let index = 0; size(JSON.stringify(data)) < 1024 * 1024 - 20_000; index++) {
    links.push({
      platform: 'website',
      url: `https://example.com/${index}`,
      label: `${'漢'.repeat(300)} ${index}`,
    });
  }
  const minified = JSON.stringify(data);
  assert.ok(size(minified) <= 1024 * 1024);
  const original = importTexts(minified, EXAMPLE.site);
  const small = exportUnit({ sources: yamlSources }, 'json');
  assert.deepEqual(small.disclosure.overImportCap, []);
  for (const format of ['json', 'yaml'] as const) {
    const exported = exportUnit({ sources: original.unit.sources }, format);
    assert.ok(exported.files[0]!.text.length < 1024 * 1024, 'under the cap in UTF-16 units');
    const over = (['portfolio', 'site'] as const).filter(
      (_, index) => size(exported.files[index]!.text) > 1024 * 1024,
    );
    assert.deepEqual(exported.disclosure.overImportCap, over, format);
    if (format === 'json') assert.deepEqual(over, ['portfolio']);
    if (over.includes('portfolio')) {
      const again = runImport([
        { name: 'a', bytes: bytes(exported.files[0]!.text) },
        { name: 'b', bytes: bytes(exported.files[1]!.text) },
      ]);
      assert.equal(again.kind === 'refused' && again.code, 'too_large', format);
    }
  }
});
