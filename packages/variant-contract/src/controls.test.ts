import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PortfolioSchema,
  resolvePortfolioView,
  type ContentExtension,
  type ParsedPair,
} from '@portfolio/schema';
import { exhibitions } from './__fixtures__/extension';
import {
  checkControlValues,
  contentIndex,
  materializeControls,
  migrateControls,
  RECORD_PLACEMENT_MAX,
  serializeControls,
  storedControls,
  type ControlsEntry,
} from './controls';
import type { VariantManifest } from './manifest-schema';
import { validateManifest } from './validate-manifest';

// Typed controls (#5, Slice 1, item 2): stored values against the manifest
// and the visible content, defaults for anything unusable, deterministic
// serialization, and migrations that step one version at a time.

// The fixture as plain JSON, which each test reshapes freely.
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function load(change: (m: Raw) => void = () => {}): VariantManifest {
  const raw = JSON.parse(
    readFileSync(new URL('./__fixtures__/manifest.json', import.meta.url), 'utf8'),
  );
  change(raw);
  const result = validateManifest(raw, { packageName: '@acme/ocean' });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.manifest;
}

const MANIFEST = load();
const WORKS = [
  { id: 'tide', title: 'Tide', medium: 'writing' },
  { id: 'atlas', title: 'Atlas', medium: 'software' },
  { id: 'sketch', title: 'Sketch', medium: 'writing' },
  { id: 'secret', title: 'Secret', medium: 'writing', visibility: 'private' },
];
const SECTIONS = [
  { id: 'top', kind: 'hero' },
  { id: 'essays', kind: 'works', items: ['tide'] },
  { id: 'work', kind: 'works', items: ['atlas', 'secret'] },
  { id: 'drafts', kind: 'works', items: ['sketch'] },
  { id: 'contact', kind: 'contact' },
];
/** A version 3 pair holding `sections`, with the site hiding `hidden`. */
const pairOf = (sections: readonly object[], hidden: readonly string[] = []) =>
  ({
    portfolio: PortfolioSchema.parse({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Rowan Controls' },
      works: WORKS,
      contact: { message: 'Write.' },
      sections,
    }),
    site: { sections: Object.fromEntries(hidden.map((id) => [id, { hidden: true }])) },
  }) as unknown as ParsedPair;
/** The published view's portfolio, as a render reads it. */
const viewOf = (pair: ParsedPair, extensions: readonly ContentExtension[] = []) =>
  resolvePortfolioView(pair, {}, { mediaBase: '/media', extensions }).portfolio;
const CONTENT = contentIndex(viewOf(pairOf(SECTIONS, ['drafts'])));

const DEFAULTS = {
  showIndex: true,
  heroLayout: 'wide',
  columns: 2,
  leadSection: null,
  featured: [],
};

const problems = (values: Record<string, unknown>, version = 2) =>
  checkControlValues(MANIFEST, { version, values }, CONTENT).map(({ code, path }) => [
    code,
    path.join('/'),
  ]);

test('values that fit their controls have no problems, and fill in over the defaults', () => {
  const values = {
    showIndex: false,
    heroLayout: 'split',
    columns: 4,
    leadSection: 'essays',
    featured: ['work', 'essays'],
  };
  assert.deepEqual(problems(values), []);
  assert.deepEqual(materializeControls(MANIFEST, { version: 2, values }, CONTENT), values);
});

test('omitted values, and no entry at all, take the defaults', () => {
  assert.deepEqual(problems({ columns: 3 }), []);
  assert.deepEqual(materializeControls(MANIFEST, { version: 2, values: { columns: 3 } }, CONTENT), {
    ...DEFAULTS,
    columns: 3,
  });
  assert.deepEqual(materializeControls(MANIFEST, undefined, CONTENT), DEFAULTS);
  assert.deepEqual(checkControlValues(MANIFEST, undefined, CONTENT), []);
});

test("storedControls returns the site's own entry for a variant, and nothing it inherits", () => {
  const entry = { version: 2, values: { columns: 3 } };
  assert.equal(storedControls({ variantControls: { 'acme-ocean': entry } }, 'acme-ocean'), entry);
  assert.equal(storedControls({}, 'acme-ocean'), undefined);
  for (const id of ['constructor', 'toString', '__proto__']) {
    assert.equal(storedControls({ variantControls: {} }, id), undefined, id);
  }
  const inherited = Object.create({ 'acme-ocean': entry }) as Record<string, ControlsEntry>;
  assert.equal(storedControls({ variantControls: inherited }, 'acme-ocean'), undefined);
});

