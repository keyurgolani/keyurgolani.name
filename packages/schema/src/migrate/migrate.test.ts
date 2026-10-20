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

test('meta.url is removed and printed as the proposed PORTFOLIO_ORIGIN', () => {
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
  assert.ok(report.includes('Proposed PORTFOLIO_ORIGIN: https://rowan-old.test.'));
  assert.ok(
    !formatMigration(migration, { file: 'meta-url.yml', summary: true }).includes('rowan-old'),
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
      ['contact', 'kept'],
      ['contact-2', 'repeated'],
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
    '/sections/0/lang',
    '/sections/1/items/0/metric',
    '/sections/2/items/0/period/note',
  ];
  assert.deepEqual(
    kept.unknown.map(({ pointer }) => pointer),
    pointers,
  );
  assert.deepEqual([kept.unknown[0]!.line, kept.unknown[0]!.column], [6, 3]);
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
