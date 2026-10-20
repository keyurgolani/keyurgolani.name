import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseSource } from '../source';
import type { AppearanceCatalog } from '../validate';
import {
  formatMigration,
  migrate,
  parseSet,
  slugify,
  type Migration,
  type MigrationPlan,
  type MigrateOptions,
} from './index';

// One legacy fixture per row of the mapping in #4, item 20, plus one shaped
// like the live owner file and the old bundled example.

/** The host's interim catalog: the registered variants and each one's ids. */
const CATALOG: AppearanceCatalog = {
  ids(axis, selection) {
    const schemes: Record<string, string[]> = {
      editorial: ['warm', 'noir', 'ink-and-paper'],
      'kinetic-cosmos': ['nebula', 'aurora', 'solar'],
    };
    const typesets: Record<string, string[]> = {
      editorial: ['classic', 'modernist'],
      'kinetic-cosmos': ['geometric', 'humanist'],
    };
    switch (axis) {
      case 'variant':
        return ['editorial', 'kinetic-cosmos'];
      case 'colorScheme':
        return schemes[selection.variant] ?? null;
      case 'typography':
        return typesets[selection.variant] ?? null;
      case 'displayMode':
        return ['system', 'light', 'dark'];
      default:
        return null;
    }
  },
  generatorInput: () => undefined,
};

