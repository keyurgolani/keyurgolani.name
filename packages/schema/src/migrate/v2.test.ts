import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { validatePublicationUnit } from '../validate';
import {
  formatMigration,
  migrate,
  migrateDocuments,
  parseSet,
  SCHEMA_VERSIONS,
  type Migration,
  type MigrationPlan,
  type StoredUnit,
  type UnitMigration,
  type UnitMigrationPlan,
} from './index';

// The 2-to-3 step (#10, items 2 and 6), through pnpm config:migrate's
// migrate() and the store's migrateDocuments(): version 2 portfolios as #4
// shipped them, and small documents for each row of the mapping.

const DIR = new URL('../__fixtures__/v2/', import.meta.url);
const read = (name: string, file: string) => readFileSync(new URL(`${name}/${file}`, DIR), 'utf8');
const FIXTURES = readdirSync(DIR);

const lines = (...text: string[]) => `${text.join('\n')}\n`;
const V2 = (...sections: string[]) =>
  lines(
    'schemaVersion: 2',
    'locale: en',
    'direction: ltr',
    'identity:',
    '  name: Rowan Two',
    'sections:',
    ...sections,
  );
/** A version 2 site document that hides these sections. */
const SITE = (...hidden: string[]) =>
  lines(
    'schemaVersion: 2',
    'appearance:',
    '  variant: missing-variant',
    '  designLanguage: platform-neutral',
    '  colorScheme: ink-and-paper',
    '  typography: classic',
    '  displayMode: light',
    'visitorControls:',
    '  variant: locked',
    '  designLanguage: locked',
    '  colorScheme: selectable',
    '  typography: locked',
    '  displayMode: selectable',
    'motionPolicy: respect-os',
    'features:',
    '  feed: true',
    ...(hidden.length > 0 ? ['sections:', ...hidden.map((id) => `  ${id}: { hidden: true }`)] : []),
  );

function plan(migration: Migration): MigrationPlan {
  assert.ok(
    migration.status === 'ready' || migration.status === 'blocked',
    JSON.stringify(migration),
  );
  return migration;
}
const v2 = (text: string, site?: string, set: string[] = []) =>
  plan(
    migrate(
      { text, format: 'yaml' },
      {
        ...(site !== undefined ? { site: { text: site, format: 'yaml' } } : {}),
        set: set.map(parseSet),
      },
    ),
  );
type Rec = Record<string, unknown>;
const data = (migration: MigrationPlan) => migration.portfolio.data as Rec;
const notes = (migration: MigrationPlan, code: string) =>
  migration.changes
    .filter((change) => change.code === code)
    .map(({ from, to, note }) => [from, to?.pointer, note]);

test('each version 2 pair migrates: every section keeps its place and id, and the pair is valid', () => {
  assert.deepEqual(FIXTURES.sort(), ['engineering', 'mixed', 'photography']);
  for (const name of FIXTURES) {
    const text = read(name, 'portfolio.yml');
    const site = read(name, 'site.yml');
    const migration = v2(text, site);
    assert.equal(migration.status, 'ready', name);
    assert.equal(migration.from, 2, name);
    assert.equal(migration.to, 3, name);
    // Only the portfolio document changes.
    assert.equal(migration.site, undefined, name);
    assert.deepEqual(migration.ids, [], name);
    const before = parseYaml(text) as { sections: Array<{ id: string }> };
    const after = data(migration) as { schemaVersion: number; sections: Array<{ id: string }> };
    assert.equal(after.schemaVersion, 3, name);
    assert.deepEqual(
      after.sections.map(({ id }) => id),
      before.sections.map(({ id }) => id),
      name,
    );
    const checked = validatePublicationUnit({
      portfolio: { text: migration.portfolio.text, format: 'yaml', name: 'portfolio.yml' },
      site: { text: site, format: 'yaml', name: 'site.yml' },
    });
    assert.ok(checked.pair, name);
    assert.deepEqual(
      checked.diagnostics.filter(({ severity }) => severity !== 'warning'),
      [],
      name,
    );
    // The same input mints the same ids, and the output is current.
    const again = v2(text, site);
    assert.equal(again.portfolio.text, migration.portfolio.text, name);
    assert.equal(
      formatMigration(again, { file: 'portfolio.yml' }),
      formatMigration(migration, { file: 'portfolio.yml' }),
      name,
    );
    assert.deepEqual(migrate({ text: migration.portfolio.text, format: 'yaml' }), {
      status: 'current',
      document: 'portfolio',
    });
  }
});

