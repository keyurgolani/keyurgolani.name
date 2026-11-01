// LANG-1's merges, as the catalog holds them: four design languages retired
// into the survivors their tokens match, each manifest moved unchanged to
// retired/<id>/, beside a record naming its survivor and what differs. A
// survivor may evolve after the merge (LANG-2), so equality holds at the
// merge point the record pins, never against the survivor at head.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { packDirLookDigest, packLookDigest } from '@portfolio/variant-contract/node';
import { PACKAGES_DIR } from './test-support/packs';

const LANGUAGES = new URL('appearance-languages/', PACKAGES_DIR);
const read = (url: URL) => JSON.parse(fs.readFileSync(url, 'utf8')) as Record<string, unknown>;
const dirs = (url: URL) =>
  fs
    .readdirSync(url, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort();

/** The merges the owner and the lead ruled on, and what each looks like under its survivor. */
const MERGES: Readonly<
  Record<string, { aliasOf: string; differs: Record<string, [string, string]> }>
> = {
  'ant-inspired': { aliasOf: 'primer-inspired', differs: {} },
  'atlassian-inspired': { aliasOf: 'utility-dense', differs: {} },
  'polaris-inspired': {
    aliasOf: 'spectrum-2-inspired',
    differs: { 'icon-stroke-width': ['1.75', '1.5'] },
  },
  'radix-inspired': { aliasOf: 'spectrum-2-inspired', differs: {} },
};

test('the four retired languages are out of packs/, in retired/, and 33 languages ship', () => {
  const packs = dirs(new URL('packs/', LANGUAGES));
  assert.deepEqual(dirs(new URL('retired/', LANGUAGES)), Object.keys(MERGES).sort());
  for (const id of Object.keys(MERGES)) assert.ok(!packs.includes(id), `${id} still ships`);
  assert.equal(packs.length, 33);
});

/** The retired manifest as its survivor was at the merge: its tokens with the record's differences applied. */
function atMerge(retired: Record<string, unknown>, differs: Record<string, [string, string]>) {
  const tokens = { ...(retired.tokens as Record<string, string>) };
  for (const [key, [was, became]] of Object.entries(differs)) {
    assert.equal(tokens[key], was, `the retired manifest's ${key}`);
    tokens[key] = became;
  }
  return { ...retired, tokens };
}

test('each retired record names its survivor, and the survivor at the merge differed only where the record says', () => {
  for (const [id, { aliasOf, differs }] of Object.entries(MERGES)) {
    const record = read(new URL(`retired/${id}/retired.json`, LANGUAGES));
    assert.equal(record.id, id);
    assert.equal(record.kind, 'design-language');
    assert.equal(record.aliasOf, aliasOf);
    assert.equal(record.retiredVersion, 1);
    // The notice says what differed at the merge, and only when something did.
    assert.equal(record.change === null, Object.keys(differs).length === 0, id);
    const retired = read(new URL(`retired/${id}/manifest.json`, LANGUAGES));
    assert.equal(retired.id, id, 'the manifest moved unchanged');
    assert.equal(retired.stylesheet, undefined);
    // The record pins the survivor's look at the merge, so equality is held
    // there: the retired manifest, with only the recorded differences, is
    // the survivor's look then. The survivor at head never enters it.
    assert.equal(record.survivorVersion, '1.0.2', id);
    assert.equal(packLookDigest(atMerge(retired, differs)), record.survivorDigest, id);
  }
});

test('a survivor may evolve: each either still looks as it did at the merge or has bumped its version since', () => {
  const after = (a: string, b: string) => {
    const [x, y] = [a, b].map((version) => version.split('.').map(Number));
    const index = x!.findIndex((part, at) => part !== y![at]);
    return index >= 0 && x![index]! > y![index]!;
  };
  for (const [id, { aliasOf }] of Object.entries(MERGES)) {
    const record = read(new URL(`retired/${id}/retired.json`, LANGUAGES));
    const dir = new URL(`packs/${aliasOf}/`, LANGUAGES);
    const version = read(new URL('manifest.json', dir)).version as string;
    const merged = record.survivorVersion as string;
    assert.ok(!after(merged, version), `${id}: the merge's ${merged} is after ${version}`);
    if (packDirLookDigest(fileURLToPath(dir)) !== record.survivorDigest) {
      assert.ok(after(version, merged), `${aliasOf} changed since the merge at ${merged}`);
    }
  }
});

// LANG-5a's merges: three color schemes and a typography profile, each into
// the survivor LANG-4 scored it beside. None matched its survivor token for
// token, so each record says what changed at the merge.
const SCHEMES = new URL('appearance-schemes/', PACKAGES_DIR);
const TYPOGRAPHY = new URL('appearance-typography/', PACKAGES_DIR);

/** Each LANG-5a merge, with the manifest fields its look differed from its survivor's in. */
const MERGES_5A: Readonly<
  Record<
    string,
    {
      kind: 'color-scheme' | 'typography';
      aliasOf: string;
      survivorVersion: string;
      differs: readonly string[];
    }
  >
> = {
  bookcloth: {
    kind: 'color-scheme',
    aliasOf: 'paper-ink',
    // paper-ink took bookcloth's categorical anchors at the merge (the orchestrator's ruling), as 1.1.2.
    survivorVersion: '1.1.2',
    differs: ['anchors', 'adjustments', 'swatches'],
  },
  zinc: {
    kind: 'color-scheme',
    aliasOf: 'graphite',
    survivorVersion: '1.1.1',
    differs: ['anchors', 'adjustments', 'swatches'],
  },
  'earthy-clay': {
    kind: 'color-scheme',
    aliasOf: 'desert-terracotta',
    survivorVersion: '1.1.1',
    differs: ['anchors', 'adjustments', 'swatches'],
  },
  'literary-reading': {
    kind: 'typography',
    aliasOf: 'editorial-serif',
    survivorVersion: '1.0.0',
    differs: ['roles'],
  },
};
const packageOf = (kind: 'color-scheme' | 'typography') =>
  kind === 'color-scheme' ? SCHEMES : TYPOGRAPHY;

test("LANG-5a's three schemes and one typography profile are out of packs/, in retired/, and 35 scheme and 15 typography directories are left", () => {
  for (const [url, ids, left] of [
    [SCHEMES, ['bookcloth', 'earthy-clay', 'zinc'], 35],
    [TYPOGRAPHY, ['literary-reading'], 15],
  ] as const) {
    const packs = dirs(new URL('packs/', url));
    assert.deepEqual(dirs(new URL('retired/', url)), ids);
    for (const id of ids) assert.ok(!packs.includes(id), `${id} still ships`);
    // The schemes' directories include the three generators and profile-image, which register on their own terms.
    assert.equal(packs.length, left);
  }
});

test("each LANG-5a record names its survivor at the merge's version, and says what changed, since none looked the same", () => {
  for (const [id, { kind, aliasOf, survivorVersion }] of Object.entries(MERGES_5A)) {
    const record = read(new URL(`retired/${id}/retired.json`, packageOf(kind)));
    assert.equal(record.id, id);
    assert.equal(record.kind, kind);
    assert.equal(record.aliasOf, aliasOf);
    assert.equal(record.retiredVersion, 1);
    assert.equal(record.survivorVersion, survivorVersion, id);
    assert.equal(record.retiredAt, '2026-10-29', id);
    const retired = read(new URL(`retired/${id}/manifest.json`, packageOf(kind)));
    assert.equal(retired.id, id, 'the manifest moved unchanged');
    assert.equal(retired.stylesheet, undefined, `${id} ships no stylesheet`);
    if (kind === 'typography') assert.deepEqual(retired.fontAssets, [], `${id} ships no font`);
    // Its look wasn't its survivor's at the merge, so the notice may never say it looks the same.
    assert.notEqual(packLookDigest(retired), record.survivorDigest, id);
    assert.equal(typeof record.change, 'string', `${id} says what changed`);
  }
});

test("while each LANG-5a survivor looks as it did at the merge, its alias's look differed only in the fields the merge names", () => {
  const without = (manifest: Record<string, unknown>, keys: readonly string[]) =>
    Object.fromEntries(Object.entries(manifest).filter(([key]) => !keys.includes(key)));
  for (const [id, { kind, aliasOf, differs }] of Object.entries(MERGES_5A)) {
    const record = read(new URL(`retired/${id}/retired.json`, packageOf(kind)));
    const dir = new URL(`packs/${aliasOf}/`, packageOf(kind));
    // An evolved survivor is the next test's: the record pins the merge, and head moves on.
    if (packDirLookDigest(fileURLToPath(dir)) !== record.survivorDigest) continue;
    const survivor = read(new URL('manifest.json', dir));
    const retired = read(new URL(`retired/${id}/manifest.json`, packageOf(kind)));
    assert.equal(
      packLookDigest(without(retired, differs)),
      packLookDigest(without(survivor, differs)),
      id,
    );
    for (const key of differs) assert.notDeepEqual(retired[key], survivor[key], `${id} ${key}`);
  }
});

/**
 * The two cloths LANG-5d moved in paper-ink (Q-L3, lead A, 2026-10-30), by
 * index: rust to a brick brown, apart from the claret rubric, and slate
 * tealer and more saturated, so it reads as an ink beside text-secondary.
 */
const CLOTH_MOVES_5D: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  light: { 0: '#965630', 1: '#3e6980' },
  dark: { 0: '#cf9771', 1: '#6baed1' },
};