const DIR = new URL('../__fixtures__/legacy/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DIR), 'utf8');
const formatOf = (name: string) => (name.endsWith('.json') ? 'json' : 'yaml');
const run = (name: string, options: MigrateOptions = {}) =>
  migrate({ text: read(name), format: formatOf(name) }, { catalog: CATALOG, ...options });
/** The --set values Editorial's baseline appearance needs. */
const BASELINE = ['site.appearance.colorScheme=warm', 'site.appearance.typography=classic'].map(
  parseSet,
);

function plan(migration: Migration): MigrationPlan {
  assert.ok(
    migration.status === 'ready' || migration.status === 'blocked',
    JSON.stringify(migration),
  );
  return migration;
}
const needs = (migration: Migration) =>
  plan(migration).needs.map(({ path, reason, was, accepts }) => ({
    path,
    reason,
    ...(was !== undefined ? { was } : {}),
    ...(accepts ? { accepts: [...accepts] } : {}),
  }));
const changes = (migration: Migration, code: string) =>
  plan(migration)
    .changes.filter((change) => change.code === code)
    .map(({ from, to, value, note }) => [from, to && `${to.document}:${to.pointer}`, value, note]);

test('content keeps its pointers in the portfolio document', () => {
  const migration = plan(run('content.yml', { set: BASELINE }));
  assert.equal(migration.status, 'ready');
  const old = parseSource(read('content.yml'), 'yaml');
  assert.ok(old.ok);
  const { identity, links, meta, sections } = old.data as Record<string, unknown>;
  assert.deepEqual(migration.portfolio.data, {
    schemaVersion: 2,
    locale: 'en',
    direction: 'ltr',
    identity,
    links,
    meta,
    sections,
  });
  assert.deepEqual(migration.diagnostics, []);
});

test('meta.url is removed and printed, on its own line, as a starting point for PORTFOLIO_ORIGIN', () => {
  const migration = plan(run('meta-url.yml', { set: BASELINE }));
  assert.equal(migration.origin, 'https://rowan-old.test');
  assert.deepEqual(changes(migration, 'removed'), [
    [
      '/meta/url',
      undefined,
      'https://rowan-old.test',
      'The canonical origin is a deployment setting now: PORTFOLIO_ORIGIN.',
    ],
  ]);
  // meta held only the url, so the portfolio has no meta at all.
  assert.equal('meta' in (migration.portfolio.data as object), false);
  const report = formatMigration(migration, { file: 'meta-url.yml' });
  // No period after the origin, so it copies cleanly.
  assert.ok(
    report.includes(
      '\n    https://rowan-old.test (from meta.url; set PORTFOLIO_ORIGIN to the real public origin)\n',
    ),
    report,
  );
  assert.ok(
    !formatMigration(migration, { file: 'meta-url.yml', summary: true }).includes('rowan-old'),
  );
});

test('the pair is checked against --origin, never the old meta.url, which may name another domain', () => {
  // The old file's meta.url is a stale .com, and its links the real .name.
  const text = [
    'identity:',
    '  name: Rowan Origin',
    'links:',
    '  - url: https://rowan.name/',
    'meta:',
    '  url: https://rowan.com',
    'sections:',
    '  - kind: lede',
    '    title: About',
    '    body: Hi.',
    '',
  ].join('\n');
  const options = { catalog: CATALOG, set: BASELINE };
  const unchecked = plan(migrate({ text, format: 'yaml' }, options));
  assert.equal(unchecked.status, 'ready');
  assert.deepEqual(unchecked.diagnostics, []);
  assert.ok(unchecked.notChecked.includes('origin.stale'), unchecked.notChecked.join(', '));
  assert.match(
    formatMigration(unchecked, { file: 'old.yml' }),
    /\nNot checked: [^\n]*origin\.stale[^\n]* Pass --origin <url> with the site's real public origin/,
  );
  const checked = plan(
    migrate({ text, format: 'yaml' }, { ...options, origin: 'https://rowan.name' }),
  );
  assert.deepEqual(checked.diagnostics, []);
  assert.ok(!checked.notChecked.some((entry) => entry.startsWith('origin.')));
  // Against a stale origin the real links would warn, which is why it's never the old meta.url.
  const stale = plan(
    migrate({ text, format: 'yaml' }, { ...options, origin: 'https://rowan.com' }),
  );
  assert.deepEqual(
    stale.diagnostics.map(({ code }) => code),
    ['origin.stale'],
  );
});

test('a registered variant moves to appearance.variant, and its ids are the ones asked for', () => {
  const migration = run('variant.yml');
  assert.deepEqual(changes(migration, 'moved'), [
    ['/variant', 'site:/appearance/variant', undefined, ''],
  ]);
  assert.deepEqual(needs(migration), [
    {
      path: 'site.appearance.colorScheme',
      reason: 'The old format had none, and this release needs one.',
      accepts: ['nebula', 'aurora', 'solar'],
    },
    {
      path: 'site.appearance.typography',
      reason: 'The old format had none, and this release needs one.',
      accepts: ['geometric', 'humanist'],
    },
  ]);
});

test('a variant the catalog does not list needs a value', () => {
  assert.deepEqual(needs(run('variant-unregistered.yml')), [
    {
      path: 'site.appearance.variant',
      reason: "The old id isn't one this build registers.",
      was: 'canvas',
      accepts: ['editorial', 'kinetic-cosmos'],
    },
    // With no variant this build has, there's no list of its ids to give.
    {
      path: 'site.appearance.colorScheme',
      reason: 'The old format had none, and this release needs one.',
    },
    {
      path: 'site.appearance.typography',
      reason: 'The old format had none, and this release needs one.',
    },
  ]);
});

test('theme becomes the display mode, and bright and black need a value', () => {
  const dark = plan(run('theme.yml', { set: BASELINE }));
  assert.equal(dark.status, 'ready');
  assert.equal(
    (dark.site.data as { appearance: { displayMode: string } }).appearance.displayMode,
    'dark',
  );
  assert.deepEqual(changes(dark, 'moved'), [
    ['/theme', 'site:/appearance/displayMode', undefined, ''],
  ]);
  assert.deepEqual(needs(run('theme-bright.yml', { set: BASELINE })), [
    {
      path: 'site.appearance.displayMode',
      reason: 'The old theme has no display mode now.',
      was: 'bright',
      accepts: ['system', 'light', 'dark'],
    },
  ]);
});

test('no old color scheme or typography id carries over, even one that names a current id', () => {
  assert.deepEqual(needs(run('appearance-ids.yml')), [
    {
      path: 'site.appearance.colorScheme',
      reason: "The old id doesn't carry over: this release's ids are new.",
      was: 'noir',
      accepts: ['warm', 'noir', 'ink-and-paper'],
    },
    {
      path: 'site.appearance.typography',
      reason: "The old id doesn't carry over: this release's ids are new.",
      was: 'modernist',
      accepts: ['classic', 'modernist'],
    },
  ]);
  // Given with --set, the same ids are fine.
  const given = run('appearance-ids.yml', {
    set: ['site.appearance.colorScheme=noir', 'site.appearance.typography=modernist'].map(parseSet),
  });
  assert.equal(plan(given).status, 'ready');
});

test('motionPreference becomes motionPolicy, and full becomes respect-os, reported', () => {
  const migration = plan(run('motion-full.yml', { set: BASELINE }));
  assert.equal((migration.site.data as { motionPolicy: string }).motionPolicy, 'respect-os');
  assert.deepEqual(changes(migration, 'mapped'), [
    [
      '/motionPreference',
      'site:/motionPolicy',
      undefined,
      "full becomes respect-os: nothing forces motion past the visitor's OS setting now.",
    ],
  ]);
});

test('hidden: true moves to the site document under the section id, and hidden: false goes', () => {
  const migration = plan(run('hidden.yml', { set: BASELINE }));
  assert.deepEqual((migration.site.data as { sections: unknown }).sections, {
    now: { hidden: true },
  });
  assert.deepEqual(changes(migration, 'moved'), [
    ['/sections/1/hidden', 'site:/sections/now/hidden', undefined, ''],
  ]);
  assert.deepEqual(changes(migration, 'removed'), [
    [
      '/sections/2/hidden',
      undefined,
      undefined,
      'Only hidden: true hides a section, so this one stays visible.',
    ],
  ]);
  const sections = (migration.portfolio.data as { sections: Record<string, unknown>[] }).sections;
  assert.ok(sections.every((section) => !('hidden' in section)));
});

test('section ids follow the old anchors: top, the slugified title, else the kind', () => {
  const migration = plan(run('ids.yml', { set: BASELINE }));
  assert.deepEqual(
    migration.ids.map(({ id, source }) => [id, source]),
    [
      ['top', 'hero'],
      ['about', 'title'],
      ['about-2', 'title'],
      ['quote', 'kind'],
      ['about-me', 'slugified'],
      ['main-2', 'reserved'],
      // Cut at a hyphen to fit 64 characters.
      ['a-very-long-title-that-keeps-going-well-past-the-sixty-four', 'title'],
      // The navigation linked the titled one, so it keeps the id first.
      ['contact-2', 'repeated'],
      ['contact', 'kept'],
    ],
  );
  assert.ok(migration.ids.every(({ id }) => id.length <= 64));
  assert.deepEqual(migration.diagnostics, []);
  const report = formatMigration(migration, { file: 'ids.yml' });
  assert.ok(report.includes('/sections/3 is quote, from its kind. If links point at the id'));
  assert.ok(report.includes('--set portfolio.sections.3.id=<id>'));

  // An id given with --set wins, even over a section that has it in the file.
  const set = plan(
    run('ids.yml', {
      set: [
        ...BASELINE,
        ...['portfolio.sections.3.id=pull-quote', 'portfolio.sections.8.id=contact'].map(parseSet),
      ],
    }),
  );
  assert.deepEqual(
    set.ids.filter(({ index }) => [3, 7, 8].includes(index)).map(({ id, source }) => [id, source]),
    [
      ['pull-quote', 'set'],
      ['contact-2', 'repeated'],
      ['contact', 'set'],
    ],
  );
});

test('slugify is the old kit one, so a generated id is the anchor visitors had', () => {
  assert.equal(slugify('  Want to work together?  '), 'want-to-work-together');
  assert.equal(slugify('Stack I currently reach for'), 'stack-i-currently-reach-for');
  assert.equal(slugify('Écoute'), 'coute');
  assert.equal(slugify('!!!'), '');
});

test('where the old file has nothing, every filled-in value is reported', () => {
  const migration = plan(run('minimal.yml', { set: BASELINE }));
  assert.deepEqual(
    changes(migration, 'default').map(([, to, value]) => [to, value]),
    [
      ['portfolio:/locale', 'en'],
      ['portfolio:/direction', 'ltr'],
      ['site:/appearance/variant', 'editorial'],
      ['site:/appearance/designLanguage', 'platform-neutral'],
      ['site:/appearance/displayMode', 'system'],
      ['site:/visitorControls', undefined],
      ['site:/motionPolicy', 'respect-os'],
      ['site:/features/feed', 'true'],
    ],
  );
  assert.deepEqual(migration.site.data, {
    schemaVersion: 2,
    appearance: {
      variant: 'editorial',
      designLanguage: 'platform-neutral',
      displayMode: 'system',
      colorScheme: 'warm',
      typography: 'classic',
    },
    visitorControls: {
      variant: 'locked',
      designLanguage: 'locked',
      colorScheme: 'selectable',
      typography: 'locked',
      displayMode: 'selectable',
    },
    motionPolicy: 'respect-os',
    features: { feed: true },
  });
  // With no section at all the pair can't go live, so the migration stops.
  assert.equal(migration.status, 'blocked');
  assert.deepEqual(
    migration.diagnostics.map(({ code, severity }) => [code, severity]),
    [['content.empty', 'blocks-publish']],
  );
});

test('a key the old schema dropped is listed, and stops the write unless dropped', () => {
  const kept = plan(run('unknown-keys.yml', { set: BASELINE }));
  const pointers = [
    '/identity/nickname',
    '/identity/extensions',
    '/customFooter',
    '/links/0/rel',
    '/meta/keywords',
    '/sections/1/items/0/metric',
    '/sections/2/items/0/period/note',
  ];
  assert.deepEqual(
    kept.unknown.map(({ pointer }) => pointer),
    pointers,
  );
  assert.deepEqual([kept.unknown[0]!.line, kept.unknown[0]!.column], [7, 3]);
  // A section's lang that's a language tag carries over as it is.
  const sections = (kept.portfolio.data as { sections: Record<string, unknown>[] }).sections;
  assert.equal(sections[0]!.lang, 'en');
  assert.equal(kept.status, 'blocked');
  const dropped = plan(run('unknown-keys.yml', { set: BASELINE, dropUnknown: true }));
  assert.equal(dropped.status, 'ready');
  assert.deepEqual(
    changes(dropped, 'dropped').map(([from]) => from),
    pointers,
  );
  for (const text of [dropped.portfolio.text, dropped.site.text]) {
    for (const value of [
      'nickname',
      'Leica',
      'Made by hand',
      'keywords',
      'tenure-years',
      'still there',
    ]) {
      assert.ok(!text.includes(value), value);
    }
  }
});

test('the owner-shaped file blocks on its scheme, typeset, and unknown key, then migrates', () => {
  const blocked = plan(run('owner.yml'));
  assert.equal(blocked.status, 'blocked');
  assert.deepEqual(
    blocked.needs.map(({ path, was }) => [path, was]),
    [
      ['site.appearance.colorScheme', 'warm'],
      ['site.appearance.typography', 'classic'],
    ],
  );
  assert.deepEqual(
    blocked.unknown.map(({ pointer, line }) => [pointer, line]),
    [['/sections/4/subtitel', 49]],
  );
  assert.deepEqual(blocked.comments, [1, 2, 3, 4, 39]);

  const ready = plan(run('owner.yml', { set: BASELINE, dropUnknown: true }));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.origin, 'https://rowan-old.test');
  assert.deepEqual((ready.site.data as { appearance: unknown }).appearance, {
    variant: 'editorial',
    designLanguage: 'platform-neutral',
    displayMode: 'system',
    colorScheme: 'warm',
    typography: 'classic',
  });
  assert.deepEqual((ready.site.data as { sections: unknown }).sections, {
    talks: { hidden: true },
  });
  assert.deepEqual(
    ready.diagnostics.filter(({ severity }) => severity !== 'warning'),
    [],
  );
});