test('items become records with ids minted once from content, in document order', () => {
  const migration = v2(read('engineering', 'portfolio.yml'), read('engineering', 'site.yml'));
  const portfolio = data(migration) as {
    works: Rec[];
    evidence: Rec[];
    chronology: Rec[];
    practice: Rec;
    contact: Rec;
    sections: Rec[];
  };
  assert.deepEqual(
    migration.minted.map(({ id, owner, pointer, from }) => [id, owner, pointer, from]),
    [
      ['years-engineering', 'evidence', '/evidence/0', '/sections/2/items/0'],
      ['services-migrated', 'evidence', '/evidence/1', '/sections/2/items/1'],
      ['shipyard', 'work', '/works/0', '/sections/3/items/0'],
      ['quiet-alerts', 'work', '/works/1', '/sections/3/items/1'],
      [
        'staff-engineer-platform-harbor-freight-labs',
        'chronology',
        '/chronology/0',
        '/sections/4/items/0',
      ],
      ['senior-engineer-bluefin', 'chronology', '/chronology/1', '/sections/4/items/1'],
    ],
  );
  assert.deepEqual(
    portfolio.sections.map(({ kind, id, items, part }) => [kind, id, items ?? part ?? null]),
    [
      ['hero', 'top', null],
      ['lede', 'about', null],
      ['evidence', 'numbers', ['years-engineering', 'services-migrated']],
      ['works', 'work', ['shipyard', 'quiet-alerts']],
      [
        'chronology',
        'experience',
        ['staff-engineer-platform-harbor-freight-labs', 'senior-engineer-bluefin'],
      ],
      ['practice', 'skills', 'skills'],
      ['practice', 'stack', 'tools'],
      ['contact', 'contact', null],
    ],
  );
  // A project's name is its title, and its technologies its tools.
  assert.deepEqual(portfolio.works[1], {
    id: 'quiet-alerts',
    title: 'quiet-alerts',
    medium: 'software',
    summary: 'Alert routing that pages one person, not twelve.',
    role: 'Maintainer',
    tools: ['TypeScript'],
  });
  // An experience item's role is its title.
  assert.deepEqual(portfolio.chronology[1], {
    id: 'senior-engineer-bluefin',
    kind: 'role',
    title: 'Senior Engineer',
    period: { start: '2016-05', end: '2021-12' },
    organization: 'Bluefin',
  });
  assert.deepEqual(Object.keys(portfolio.practice), ['skills', 'tools']);
  assert.deepEqual(portfolio.contact, { message: 'Email is best. I answer within a week.' });
  const report = formatMigration(migration, { file: 'portfolio.yml' });
  assert.ok(
    report.startsWith(
      "portfolio.yml is a schemaVersion 2 portfolio document. Migrating it writes portfolio.yml at schemaVersion 3; the site document doesn't change.\n",
    ),
    report,
  );
  assert.ok(report.includes('\nRecord and media ids, minted once from content:\n'), report);
  assert.ok(report.includes('  /works/0 is shipyard, from /sections/3/items/0.\n'), report);
  assert.ok(
    report.includes('pnpm config:migrate portfolio.yml --write --out <dir> writes portfolio.yml'),
    report,
  );
  // A summary leaves the minted ids out.
  const summary = formatMigration(migration, { file: 'portfolio.yml', summary: true });
  for (const value of ['shipyard', 'Ines', 'harbor-freight', 'Email is best']) {
    assert.ok(!summary.includes(value), value);
  }
});

