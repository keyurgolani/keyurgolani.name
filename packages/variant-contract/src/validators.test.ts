import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePublicationUnit, type ContentExtension, type Diagnostic } from '@portfolio/schema';
import { exhibitions } from './__fixtures__/extension';
import { UNIT_CODES } from './diagnostics';
import type { VariantRegistry } from './registry';
import { validateManifest } from './validate-manifest';
import {
  contractValidators,
  validateControls,
  validateRoutes,
  validateSelection,
} from './validators';

// The contract's publication-unit checks (#5, Slice 1), run inside #4's
// validatePublicationUnit() as plugged-in validators: located in the site
// document, with #4's severities, and covering the entries #4 leaves unchecked.

const PAIR = new URL('../../schema/src/__fixtures__/pairs/engineering/yaml/', import.meta.url);
const PORTFOLIO = readFileSync(new URL('portfolio.yml', PAIR), 'utf8');
const SITE = readFileSync(new URL('site.yml', PAIR), 'utf8');

function manifest(id: string) {
  const raw = JSON.parse(
    readFileSync(new URL('./__fixtures__/manifest.json', import.meta.url), 'utf8'),
  );
  raw.id = id;
  const result = validateManifest(raw, { packageName: '@acme/ocean' });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.manifest;
}

const REGISTRY: VariantRegistry = [
  { packageName: '@acme/ocean', version: '1.0.0', manifest: manifest('acme-ocean') },
  { packageName: '@acme/reef', version: '2.1.0', manifest: manifest('acme-reef') },
];

/** The engineering pair's site, selecting `variant`, with extra YAML appended. */
function site(variant: string, extra = ''): string {
  return `${SITE.replace('variant: editorial', `variant: ${variant}`)}${extra}`;
}

function check(
  siteText: string,
  registry: VariantRegistry = REGISTRY,
  {
    portfolio = PORTFOLIO,
    extensions = [],
  }: { portfolio?: string; extensions?: ContentExtension[] } = {},
) {
  return validatePublicationUnit(
    {
      portfolio: { text: portfolio, format: 'yaml', name: 'portfolio.yml' },
      site: { text: siteText, format: 'yaml', name: 'site.yml' },
    },
    { validators: contractValidators(registry), extensions },
  );
}

const ours = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.filter(({ code }) => Object.hasOwn(UNIT_CODES, code));

test('a registered selection with no stored controls or toggles has nothing to report', () => {
  const result = check(site('acme-ocean'));
  assert.deepEqual(ours(result.diagnostics), []);
  assert.ok(result.pair);
  // validateSelection checks the variant, so #4 no longer lists it as unchecked.
  assert.ok(!result.notChecked.includes('site.appearance.variant'));
  assert.ok(result.notChecked.includes('site.appearance.colorScheme'));
});