test('each kind of bad value is controls.invalid at its own path, and renders its default', () => {
  const values = {
    showIndex: 'yes',
    heroLayout: 'full',
    columns: 5,
    leadSection: 7,
    featured: ['work', 'work', 'essays', 'contact'],
    sparkle: true,
  };
  assert.deepEqual(problems(values), [
    ['controls.invalid', 'values/showIndex'],
    ['controls.invalid', 'values/heroLayout'],
    ['controls.invalid', 'values/columns'],
    ['controls.invalid', 'values/leadSection'],
    // Four sections where three is the most, and one of them twice.
    ['controls.invalid', 'values/featured'],
    ['controls.invalid', 'values/featured/1'],
    ['controls.invalid', 'values/sparkle'],
  ]);
  assert.deepEqual(materializeControls(MANIFEST, { version: 2, values }, CONTENT), DEFAULTS);
});

test('an integer off its step, a list that is not ids, and a ref of the wrong kind are invalid', () => {
  const stepped = load((m) =>
    Object.assign(m.controls.items[2], { min: 1, max: 9, step: 2, default: 3 }),
  );
  assert.deepEqual(
    checkControlValues(stepped, { version: 2, values: { columns: 4 } }, CONTENT).map(
      ({ code }) => code,
    ),
    ['controls.invalid'],
  );
  assert.deepEqual(problems({ featured: 'work' }), [['controls.invalid', 'values/featured']]);
  // leadSection takes works or evidence; contact is neither.
  assert.deepEqual(problems({ leadSection: 'contact' }), [
    ['controls.invalid', 'values/leadSection'],
  ]);
});

test('a ref to a missing or hidden section is controls.dangling-ref', () => {
  assert.deepEqual(problems({ leadSection: 'gone', featured: ['work', 'drafts'] }), [
    ['controls.dangling-ref', 'values/leadSection'],
    ['controls.dangling-ref', 'values/featured/1'],
  ]);
  assert.deepEqual(
    materializeControls(
      MANIFEST,
      { version: 2, values: { leadSection: 'gone', heroLayout: 'split' } },
      CONTENT,
    ),
    { ...DEFAULTS, heroLayout: 'split' },
  );
});

test('another version is controls.stale alone, and every control renders its default', () => {
  for (const version of [1, 3]) {
    assert.deepEqual(problems({ heroLayout: 'split', sparkle: true }, version), [
      ['controls.stale', 'version'],
    ]);
    assert.deepEqual(
      materializeControls(MANIFEST, { version, values: { heroLayout: 'split' } }, CONTENT),
      DEFAULTS,
    );
  }
});

test("the content index is the published view's: no hidden or unregistered extension section, and no record they alone reach", () => {
  const sections = [
    ...SECTIONS,
    { id: 'shows', kind: '@acme/portfolio-photography/exhibitions', data: { items: [] } },
    { id: 'notes', kind: '@other/x/notes', data: {} },
  ];
  const pair = pairOf(sections, ['drafts']);
  assert.deepEqual(
    [...contentIndex(viewOf(pair)).entries()],
    [
      ['top', 'hero'],
      ['essays', 'works'],
      ['work', 'works'],
      ['contact', 'contact'],
      ['tide', 'works'],
      ['atlas', 'works'],
    ],
  );
  assert.deepEqual(
    [...contentIndex(viewOf(pair, [exhibitions])).keys()],
    ['top', 'essays', 'work', 'contact', 'shows', 'tide', 'atlas'],
  );
});

test('a ref may point at a visible record, by the kind of section that lists it, and not at a private or hidden one (#10)', () => {
  assert.deepEqual(problems({ leadSection: 'tide', featured: ['atlas', 'essays'] }), []);
  assert.deepEqual(problems({ leadSection: 'secret', featured: ['sketch'] }), [
    ['controls.dangling-ref', 'values/leadSection'],
    ['controls.dangling-ref', 'values/featured/0'],
  ]);
  // A kind filter reads a record by the kind of section that lists it.
  const sectionsOnly = load((m) => {
    m.controls.items[3].kinds = ['hero'];
  });
  assert.deepEqual(
    checkControlValues(sectionsOnly, { version: 2, values: { leadSection: 'tide' } }, CONTENT).map(
      ({ code }) => code,
    ),
    ['controls.invalid'],
  );
});