test('an image is a media asset, made at its first use, with its source under the media root', () => {
  const migration = v2(read('photography', 'portfolio.yml'), read('photography', 'site.yml'));
  const portfolio = data(migration) as { identity: Rec; media: Rec[]; works: Rec[] };
  assert.deepEqual(portfolio.identity.avatar, { asset: 'avatar' });
  assert.deepEqual(portfolio.media[0], {
    id: 'avatar',
    kind: 'image',
    source: 'images/mateo.jpg',
    alt: 'Mateo with a medium-format camera',
  });
  // A gallery is one image-series work, its items placements in order. The
  // section claims harbors first, so the work's id is the next free one.
  assert.deepEqual(portfolio.works[0], {
    id: 'harbors-2',
    title: 'Harbors',
    medium: 'image-series',
    media: [
      {
        asset: 'harbors-2-image',
        caption: 'The 6:10 to Vinga',
        location: 'Gothenburg',
        takenAt: '2025-03',
      },
      { asset: 'harbors-2-image-2', caption: 'Nets, Fiskebäckskil', takenAt: '2024-08' },
    ],
  });
  // A title with no letter an id can use mints the kind's next number.
  const mixed = v2(read('mixed', 'portfolio.yml'), read('mixed', 'site.yml'));
  assert.deepEqual(
    mixed.minted.map(({ id }) => id),
    ['work-1', 'work-2', 'maps-people-draw-by-hand'],
  );
  assert.equal((data(mixed).works as Rec[])[1]!.series, 'خرائط');
});

test('a stat is metric evidence: a number is its value, anything else its statement', () => {
  const migration = v2(
    V2(
      '  - kind: stats',
      '    id: numbers',
      '    items:',
      "      - { metric: talks-given, value: '40', label: Talks given }",
      "      - { value: 'Forty', label: Talks }",
      '  - kind: tenure',
      '    id: tenure',
      '    years: 12',
      '    summary: Twelve years in platforms.',
    ),
  );
  assert.deepEqual(data(migration).evidence, [
    {
      id: 'talks-given',
      type: 'metric',
      statement: 'Talks given',
      metric: { key: 'talks-given', value: 40 },
    },
    { id: 'talks', type: 'metric', statement: 'Forty Talks' },
    {
      id: 'tenure-years',
      type: 'metric',
      statement: 'Twelve years in platforms.',
      metric: { key: 'tenure-years', value: 12, unit: 'years' },
    },
  ]);
  assert.deepEqual(
    notes(migration, 'warned').map(([from]) => from),
    ['/sections/0/items/1', '/sections/0/items/1/value'],
  );
});

test("a hidden section's groups and contact never join what a visible section shows", () => {
  const text = V2(
    '  - kind: skills',
    '    id: skills',
    '    groups: [{ name: Public, items: [Go] }]',
    '  - kind: skills',
    '    id: skills-draft',
    '    groups: [{ name: Draft, items: [canary-hidden-skill] }]',
    '  - kind: contact',
    '    id: contact-draft',
    '    message: canary-hidden-contact',
    '  - kind: contact',
    '    id: contact',
    '    message: Write any time.',
  );
  const hidden = v2(text, SITE('skills-draft', 'contact-draft'));
  assert.equal(hidden.status, 'ready');
  const portfolio = data(hidden);
  assert.deepEqual(portfolio.practice, { skills: [{ name: 'Public', items: ['Go'] }] });
  assert.deepEqual(portfolio.contact, { message: 'Write any time.' });
  assert.ok(!JSON.stringify(portfolio).includes('canary'), JSON.stringify(portfolio));
  assert.deepEqual(
    notes(hidden, 'removed').map(([from]) => from),
    ['/sections/1', '/sections/2'],
  );
  // Without the site document every section counts as visible: the groups
  // join one part, and the first contact section's message is the record.
  const visible = v2(text);
  assert.deepEqual((data(visible).practice as Rec).skills, [
    { name: 'Public', items: ['Go'] },
    { name: 'Draft', items: ['canary-hidden-skill'] },
  ]);
  assert.deepEqual(data(visible).contact, { message: 'canary-hidden-contact' });
  assert.deepEqual(
    notes(visible, 'warned').map(([from]) => from),
    ['/sections/1'],
  );
});

test('a label for a call to action, and a title for a gallery, are values only the owner gives', () => {
  const text = V2(
    '  - kind: cta',
    '    id: next',
    '    title: Next',
    "    primaryAction: { url: 'mailto:rowan@rowan.test' }",
    '  - kind: gallery',
    '    id: plates',
    '    items:',
    '      - image: { src: /a.png, alt: A plate }',
  );
  const blocked = v2(text);
  assert.equal(blocked.status, 'blocked');
  assert.deepEqual(
    blocked.needs.map(({ path }) => path),
    ['portfolio.sections.0.primaryAction.label', 'portfolio.works.0.title'],
  );
  const ready = v2(text, undefined, [
    'portfolio.sections.0.primaryAction.label=Write',
    'portfolio.works.0.title=Plates',
  ]);
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.diagnostics, []);
  // A version 2 portfolio's migration sets portfolio values only.
  assert.deepEqual(
    migrate(
      { text, format: 'yaml' },
      { set: [parseSet('site.appearance.colorScheme=warm')] },
    ),
    {
      status: 'failed',
      reasons: [
        "--set site.appearance.colorScheme: a version 2 portfolio's migration sets portfolio values only.",
      ],
    },
  );
});