test('an unregistered selection, the fallback, and missing-variant are variant.unavailable', () => {
  for (const variant of ['editorial', 'fallback', 'missing-variant']) {
    const result = check(site(variant));
    const records = ours(result.diagnostics);
    assert.deepEqual(
      records.map(({ code, severity, document, pointer }) => [code, severity, document, pointer]),
      [['variant.unavailable', 'blocks-publish', 'site', '/appearance/variant']],
      variant,
    );
    // Located at the line, and blocking publish only, so preview still has the pair.
    assert.equal(records[0]!.line, 4);
    assert.ok(result.pair, variant);
    // The message never repeats the document's value, unless it's the reserved id it explains.
    if (variant !== 'fallback') {
      assert.ok(!records[0]!.message.includes(variant), records[0]!.message);
    }
    assert.match(records[0]!.remediation, /acme-ocean, acme-reef/);
  }
  assert.match(ours(check(site('fallback')).diagnostics)[0]!.message, /can't be selected/);
});

test('with nothing registered, the remediation says how to install a variant', () => {
  const [record] = ours(check(site('editorial'), []).diagnostics);
  assert.match(record!.remediation, /pnpm --filter @portfolio\/web add <package>/);
});

const CONTROLS = `variantControls:
  acme-ocean:
    version: 2
    values:
      heroLayout: full
      columns: 3
      leadSection: work
      featured: [gone]
      sparkle: true
  acme-reef:
    version: 9
    values:
      anything: [1, 2]
sections:
  work:
    hidden: true
`;

test("the selected variant's controls are checked at their pointers; another variant's are kept unchecked", () => {
  const result = check(site('acme-ocean', CONTROLS));
  assert.deepEqual(
    ours(result.diagnostics).map(({ code, pointer, line }) => [code, pointer, line]),
    // Sorted by pointer, as #4 sorts every record.
    [
      ['controls.dangling-ref', '/variantControls/acme-ocean/values/featured/0', 25],
      ['controls.invalid', '/variantControls/acme-ocean/values/heroLayout', 22],
      ['controls.dangling-ref', '/variantControls/acme-ocean/values/leadSection', 24],
      ['controls.invalid', '/variantControls/acme-ocean/values/sparkle', 26],
    ],
  );
  assert.ok(result.notChecked.includes('site.variantControls.acme-reef'));
  assert.ok(!result.notChecked.includes('site.variantControls.acme-ocean'));
  for (const record of ours(result.diagnostics)) {
    assert.equal(record.severity, 'blocks-publish');
    assert.ok(record.message.startsWith(record.pointer), record.message);
  }
});

test('a stored version other than the manifest is controls.stale, reported once', () => {
  const stale = CONTROLS.replace('version: 2', 'version: 1');
  assert.deepEqual(
    ours(check(site('acme-ocean', stale)).diagnostics).map(({ code, pointer }) => [code, pointer]),
    [['controls.stale', '/variantControls/acme-ocean/version']],
  );
});

test('with the selection unavailable, every stored entry is kept unchecked', () => {
  const result = check(site('editorial', CONTROLS));
  assert.deepEqual(
    ours(result.diagnostics).map(({ code }) => code),
    ['variant.unavailable'],
  );
  for (const id of ['acme-ocean', 'acme-reef']) {
    assert.ok(result.notChecked.includes(`site.variantControls.${id}`), id);
  }
});

const ROUTES = `routes:
  home:
    enabled: false
  chapters:
    enabled: false
  reels:
    enabled: true
`;

test("route toggles for routes the variant doesn't have warn, and home can't be turned off", () => {
  const result = check(site('acme-ocean', ROUTES));
  assert.deepEqual(
    ours(result.diagnostics).map(({ code, severity, pointer }) => [code, severity, pointer]),
    [
      ['route.required', 'warning', '/routes/home/enabled'],
      ['route.unknown', 'warning', '/routes/reels'],
    ],
  );
  assert.ok(!result.notChecked.some((entry) => entry.startsWith('site.routes.')));
  // With the selection unavailable, the toggles stay unchecked.
  const unavailable = check(site('editorial', ROUTES));
  assert.ok(unavailable.notChecked.includes('site.routes.reels'));
});

test('each validator stands alone, with an id #4 lists when it fails', () => {
  assert.deepEqual(
    [validateSelection(REGISTRY), validateControls(REGISTRY), validateRoutes(REGISTRY)].map(
      ({ id }) => id,
    ),
    ['variant-selection', 'variant-controls', 'variant-routes'],
  );
  // A registry that throws on read leaves validator:<id> unchecked rather than a record.
  const broken = new Proxy([] as never as VariantRegistry, {
    get(target, key) {
      if (key === 'find' || key === 'map') throw new Error('broken registry');
      return Reflect.get(target, key);
    },
  });
  const result = check(site('acme-ocean'), broken);
  assert.ok(result.notChecked.includes('validator:variant-selection'));
});

test("a stored ref to a section the variant won't render dangles: hidden or an unregistered extension's", () => {
  const portfolio = `${PORTFOLIO}
  - kind: '@acme/portfolio-photography/exhibitions'
    id: shows
    data: { items: [{ title: Tidelines }] }
`;
  const stored = `variantControls:
  acme-ocean:
    version: 2
    values:
      featured: [shows]
`;
  const refs = (extensions: ContentExtension[], extra = '') => {
    const result = check(site('acme-ocean', `${stored}${extra}`), REGISTRY, {
      portfolio,
      extensions,
    });
    assert.ok(result.pair, JSON.stringify(result.diagnostics));
    return ours(result.diagnostics).map(({ code, pointer }) => [code, pointer]);
  };
  assert.deepEqual(refs([exhibitions]), []);
  assert.deepEqual(refs([]), [
    ['controls.dangling-ref', '/variantControls/acme-ocean/values/featured/0'],
  ]);
  assert.deepEqual(refs([exhibitions], 'sections:\n  shows: { hidden: true }\n'), [
    ['controls.dangling-ref', '/variantControls/acme-ocean/values/featured/0'],
  ]);
});