test('a JSON file migrates to the same documents as its YAML twin, written as JSON', () => {
  const yaml = plan(run('owner.yml', { set: BASELINE, dropUnknown: true }));
  const json = plan(run('owner.json', { set: BASELINE, dropUnknown: true }));
  assert.equal(json.format, 'json');
  assert.deepEqual(json.portfolio.data, yaml.portfolio.data);
  assert.deepEqual(json.site.data, yaml.site.data);
  assert.deepEqual(JSON.parse(json.portfolio.text), json.portfolio.data);
  assert.deepEqual(json.comments, []);
});

test('the old bundled example migrates to the ids its baseline page rendered', () => {
  const migration = plan(run('example.yml', { set: BASELINE }));
  assert.equal(migration.status, 'ready');
  const baseline = JSON.parse(
    readFileSync(
      new URL('../../../../tests/fixtures/baseline/example-home.json', import.meta.url),
      'utf8',
    ),
  ) as { sectionIds: string[] };
  assert.deepEqual(
    migration.ids.map(({ id }) => id),
    baseline.sectionIds,
  );
});

test('every fixture migrates the same way twice, and its own output is already current', () => {
  const fixtures = readdirSync(DIR).filter((name) => /\.(?:yml|json)$/.test(name));
  assert.ok(fixtures.length >= 14, fixtures.join(', '));
  for (const name of fixtures) {
    const options = { set: BASELINE, dropUnknown: true };
    const first = plan(run(name, options));
    const second = plan(run(name, options));
    assert.equal(second.portfolio.text, first.portfolio.text, name);
    assert.equal(second.site.text, first.site.text, name);
    assert.equal(
      formatMigration(second, { file: name }),
      formatMigration(first, { file: name }),
      name,
    );
    for (const [document, text] of [
      ['portfolio', first.portfolio.text],
      ['site', first.site.text],
    ] as const) {
      const again = migrate({ text, format: first.format }, { catalog: CATALOG });
      assert.deepEqual(again, { status: 'current', document }, `${name} ${document}`);
    }
  }
});