test('a list section that lists nothing goes, and the sections after it move up', () => {
  const text = V2(
    '  - { kind: projects, id: drafts, title: Drafts, items: [] }',
    '  - { kind: experience, id: experience, title: Experience, items: [] }',
    '  - { kind: lede, id: about, title: About, body: Hi. }',
    "  - { kind: cta, id: next, primaryAction: { url: '#about' } }",
  );
  const migration = v2(text, SITE('drafts'));
  assert.deepEqual(
    (data(migration).sections as Rec[]).map(({ id }) => id),
    ['about', 'next'],
  );
  const empty = "An empty list is left out: in version 3 a list that's left out isn't authored.";
  assert.deepEqual(notes(migration, 'removed'), [
    [
      '/sections/0',
      undefined,
      'The projects section lists nothing, and a version 3 works section lists at least one record, so it goes, and its id with it.',
    ],
    ['/sections/0/items', undefined, empty],
    [
      '/sections/1',
      undefined,
      'The experience section lists nothing, and a version 3 chronology section without items lists every entry, so it goes, and its id with it.',
    ],
    ['/sections/1/items', undefined, empty],
  ]);
  // The site document stays as it is, so its entry for the section is reported.
  assert.deepEqual(notes(migration, 'warned'), [
    [
      '/sections/0',
      undefined,
      "The site document's sections still name it: remove that entry, since its id is gone.",
    ],
  ]);
  // The need for the label is at the section's new place.
  assert.deepEqual(
    migration.needs.map(({ path }) => path),
    ['portfolio.sections.1.primaryAction.label'],
  );
});

test('in the old format, a list section that lists nothing goes, and so does its site entry', () => {
  const text = lines(
    'identity:',
    '  name: Rowan Empty',
    'sections:',
    '  - { kind: lede, title: About, body: Hi. }',
    '  - { kind: projects, title: Drafts, hidden: true, items: [] }',
    '  - { kind: projects, title: Work, items: [{ name: Shipyard }] }',
  );
  const set = ['site.appearance.colorScheme=warm', 'site.appearance.typography=classic'];
  const migration = plan(migrate({ text, format: 'yaml' }, { set: set.map(parseSet) }));
  assert.equal(migration.status, 'ready', JSON.stringify(migration.diagnostics));
  assert.deepEqual(
    (data(migration).sections as Rec[]).map(({ id }) => id),
    ['about', 'work'],
  );
  assert.equal((migration.site!.data as Rec).sections, undefined);
  assert.ok(
    migration.changes.some(
      ({ code, from, note }) =>
        code === 'removed' &&
        from === '/sections/1/hidden' &&
        note === "Its section goes, so the site document doesn't hide it.",
    ),
  );
  // The section after it says where it is now.
  assert.ok(
    migration.changes.some(
      ({ code, from, to }) =>
        code === 'mapped' && from === '/sections/2' && to?.pointer === '/sections/1',
    ),
  );
});

const UNIT: StoredUnit = {
  portfolio: { text: read('engineering', 'portfolio.yml'), format: 'yaml' },
  site: { text: read('engineering', 'site.yml'), format: 'yaml' },
  media: { text: '{ "assets": [] }\n', format: 'json' },
};

function unitPlan(migration: UnitMigration): UnitMigrationPlan {
  assert.ok(
    migration.status === 'ready' || migration.status === 'blocked',
    JSON.stringify(migration),
  );
  return migration;
}