test('serializeControls sorts keys at every level and writes canonical numbers', () => {
  const a: ControlsEntry = {
    version: 2,
    values: { columns: 3, heroLayout: 'wide', z: { b: 1, a: 2 } },
  };
  const b: ControlsEntry = {
    values: { z: { a: 2, b: 1 }, heroLayout: 'wide', columns: 3.0 },
    version: 2,
  };
  assert.equal(serializeControls(a), serializeControls(b));
  assert.equal(
    serializeControls(a),
    '{"values":{"columns":3,"heroLayout":"wide","z":{"a":2,"b":1}},"version":2}',
  );
  assert.equal(
    serializeControls({ version: 1, values: { n: -0, big: 1e21 } }),
    '{"values":{"big":1e+21,"n":0},"version":1}',
  );
});

test('a migration steps version 1 to 2 with each operation, and the result is current', () => {
  const old: ControlsEntry = {
    version: 1,
    values: { layout: 'full', columns: 9, legacyFlag: true, showIndex: false },
  };
  const { entry, changes, newer } = migrateControls(MANIFEST, old);
  assert.equal(newer, false);
  assert.deepEqual(entry, {
    version: 2,
    values: { heroLayout: 'wide', columns: 4, showIndex: false },
  });
  assert.deepEqual(
    changes.map(({ op, control, before, after }) => [op, control, before, after]),
    [
      ['rename', 'layout', undefined, 'heroLayout'],
      ['mapValue', 'heroLayout', 'full', 'wide'],
      ['clamp', 'columns', 9, 4],
      ['drop', 'legacyFlag', true, undefined],
    ],
  );
  assert.deepEqual(checkControlValues(MANIFEST, entry, CONTENT), []);
  // The input is left alone.
  assert.equal(old.version, 1);
  assert.ok('layout' in old.values);
});

test('migrating twice is a no-op, on the same input and on its own output', () => {
  const old: ControlsEntry = { version: 1, values: { layout: 'split', columns: 0 } };
  const once = migrateControls(MANIFEST, old);
  assert.deepEqual(migrateControls(MANIFEST, old), once);
  const again = migrateControls(MANIFEST, once.entry);
  assert.deepEqual(again.entry, once.entry);
  assert.deepEqual(again.changes, []);
  assert.equal(serializeControls(again.entry), serializeControls(once.entry));
});

test('a rename onto a value that already exists keeps the newer one', () => {
  const { entry } = migrateControls(MANIFEST, {
    version: 1,
    values: { layout: 'full', heroLayout: 'split' },
  });
  assert.deepEqual(entry.values, { layout: 'full', heroLayout: 'split' });
});

test('an entry newer than the manifest is left as it was', () => {
  const entry: ControlsEntry = { version: 5, values: { anything: 1 } };
  const result = migrateControls(MANIFEST, entry);
  assert.equal(result.newer, true);
  assert.equal(result.entry, entry);
  assert.deepEqual(result.changes, []);
});

test('a three-version history steps through each migration in order', () => {
  const three = load((m) => {
    m.controls.version = 3;
    m.controls.migrations.push({
      from: 2,
      to: 3,
      operations: [{ op: 'rename', from: 'heroLayout', to: 'opening' }],
    });
    m.controls.items[1].id = 'opening';
  });
  const { entry } = migrateControls(three, { version: 1, values: { layout: 'full' } });
  assert.deepEqual(entry, { version: 3, values: { opening: 'wide' } });
});

// K-3: Chapters' two control types, a periodList of the owner's own chapters
// and a recordPlacement of records into them.
const BOOK = load((m) => {
  m.controls.items.push(
    {
      type: 'periodList',
      id: 'chapters',
      label: 'Chapters',
      description: 'Your own chapters, in the order they start.',
      max: 7,
      default: [],
    },
    {
      type: 'recordPlacement',
      id: 'place',
      label: 'Placement',
      description: 'Which chapter a record goes in.',
      default: {},
    },
  );
});
const bookProblems = (values: Record<string, unknown>) =>
  checkControlValues(BOOK, { version: 2, values }, CONTENT).map(({ code, path }) => [
    code,
    path.join('/'),
  ]);