test("bookcloth's five cloths are paper-ink's categorical anchors, in both modes, so Chapters' chapter inks survive the merge, with LANG-5d's two moves", () => {
  const retired = read(new URL('retired/bookcloth/manifest.json', SCHEMES));
  const survivor = read(new URL('packs/paper-ink/manifest.json', SCHEMES));
  type Anchored = { anchors: Record<string, { categorical?: string[] }> };
  for (const mode of ['light', 'dark']) {
    const cloths = (retired as Anchored).anchors[mode]!.categorical;
    assert.equal(cloths?.length, 5, mode);
    const moves = CLOTH_MOVES_5D[mode]!;
    for (const [index, cloth] of Object.entries(moves)) {
      assert.notEqual(cloths![Number(index)], cloth, `${mode} cloth ${index} moved`);
    }
    assert.deepEqual(
      (survivor as Anchored).anchors[mode]!.categorical,
      cloths!.map((cloth, index) => moves[index] ?? cloth),
      mode,
    );
  }
});

test("literary-reading's roles were editorial-serif's at the merge but for their faces: every size, weight, and spacing the same", () => {
  const record = read(new URL('retired/literary-reading/retired.json', TYPOGRAPHY));
  const retired = read(new URL('retired/literary-reading/manifest.json', TYPOGRAPHY));
  const roles = retired.roles as Record<string, Record<string, unknown>>;
  const charter = 'Charter, "Bitstream Charter", Georgia, serif';
  const iowan = '"Iowan Old Style", "Palatino Linotype", Georgia, serif';
  const faces: Record<string, string> = {
    [charter]: iowan,
    '"Trebuchet MS", "Segoe UI", sans-serif':
      '"Avenir Next", Avenir, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  };
  const swapped = Object.fromEntries(
    Object.entries(roles).map(([role, values]) => {
      const family = values['font-family'] as string;
      return [role, { ...values, 'font-family': faces[family] ?? family }];
    }),
  );
  // Seven serif roles and the label changed face; code and numeric kept theirs.
  assert.deepEqual(
    Object.keys(roles).filter(
      (role) => roles[role]!['font-family'] !== swapped[role]!['font-family'],
    ),
    ['display', 'headline', 'title', 'body', 'body-compact', 'label', 'caption', 'quote'],
  );
  assert.equal(packLookDigest({ ...retired, roles: swapped }), record.survivorDigest);
});

test('a LANG-5a survivor may evolve: each either still looks as it did at the merge or has bumped its version since', () => {
  const after = (a: string, b: string) => {
    const [x, y] = [a, b].map((version) => version.split('.').map(Number));
    const index = x!.findIndex((part, at) => part !== y![at]);
    return index >= 0 && x![index]! > y![index]!;
  };
  for (const [id, { kind, aliasOf }] of Object.entries(MERGES_5A)) {
    const record = read(new URL(`retired/${id}/retired.json`, packageOf(kind)));
    const dir = new URL(`packs/${aliasOf}/`, packageOf(kind));
    const version = read(new URL('manifest.json', dir)).version as string;
    const merged = record.survivorVersion as string;
    assert.ok(!after(merged, version), `${id}: the merge's ${merged} is after ${version}`);
    if (packDirLookDigest(fileURLToPath(dir)) !== record.survivorDigest) {
      assert.ok(after(version, merged), `${aliasOf} changed since the merge at ${merged}`);
    }
  }
});

test('no recipe and no catalog lock entry names a retired id', () => {
  const recipes = fs.readFileSync(
    new URL('appearance/appearance-recipes.json', PACKAGES_DIR),
    'utf8',
  );
  const lock = read(new URL('appearance/appearance-catalog.lock.json', PACKAGES_DIR));
  for (const id of [...Object.keys(MERGES), ...Object.keys(MERGES_5A)]) {
    assert.ok(!recipes.includes(`"${id}"`), `a recipe names ${id}`);
    assert.ok(!Object.hasOwn(lock.packs as object, id), `the lock pins ${id}`);
  }
});
