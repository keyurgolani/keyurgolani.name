import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  defineContentExtension,
  validatePublicationUnit,
  type ContentExtension,
  type Diagnostic,
} from '@portfolio/schema';
import { exhibitions } from './__fixtures__/extension';
import type { VariantRegistry } from './registry';
import { validateManifest } from './validate-manifest';
import { contractValidators, validateCompatibility } from './validators';

// The contract's publication-unit checks from Slice 1, the selection, the
// stored control values, and the route toggles, which Slice 5 folds into the
// compatibility validator, run inside #4's validatePublicationUnit(): located
// in the site document, with #4's severities, and covering the entries #4
// leaves unchecked. compatibility.test.ts covers the rest of the report.

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

function fallbackManifest() {
  const raw = JSON.parse(
    readFileSync(new URL('../../fallback-composition/manifest.json', import.meta.url), 'utf8'),
  );
  const result = validateManifest(raw, { packageName: '@portfolio/fallback-composition' });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.manifest;
}

const FALLBACK = fallbackManifest();

/** The registry with the fallback composition, as every build has it. */
const WITH_FALLBACK: VariantRegistry = [
  { packageName: '@portfolio/fallback-composition', version: '0.1.1', manifest: FALLBACK },
  ...REGISTRY,
];

/** The engineering pair's site, selecting `variant`, with extra YAML appended. */
function site(variant: string, extra = ''): string {
  // The first `variant:` line is the appearance's; visitorControls has the other.
  return `${SITE.replace(/^ {2}variant: .+$/m, `  variant: ${variant}`)}${extra}`;
}

function check(
  siteText: string,
  registry: VariantRegistry = REGISTRY,
  {
    portfolio = PORTFOLIO,
    extensions = [],
    live = false,
  }: { portfolio?: string; extensions?: ContentExtension[]; live?: boolean } = {},
) {
  return validatePublicationUnit(
    {
      portfolio: { text: portfolio, format: 'yaml', name: 'portfolio.yml' },
      site: { text: siteText, format: 'yaml', name: 'site.yml' },
    },
    { validators: contractValidators(registry, { live }), extensions },
  );
}

/** Slice 1's codes, which this file is about. */
const SLICE_1 = new Set([
  'variant.unavailable',
  'controls.invalid',
  'controls.stale',
  'controls.dangling-ref',
  'route.unknown',
  'route.required',
]);

const ours = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.filter(({ code }) => SLICE_1.has(code));

/** Each of ours as its code, severity, document, and pointer. */
const where = (diagnostics: readonly Diagnostic[]) =>
  ours(diagnostics).map(({ code, severity, document, pointer }) => [
    code,
    severity,
    document,
    pointer,
  ]);

test('a registered selection with no stored controls or toggles has nothing to report', () => {
  const result = check(site('acme-ocean'));
  assert.deepEqual(ours(result.diagnostics), []);
  assert.ok(result.pair);
  // The compatibility validator checks the variant, so #4 no longer lists it as unchecked.
  assert.ok(!result.notChecked.includes('site.appearance.variant'));
  assert.ok(result.notChecked.includes('site.appearance.colorScheme'));
});

test('an unregistered selection and missing-variant are variant.unavailable', () => {
  for (const variant of ['editorial', 'missing-variant']) {
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
    // The message never repeats the document's value.
    assert.ok(!records[0]!.message.includes(variant), records[0]!.message);
    assert.match(records[0]!.remediation, /acme-ocean, acme-reef/);
  }
});