test('a summary leaves out every value the documents hold', () => {
  const migration = run('owner.yml', { set: BASELINE, dropUnknown: true });
  const summary = formatMigration(migration, { file: 'owner.yml', summary: true });
  for (const value of [
    'Rowan Owner',
    'calm software',
    'Lisbon',
    'rowan-old',
    'code.rowan.test',
    'Write any time',
    'Calm systems',
    'talks',
    '=warm',
  ]) {
    assert.ok(!summary.includes(value), value);
  }
  // It still says what the migration does.
  assert.ok(summary.includes('/sections/3/hidden to site.yml /sections/<its id>/hidden.'));
  assert.ok(summary.includes('--set site.appearance.colorScheme=<value>'));
  const full = formatMigration(migration, { file: 'owner.yml' });
  assert.ok(full.includes('Rowan Owner') && full.includes('talks'));
  // Nor the old values a need was given.
  for (const [name, old] of [
    ['variant-unregistered.yml', 'canvas'],
    ['theme-bright.yml', 'bright'],
  ] as const) {
    const blocked = run(name, { set: BASELINE });
    assert.ok(formatMigration(blocked, { file: 'old.yml' }).includes(`It was ${old}.`), name);
    assert.ok(!formatMigration(blocked, { file: 'old.yml', summary: true }).includes(old), name);
  }
});

