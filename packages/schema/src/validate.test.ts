import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parse as parseYaml } from 'yaml';
import { defineContentExtension } from './extensions';
import type { AppearanceSelection } from './site';
import {
  DIAGNOSTIC_SEVERITIES,
  validatePublicationUnit,
  type AppearanceCatalog,
  type Context,
  type Diagnostic,
  type SourceDocument,
  type UnitValidator,
} from './validate';

const lines = (...text: string[]) => `${text.join('\n')}\n`;

const PORTFOLIO = lines(
  'schemaVersion: 2',
  'locale: en',
  'direction: ltr',
  'identity:',
  '  name: Rowan Test',
  'links:',
  '  - url: https://rowan.name',
  'sections:',
  '  - kind: lede',
  '    id: about',
  '    title: About',
  '    body: Hi',
  '  - kind: contact',
  '    id: contact',
  '    title: Contact',
);

const SITE = lines(
  'schemaVersion: 2',
  'appearance:',
  '  variant: editorial',
  '  designLanguage: platform-neutral',
  '  colorScheme: warm',
  '  typography: classic',
  '  displayMode: system',
  'visitorControls:',
  '  variant: locked',
  '  designLanguage: locked',
  '  colorScheme: selectable',
  '  typography: locked',
  '  displayMode: selectable',
  'motionPolicy: respect-os',
  'features:',
  '  feed: true',
);

/** The host's interim catalog, with Editorial's ids. */
const CATALOG: AppearanceCatalog = {
  ids(axis, selection: AppearanceSelection) {
    switch (axis) {
      case 'variant':
        return ['editorial', 'kinetic-cosmos'];
      case 'colorScheme':
        return selection.variant === 'editorial' ? ['warm', 'noir'] : null;
      case 'typography':
        return selection.variant === 'editorial' ? ['classic', 'modernist'] : null;
      case 'displayMode':
        return ['system', 'light', 'dark'];
      default:
        return null;
    }
  },
  generatorInput: () => undefined,
};
const CONTEXT: Context = { catalog: CATALOG, canonicalOrigin: 'https://rowan.name' };

const yaml = (text: string, name: string): SourceDocument => ({ text, format: 'yaml', name });
const unit = (portfolio = PORTFOLIO, site = SITE) => ({
  portfolio: yaml(portfolio, 'portfolio.yml'),
  site: yaml(site, 'site.yml'),
});
const validate = (portfolio?: string, site?: string, ctx: Context = CONTEXT) =>
  validatePublicationUnit(unit(portfolio, site), ctx);

/** The findings as [document, code, severity, pointer, line, column]. */
const found = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.map(({ document, code, severity, pointer, line, column }) => [
    document,
    code,
    severity,
    pointer,
    line,
    column,
  ]);
const codes = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.map(({ document, code, pointer }) => `${document}:${code}:${pointer}`);

test('a valid pair returns both models, and checks without their context are listed', () => {
  const bare = validatePublicationUnit(unit());
  assert.deepEqual(bare.diagnostics, []);
  assert.equal(bare.pair?.portfolio.identity.name, 'Rowan Test');
  assert.equal(bare.pair?.site.appearance.variant, 'editorial');
  assert.deepEqual(bare.notChecked, [
    'origin.sample',
    'origin.stale',
    'site.appearance.colorScheme',
    'site.appearance.designLanguage',
    'site.appearance.displayMode',
    'site.appearance.typography',
    'site.appearance.variant',
  ]);
  const checked = validate();
  assert.deepEqual(checked.diagnostics, []);
  assert.deepEqual(checked.notChecked, ['site.appearance.designLanguage']);
});

test('syntax, version, and schema problems stop rendering, each located in its document', () => {
  const result = validatePublicationUnit({
    portfolio: yaml(PORTFOLIO.replace('identity:', 'identity: &a'), 'portfolio.yml'),
    site: { text: '{ "schemaVersion": 1 }', format: 'json', name: 'site.json' },
  });
  assert.equal(result.pair, null);
  assert.deepEqual(found(result.diagnostics), [
    ['portfolio', 'parse.syntax', 'blocks-preview', '/identity', 4, 11],
    ['site', 'schema.version', 'blocks-preview', '/schemaVersion', 1, 20],
  ]);
  const invalid = validate(PORTFOLIO.replace('  name: Rowan Test', '  name: 7'));
  assert.equal(invalid.pair, null);
  assert.deepEqual(found(invalid.diagnostics), [
    ['portfolio', 'schema.invalid', 'blocks-preview', '/identity/name', 5, 9],
  ]);
  assert.match(invalid.diagnostics[0]!.remediation, /schema expects/);
});