test("#4's site schema refuses the fallback composition before the validators run", () => {
  const result = check(site('fallback'));
  assert.equal(result.pair, null);
  assert.deepEqual(
    result.diagnostics.map(({ code, severity, pointer }) => [code, severity, pointer]),
    [['schema.invalid', 'blocks-preview', '/appearance/variant']],
  );
  assert.match(result.diagnostics[0]!.message, /can't be selected/);
  // Called on its own, the selection check refuses it too, live or not.
  const parsed = check(site('acme-ocean')).pair!;
  const appearance = { ...parsed.site.appearance, variant: 'fallback' };
  const pair = { ...parsed, site: { ...parsed.site, appearance } };
  for (const live of [false, true]) {
    const [record] = ours(validateCompatibility(REGISTRY, { live }).validate(pair, {}).diagnostics);
    assert.deepEqual([record!.code, record!.severity], ['variant.unavailable', 'blocks-publish']);
    assert.match(record!.message, /can't be selected/);
  }
});

test('with nothing registered, the remediation says how to install a variant, once', () => {
  const [record] = ours(check(site('editorial'), []).diagnostics);
  assert.equal(
    record!.remediation,
    'Install its package with pnpm --filter @portfolio/web add <package> and rebuild. This build registers no variant yet.',
  );
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
    where(result.diagnostics),
    // Sorted by pointer, as #4 sorts every record.
    [
      [
        'controls.dangling-ref',
        'blocks-publish',
        'site',
        '/variantControls/acme-ocean/values/featured/0',
      ],
      [
        'controls.invalid',
        'blocks-publish',
        'site',
        '/variantControls/acme-ocean/values/heroLayout',
      ],
      [
        'controls.dangling-ref',
        'blocks-publish',
        'site',
        '/variantControls/acme-ocean/values/leadSection',
      ],
      ['controls.invalid', 'blocks-publish', 'site', '/variantControls/acme-ocean/values/sparkle'],
    ],
  );
  assert.deepEqual(
    ours(result.diagnostics).map(({ line }) => line),
    [25, 22, 24, 26],
  );
  assert.ok(result.notChecked.includes('site.variantControls.acme-reef'));
  assert.ok(!result.notChecked.includes('site.variantControls.acme-ocean'));
  for (const record of ours(result.diagnostics)) {
    assert.ok(record.message.startsWith(record.pointer), record.message);
  }
  // A declared control's bad value renders its default; a key no control declares is read by nothing.
  const message = (pointer: string) =>
    ours(result.diagnostics).find((record) => record.pointer === pointer)!.message;
  assert.equal(
    message('/variantControls/acme-ocean/values/heroLayout'),
    "/variantControls/acme-ocean/values/heroLayout must be one of the control's options. The control renders its default. It blocks publishing, not preview.",
  );
  assert.equal(
    message('/variantControls/acme-ocean/values/sparkle'),
    "/variantControls/acme-ocean/values/sparkle names a control the variant doesn't declare. Nothing reads it. It blocks publishing, not preview.",
  );
});

test('a stored version other than the manifest is controls.stale, reported once', () => {
  const stale = CONTROLS.replace('version: 2', 'version: 1');
  assert.deepEqual(where(check(site('acme-ocean', stale)).diagnostics), [
    ['controls.stale', 'blocks-publish', 'site', '/variantControls/acme-ocean/version'],
  ]);
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
  assert.deepEqual(where(result.diagnostics), [
    ['route.required', 'warning', 'site', '/routes/home/enabled'],
    ['route.unknown', 'warning', 'site', '/routes/reels'],
  ]);
  assert.ok(!result.notChecked.some((entry) => entry.startsWith('site.routes.')));
  // With the selection unavailable, the toggles stay unchecked, with or
  // without a fallback composition to render in its place: they're about the
  // selection's routes.
  for (const registry of [REGISTRY, WITH_FALLBACK]) {
    const unavailable = check(site('editorial', ROUTES), registry);
    assert.deepEqual(
      ours(unavailable.diagnostics).map(({ code }) => code),
      ['variant.unavailable'],
    );
    for (const id of ['home', 'chapters', 'reels']) {
      assert.ok(unavailable.notChecked.includes(`site.routes.${id}`), id);
    }
  }
});

test('live, the records that fall back only warn, and the rest keep their severity', () => {
  const unavailable = check(site('editorial', ROUTES), REGISTRY, { live: true });
  assert.deepEqual(where(unavailable.diagnostics), [
    ['variant.unavailable', 'warning', 'site', '/appearance/variant'],
  ]);
  const controls = check(site('acme-ocean', `${CONTROLS}${ROUTES}`), REGISTRY, { live: true });
  assert.deepEqual(where(controls.diagnostics), [
    ['route.required', 'warning', 'site', '/routes/home/enabled'],
    ['route.unknown', 'warning', 'site', '/routes/reels'],
    ['controls.dangling-ref', 'warning', 'site', '/variantControls/acme-ocean/values/featured/0'],
    ['controls.invalid', 'warning', 'site', '/variantControls/acme-ocean/values/heroLayout'],
    ['controls.dangling-ref', 'warning', 'site', '/variantControls/acme-ocean/values/leadSection'],
    ['controls.invalid', 'warning', 'site', '/variantControls/acme-ocean/values/sparkle'],
  ]);
  const stale = CONTROLS.replace('version: 2', 'version: 1');
  assert.deepEqual(where(check(site('acme-ocean', stale), REGISTRY, { live: true }).diagnostics), [
    ['controls.stale', 'warning', 'site', '/variantControls/acme-ocean/version'],
  ]);
  // Not live, as #3's publish checks, every one of them blocks publishing.
  const published = ours(check(site('acme-ocean', CONTROLS)).diagnostics);
  assert.deepEqual([...new Set(published.map(({ severity }) => severity))], ['blocks-publish']);
});

test('the compatibility validator is the one the host passes, with an id #4 lists when it fails', () => {
  assert.deepEqual(
    contractValidators(REGISTRY).map(({ id }) => id),
    ['variant-compatibility'],
  );
  // A registry that throws on read leaves validator:<id> unchecked rather than a record.
  const broken = new Proxy([] as never as VariantRegistry, {
    get(target, key) {
      if (key === 'find' || key === 'map') throw new Error('broken registry');
      return Reflect.get(target, key);
    },
  });
  const result = check(site('acme-ocean'), broken);
  assert.ok(result.notChecked.includes('validator:variant-compatibility'));
});

test("an extension whose fields throw when read can't take any finding with it", () => {
  // Its fields schema hands back an object whose field throws once it's read,
  // as hashing the pair reads every field. The validator doesn't hash.
  const unreadable = defineContentExtension({
    namespace: '@acme/portfolio-unreadable',
    fields: z
      .object({ shot: z.string() })
      .strict()
      .transform(() => ({
        get shot(): string {
          throw new Error('unreadable');
        },
      })),
  });
  const portfolio = PORTFOLIO.replace(
    '  email: ines@okafor.test\n',
    "  email: ines@okafor.test\n  extensions:\n    '@acme/portfolio-unreadable': { shot: dawn }\n",
  );
  assert.notEqual(portfolio, PORTFOLIO);
  const findings = (siteText: string, registry: VariantRegistry) => {
    const result = check(siteText, registry, { portfolio, extensions: [unreadable] });
    assert.ok(result.pair, JSON.stringify(result.diagnostics));
    assert.ok(!result.notChecked.includes('validator:variant-compatibility'));
    return ours(result.diagnostics).map(({ code, pointer }) => [code, pointer]);
  };
  assert.deepEqual(findings(site('editorial'), WITH_FALLBACK), [
    ['variant.unavailable', '/appearance/variant'],
  ]);
  assert.deepEqual(findings(site('acme-ocean', CONTROLS), WITH_FALLBACK), [
    ['controls.dangling-ref', '/variantControls/acme-ocean/values/featured/0'],
    ['controls.invalid', '/variantControls/acme-ocean/values/heroLayout'],
    ['controls.dangling-ref', '/variantControls/acme-ocean/values/leadSection'],
    ['controls.invalid', '/variantControls/acme-ocean/values/sparkle'],
  ]);
});

test('when checking the composition throws, variant.unavailable still stands and the rest is unchecked', () => {
  // A fallback composition whose manifest fails once the composition is checked.
  const broken = new Proxy(FALLBACK, {
    get(target, key) {
      if (key === 'renderedKinds') throw new Error('broken manifest');
      return Reflect.get(target, key);
    },
  });
  const registry: VariantRegistry = [
    { packageName: '@portfolio/fallback-composition', version: '0.1.1', manifest: broken },
    ...REGISTRY,
  ];
  for (const live of [false, true]) {
    const result = check(site('editorial', `${CONTROLS}${ROUTES}`), registry, { live });
    assert.deepEqual(
      ours(result.diagnostics).map(({ code, severity, pointer }) => [code, severity, pointer]),
      [['variant.unavailable', live ? 'warning' : 'blocks-publish', '/appearance/variant']],
    );
    assert.ok(!result.notChecked.includes('validator:variant-compatibility'));
    for (const entry of [
      'variant.compatibility',
      'site.variantControls.acme-ocean',
      'site.variantControls.acme-reef',
      'site.routes.home',
      'site.routes.reels',
    ]) {
      assert.ok(result.notChecked.includes(entry), entry);
    }
  }
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
