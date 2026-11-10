// Whether a set of colors is complete, without zod: a visitor's page checks a
// draft's generated sets before it renders them, and no public page loads zod
// (row 134). It gives ColorTokenSetSchema's verdict (./manifests), which
// validates the same sets with their messages; color-set.test.ts holds the two
// together.

import { DERIVED_ROLES } from './derived-roles';
import { COLOR_ROLES } from './roles';

/** A six-digit lowercase hex color, such as #2b241c: every role's value. */
export const HEX_COLOR = /^#[0-9a-f]{6}$/;

const ROLES: ReadonlySet<string> = new Set(COLOR_ROLES);
const DERIVED: ReadonlySet<string> = new Set(DERIVED_ROLES);

const isHex = (value: unknown) => typeof value === 'string' && HEX_COLOR.test(value);

/**
 * Whether `set` is one mode's colors: an object with every role but the three
 * K-2 added as a hex color, those three all given or all left out, and no
 * other key.
 */
export function isColorTokenSet(set: unknown): boolean {
  if (typeof set !== 'object' || set === null || Array.isArray(set)) return false;
  const record = set as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ROLES.has(key))) return false;
  let derivedGiven = 0;
  for (const role of COLOR_ROLES) {
    const value = record[role];
    if (DERIVED.has(role) && value === undefined) continue;
    if (!isHex(value)) return false;
    if (DERIVED.has(role)) derivedGiven += 1;
  }
  return derivedGiven === 0 || derivedGiven === DERIVED_ROLES.length;
}