test('deployment settings in the site document point at the environment', () => {
  const result = validate(
    undefined,
    SITE.replace(
      'features:\n  feed: true\n',
      'features:\n  feed: true\n  url: x\norigin: x\nprofile: owner\ncolour: red\n',
    ),
  );
  assert.equal(result.pair, null);
  assert.deepEqual(codes(result.diagnostics), [
    'site:schema.invalid:/colour',
    'site:site.deployment-setting:/features/url',
    'site:site.deployment-setting:/origin',
    'site:site.deployment-setting:/profile',
  ]);
  const [, url, origin, profile] = result.diagnostics;
  assert.equal(
    url!.message,
    "/features/url is a deployment setting, which the site document can't hold.",
  );
  assert.match(url!.remediation, /set PORTFOLIO_ORIGIN in the server's environment/);
  assert.match(origin!.remediation, /PORTFOLIO_ORIGIN/);
  assert.match(profile!.remediation, /PORTFOLIO_PROFILE/);
  assert.equal(origin!.line, 18);
});

test('appearance ids the catalog does not register stop rendering', () => {
  const result = validate(
    undefined,
    SITE.replace('colorScheme: warm', 'colorScheme: neon').replace(
      'displayMode: system',
      'displayMode: high-contrast',
    ),
  );
  assert.equal(result.pair, null);
  assert.deepEqual(found(result.diagnostics), [
    ['site', 'appearance.unknown', 'blocks-preview', '/appearance/colorScheme', 5, 16],
    ['site', 'appearance.unknown', 'blocks-preview', '/appearance/displayMode', 7, 16],
  ]);
  assert.equal(
    result.diagnostics[0]!.message,
    '/appearance/colorScheme names no color scheme this build registers.',
  );
  assert.equal(result.diagnostics[0]!.remediation, 'Use one of: warm, noir.');
  // An unregistered variant leaves its schemes unchecked rather than wrong.
  const variant = validate(undefined, SITE.replace('variant: editorial', 'variant: canvas'));
  assert.deepEqual(codes(variant.diagnostics), ['site:appearance.unknown:/appearance/variant']);
  assert.deepEqual(variant.notChecked, [
    'site.appearance.colorScheme',
    'site.appearance.designLanguage',
    'site.appearance.typography',
  ]);
});

test('appearance inputs are checked against the generator each names, when there is a registry', () => {
  const site = `${SITE}appearanceInputs:\n  brand-seed: { seedColor: '#3366ff' }\n`;
  assert.deepEqual(validate(undefined, site).notChecked, [
    'site.appearance.designLanguage',
    'site.appearanceInputs.brand-seed',
  ]);
  const generator = (takes: 'seed-color' | 'asset' | null): Context => ({
    ...CONTEXT,
    catalog: { ...CATALOG, generatorInput: () => takes },
  });
  assert.deepEqual(validate(undefined, site, generator('seed-color')).diagnostics, []);
  assert.deepEqual(
    validate(undefined, site, generator('asset')).diagnostics.map(({ pointer, message }) => [
      pointer,
      message,
    ]),
    [
      [
        '/appearanceInputs/brand-seed',
        '/appearanceInputs/brand-seed gives its color scheme the wrong kind of input.',
      ],
    ],
  );
  assert.deepEqual(codes(validate(undefined, site, generator(null)).diagnostics), [
    'site:appearance.unknown:/appearanceInputs/brand-seed',
  ]);
});

test('repeated ids, missing references, and empty content block publishing, but the pair renders', () => {
  const repeated = validate(PORTFOLIO.replace('    id: contact', '    id: about'));
  assert.ok(repeated.pair);
  assert.deepEqual(found(repeated.diagnostics), [
    ['portfolio', 'id.duplicate', 'blocks-publish', '/sections/1/id', 14, 9],
  ]);
  assert.equal(repeated.diagnostics[0]!.stableId, 'about');

  const site = `${SITE}sections:\n  about: { hidden: true }\n  contact: { hidden: true }\n  gone: { hidden: true }\n`;
  const result = validate(undefined, site);
  assert.ok(result.pair);
  assert.deepEqual(found(result.diagnostics), [
    ['portfolio', 'content.empty', 'blocks-publish', '/sections', 9, 3],
    ['site', 'ref.missing', 'blocks-publish', '/sections/gone', 20, 9],
  ]);
  assert.equal(result.diagnostics[1]!.stableId, 'gone');
});

test('a #fragment link has to name a visible section', () => {
  const portfolio = PORTFOLIO.replace(
    '  - url: https://rowan.name',
    [
      '  - url: "#contact"',
      '  - url: "/#about"',
      '  - url: "#main"',
      '  - url: "#nowhere"',
      '  - url: "#hidden-bit"',
      '  - url: "#"',
    ].join('\n'),
  ).concat(
    lines(
      '  - kind: cta',
      '    id: hidden-bit',
      '    primaryAction: { url: "#also-nowhere" }',
      "  - kind: '@other/x/y'",
      '    id: extra',
      '    data: { url: "#nowhere-either" }',
    ),
  );
  const site = `${SITE}sections:\n  hidden-bit: { hidden: true }\n`;
  // Only links visitors see are checked, and only visible sections count.
  assert.deepEqual(found(validate(portfolio, site).diagnostics), [
    ['portfolio', 'anchor.broken', 'blocks-publish', '/links/3/url', 10, 10],
    ['portfolio', 'anchor.broken', 'blocks-publish', '/links/4/url', 11, 10],
    ['portfolio', 'extension.unregistered', 'warning', '/sections/3', 24, 5],
  ]);
});

test('a metric with two values blocks publishing, and one shown twice warns', () => {
  const portfolio = PORTFOLIO.concat(
    lines(
      '  - kind: stats',
      '    id: numbers',
      '    items:',
      '      - { metric: tenure-years, value: "12", label: Years }',
      '      - { metric: talks, value: " Forty ", label: Talks }',
      '  - kind: tenure',
      '    id: tenure',
      '    years: 12',
      '  - kind: stats',
      '    id: more-numbers',
      '    items:',
      '      - { metric: tenure-years, value: 13, label: Years }',
      '      - { metric: talks, value: forty, label: Talks }',
    ),
  );
  const result = validate(portfolio);
  assert.ok(result.pair);
  assert.deepEqual(found(result.diagnostics), [
    ['portfolio', 'metric.duplicate', 'warning', '/sections/3/years', 23, 12],
    ['portfolio', 'metric.conflict', 'blocks-publish', '/sections/4/items/0/value', 27, 40],
    ['portfolio', 'metric.duplicate', 'warning', '/sections/4/items/1/value', 28, 33],
  ]);
  assert.equal(
    result.diagnostics[1]!.message,
    '/sections/4/items/0/value and /sections/2/items/0/value give one metric different values.',
  );
});

test('a hidden first statement of a metric hides no visible duplicate', () => {
  const stats = (id: string, value: string) =>
    lines(
      '  - kind: stats',
      `    id: ${id}`,
      '    items:',
      `      - { metric: talks, value: "${value}", label: Talks }`,
    );
  const portfolio = PORTFOLIO.concat(stats('one', '12'), stats('two', '12'), stats('three', '12'));
  const site = `${SITE}sections:\n  one: { hidden: true }\n`;
  assert.deepEqual(codes(validate(portfolio, site).diagnostics), [
    'portfolio:metric.duplicate:/sections/4/items/0/value',
  ]);
  assert.equal(
    validate(portfolio, site).diagnostics[0]!.message,
    '/sections/4/items/0/value and /sections/3/items/0/value show one metric with the same value.',
  );
  // A hidden first statement with another value still contradicts the visible ones.
  const contradicted = PORTFOLIO.concat(
    stats('one', '9'),
    stats('two', '12'),
    stats('three', '12'),
  );
  assert.deepEqual(codes(validate(contradicted, site).diagnostics), [
    'portfolio:metric.conflict:/sections/3/items/0/value',
    'portfolio:metric.conflict:/sections/4/items/0/value',
    'portfolio:metric.duplicate:/sections/4/items/0/value',
  ]);
});

test('secret-shaped text anywhere blocks publishing, and no record repeats it', () => {
  // Built at run time, so no secret-shaped literal sits in the repository.
  const token = `ghp_${'x'.repeat(36)}`;
  const key = `-----BEGIN ${'PRIVATE KEY'}-----`;
  const bcrypt = `$2b$10$${'a'.repeat(53)}`;
  const phc = `$argon2id$v=19$m=65536,t=3,p=4$${'c2FsdA'}$${'aGFzaA'}`;
  const aws = `AKIA${'Z'.repeat(16)}`;
  const portfolio = PORTFOLIO.replace(
    '  name: Rowan Test',
    `  name: Rowan Test\n  tagline: ${JSON.stringify(`token ${token}`)}`,
  )
    .replace(
      '  - url: https://rowan.name',
      `  - url: https://rowan.name\n    label: ${JSON.stringify(aws)}`,
    )
    .concat(lines(`    extensions: { '@other/x': { pem: ${JSON.stringify(key)} } }`));
  const site = `${SITE}extensions:\n  '@other/x': { hash: ${JSON.stringify(bcrypt)}, ${JSON.stringify(token)}: 1, phc: ${JSON.stringify(phc)} }\n`;
  const result = validate(portfolio, site);
  assert.ok(result.pair);
  assert.deepEqual(
    result.diagnostics
      .filter(({ code }) => code === 'secret.detected')
      .map(({ document, pointer, message }) => [document, pointer, message]),
    [
      [
        'portfolio',
        '/identity/tagline',
        "/identity/tagline looks like a GitHub token. A document can't hold secrets.",
      ],
      [
        'portfolio',
        '/links/0/label',
        "/links/0/label looks like an AWS access key ID. A document can't hold secrets.",
      ],
      [
        'portfolio',
        '/sections/1/extensions/@other~1x/pem',
        "/sections/1/extensions/@other~1x/pem looks like a PEM private key. A document can't hold secrets.",
      ],
      [
        'site',
        '/extensions/@other~1x',
        "A key in /extensions/@other~1x looks like a GitHub token. A document can't hold secrets.",
      ],
      [
        'site',
        '/extensions/@other~1x/hash',
        "/extensions/@other~1x/hash looks like a bcrypt password hash. A document can't hold secrets.",
      ],
      [
        'site',
        '/extensions/@other~1x/phc',
        "/extensions/@other~1x/phc looks like a PHC password hash. A document can't hold secrets.",
      ],
    ],
  );
  // The pair holds the data as written; the records never repeat it.
  const everything = JSON.stringify([result.diagnostics, result.notChecked]);
  for (const secret of [token, key, bcrypt, phc, aws]) assert.ok(!everything.includes(secret));
  // A secret-shaped key is located at the key itself, not at the object holding it.
  const atKey = result.diagnostics.find(({ message }) => message.startsWith('A key in'));
  const siteLines = site.split('\n');
  const keyLine = siteLines.findIndex((line) => line.includes(JSON.stringify(token)));
  assert.deepEqual(
    [atKey?.line, atKey?.column],
    [keyLine + 1, siteLines[keyLine]!.indexOf(JSON.stringify(token)) + 1],
  );
});

test('a hash with a slash never reaches a pointer or a message, escaped or not', () => {
  // `/` is `~1` in a pointer, which the secret patterns wouldn't match.
  const bcrypt = `$2b$10$${'a/'.repeat(26)}a`;
  const phc = `$argon2id$v=19$m=65536,t=3,p=4$c2F/sdA$aGF/zaA`;
  for (const secret of [bcrypt, phc]) {
    // An unknown key, an anchor under it, and an unregistered extension's key.
    for (const portfolio of [
      PORTFOLIO.replace('identity:', `${JSON.stringify(secret)}: 1\nidentity:`),
      PORTFOLIO.replace('identity:', `${JSON.stringify(secret)}: &a 1\nidentity:`),
      PORTFOLIO.replace(
        '  name: Rowan Test',
        `  name: Rowan Test\n  extensions: { ${JSON.stringify(`@other/x`)}: { ${JSON.stringify(secret)}: 1 } }`,
      ),
    ]) {
      const result = validate(portfolio);
      const records = JSON.stringify([result.diagnostics, result.notChecked]);
      assert.ok(result.diagnostics.length > 0);
      for (const form of [secret, secret.replace(/\//g, '~1')]) {
        assert.ok(!records.includes(form), records);
      }
    }
  }
});

test("a section id that isn't one never rides along as a stable id", () => {
  const token = `ghp_${'v'.repeat(36)}`;
  const bcrypt = `$2b$10$${'b'.repeat(53)}`;
  for (const id of [token, bcrypt, 'Not An Id']) {
    const result = validate(
      PORTFOLIO.replace('    id: about', `    id: ${JSON.stringify(id)}`).replace(
        '    body: Hi',
        '    body: 7',
      ),
    );
    const inSection = result.diagnostics.filter(({ pointer }) => pointer.startsWith('/sections/0'));
    assert.ok(inSection.length > 0, id);
    assert.deepEqual(
      inSection.map(({ stableId }) => stableId),
      inSection.map(() => undefined),
      id,
    );
    assert.ok(!JSON.stringify(result.diagnostics).includes(id), id);
  }
  // A real id still comes along.
  const valid = validate(PORTFOLIO.replace('    body: Hi', '    body: 7'));
  assert.equal(valid.diagnostics[0]?.stableId, 'about');
});

test('a comment holding a secret blocks publishing, located at the comment', () => {
  const token = `ghp_${'u'.repeat(36)}`;
  const result = validate(PORTFOLIO.replace('identity:', `identity: # ${token}`));
  assert.deepEqual(found(result.diagnostics), [
    ['portfolio', 'secret.detected', 'blocks-publish', '', 4, 11],
  ]);
  assert.equal(
    result.diagnostics[0]!.message,
    "A comment looks like a GitHub token. A document can't hold secrets.",
  );
  assert.ok(!JSON.stringify(result.diagnostics).includes(token));
  // Comments anywhere: own lines, after values, in flow collections, after the document.
  const everywhere = lines(
    `# ${token}`,
    PORTFOLIO.trimEnd().replace(
      '  - url: https://rowan.name',
      `  - { url: https://rowan.name } # ${token}`,
    ),
    `    # ${token}`,
    `# ${token}`,
  );
  assert.deepEqual(
    validate(everywhere).diagnostics.map(({ code, line }) => `${code}:${line}`),
    ['secret.detected:1', 'secret.detected:8', 'secret.detected:17', 'secret.detected:18'],
  );
});

test('names on Object.prototype are not deployment settings', () => {
  const result = validate(
    undefined,
    `${SITE}constructor: 1\ntoString: 1\n__proto__: { polluted: true }\nhasOwnProperty: 1\n`,
  );
  assert.deepEqual(codes(result.diagnostics), [
    'site:schema.invalid:/__proto__',
    'site:schema.invalid:/constructor',
    'site:schema.invalid:/hasOwnProperty',
    'site:schema.invalid:/toString',
  ]);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test('a secret-shaped key never reaches a message, even in a schema problem', () => {
  const token = `ghp_${'y'.repeat(36)}`;
  const result = validate(PORTFOLIO.replace('identity:', `${token}: 1\nidentity:`));
  assert.equal(result.pair, null);
  assert.ok(!JSON.stringify(result).includes(token));
  assert.deepEqual(codes(result.diagnostics), [
    'portfolio:secret.detected:',
    'portfolio:schema.invalid:/[secret]',
  ]);
});

test('documents never interpolate environment values', () => {
  const result = validate(PORTFOLIO.replace('name: Rowan Test', 'name: "${HOME}"'));
  assert.equal(result.pair?.portfolio.identity.name, '${HOME}');
});

test('links to sample hosts, and to a stale copy of the origin, warn', () => {
  const portfolio = PORTFOLIO.replace(
    '  - url: https://rowan.name',
    [
      '  - url: https://jane.example.com/cv',
      '  - url: https://example.org',
      '  - url: http://demo.test',
      '  - url: https://rowan.com/blog',
      '  - url: https://www.rowan.net',
      '  - url: https://rowan.name.evil.example',
      '  - url: https://other.name',
      '  - url: mailto:rowan@example.com',
    ].join('\n'),
  );
  assert.deepEqual(codes(validate(portfolio).diagnostics), [
    'portfolio:origin.sample:/links/0/url',
    'portfolio:origin.sample:/links/1/url',
    'portfolio:origin.sample:/links/2/url',
    'portfolio:origin.stale:/links/3/url',
    'portfolio:origin.stale:/links/4/url',
    'portfolio:origin.sample:/links/5/url',
    // A mail address on a sample domain is a sample address too.
    'portfolio:origin.sample:/links/7/url',
  ]);
  const mail = (url: string) =>
    codes(
      validate(PORTFOLIO.replace('  - url: https://rowan.name', `  - url: "${url}"`)).diagnostics,
    );
  assert.deepEqual(mail('mailto:Rowan@Mail.Example.org?subject=Hi'), [
    'portfolio:origin.sample:/links/0/url',
  ]);
  assert.deepEqual(mail('mailto:rowan@rowan.name,jane%40demo.test'), [
    'portfolio:origin.sample:/links/0/url',
  ]);
  assert.deepEqual(mail('mailto:rowan@rowan.name'), []);
  // On a sample origin, sample links are expected.
  const onSample = validate(portfolio, SITE, { ...CONTEXT, canonicalOrigin: 'https://jane.test' });
  assert.deepEqual(codes(onSample.diagnostics), []);
});

test('unregistered extension data warns in either document', () => {
  const portfolio = PORTFOLIO.replace(
    '  name: Rowan Test',
    "  name: Rowan Test\n  extensions: { '@other/x': { a: 1 } }",
  );
  const site = `${SITE}extensions: { '@other/y': { b: 2 } }\n`;
  const result = validate(portfolio, site);
  assert.ok(result.pair);
  assert.deepEqual(found(result.diagnostics), [
    ['portfolio', 'extension.unregistered', 'warning', '/identity/extensions/@other~1x', 6, 17],
    ['site', 'extension.unregistered', 'warning', '/extensions/@other~1y', 17, 15],
  ]);
  const registered = validate(portfolio, site, {
    ...CONTEXT,
    extensions: [defineContentExtension({ namespace: '@other/x' })],
  });
  assert.equal(registered.pair, null);
});

test('diagnostics sort by document, pointer with indexes in number order, and code', () => {
  const portfolio = PORTFOLIO.concat(
    Array.from({ length: 10 }, (_, index) =>
      lines(`  - kind: cta`, `    id: c${index}`, `    primaryAction: { url: "#x${index}" }`),
    ).join(''),
  );
  const pointers = validate(portfolio).diagnostics.map(({ pointer }) => pointer);
  assert.deepEqual(
    pointers,
    Array.from({ length: 10 }, (_, index) => `/sections/${index + 2}/primaryAction/url`),
  );
});

test('plugged-in validators add records and unchecked items; one that throws is unchecked', () => {
  const result = validate(undefined, undefined, {
    ...CONTEXT,
    validators: [
      {
        id: 'routes',
        validate: (pair) => ({
          diagnostics: [
            {
              code: 'route.unknown',
              severity: 'blocks-publish',
              document: 'site',
              pointer: `/routes/${pair.site.appearance.variant}`,
              message: `/routes/x names no route ghp_${'z'.repeat(36)}.`,
              remediation: 'Remove it.',
            },
          ],
          notChecked: ['site.routes.extra'],
        }),
      },
      {
        id: 'broken',
        validate: () => {
          throw new Error('boom');
        },
      },
    ],
  });
  assert.ok(result.pair);
  assert.deepEqual(codes(result.diagnostics), ['site:route.unknown:/routes/editorial']);
  assert.equal(result.diagnostics[0]!.message, '/routes/x names no route [secret].');
  assert.deepEqual(result.notChecked, [
    'site.appearance.designLanguage',
    'site.routes.extra',
    'validator:broken',
  ]);
});

test("a plugged-in validator's records are located, redacted, and checked whole", () => {
  const token = `ghp_${'t'.repeat(36)}`;
  const record = (fields: Record<string, unknown> = {}) => ({
    code: 'route.unknown',
    severity: 'blocks-publish',
    document: 'portfolio',
    pointer: '/sections/1/title',
    message: 'The title names no route.',
    remediation: `Remove it, or ${token}.`,
    ...fields,
  });
  const run = (...records: unknown[]) =>
    validate(undefined, undefined, {
      ...CONTEXT,
      validators: [
        {
          id: 'routes',
          validate: () => ({
            diagnostics: records as Diagnostic[],
            notChecked: [`site.x.${token}`],
          }),
        },
      ],
    });
  const good = run(record(), record({ pointer: `/${token}`, document: 'site' }));
  // Located from the pointer, the section's id attached, and every string redacted.
  assert.deepEqual(found(good.diagnostics), [
    ['portfolio', 'route.unknown', 'blocks-publish', '/sections/1/title', 15, 12],
    ['site', 'route.unknown', 'blocks-publish', '/[secret]', 1, 1],
  ]);
  assert.equal(good.diagnostics[0]!.stableId, 'contact');
  assert.equal(good.diagnostics[0]!.remediation, 'Remove it, or [secret].');
  assert.ok(!JSON.stringify(good).includes(token));
  assert.ok(good.notChecked.includes('site.x.[secret]'));

  // One malformed record, wherever it sits, drops every record the validator returned.
  for (const bad of [
    record({ code: 'Route Unknown' }),
    record({ code: 7 }),
    record({ severity: 'fatal' }),
    record({ document: 'deployment' }),
    record({ pointer: 'sections/1' }),
    record({ pointer: '/a~2b' }),
    record({ message: undefined }),
    record({ remediation: null }),
    // A core code keeps its core severity.
    record({ code: 'anchor.broken', severity: 'warning' }),
    'route.unknown',
  ]) {
    const result = run(record(), bad, record());
    assert.deepEqual(codes(result.diagnostics), [], JSON.stringify(bad));
    assert.ok(result.notChecked.includes('validator:routes'), JSON.stringify(bad));
  }
  for (const result of [{ diagnostics: 'none' }, { diagnostics: [], notChecked: [1] }, null]) {
    const malformed = validate(undefined, undefined, {
      ...CONTEXT,
      validators: [{ id: 'odd', validate: () => result as never }],
    });
    assert.deepEqual(malformed.notChecked, ['site.appearance.designLanguage', 'validator:odd']);
  }
});

test('a validator that covers unchecked entries clears them once it runs', () => {
  const site = `${SITE}routes: { work: { enabled: true } }\nvariantControls: { editorial: { version: 1, values: {} } }\n`;
  const contract = (validate: UnitValidator['validate']): Context => ({
    ...CONTEXT,
    validators: [
      { id: 'variant-contract', covers: ['site.routes.*', 'site.variantControls.*'], validate },
    ],
  });
  assert.deepEqual(
    validate(
      undefined,
      site,
      contract(() => ({ diagnostics: [] })),
    ).notChecked,
    ['site.appearance.designLanguage'],
  );
  // What it says it couldn't check stays listed, and one that fails covers nothing.
  assert.deepEqual(
    validate(
      undefined,
      site,
      contract(() => ({ diagnostics: [], notChecked: ['site.routes.work'] })),
    ).notChecked,
    ['site.appearance.designLanguage', 'site.routes.work'],
  );
  assert.deepEqual(
    validate(
      undefined,
      site,
      contract(() => {
        throw new Error('boom');
      }),
    ).notChecked,
    [
      'site.appearance.designLanguage',
      'site.routes.work',
      'site.variantControls.editorial',
      'validator:variant-contract',
    ],
  );
});

test('route ids and variant control values wait for their validator', () => {
  const site = `${SITE}routes: { work: { enabled: true } }\nvariantControls: { editorial: { version: 1, values: {} } }\n`;
  assert.deepEqual(validate(undefined, site).notChecked, [
    'site.appearance.designLanguage',
    'site.routes.work',
    'site.variantControls.editorial',
  ]);
});

test('it never throws, even when the build itself is wrong', () => {
  const twins = [
    defineContentExtension({ namespace: 'twin' }),
    defineContentExtension({ namespace: 'twin' }),
  ];
  const result = validate(undefined, undefined, { extensions: twins });
  assert.equal(result.pair, null);
  assert.deepEqual(codes(result.diagnostics), ['portfolio:validator.failed:']);
  for (const text of ['', '{', '- a', 'null', '[]']) {
    assert.doesNotThrow(() => validatePublicationUnit(unit(text, text)));
  }
});

test('the bundled example has no blocking diagnostic', () => {
  const example = readFileSync(new URL('../../../portfolio.example.yml', import.meta.url), 'utf8');
  const result = validate(example, SITE, { ...CONTEXT, canonicalOrigin: 'https://anamika.name' });
  assert.ok(result.pair);
  assert.deepEqual(
    result.diagnostics.filter(({ severity }) => severity !== 'warning'),
    [],
  );
});

test('every diagnostic code comes with a line and column, in YAML and JSON', () => {
  const token = `ghp_${'w'.repeat(36)}`;
  const stats = (id: string, value: string) =>
    lines(
      '  - kind: stats',
      `    id: ${id}`,
      '    items:',
      `      - { metric: talks, value: "${value}", label: Talks }`,
    );
  const links = [
    '  - url: "#nowhere"',
    '  - url: https://example.org',
    '  - url: https://rowan.com',
    `  - url: https://rowan.name\n    label: ${JSON.stringify(token)}`,
    "    extensions: { '@other/x': { a: 1 } }",
  ].join('\n');
  // Two content extensions with one namespace: a broken build, not a broken document.
  const twins: Context = {
    ...CONTEXT,
    extensions: [
      defineContentExtension({ namespace: 'twin' }),
      defineContentExtension({ namespace: 'twin' }),
    ],
  };
  // Each YAML unit but the first has a JSON twin; JSON's syntax error is its own.
  const units: Array<{ portfolio?: string; site?: string; json?: string; ctx?: Context }> = [
    { portfolio: PORTFOLIO.replace('identity:', 'identity: &a'), json: '{ "schemaVersion": 2, }' },
    { portfolio: PORTFOLIO.replace('  name: Rowan Test', '  name: 7') },
    { site: SITE.replace('schemaVersion: 2', 'schemaVersion: 1') },
    { site: `${SITE}origin: x\n` },
    { site: SITE.replace('colorScheme: warm', 'colorScheme: neon') },
    { portfolio: PORTFOLIO.replace('    id: contact', '    id: about') },
    { site: `${SITE}sections:\n  gone: { hidden: true }\n` },
    { portfolio: PORTFOLIO.concat(stats('one', '1'), stats('two', '1'), stats('three', '2')) },
    { portfolio: PORTFOLIO.replace('  - url: https://rowan.name', links) },
    { site: `${SITE}sections:\n  about: { hidden: true }\n  contact: { hidden: true }\n` },
    { ctx: twins },
  ];
  const twin = (yaml: string) => `${JSON.stringify(parseYaml(yaml), null, 2)}\n`;
  for (const format of ['yaml', 'json'] as const) {
    const seen = new Set<string>();
    for (const { portfolio = PORTFOLIO, site = SITE, json, ctx = CONTEXT } of units) {
      const document = (text: string, name: string): SourceDocument =>
        format === 'yaml' ? { text, format, name } : { text: twin(text), format, name };
      const unit = {
        portfolio:
          format === 'json' && json !== undefined
            ? { text: json, format, name: 'portfolio.json' }
            : document(portfolio, `portfolio.${format}`),
        site: document(site, `site.${format}`),
      };
      for (const diagnostic of validatePublicationUnit(unit, ctx).diagnostics) {
        seen.add(diagnostic.code);
        assert.ok(
          Number.isInteger(diagnostic.line) && Number.isInteger(diagnostic.column),
          `${format}: ${diagnostic.code} at ${diagnostic.pointer} has no position`,
        );
      }
    }
    assert.deepEqual([...seen].sort(), Object.keys(DIAGNOSTIC_SEVERITIES).sort(), format);
  }
});

test('the validator, and the package root Studio imports, bundle for a browser', async () => {
  // A real bundle: a Node.js built-in anywhere in the import graph fails to
  // resolve for the browser platform, where a text search could miss one.
  const result = await build({
    entryPoints: ['validate.ts', 'index.ts'].map((file) =>
      fileURLToPath(new URL(file, import.meta.url)),
    ),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    outdir: 'bundle',
    metafile: true,
    logLevel: 'silent',
  });
  assert.deepEqual(result.errors, []);
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(
    inputs.some((file) => file.endsWith('src/validate.ts')),
    inputs.join(', '),
  );
  assert.ok(
    inputs.some((file) => file.includes('node_modules/yaml/')),
    inputs.join(', '),
  );
  assert.deepEqual(
    inputs.filter((file) => file.startsWith('node:') || /^(?:fs|path|crypto)$/.test(file)),
    [],
  );
  // And it does fail on one: a module that imports node:fs doesn't bundle.
  await assert.rejects(
    build({
      stdin: { contents: "import { readFileSync } from 'node:fs'; export const a = readFileSync;" },
      bundle: true,
      platform: 'browser',
      write: false,
      logLevel: 'silent',
    }),
  );
});