test('the dry run shows a diff of the portfolio and the whole site document', () => {
  const report = formatMigration(run('owner.yml', { set: BASELINE, dropUnknown: true }), {
    file: 'owner.yml',
  });
  assert.ok(
    report.includes(
      'portfolio.yml, as a diff from owner.yml:\n--- owner.yml (old)\n+++ portfolio.yml (new)\n@@ ',
    ),
  );
  assert.ok(report.includes('\n-variant: editorial\n'));
  assert.ok(report.includes('\n+    id: talks\n'));
  assert.ok(
    report.endsWith(
      `site.yml:\n${plan(run('owner.yml', { set: BASELINE, dropUnknown: true })).site.text}`,
    ),
  );
});

test('files that are not the old format are current or refused', () => {
  const current = migrate({ text: 'schemaVersion: 2\nidentity:\n  name: Rowan\n', format: 'yaml' });
  assert.deepEqual(current, { status: 'current', document: 'portfolio' });
  assert.equal(
    formatMigration(current, { file: 'p.yml' }),
    'p.yml is already a schemaVersion 2 portfolio document. Nothing to migrate.\n',
  );
  for (const [text, reason] of [
    ['schemaVersion: 3\nidentity: {}\n', /declares schemaVersion 3, which no migration step reads/],
    ['links: []\n', /neither the old one-file format nor a schemaVersion 2 document/],
    ['identity: [\n', /^Line \d+, column \d+: /],
  ] as const) {
    const failed = migrate({ text, format: 'yaml' });
    assert.equal(failed.status, 'failed', text);
    if (failed.status === 'failed') assert.match(failed.reasons[0]!, reason, text);
  }
});

