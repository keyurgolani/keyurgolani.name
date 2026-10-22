import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectDocument, readSite } from '@portfolio/schema';
import { legacyAppearanceRemediation } from './index';
import { testRegistry } from './test-support/packs';

const registry = testRegistry();
const LEGACY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../schema/src/__fixtures__/legacy',
);

/** One of #4's legacy fixtures, as the old file's parsed data. */
function legacy(name: string): unknown {
  const file = path.join(LEGACY, name);
  const data = readSite(readFileSync(file, 'utf8'), name.endsWith('.json') ? 'json' : 'yaml').data;
  assert.equal(detectDocument(data), 'legacy', name);
  return data;
}

const line = (text: string, field: string) =>
  text.split('\n').find((each) => each.startsWith(`- ${field}`))!;

test('variant editorial is now editorial-evidence, named even when the old file left it out', () => {
  const text = legacyAppearanceRemediation({ variant: 'editorial' }, registry);
  assert.equal(
    line(text, 'variant'),
    '- variant: editorial-evidence, the new name for editorial. Registered: acme-gallery, editorial-evidence.',
  );
  assert.equal(
    line(legacyAppearanceRemediation(legacy('minimal.yml'), registry), 'variant'),
    '- variant: editorial-evidence, the new name for editorial, the old default. Registered: acme-gallery, editorial-evidence.',
  );
  assert.equal(
    line(legacyAppearanceRemediation({ variant: 'acme-gallery' }, registry), 'variant'),
    '- variant: acme-gallery, which carries over. Registered: acme-gallery, editorial-evidence.',
  );
});

test('themes bright and black are the light and dark display modes', () => {
  assert.equal(
    line(legacyAppearanceRemediation(legacy('theme-bright.yml'), registry), 'displayMode'),
    '- displayMode, from theme: light, the display mode the old theme bright is now. It takes system, light, dark, high-contrast.',
  );
  assert.match(
    line(legacyAppearanceRemediation({ theme: 'black' }, registry), 'displayMode'),
    /: dark, the display mode the old theme black is now\./,
  );
  assert.match(
    line(legacyAppearanceRemediation(legacy('theme.yml'), registry), 'displayMode'),
    /: dark, which carries over\./,
  );
  assert.match(
    line(legacyAppearanceRemediation({}, registry), 'displayMode'),
    /: system, the old default\./,
  );
});

test('no old color scheme or typography id carries over, and none is repeated', () => {
  const data = legacy('appearance-ids.yml');
  const text = legacyAppearanceRemediation(data, registry);
  assert.equal(
    line(text, 'colorScheme'),
    '- colorScheme: no old color scheme carries over. Registered: fixture-asset, fixture-dark-only, fixture-light-only, fixture-seed, warm-parchment.',
  );
  assert.equal(
    line(text, 'typography'),
    '- typography: no old typography carries over. Registered: humanist-ui, multilingual-system.',
  );
  for (const old of ['noir', 'modernist']) assert.ok(!text.includes(old), old);
});

test('an old value this build does not know is never repeated', () => {
  const text = legacyAppearanceRemediation(legacy('variant-unregistered.yml'), registry);
  assert.match(
    line(text, 'variant'),
    /^- variant: the old variant isn't one this build registers, so pick one\./,
  );
  assert.ok(!text.includes('canvas'));
  const theme = legacyAppearanceRemediation({ theme: 'neon-secret-token' }, registry);
  assert.match(line(theme, 'displayMode'), /the old theme isn't a display mode, so pick one\./);
  assert.ok(!theme.includes('neon-secret-token'));
});

test("every one of #4's legacy fixtures gets a remediation naming all four fields", () => {
  for (const name of readdirSync(LEGACY).filter((file) => /\.(?:ya?ml|json)$/.test(file))) {
    const text = legacyAppearanceRemediation(legacy(name), registry);
    const lines = text.split('\n');
    assert.equal(lines.length, 5, name);
    assert.deepEqual(
      lines.slice(1).map((each) => each.split(':')[0]),
      ['- variant', '- displayMode, from theme', '- colorScheme', '- typography'],
      name,
    );
  }
});
