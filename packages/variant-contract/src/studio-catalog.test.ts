import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPOSITION_IDS } from './ids';
import { COMPOSITION_FAMILIES, COMPOSITION_FAMILY, UPCOMING_COMPOSITIONS } from './studio-catalog';

// Studio's composition picker data (P-5): every first-party composition,
// registered or upcoming, in exactly one of the four families.

const REGISTERED: readonly string[] = COMPOSITION_IDS;
const UPCOMING = UPCOMING_COMPOSITIONS.map(({ id }) => id);
const FAMILIES = new Set<string>(COMPOSITION_FAMILIES);

test('every COMPOSITION_FAMILY key is a registered first-party id or an upcoming one', () => {
  const strays = Object.keys(COMPOSITION_FAMILY).filter(
    (id) => !REGISTERED.includes(id) && !UPCOMING.includes(id),
  );
  assert.deepEqual(strays, [], 'a family for a composition the program has no entry for');
  for (const [id, family] of Object.entries(COMPOSITION_FAMILY)) {
    assert.ok(FAMILIES.has(family), `${id}'s family ${family} is one of the four`);
  }
  // Flux joined when its package registered, in the stage family (ruling Q6).
  assert.equal(COMPOSITION_FAMILY.flux, 'stage');
});

test('every registered first-party composition has a family, so none registers without one', () => {
  const missing = REGISTERED.filter((id) => !Object.hasOwn(COMPOSITION_FAMILY, id));
  assert.deepEqual(missing, [], 'registered with no family in studio-catalog.ts');
  // And so does every upcoming one, which the picker files under its family too.
  assert.deepEqual(
    UPCOMING.filter((id) => !Object.hasOwn(COMPOSITION_FAMILY, id)),
    [],
  );
});

test('each upcoming composition is listed once, with its name and idiom', () => {
  assert.equal(new Set(UPCOMING).size, UPCOMING.length);
  for (const entry of UPCOMING_COMPOSITIONS) {
    assert.ok(entry.name && entry.signature, entry.id);
  }
});