test('--set takes <portfolio|site>.<path>=<value>, and never reaches Object.prototype', () => {
  assert.deepEqual(parseSet('site.appearance.colorScheme=warm'), {
    path: 'site.appearance.colorScheme',
    value: 'warm',
  });
  assert.deepEqual(parseSet('portfolio.identity.name=A=B'), {
    path: 'portfolio.identity.name',
    value: 'A=B',
  });
  for (const bad of ['colorScheme=warm', 'site=warm', 'site.=x', 'deployment.origin=x', 'site.a']) {
    assert.throws(() => parseSet(bad), /--set takes/, bad);
  }
  const migration = plan(
    run('minimal.yml', {
      set: [
        ...BASELINE,
        parseSet('portfolio.__proto__.polluted=yes'),
        parseSet('site.features.feed=false'),
      ],
    }),
  );
  assert.equal(({} as { polluted?: string }).polluted, undefined);
  assert.equal((migration.site.data as { features: { feed: boolean } }).features.feed, false);
  // The own __proto__ key it made is just an unknown field, which the new documents refuse.
  assert.ok(
    migration.diagnostics.some(
      ({ code, pointer }) => code === 'schema.invalid' && pointer === '/__proto__',
    ),
  );
  // A value in the way, and a section the file doesn't have, are refused.
  for (const [argument, reason] of [
    ['portfolio.identity.name.first=Rowan', 'a value is in the way at first.'],
    ['portfolio.sections.0.id=about', 'the list has no item 0.'],
  ]) {
    assert.deepEqual(run('minimal.yml', { set: [parseSet(argument!)] }), {
      status: 'failed',
      reasons: [`--set ${argument!.slice(0, argument!.indexOf('='))}: ${reason}`],
    });
  }
});

// Review of PR #32. Secret-shaped strings are built here from parts, so no
// committed line looks like one.
const TOKEN = ['gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('');
const KEY_BODY = ['MIIEowIBAAKCAQEA', 'canaryKeyBodyLineOne', 'x'.repeat(24)].join('');
const KEY_TAIL = ['canaryKeyBodyLineTwo', 'z'.repeat(36)].join('');
const PEM = [
  ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' '),
  KEY_BODY,
  KEY_TAIL,
  ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' '),
].join('\n');
const AWS = ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join('');

const legacy = (...more: string[]) =>
  [
    'identity:',
    '  name: Rowan Secret',
    'sections:',
    '  - kind: hero',
    '    tagline: Calm.',
    '  - kind: lede',
    '    title: About',
    '    body: Hello.',
    ...more,
    '',
  ].join('\n');
const indent = (text: string, by: string) => text.split('\n').join(`\n${by}`);

test('secret-shaped text in the old file withholds every value, the diff, and both documents', () => {
  const cases: Array<{ name: string; text: string; format?: 'yaml' | 'json'; drop?: boolean }> = [
    {
      name: 'a key in a block scalar of a known field',
      text: legacy(
        '  - kind: lede',
        '    title: Keys',
        `    body: |\n      ${indent(PEM, '      ')}`,
      ),
    },
    {
      name: 'a key in a key the old schema dropped, dropped',
      text: `${legacy()}deployKey: |\n  ${indent(PEM, '  ')}\n`,
      drop: true,
    },
    {
      name: 'a token folded across two lines',
      text: `${legacy()}notes: "${TOKEN.slice(0, 20)}\\\n  ${TOKEN.slice(20)}"\n`,
      drop: true,
    },
    { name: 'an access key in a comment', text: `# ${AWS}\n${legacy()}` },
    {
      name: 'a key in a JSON line',
      format: 'json',
      text: JSON.stringify(
        {
          identity: { name: 'Rowan Secret' },
          sections: [{ kind: 'lede', title: 'About', body: PEM }],
        },
        null,
        2,
      ),
    },
  ];
  for (const { name, text, format = 'yaml', drop = false } of cases) {
    const migration = plan(
      migrate({ text, format }, { catalog: CATALOG, set: BASELINE, dropUnknown: drop }),
    );
    assert.ok(migration.secrets.length > 0, name);
    for (const summary of [false, true]) {
      const report = formatMigration(migration, { file: 'old.yml', summary });
      for (const part of [KEY_BODY, KEY_TAIL, TOKEN, TOKEN.slice(4), TOKEN.slice(20), AWS]) {
        assert.ok(!report.includes(part), `${name}: ${part.slice(0, 12)}`);
      }
      assert.match(report, /\nSecret-shaped text, which no document may hold\./, name);
      assert.ok(!report.includes('as a diff from'), name);
      assert.ok(!report.includes('\nsite.yml:\n') && !report.includes('\nsite.json:\n'), name);
      // Nor any other value: the summary's rules hold.
      assert.ok(!report.includes('Rowan Secret'), name);
    }
  }
  const located = plan(
    migrate(
      {
        text: `# ${AWS}\n${legacy('  - kind: lede', '    title: T', `    body: "${TOKEN}"`)}`,
        format: 'yaml',
      },
      { catalog: CATALOG, set: BASELINE },
    ),
  );
  assert.deepEqual(
    located.secrets.map(({ in: at, pointer, line }) => [at, pointer, line]),
    [
      ['value', '/sections/2/body', 12],
      ['comment', undefined, 1],
    ],
  );
  const report = formatMigration(located, { file: 'old.yml' });
  assert.ok(report.includes('  /sections/2/body (line 12, column 11): a GitHub token.'), report);
  assert.ok(report.includes('  The comment on line 1: an AWS access key ID.'));
  // A secret-shaped --set value is one too.
  const given = plan(
    run('minimal.yml', { set: [...BASELINE, parseSet(`portfolio.identity.tagline=${TOKEN}`)] }),
  );
  assert.deepEqual(
    given.secrets.map(({ in: at, path }) => [at, path]),
    [['set', 'portfolio.identity.tagline']],
  );
  assert.ok(!formatMigration(given, { file: 'old.yml' }).includes(TOKEN.slice(4)));
});

