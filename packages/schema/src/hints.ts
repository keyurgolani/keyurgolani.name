import { z } from './zod';
import { EXTENSION_DATA, SECTION_ROUTE } from './compose';
import { EXTENSION_FIELDS } from './extensions';
import { isPlainObject } from './json';

// Did-you-mean hints: which keys the schema allows where an unknown key was
// found, and which allowed word is closest to a mistyped one.

type Lookup = (key: unknown) => z.ZodTypeAny | undefined;

/** A schema's definition, which names its type and holds the schemas inside it. */
function defOf(schema: z.ZodTypeAny): Record<string, unknown> & { readonly type: string } {
  return schema._zod.def as unknown as Record<string, unknown> & { readonly type: string };
}

/**
 * The keys the schema allows on the object at `path` in `data`, or undefined
 * when the path doesn't lead to an object the schema describes, such as one
 * inside unregistered extension data.
 */
export function allowedKeysAt(
  schema: z.ZodTypeAny,
  data: unknown,
  path: readonly PropertyKey[],
): string[] | undefined {
  return keyContext(schema, data, path).allowed;
}

/**
 * What allowedKeysAt() returns, and whether the object at `path` is inside an
 * extension's fields or an extension section's data, where an extension, not
 * the core schemas, decides the keys.
 */
export function keyContext(
  schema: z.ZodTypeAny,
  data: unknown,
  path: readonly PropertyKey[],
): { readonly allowed?: string[]; readonly extension: boolean } {
  const at = walk(schema, data, path);
  if (!at) return { extension: false };
  const current = resolve(at.schema, at.value);
  return current && defOf(current).type === 'object'
    ? { allowed: Object.keys(shapeOf(current)), extension: at.extension }
    : { extension: at.extension };
}

/**
 * The tags a discriminated union at `path` in `data` allows, for a hint when
 * a value's tag is none of them. Empty when no such union is there.
 */
export function discriminatorOptions(
  schema: z.ZodTypeAny,
  data: unknown,
  path: readonly PropertyKey[],
): string[] {
  const tag = path.at(-1);
  const at = walk(schema, data, path.slice(0, -1));
  let current = at ? resolve(at.schema, at.value, { stopAtUnion: true }) : undefined;
  if (!current || defOf(current).type !== 'union') return [];
  const def = defOf(current);
  if (def.discriminator !== tag) return [];
  return (def.options as z.ZodTypeAny[]).flatMap((option) => {
    current = resolve(option, undefined);
    const field =
      current && defOf(current).type === 'object' ? shapeOf(current)[String(tag)] : undefined;
    const values = field ? defOf(field).values : undefined;
    return Array.isArray(values) ? values.map(String) : [];
  });
}

/**
 * The schema and the value at `path`, before unwrapping, and whether the path
 * passes through an extension. Undefined when the path leaves the schema.
 */
function walk(
  schema: z.ZodTypeAny,
  data: unknown,
  path: readonly PropertyKey[],
):
  | {
      readonly schema: z.ZodTypeAny | undefined;
      readonly value: unknown;
      readonly extension: boolean;
    }
  | undefined {
  let current: z.ZodTypeAny | undefined = schema;
  let value = data;
  let extension = false;
  for (const segment of path) {
    if (typeof segment === 'symbol') return undefined;
    current = resolve(current, value);
    if (!current) return { schema: undefined, value: undefined, extension };
    if (EXTENSION_FIELDS in current) {
      // An `extensions` field: each entry is its registered namespace's schema.
      extension = true;
      current = (current as unknown as Record<typeof EXTENSION_FIELDS, Lookup>)[EXTENSION_FIELDS](
        String(segment),
      );
    } else {
      const def = defOf(current);
      if (def.type === 'object') {
        // Own keys only: a __proto__ in the data names no field.
        const shape = shapeOf(current);
        current = Object.hasOwn(shape, segment) ? shape[segment] : undefined;
        if (current && EXTENSION_DATA in current) extension = true;
      } else if (def.type === 'array') {
        current = def.element as z.ZodTypeAny;
      } else if (def.type === 'record') {
        current = def.valueType as z.ZodTypeAny;
      } else return { schema: undefined, value: undefined, extension };
    }
    value =
      (isPlainObject(value) || Array.isArray(value)) && Object.hasOwn(value, segment)
        ? (value as never)[segment]
        : undefined;
  }
  return { schema: current, value, extension };
}