const PERIODS = [
  { slug: 'early-years', title: 'Early years', from: '2012' },
  { slug: 'the-platform', title: 'The platform', from: '2016-04', teaser: 'Where it scaled.' },
  { slug: 'now', title: 'Now', from: '2021' },
];

test('a periodList and a recordPlacement that fit have no problems, and both default to none', () => {
  const values = { chapters: PERIODS, place: { tide: 'early-years', atlas: 'now' } };
  assert.deepEqual(bookProblems(values), []);
  const materialized = materializeControls(BOOK, { version: 2, values }, CONTENT);
  assert.deepEqual(materialized.chapters, PERIODS);
  assert.deepEqual(materialized.place, values.place);
  const defaults = materializeControls(BOOK, undefined, CONTENT);
  assert.deepEqual([defaults.chapters, defaults.place], [[], {}]);
});

test('a periodList takes at most its max of periods, each with a slug, a short title, a start in order, and an optional teaser', () => {
  assert.deepEqual(
    bookProblems({
      chapters: [
        { slug: 'Early Years', title: 'Early years', from: '2012' },
        { slug: 'b', title: '', from: '2013' },
        { slug: 'b', title: 'B again', from: '2014-13' },
        { slug: 'd', title: 'x'.repeat(61), from: '2014' },
        { slug: 'e', title: 'E', from: '2013-06', colour: 'red' },
        { slug: 'f', title: 'F <b>', from: '2015', teaser: 'y'.repeat(301) },
        'g',
        { slug: 'h', title: 'H', from: '2016' },
      ],
    }),
    [
      ['controls.invalid', 'values/chapters'],
      ['controls.invalid', 'values/chapters/0/slug'],
      ['controls.invalid', 'values/chapters/1/title'],
      ['controls.invalid', 'values/chapters/2/slug'],
      ['controls.invalid', 'values/chapters/2/from'],
      ['controls.invalid', 'values/chapters/3/title'],
      ['controls.invalid', 'values/chapters/4/colour'],
      // 2013-06 starts before 2014, the period before it.
      ['controls.invalid', 'values/chapters/4/from'],
      ['controls.invalid', 'values/chapters/5/title'],
      ['controls.invalid', 'values/chapters/5/teaser'],
      ['controls.invalid', 'values/chapters/6'],
    ],
  );
  // A bare year is its January, so 2019 then 2019-04 is in order, and 2019-01 after 2019 isn't.
  assert.deepEqual(
    bookProblems({
      chapters: [
        { slug: 'a', title: 'A', from: '2019' },
        { slug: 'b', title: 'B', from: '2019-04' },
      ],
    }),
    [],
  );
  assert.deepEqual(
    bookProblems({
      chapters: [
        { slug: 'a', title: 'A', from: '2019' },
        { slug: 'b', title: 'B', from: '2019-01' },
      ],
    }),
    [['controls.invalid', 'values/chapters/1/from']],
  );
  assert.deepEqual(bookProblems({ chapters: 'early-years' }), [
    ['controls.invalid', 'values/chapters'],
  ]);
  // Anything wrong renders the default: none.
  const values = { chapters: [{ slug: 'a', title: '', from: '2019' }] };
  assert.deepEqual(materializeControls(BOOK, { version: 2, values }, CONTENT).chapters, []);
});

test('a recordPlacement names visible records alone, each to a slug, and a private, unreached, or unknown one is controls.dangling-ref', () => {
  assert.deepEqual(
    bookProblems({
      place: {
        tide: 'early-years',
        secret: 'now',
        sketch: 'now',
        nowhere: 'now',
        essays: 'now',
        atlas: 'Not A Slug',
      },
    }),
    [
      // secret is private, sketch is listed only by a hidden section, and nowhere doesn't exist.
      ['controls.dangling-ref', 'values/place/secret'],
      ['controls.dangling-ref', 'values/place/sketch'],
      ['controls.dangling-ref', 'values/place/nowhere'],
      // essays is a section.
      ['controls.invalid', 'values/place/essays'],
      ['controls.invalid', 'values/place/atlas'],
    ],
  );
  assert.deepEqual(bookProblems({ place: ['tide'] }), [['controls.invalid', 'values/place']]);
  // A placement that names anything it can't is dropped whole, so no private id reaches a render.
  const values = { place: { tide: 'now', secret: 'now' } };
  assert.deepEqual(materializeControls(BOOK, { version: 2, values }, CONTENT).place, {});
});