test('the sections the old navigation linked keep their anchors, and a changed one is reported', () => {
  const text = [
    'identity:',
    '  name: Rowan Ids',
    'sections:',
    '  - kind: hero',
    '    ctas:',
    "      - { url: '#projects', label: Work }",
    '  - kind: projects',
    '    title: Projects',
    '    hidden: true',
    '    items: []',
    '  - kind: projects',
    '    title: Projects',
    '    items: [{ name: Shipyard }]',
    '',
  ].join('\n');
  const migration = plan(migrate({ text, format: 'yaml' }, { catalog: CATALOG, set: BASELINE }));
  assert.deepEqual(
    migration.ids.map(({ id, anchor }) => [id, anchor]),
    [
      ['top', 'top'],
      ['projects-2', 'projects'],
      ['projects', 'projects'],
    ],
  );
  // The hero's link still lands, so nothing blocks.
  assert.equal(migration.status, 'ready');
  assert.deepEqual(migration.diagnostics, []);
  const report = formatMigration(migration, { file: 'old.yml' });
  assert.ok(
    report.includes(
      "  /sections/1 is projects-2, from its title. The old page's anchor for it was #projects.",
    ),
    report,
  );
  assert.ok(report.includes('  /sections/2 is projects, from its title.\n'));
  assert.ok(
    formatMigration(migration, { file: 'old.yml', summary: true }).includes(
      '  /sections/1 gets an id, from its title. Its anchor on the old page differs.',
    ),
  );
  // So does an id the hidden one gives itself.
  const explicit = plan(
    migrate(
      {
        text: text.replace('    title: Projects\n    hidden', '    id: projects\n    hidden'),
        format: 'yaml',
      },
      { catalog: CATALOG, set: BASELINE },
    ),
  );
  assert.deepEqual(
    explicit.ids.map(({ id, source }) => [id, source]),
    [
      ['top', 'hero'],
      ['projects-2', 'repeated'],
      ['projects', 'title'],
    ],
  );
  assert.equal(explicit.status, 'ready');
});

test('a title with no letter or digit an id can use is not called untitled', () => {
  const text = legacy('  - kind: now', "    title: '日本語'", '    body: Now.');
  const migration = plan(migrate({ text, format: 'yaml' }, { catalog: CATALOG, set: BASELINE }));
  assert.deepEqual(
    migration.ids.slice(2).map(({ id, source }) => [id, source]),
    [['now', 'unusable']],
  );
  const report = formatMigration(migration, { file: 'old.yml' });
  assert.ok(
    report.includes(
      "  /sections/2 is now, from its kind: its title has no letter or digit an id can use. The old page's anchor for it was #日本語.",
    ),
    report,
  );
  // That anchor isn't an id this release takes, so there's no --set to keep it.
  assert.ok(!report.includes('--set portfolio.sections.2.id'));
});

