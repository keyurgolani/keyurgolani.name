import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  validatePublicationUnit,
  type ContentExtension,
  type Diagnostic,
  type ParsedPair,
} from '@portfolio/schema';
import { exhibitions } from './__fixtures__/extension';
import {
  compatibilityFor,
  evaluateCompatibility,
  REPORT_VERSION,
  type CompatibilityOptions,
} from './compatibility';
import { UNIT_CODES } from './diagnostics';
import type { VariantManifest } from './manifest-schema';
import type { VariantRegistry } from './registry';
import { validateManifest } from './validate-manifest';
import { contractValidators } from './validators';

// The compatibility report (#5, Slice 5, item 1): how a pair renders in a
// composition, and each finding of the blocking-rules table (item 2) with its
// exact code, document, pointer, and severity, live and not.

const PAIRS = new URL('../../schema/src/__fixtures__/pairs/', import.meta.url);
const PAIR = new URL('engineering/yaml/', PAIRS);
const PORTFOLIO = readFileSync(new URL('portfolio.yml', PAIR), 'utf8');
const SITE = readFileSync(new URL('site.yml', PAIR), 'utf8');

/** The fixture manifest, changed by `edit`, checked as a package would be. */
function manifest(edit: (raw: Record<string, unknown>) => void = () => {}): VariantManifest {
  const raw = JSON.parse(
    readFileSync(new URL('./__fixtures__/manifest.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  edit(raw);
  const result = validateManifest(raw, { packageName: `@acme/${String(raw.id).slice(5)}` });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.manifest;
}

function fallbackManifest(): VariantManifest {
  const raw = JSON.parse(
    readFileSync(new URL('../../fallback-composition/manifest.json', import.meta.url), 'utf8'),
  );
  const result = validateManifest(raw, { packageName: '@portfolio/fallback-composition' });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.manifest;
}

const OCEAN = manifest();
const FALLBACK = fallbackManifest();
const REGISTRY: VariantRegistry = [
  { packageName: '@portfolio/fallback-composition', version: '0.1.1', manifest: FALLBACK },
  { packageName: '@acme/ocean', version: '1.0.0', manifest: OCEAN },
];

/** The engineering pair's site, selecting `variant`, with extra YAML appended. */
function site(variant: string, extra = ''): string {
  return `${SITE.replace(/^ {2}variant: .+$/m, `  variant: ${variant}`)}${extra}`;
}

/** The pair the texts parse to, which must render. */
function pair(
  siteText: string,
  portfolio = PORTFOLIO,
  extensions: readonly ContentExtension[] = [],
): ParsedPair {
  const result = validatePublicationUnit(
    {
      portfolio: { text: portfolio, format: 'yaml', name: 'portfolio.yml' },
      site: { text: siteText, format: 'yaml', name: 'site.yml' },
    },
    { extensions },
  );
  assert.ok(result.pair, JSON.stringify(result.diagnostics));
  return result.pair;
}

const where = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.map(({ code, severity, document, pointer }) => [code, severity, document, pointer]);

/** A section appended to the engineering portfolio. */
const withSections = (...yaml: string[]) => `${PORTFOLIO}${yaml.join('')}`;
const GITHUB = `
  - kind: github
    id: code
    username: ines
`;
const ESSAYS = (id: string) => `
  - kind: writings
    id: ${id}
    title: Essays
    items:
      - { title: On rollbacks, url: 'https://okafor.test/rollbacks' }
`;
const SHOWS = `
  - kind: '@acme/portfolio-photography/exhibitions'
    id: shows
    data: { items: [{ title: Tidelines }] }
`;

test('the report says how each kind renders, how full each slot is, and what to fix', () => {
  const report = compatibilityFor(pair(site('acme-ocean')), { registry: REGISTRY });
  assert.equal(report.reportVersion, REPORT_VERSION);
  assert.deepEqual(report.variant, {
    requested: 'acme-ocean',
    rendered: 'acme-ocean',
    version: '1.0.0',
  });
  assert.match(report.inputHash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(report.kinds, [
    { kind: 'hero', sections: 1, renderer: 'bespoke' },
    { kind: 'lede', sections: 1, renderer: 'shared' },
    { kind: 'stats', sections: 1, renderer: 'shared' },
    { kind: 'projects', sections: 1, renderer: 'shared' },
    { kind: 'experience', sections: 1, renderer: 'shared' },
    { kind: 'skills', sections: 1, renderer: 'shared' },
    { kind: 'stack', sections: 1, renderer: 'shared' },
    { kind: 'contact', sections: 1, renderer: 'shared' },
  ]);
  const notes = (id: string) => OCEAN.contentSlots.find((slot) => slot.id === id)!.whenEmpty;
  assert.deepEqual(report.slots, [
    {
      id: 'lead',
      label: 'Lead story',
      level: 'recommended',
      count: 0,
      min: 1,
      max: 1,
      whenEmpty: notes('lead'),
    },
    {
      id: 'essays',
      label: 'Essays',
      level: 'required',
      count: 0,
      min: 1,
      whenEmpty: notes('essays'),
    },
    {
      id: 'portrait',
      label: 'Portrait',
      level: 'optional',
      count: 0,
      min: 0,
      max: 1,
      whenEmpty: notes('portrait'),
    },
    {
      id: 'project-images',
      label: 'Project images',
      level: 'optional',
      count: 0,
      min: 0,
      whenEmpty: notes('project-images'),
    },
  ]);
  // Empty optional slots are in slots alone; the rest say where to fill them.
  assert.deepEqual(where(report.diagnostics), [
    ['slot.required-empty', 'blocks-publish', 'portfolio', '/sections'],
    ['slot.recommended-empty', 'warning', 'site', '/variantControls/acme-ocean/values/leadSection'],
  ]);
  assert.equal(report.status, 'blocks-publish');
  assert.deepEqual(report.routes, []);
  // No recipe registry until #20, so the recommended appearance waits.
  assert.deepEqual(report.notChecked, ['variant.recommendedAppearance']);
});

test('a slot counts sections of its kind, sections its control points at, and the values its field holds', () => {
  const portfolio = withSections(ESSAYS('essays'), ESSAYS('notebook')).replace(
    '  email: ines@okafor.test\n',
    '  email: ines@okafor.test\n  avatar: { src: /ines.jpg, alt: Ines Okafor }\n',
  );
  const stored = `variantControls:
  acme-ocean:
    version: 2
    values:
      leadSection: notebook
`;
  const report = compatibilityFor(pair(site('acme-ocean', stored), portfolio), {
    registry: REGISTRY,
  });
  assert.deepEqual(
    report.slots.map(({ id, count, whenEmpty }) => [id, count, whenEmpty !== undefined]),
    [
      ['lead', 1, false],
      ['essays', 2, false],
      ['portrait', 1, false],
      ['project-images', 0, true],
    ],
  );
  assert.deepEqual(where(report.diagnostics), []);
  assert.equal(report.status, 'ok');
});

/** Ocean, changed to raise every Slice 5 finding but variant.unavailable's. */
const STRICT = manifest((raw) => {
  raw.id = 'acme-strict';
  raw.textDirection = ['ltr'];
  const slots = raw.contentSlots as Record<string, unknown>[];
  slots.find((slot) => slot.id === 'essays')!.max = 1;
});
const STRICT_REGISTRY: VariantRegistry = [
  ...REGISTRY,
  { packageName: '@acme/strict', version: '3.0.0', manifest: STRICT },
];

test('every Slice 5 finding has its exact code, document, pointer, and severity', () => {
  const portfolio = withSections(GITHUB, ESSAYS('essays'), ESSAYS('notebook'), SHOWS).replace(
    'direction: ltr',
    'direction: rtl',
  );
  const unit = pair(site('acme-strict'), portfolio, [exhibitions]);
  const options: CompatibilityOptions = {
    registry: STRICT_REGISTRY,
    extensions: [exhibitions],
    recipes: ['quiet-paper'],
  };
  const report = compatibilityFor(unit, options);
  // The engineering portfolio has 8 sections, so the appended ones are 8 to 11.
  assert.deepEqual(where(report.diagnostics), [
    ['direction.unsupported', 'warning', 'portfolio', '/direction'],
    ['kind.unsupported', 'warning', 'portfolio', '/sections/8'],
    ['slot.overflow', 'warning', 'portfolio', '/sections/10'],
    ['kind.no-renderer', 'blocks-publish', 'portfolio', '/sections/11'],
    ['appearance.unknown-recipe', 'warning', 'site', '/appearance/variant'],
    [
      'slot.recommended-empty',
      'warning',
      'site',
      '/variantControls/acme-strict/values/leadSection',
    ],
  ]);
  assert.deepEqual(
    report.kinds.filter(({ kind }) => kind === 'github' || kind.startsWith('@')),
    [
      { kind: 'github', sections: 1, renderer: 'unsupported' },
      { kind: '@acme/portfolio-photography/exhibitions', sections: 1, renderer: 'none' },
    ],
  );
  assert.deepEqual(report.notChecked, []);
  // Live, as startup checks the pair, what renders anyway only warns.
  const live = compatibilityFor(unit, { ...options, live: true });
  assert.deepEqual(
    live.diagnostics.map(({ code, severity }) => [code, severity]),
    report.diagnostics.map(({ code }) => [code, 'warning']),
  );
  assert.equal(live.status, 'warning');
  // With its extension's renderer registered, the exhibitions render.
  const rendered = compatibilityFor(unit, {
    ...options,
    extensionRenderers: ['@acme/portfolio-photography/exhibitions'],
  });
  assert.ok(!rendered.diagnostics.some(({ code }) => code === 'kind.no-renderer'));
  assert.deepEqual(rendered.kinds.at(-1), {
    kind: '@acme/portfolio-photography/exhibitions',
    sections: 1,
    renderer: 'extension',
  });
});

test('a section in a language that runs right to left is direction.unsupported at its lang', () => {
  const portfolio = withSections(`
  - kind: lede
    id: arabic
    lang: ar
    body: نبذة قصيرة
`);
  const report = compatibilityFor(pair(site('acme-strict'), portfolio), {
    registry: STRICT_REGISTRY,
  });
  assert.deepEqual(
    where(report.diagnostics).filter(([code]) => code === 'direction.unsupported'),
    [['direction.unsupported', 'warning', 'portfolio', '/sections/8/lang']],
  );
  // A composition that declares rtl lays it out either way.
  const ocean = compatibilityFor(pair(site('acme-ocean'), portfolio), { registry: REGISTRY });
  assert.ok(!ocean.diagnostics.some(({ code }) => code === 'direction.unsupported'));
});

test('each message starts at its pointer, says what renders, ends on what it blocks, and repeats no document value', () => {
  const portfolio = withSections(GITHUB, ESSAYS('essays'), ESSAYS('notebook'), SHOWS).replace(
    'direction: ltr',
    'direction: rtl',
  );
  const stored = `variantControls:
  acme-strict:
    version: 2
    values:
      heroLayout: full
      featured: [gone]
`;
  const report = compatibilityFor(pair(`${site('missing-variant')}`, portfolio, [exhibitions]), {
    registry: STRICT_REGISTRY,
    extensions: [exhibitions],
  });
  const strict = compatibilityFor(pair(site('acme-strict', stored), portfolio, [exhibitions]), {
    registry: STRICT_REGISTRY,
    extensions: [exhibitions],
    recipes: [],
  });
  const all = [...report.diagnostics, ...strict.diagnostics];
  assert.ok(all.length >= 9, String(all.length));
  for (const record of all) {
    assert.ok(Object.hasOwn(UNIT_CODES, record.code), record.code);
    assert.ok(record.message.startsWith(`${record.pointer} `), record.message);
    const gate =
      UNIT_CODES[record.code as keyof typeof UNIT_CODES] === 'blocks-publish'
        ? 'It blocks publishing, not preview.'
        : 'It blocks neither preview nor publishing.';
    assert.ok(record.message.endsWith(gate), record.message);
    assert.ok(record.remediation.length > 0, record.code);
    for (const value of ['missing-variant', 'notebook', 'shows', 'code', 'github', 'exhibitions']) {
      assert.ok(!record.message.includes(value), `${record.code}: ${record.message}`);
    }
  }
  // Each code here at least once.
  assert.deepEqual([...new Set(all.map(({ code }) => code))].sort(), [
    'appearance.unknown-recipe',
    'controls.dangling-ref',
    'controls.invalid',
    'direction.unsupported',
    'kind.no-renderer',
    'kind.unsupported',
    'slot.overflow',
    'slot.recommended-empty',
    'variant.unavailable',
  ]);
});

test("a selection the registry doesn't have is reported against the fallback composition", () => {
  const report = compatibilityFor(pair(site('editorial')), { registry: REGISTRY });
  assert.deepEqual(report.variant, {
    requested: 'editorial',
    rendered: 'fallback',
    version: '0.1.1',
  });
  assert.deepEqual(where(report.diagnostics), [
    ['variant.unavailable', 'blocks-publish', 'site', '/appearance/variant'],
  ]);
  assert.ok(report.kinds.every(({ renderer }) => renderer === 'shared'));
  assert.deepEqual(report.slots, []);
  // Without a fallback composition, only the selection is checked.
  const bare = compatibilityFor(pair(site('editorial')), {
    registry: REGISTRY.filter(({ manifest: { id } }) => id !== 'fallback'),
  });
  assert.deepEqual(
    bare.diagnostics.map(({ code }) => code),
    ['variant.unavailable'],
  );
  assert.ok(bare.notChecked.includes('variant.compatibility'));
});

test("routes lists the previous variant's path views this one has no view for", () => {
  const candidate = manifest((raw) => {
    raw.id = 'acme-reef';
    raw.routes = {
      home: 'shared',
      work: 'shared',
      // The same address as Ocean's chapters/{chapter}, whatever the placeholder is called.
      views: [{ id: 'parts', under: 'home', type: 'path', segment: 'chapters/{part}' }],
    };
    raw.keyBindings = [];
  });
  const registry: VariantRegistry = [
    ...REGISTRY,
    { packageName: '@acme/reef', version: '2.0.0', manifest: candidate },
  ];
  const unit = pair(site('acme-reef'));
  const report = compatibilityFor(unit, { registry, previous: OCEAN });
  // Ocean's fragment view is an anchor on home, not an address of its own.
  assert.deepEqual(report.routes, [{ id: 'notes', under: 'work', segment: 'notes' }]);
  assert.deepEqual(compatibilityFor(unit, { registry, previous: candidate }).routes, []);
  assert.deepEqual(compatibilityFor(unit, { registry }).routes, []);
});

test('inputHash is the same for the same inputs, and follows what the report depends on', () => {
  const unit = pair(site('acme-ocean'));
  const options = { registry: REGISTRY };
  const hash = compatibilityFor(unit, options).inputHash;
  assert.equal(compatibilityFor(unit, options).inputHash, hash);
  // Key order is the document's business, not the report's.
  const moved = site('acme-ocean').replace('motionPolicy: respect-os\n', '');
  assert.notEqual(moved, site('acme-ocean'));
  const reordered = pair(`${moved}motionPolicy: respect-os\n`);
  assert.equal(compatibilityFor(reordered, options).inputHash, hash);
  const edited = pair(site('acme-ocean'), PORTFOLIO.replace('Platform engineer\n', 'Engineer\n'));
  assert.notEqual(compatibilityFor(edited, options).inputHash, hash);
  assert.notEqual(compatibilityFor(unit, { ...options, live: true }).inputHash, hash);
  assert.notEqual(compatibilityFor(unit, { ...options, previous: OCEAN }).inputHash, hash);
  const flipped = evaluateCompatibility(OCEAN, structuredClone(unit), options);
  assert.equal(flipped.inputHash, hash);
});

test('the fallback composition renders every fixture pair, with nothing to fix but the selection', () => {
  const pairs = readdirSync(PAIRS).sort();
  assert.ok(pairs.length >= 8, pairs.join());
  for (const name of pairs) {
    for (const format of ['yaml', 'json'] as const) {
      const dir = new URL(`${name}/${format}/`, PAIRS);
      const extension = format === 'yaml' ? 'yml' : 'json';
      const result = validatePublicationUnit(
        {
          portfolio: {
            text: readFileSync(new URL(`portfolio.${extension}`, dir), 'utf8'),
            format,
            name: `portfolio.${extension}`,
          },
          site: {
            text: readFileSync(new URL(`site.${extension}`, dir), 'utf8'),
            format,
            name: `site.${extension}`,
          },
        },
        { validators: contractValidators(REGISTRY, { live: true }) },
      );
      assert.ok(result.pair, `${name}/${format}`);
      const report = compatibilityFor(result.pair, { registry: REGISTRY, live: true });
      assert.equal(report.variant.rendered, 'fallback', `${name}/${format}`);
      assert.ok(
        report.kinds.every(({ renderer }) => renderer === 'shared'),
        `${name}/${format}: ${JSON.stringify(report.kinds)}`,
      );
      // Each pair selects a variant this build doesn't register yet.
      assert.deepEqual(
        where(report.diagnostics),
        [['variant.unavailable', 'warning', 'site', '/appearance/variant']],
        `${name}/${format}`,
      );
      assert.equal(report.status, 'warning');
      // The validator hands #4 the same findings.
      assert.deepEqual(
        where(result.diagnostics.filter(({ code }) => Object.hasOwn(UNIT_CODES, code))),
        where(report.diagnostics),
        `${name}/${format}`,
      );
    }
  }
});

test('in #4, the records are located, and a section finding carries its stable id', () => {
  const portfolio = withSections(GITHUB);
  const result = validatePublicationUnit(
    {
      portfolio: { text: portfolio, format: 'yaml', name: 'portfolio.yml' },
      site: { text: site('acme-ocean'), format: 'yaml', name: 'site.yml' },
    },
    { validators: contractValidators(REGISTRY) },
  );
  const record = result.diagnostics.find(({ code }) => code === 'kind.unsupported');
  assert.ok(record, JSON.stringify(result.diagnostics));
  assert.equal(record.pointer, '/sections/8');
  assert.equal(record.stableId, 'code');
  assert.equal(record.line, PORTFOLIO.split('\n').length + 1);
  assert.ok(result.pair);
});
