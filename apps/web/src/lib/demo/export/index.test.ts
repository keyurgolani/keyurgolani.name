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