test('a periodList declares a max from 1 to 7, and both new types default to none', () => {
  const declare = (control: Raw) =>
    validateManifest(
      (() => {
        const raw = JSON.parse(
          readFileSync(new URL('./__fixtures__/manifest.json', import.meta.url), 'utf8'),
        );
        raw.controls.items.push(control);
        return raw;
      })(),
      { packageName: '@acme/ocean' },
    ).ok;
  const base = { id: 'chapters', label: 'Chapters', description: 'Chapters.' };
  assert.equal(declare({ type: 'periodList', ...base, max: 7, default: [] }), true);
  assert.equal(declare({ type: 'periodList', ...base, max: 8, default: [] }), false);
  assert.equal(declare({ type: 'periodList', ...base, max: 0, default: [] }), false);
  assert.equal(declare({ type: 'periodList', ...base, max: 3, default: [PERIODS[0]] }), false);
  assert.equal(declare({ type: 'recordPlacement', ...base, default: {} }), true);
  assert.equal(declare({ type: 'recordPlacement', ...base, default: { tide: 'now' } }), false);
});

test('a period title or teaser refuses a line or paragraph separator, NEL, a direction override or isolate, and padding (K-3 review)', () => {
  const titled = (title: string, teaser?: string) =>
    bookProblems({
      chapters: [{ slug: 'a', title, from: '2019', ...(teaser === undefined ? {} : { teaser }) }],
    });
  for (const bad of [
    '\u2028',
    '\u2029',
    '\u0085',
    '\u009f',
    '\u202a',
    '\u202e',
    '\u2066',
    '\u2069',
  ]) {
    const code = bad.codePointAt(0)!.toString(16);
    assert.deepEqual(
      titled(`Early${bad}years`),
      [['controls.invalid', 'values/chapters/0/title']],
      code,
    );
    assert.deepEqual(
      titled('Early years', `Where it${bad}began.`),
      [['controls.invalid', 'values/chapters/0/teaser']],
      code,
    );
  }
  assert.deepEqual(titled('  Early years  '), [['controls.invalid', 'values/chapters/0/title']]);
  assert.deepEqual(titled('Early years', ' Padded.'), [
    ['controls.invalid', 'values/chapters/0/teaser'],
  ]);
  // Right-to-left text itself is fine: only the invisible controls go.
  assert.deepEqual(titled('السنوات الأولى', 'Où tout a commencé, 2012–2016.'), []);
});

test('a recordPlacement holds at most RECORD_PLACEMENT_MAX records, and an index without its record ids names no record (K-3 review)', () => {
  const many = Object.fromEntries(
    Array.from({ length: RECORD_PLACEMENT_MAX + 1 }, (_, index) => [`r${index}`, 'now']),
  );
  assert.ok(
    bookProblems({ place: many }).some(
      ([code, path]) => code === 'controls.invalid' && path === 'values/place',
    ),
  );
  const handBuilt = new Map([
    ['essays', 'works'],
    ['tide', 'works'],
  ]);
  assert.deepEqual(
    checkControlValues(
      BOOK,
      { version: 2, values: { place: { essays: 'now', tide: 'now' } } },
      handBuilt,
    ).map(({ code, path }) => [code, path.join('/')]),
    [
      ['controls.invalid', 'values/place/essays'],
      ['controls.invalid', 'values/place/tide'],
    ],
  );
});