test('the first dry run checks the pair, with placeholders for the values it needs', () => {
  const text = legacy(
    '  - kind: cta',
    '    title: Next',
    "    primaryAction: { url: '#nowhere', label: Go }",
  );
  const migration = plan(migrate({ text, format: 'yaml' }, { catalog: CATALOG }));
  assert.equal(migration.status, 'blocked');
  assert.deepEqual(
    migration.needs.map(({ path }) => path),
    ['site.appearance.colorScheme', 'site.appearance.typography'],
  );
  // The content problem shows now, and nothing about the placeholders does.
  assert.deepEqual(
    migration.diagnostics.map(({ code, document, pointer }) => [code, document, pointer]),
    [['anchor.broken', 'portfolio', '/sections/2/primaryAction/url']],
  );
  assert.match(
    formatMigration(migration, { file: 'old.yml' }),
    /\nDiagnostics in the new documents, checked with placeholders for the values still needed:\n {2}blocks-publish anchor\.broken /,
  );
  // Without a variant there's nothing to check the color scheme and typography against.
  const unregistered = plan(run('variant-unregistered.yml'));
  assert.ok(
    unregistered.diagnostics.every(({ pointer }) => !pointer.startsWith('/appearance/')),
    JSON.stringify(unregistered.diagnostics),
  );
});

test('a summary masks the ids in --set paths, and a failure shows no schemaVersion value', () => {
  const migration = plan(
    run('owner.yml', {
      set: [...BASELINE, parseSet('site.sections.talks.hidden=true')],
      dropUnknown: true,
    }),
  );
  const summary = formatMigration(migration, { file: 'owner.yml', summary: true });
  assert.ok(!summary.includes('talks'), summary);
  assert.ok(summary.includes(' --set site.sections.<its id>.hidden=<value> '), summary);
  for (const [text, shown] of [
    ['schemaVersion: 3\nidentity: {}\n', 'schemaVersion 3'],
    [`schemaVersion: "${KEY_BODY}"\nidentity: {}\n`, "a schemaVersion that isn't a number"],
  ] as const) {
    const failed = migrate({ text, format: 'yaml' });
    assert.ok(formatMigration(failed, { file: 'p.yml' }).includes(`declares ${shown},`), text);
    const logged = formatMigration(failed, { file: 'p.yml', summary: true });
    assert.ok(logged.includes('declares a schemaVersion, which'), logged);
    assert.ok(!logged.includes('3') && !logged.includes('canaryKeyBody'), logged);
  }
});

test('the command it suggests quotes each word for the shell', () => {
  const migration = plan(
    run('content.yml', {
      set: [...BASELINE, parseSet("portfolio.identity.tagline=Rowan's calm $(software)")],
    }),
  );
  assert.equal(migration.status, 'ready');
  const report = formatMigration(migration, { file: 'my old file.yml' });
  assert.ok(
    report.includes(
      "pnpm config:migrate 'my old file.yml' --set site.appearance.colorScheme=warm --set site.appearance.typography=classic --set 'portfolio.identity.tagline=Rowan'\\''s calm $(software)' --write --out <dir>",
    ),
    report,
  );
});

test('a locale, direction, or section lang the old file has carries over', () => {
  const text = [
    'locale: pt-BR',
    'direction: rtl',
    'identity:',
    '  name: Rowan Locale',
    'sections:',
    '  - kind: lede',
    '    title: About',
    '    lang: en',
    '    body: Hi.',
    '  - kind: now',
    '    title: Now',
    '    lang: not a tag',
    '    body: Now.',
    '',
  ].join('\n');
  const migration = plan(migrate({ text, format: 'yaml' }, { catalog: CATALOG, set: BASELINE }));
  const portfolio = migration.portfolio.data as {
    locale: string;
    direction: string;
    sections: { lang?: string }[];
  };
  assert.deepEqual([portfolio.locale, portfolio.direction], ['pt-BR', 'rtl']);
  assert.equal(portfolio.sections[0]!.lang, 'en');
  assert.deepEqual(changes(migration, 'moved').slice(0, 2), [
    ['/locale', 'portfolio:/locale', undefined, ''],
    ['/direction', 'portfolio:/direction', undefined, ''],
  ]);
  assert.ok(
    !changes(migration, 'default').some(
      ([, to]) => to === 'portfolio:/locale' || to === 'portfolio:/direction',
    ),
  );
  // A lang that isn't a language tag is an unknown key, as before.
  assert.deepEqual(
    migration.unknown.map(({ pointer }) => pointer),
    ['/sections/1/lang'],
  );
});