test('a stored unit migrates: the portfolio to 3, the site byte for byte, the media as it is', () => {
  assert.deepEqual(SCHEMA_VERSIONS, { portfolio: 3, site: 2 });
  const migration = unitPlan(migrateDocuments(UNIT));
  assert.equal(migration.status, 'ready');
  assert.deepEqual(migration.from, { portfolio: 2, site: 2 });
  assert.deepEqual(migration.to, { portfolio: 3, site: 2 });
  assert.equal(migration.documents.site.text, UNIT.site.text);
  assert.deepEqual(migration.documents.media, UNIT.media);
  assert.equal(migration.documents.portfolio.format, 'yaml');
  // The same documents, and ids, as pnpm config:migrate.
  const cli = v2(UNIT.portfolio.text, UNIT.site.text);
  assert.equal(migration.documents.portfolio.text, cli.portfolio.text);
  assert.deepEqual(migration.minted, cli.minted);
  // Deterministic, and idempotent: its own output is current.
  assert.deepEqual(migrateDocuments(UNIT), migration);
  assert.deepEqual(migrateDocuments({ ...UNIT, portfolio: migration.documents.portfolio }), {
    status: 'current',
  });
});

test('a JSON unit stays JSON, and a --set for the site edits it in place', () => {
  const json = (text: string) => `${JSON.stringify(parseYaml(text), null, 2)}\n`;
  const migration = unitPlan(
    migrateDocuments(
      {
        portfolio: { text: json(UNIT.portfolio.text), format: 'json' },
        site: UNIT.site,
      },
      { set: [parseSet('site.features.feed=false')] },
    ),
  );
  assert.equal(migration.documents.portfolio.format, 'json');
  assert.equal((JSON.parse(migration.documents.portfolio.text) as Rec).schemaVersion, 3);
  assert.equal(migration.documents.media, undefined);
  // The site keeps its comment and every other byte.
  assert.equal(
    migration.documents.site.text,
    UNIT.site.text.replace('  feed: true', '  feed: false'),
  );
});

test('a unit with a value still needed is blocked, with the record left at its pointer', () => {
  const unit: StoredUnit = {
    portfolio: {
      text: V2('  - kind: cta', '    id: next', "    primaryAction: { url: '#next' }"),
      format: 'yaml',
    },
    site: { text: SITE(), format: 'yaml' },
  };
  const blocked = unitPlan(migrateDocuments(unit));
  assert.equal(blocked.status, 'blocked');
  assert.deepEqual(
    blocked.needs.map(({ path }) => path),
    ['portfolio.sections.0.primaryAction.label'],
  );
  // The placeholder fills the check, so no record is about the label.
  assert.ok(blocked.diagnostics.every(({ pointer }) => !pointer.endsWith('/label')));
  const ready = unitPlan(
    migrateDocuments(unit, { set: [parseSet('portfolio.sections.0.primaryAction.label=Next')] }),
  );
  assert.equal(ready.status, 'ready');
});

test('a unit no step reads fails, with a summary that holds no value from it', () => {
  const name = 'Rowan Canary-Name';
  // Each with what the summary leaves out: the name, or the version declared.
  const cases: Array<[StoredUnit, RegExp, string, string]> = [
    [
      { ...UNIT, portfolio: { text: `identity:\n  name: ${name}\nsections: []\n`, format: 'yaml' } },
      /the old one-file format, version 1/,
      'The portfolio document is the old one-file format',
      'Canary',
    ],
    [
      { ...UNIT, portfolio: { text: `schemaVersion: 9\nidentity: { name: ${name} }\n`, format: 'yaml' } },
      /declares schemaVersion 9, which no migration step reads/,
      'The portfolio document declares a schemaVersion,',
      '9',
    ],
    [
      { ...UNIT, site: { text: UNIT.site.text.replace('schemaVersion: 2', 'schemaVersion: 1'), format: 'yaml' } },
      /The site document declares schemaVersion 1/,
      'The site document declares a schemaVersion,',
      '1',
    ],
    [
      { ...UNIT, portfolio: { text: `identity: [${name}\n`, format: 'yaml' } },
      /^The portfolio document: line \d+, column \d+: /,
      "The portfolio document doesn't parse.",
      'Canary',
    ],
  ];
  for (const [unit, reason, summary, withheld] of cases) {
    const failed = migrateDocuments(unit);
    assert.equal(failed.status, 'failed');
    if (failed.status !== 'failed') continue;
    assert.match(failed.reasons[0]!, reason);
    assert.ok(failed.summary[0]!.startsWith(summary), failed.summary[0]);
    assert.ok(!failed.summary.join(' ').includes(withheld), failed.summary[0]);
  }
});