// K-8: a media ref, a contentRef of kind media alone, such as Aurora's backdrop.
const SKY = load((m) => {
  m.controls.items.push({
    type: 'contentRef',
    id: 'backdrop',
    label: 'Backdrop',
    description: 'The photograph behind the page.',
    kinds: ['media'],
    default: null,
  });
});
/** A pair whose works place four images: one public and visible, one only a hidden section reaches, one private, and one nothing places. */
const skyPair = () =>
  ({
    portfolio: PortfolioSchema.parse({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Rowan Controls' },
      works: [
        { id: 'tide', title: 'Tide', medium: 'writing', cover: { asset: 'sky' } },
        { id: 'sketch', title: 'Sketch', medium: 'writing', cover: { asset: 'hidden-sky' } },
        { id: 'atlas', title: 'Atlas', medium: 'software', cover: { asset: 'private-sky' } },
      ],
      media: [
        { id: 'sky', kind: 'image', source: 'sky.jpg', decorative: true },
        { id: 'hidden-sky', kind: 'image', source: 'hidden.jpg', decorative: true },
        {
          id: 'private-sky',
          kind: 'image',
          source: 'private.jpg',
          decorative: true,
          visibility: 'private',
        },
        { id: 'loose', kind: 'image', source: 'loose.jpg', decorative: true },
      ],
      contact: { message: 'Write.' },
      sections: [
        { id: 'essays', kind: 'works', items: ['tide', 'atlas'] },
        { id: 'drafts', kind: 'works', items: ['sketch'] },
      ],
    }),
    site: { sections: { drafts: { hidden: true } } },
  }) as unknown as ParsedPair;

test('a media ref names an asset the published view holds; an unknown, private, or unplaced one is controls.dangling-ref, and renders the default (K-8)', () => {
  const view = resolvePortfolioView(skyPair(), {}, { mediaBase: '/media' });
  const content = contentIndex(view.portfolio, view.media);
  assert.deepEqual([...(content.media ?? new Map()).entries()], [['sky', 'image']]);
  // The index of sections and records is as it was: media sits apart.
  assert.deepEqual([...content.keys()], ['essays', 'tide', 'atlas']);
  const sky = (values: Record<string, unknown>) =>
    checkControlValues(SKY, { version: 2, values }, content).map(({ code, path }) => [
      code,
      path.join('/'),
    ]);
  assert.deepEqual(sky({ backdrop: 'sky' }), []);
  assert.deepEqual(sky({ backdrop: null }), []);
  for (const id of ['hidden-sky', 'private-sky', 'loose', 'nowhere']) {
    assert.deepEqual(sky({ backdrop: id }), [['controls.dangling-ref', 'values/backdrop']], id);
    assert.equal(
      materializeControls(SKY, { version: 2, values: { backdrop: id } }, content).backdrop,
      null,
      id,
    );
  }
  // A section or a record is content, not media.
  for (const id of ['essays', 'tide', 'atlas']) {
    assert.deepEqual(sky({ backdrop: id }), [['controls.invalid', 'values/backdrop']], id);
  }
  assert.deepEqual(sky({ backdrop: 7 }), [['controls.invalid', 'values/backdrop']]);
  assert.equal(
    materializeControls(SKY, { version: 2, values: { backdrop: 'sky' } }, content).backdrop,
    'sky',
  );
  // Any other ref still reaches sections and records alone.
  assert.deepEqual(sky({ leadSection: 'sky' }), [['controls.dangling-ref', 'values/leadSection']]);
  // Without the view's media, no media ref resolves.
  assert.deepEqual(
    checkControlValues(
      SKY,
      { version: 2, values: { backdrop: 'sky' } },
      contentIndex(view.portfolio),
    ).map(({ code }) => code),
    ['controls.dangling-ref'],
  );
});

test('a media ref is a contentRef of kind media alone: never beside a section kind, and never a list (K-8)', () => {
  const declare = (control: Raw) => {
    const raw = JSON.parse(
      readFileSync(new URL('./__fixtures__/manifest.json', import.meta.url), 'utf8'),
    );
    raw.controls.items.push(control);
    return validateManifest(raw, { packageName: '@acme/ocean' }).ok;
  };
  const base = { id: 'backdrop', label: 'Backdrop', description: 'The photograph behind.' };
  assert.equal(declare({ type: 'contentRef', ...base, kinds: ['media'], default: null }), true);
  assert.equal(
    declare({ type: 'contentRef', ...base, kinds: ['media', 'works'], default: null }),
    false,
  );
  assert.equal(
    declare({ type: 'contentRefList', ...base, kinds: ['media'], min: 0, max: 3, default: [] }),
    false,
  );
});