function shapeOf(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
  return defOf(schema).shape as Record<string, z.ZodTypeAny>;
}

/**
 * Unwraps optional, default, transforms, pipelines, the section router, and
 * unions, for `value`. Stops at an `extensions` field, which the caller
 * steps into by namespace, and at a union when asked to.
 */
function resolve(
  schema: z.ZodTypeAny | undefined,
  value: unknown,
  { stopAtUnion = false } = {},
): z.ZodTypeAny | undefined {
  let current = schema;
  for (;;) {
    if (!current || EXTENSION_FIELDS in current) return current;
    if (SECTION_ROUTE in current) {
      const route = (current as unknown as Record<typeof SECTION_ROUTE, Lookup>)[SECTION_ROUTE];
      current = route(isPlainObject(value) ? value.kind : undefined);
      continue;
    }
    const def = defOf(current);
    switch (def.type) {
      case 'optional':
      case 'nullable':
      case 'default':
        current = def.innerType as z.ZodTypeAny;
        break;
      case 'pipe': {
        // A transform's pipeline names its keys on the way in. Every other
        // pipeline checks the value as a whole first (as plain JSON, or for
        // both appearance input keys), then with the schema naming its keys.
        const out = def.out as z.ZodTypeAny;
        current = defOf(out).type === 'transform' ? (def.in as z.ZodTypeAny) : out;
        break;
      }
      case 'union':
        if (stopAtUnion) return current;
        current = closestOption(def.options as z.ZodTypeAny[], value);
        break;
      default:
        return current;
    }
  }
}

/** The union option whose object keys share the most with the value's. */
function closestOption(options: z.ZodTypeAny[], value: unknown): z.ZodTypeAny | undefined {
  const keys = isPlainObject(value) ? Object.keys(value) : [];
  let best: z.ZodTypeAny | undefined;
  let bestScore = -1;
  for (const option of options) {
    const resolved = resolve(option, value);
    if (!resolved || defOf(resolved).type !== 'object') continue;
    const shape = shapeOf(resolved);
    const score = keys.filter((key) => key in shape).length;
    if (score > bestScore) {
      best = resolved;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Words longer than this get no hint. No key or kind the schemas allow comes
 * close, and comparing a long word with each would cost time for nothing.
 */
export const HINT_MAX_LENGTH = 64;

/**
 * The allowed word closest to `word`: the same apart from case, or within a
 * quarter of its length in typing mistakes, at least one (a swap counts as
 * one). Undefined when nothing is that close, or the word is longer than
 * HINT_MAX_LENGTH. A third would let organisation match organizationUrl.
 */
export function closestWord(word: string, allowed: readonly string[]): string | undefined {
  if (word.length > HINT_MAX_LENGTH) return undefined;
  const lower = word.toLowerCase();
  const exact = allowed.find((candidate) => candidate.toLowerCase() === lower);
  if (exact) return exact;
  const limit = Math.max(1, Math.floor(word.length / 4));
  let best: string | undefined;
  let bestDistance = limit + 1;
  for (const candidate of allowed) {
    const other = candidate.toLowerCase();
    // The distance is at least the difference in length.
    if (Math.abs(other.length - lower.length) >= bestDistance) continue;
    const distance = editDistance(lower, other);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Optimal string alignment distance: insertions, deletions, substitutions, and
 * adjacent swaps. A swap looks two rows back, so three rows are kept, not the
 * whole table.
 */
function editDistance(a: string, b: string): number {
  let twoBack = new Array<number>(b.length + 1).fill(0);
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  let current = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let distance = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        distance = Math.min(distance, twoBack[j - 2]! + 1);
      }
      current[j] = distance;
    }
    [twoBack, previous, current] = [previous, current, twoBack];
  }
  return previous[b.length]!;
}
