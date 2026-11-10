import test from 'node:test';
import assert from 'node:assert/strict';
import { isColorTokenSet } from './color-set';
import { DERIVED_ROLES } from './derived-roles';
import { ColorTokenSetSchema } from './manifests';
import { COLOR_ROLES } from './roles';

// A public page checks generated sets with isColorTokenSet, and validation with
// ColorTokenSetSchema: the two give one verdict on every shape.

const full = Object.fromEntries(COLOR_ROLES.map((role) => [role, '#2b241c']));
const without = (...roles: string[]) =>
  Object.fromEntries(Object.entries(full).filter(([role]) => !roles.includes(role)));

const cases: ReadonlyArray<readonly [string, unknown, boolean]> = [
  ['every role', full, true],
  ['without the three K-2 added', without(...DERIVED_ROLES), true],
  [
    'the three left undefined',
    { ...full, ...Object.fromEntries(DERIVED_ROLES.map((r) => [r, undefined])) },
    true,
  ],
  ['one of the three missing', without(DERIVED_ROLES[0]), false],
  ['two of the three missing', without(DERIVED_ROLES[0], DERIVED_ROLES[1]), false],
  ['a core role missing', without('canvas'), false],
  ['a core role undefined', { ...full, canvas: undefined }, false],
  ['an uppercase hex', { ...full, accent: '#2B241C' }, false],
  ['a three-digit hex', { ...full, accent: '#abc' }, false],
  ['a hex with alpha', { ...full, accent: '#2b241cff' }, false],
  ['a hex with a trailing newline', { ...full, accent: '#2b241c\n' }, false],
  ['a number for a role', { ...full, accent: 0x2b241c }, false],
  ['a derived role not a hex', { ...full, [DERIVED_ROLES[2]]: 'white' }, false],
  ['an extra key', { ...full, glow: '#ffffff' }, false],
  ['an empty object', {}, false],
  ['null', null, false],
  ['undefined', undefined, false],
  ['an array', [], false],
  ['a string', '#2b241c', false],
];

for (const [name, set, expected] of cases) {
  test(`isColorTokenSet agrees with ColorTokenSetSchema: ${name}`, () => {
    assert.equal(ColorTokenSetSchema.safeParse(set).success, expected);
    assert.equal(isColorTokenSet(set), expected);
  });
}
