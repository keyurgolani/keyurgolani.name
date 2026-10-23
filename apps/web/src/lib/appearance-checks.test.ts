import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validatePublicationUnit } from '@portfolio/schema';
import { appearanceCatalog, appearanceValidator } from './appearance-checks';
import { APPEARANCE_REGISTRY } from './appearance-registry';
import { liveContext } from './variants';

// What startup, `pnpm config:validate`, and #3's CLI check a site's
// appearance with (#19, Slice 4): this build's appearance registries, in
// place of #4's interim catalog.

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../${name}`, import.meta.url)), 'utf8');
const PORTFOLIO = read('portfolio.example.yml');
const SITE = read('site.example.yml');

const unit = (portfolio: string, site: string) => ({
  portfolio: { text: portfolio, format: 'yaml' as const, name: 'portfolio.yml' },
  site: { text: site, format: 'yaml' as const, name: 'site.yml' },
});

const appearanceRecords = (site: string, live: boolean) =>
  validatePublicationUnit(unit(PORTFOLIO, site), {
    catalog: appearanceCatalog(APPEARANCE_REGISTRY),
    validators: [appearanceValidator(APPEARANCE_REGISTRY, live)],
  }).diagnostics.filter(({ code }) => code.startsWith('appearance.'));

test('the bundled site selects the platform defaults, which this build registers, so its appearance has no finding (#19)', () => {
  assert.deepEqual(appearanceRecords(SITE, true), []);
  assert.deepEqual(appearanceRecords(SITE, false), []);
});

test('a pack this build lacks warns while live, as its axis falls back, and blocks a publish, naming what this build has (#19)', () => {
  const site = SITE.replace('colorScheme: warm-parchment', 'colorScheme: warm');
  const [live] = appearanceRecords(site, true);
  assert.equal(live?.code, 'appearance.unavailable');
  assert.equal(live?.severity, 'warning');
  assert.equal(live?.pointer, '/appearance/colorScheme');
  assert.match(live!.remediation, /warm-parchment/);
  const [publish] = appearanceRecords(site, false);
  assert.equal(publish?.severity, 'blocks-publish');
});

test("an old one-file document's remediation names the appearance ids this build registers, as startup reports it (#19)", () => {
  const old = ['identity:', '  name: Rowan', 'variant: editorial', 'theme: bright', ''].join('\n');
  const { catalog, extensions, validators } = liveContext();
  const [legacy] = validatePublicationUnit(unit(old, 'schemaVersion: 2\n'), {
    catalog,
    extensions,
    validators,
  }).diagnostics;
  assert.equal(legacy?.code, 'legacy.document');
  const lines = legacy!.remediation.split('\n');
  assert.ok(
    lines.includes(
      'Its appearance values move to appearance in the site document, as ids this build registers:',
    ),
    legacy!.remediation,
  );
  assert.ok(
    lines.some((line) =>
      line.startsWith(
        '- displayMode, from theme: light, the display mode the old theme bright is now.',
      ),
    ),
    legacy!.remediation,
  );
  assert.ok(
    lines.some((line) => line.startsWith('- colorScheme:') && line.includes('warm-parchment')),
    legacy!.remediation,
  );
});
