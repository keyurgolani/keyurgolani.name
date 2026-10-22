import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toPublicView, type ParsedPair } from '@portfolio/schema';
import { exhibitions } from './__fixtures__/extension';
import {
  checkControlValues,
  contentIndex,
  materializeControls,
  migrateControls,
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
const SECTIONS = [
  { id: 'top', kind: 'hero' },
  { id: 'essays', kind: 'writings' },
  { id: 'work', kind: 'projects' },
  { id: 'drafts', kind: 'writings' },
  { id: 'contact', kind: 'contact' },
];
/** A pair holding `sections`, with the site hiding `hidden`. */
const pairOf = (sections: readonly object[], hidden: readonly string[] = []) =>
  ({
    portfolio: { sections },
    site: { sections: Object.fromEntries(hidden.map((id) => [id, { hidden: true }])) },
  }) as unknown as ParsedPair;
const CONTENT = contentIndex(toPublicView(pairOf(SECTIONS, ['drafts'])).portfolio);

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
  // leadSection takes writings or projects; contact is neither.
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

test("the content index is the public view's: no hidden or unregistered extension section", () => {
  const sections = [
    ...SECTIONS,
    { id: 'shows', kind: '@acme/portfolio-photography/exhibitions', data: { items: [] } },
    { id: 'notes', kind: '@other/x/notes', data: {} },
  ];
  const pair = pairOf(sections, ['drafts']);
  assert.deepEqual(
    [...contentIndex(toPublicView(pair).portfolio).keys()],
    ['top', 'essays', 'work', 'contact'],
  );
  assert.deepEqual(
    [...contentIndex(toPublicView(pair, { extensions: [exhibitions] }).portfolio).keys()],
    ['top', 'essays', 'work', 'contact', 'shows'],
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
