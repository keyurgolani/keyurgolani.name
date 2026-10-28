import { Document, isScalar, Scalar, visit } from 'yaml';
import { DEFAULT_SCHEMAS } from './compose';
import { allowedKeysAt } from './hints';
import { parseExtensionKind } from './ids';
import { isPlainObject } from './json';
import type { DocumentFormat } from './source';

// Writing documents (#4, item 17). serialize() writes migration and export
// output from authored data, never Zod output with its defaults filled in.
// canonicalize() gives the RFC 8785 form #3 hashes, the same for a YAML
// document and its JSON twin.

/**
 * Authored data as a document: keys in schema order, every key inside
 * extension data (each `extensions` object, and an extension section's
 * `data`) sorted at every level, two-space indent, LF line ends, and a
 * trailing newline. YAML never folds a line, and quotes a `<<` key, which a
 * YAML 1.1 reader would merge. Other keys the schema doesn't name keep their
 * authored order after the ones it does.
 */
export function serialize(value: unknown, format: DocumentFormat): string {
  // Both formats take the same data, so a YAML document always has a JSON twin.
  assertPlainJson(value);
  const ordered = inSchemaOrder(value);
  if (format === 'json') return `${JSON.stringify(ordered, null, 2)}\n`;
  const doc = new Document(ordered, { aliasDuplicateObjects: false });
  visit(doc, {
    Pair(_, pair) {
      if (isScalar(pair.key) && pair.key.value === '<<') pair.key.type = Scalar.QUOTE_DOUBLE;
    },
    // Keys and values alike.
    Scalar(_, scalar) {
      if (typeof scalar.value === 'string' && YAML_1_1_WORDS.test(scalar.value)) {
        scalar.type = Scalar.QUOTE_DOUBLE;
      }
    },
  });
  return doc.toString({ lineWidth: 0, indent: 2 });
}

/**
 * Strings a YAML 1.1 reader would take for a boolean or null. YAML 1.2 reads
 * them as strings, so yaml leaves them plain, but older readers still parse
 * documents this writes.
 */
const YAML_1_1_WORDS = /^(?:y|yes|n|no|on|off|true|false|null|~)$/i;

/** RFC 8785 JSON: keys sorted by UTF-16 code units, no whitespace, ECMAScript number and string forms. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error("canonicalize() can't write a number JSON doesn't have.");
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, child]) => child !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`).join(',')}}`;
  }
  throw new Error('canonicalize() takes plain JSON data only.');
}

/** Which document the data is, by its keys: identity for a portfolio, appearance for a site. */
function schemaFor(value: unknown) {
  if (!isPlainObject(value)) return undefined;
  if ('identity' in value) return DEFAULT_SCHEMAS.PortfolioSchema;
  if ('appearance' in value) return DEFAULT_SCHEMAS.SiteSchema;
  return undefined;
}

function inSchemaOrder(value: unknown): unknown {
  const schema = schemaFor(value);
  // An `extensions` field, not a record entry that happens to be keyed extensions.
  const isExtensionsField = (path: readonly (string | number)[]) =>
    path.at(-1) === 'extensions' &&
    (!schema || (allowedKeysAt(schema, value, path.slice(0, -1))?.includes('extensions') ?? false));
  // `sorted`: inside extension data, where every key is sorted.
  const walk = (node: unknown, path: readonly (string | number)[], sorted: boolean): unknown => {
    if (Array.isArray(node)) {
      return node.map((child, index) => walk(child, [...path, index], sorted));
    }
    if (!isPlainObject(node)) return node;
    const keys = Object.keys(node);
    const extensionData = (key: string) =>
      sorted ||
      isExtensionsField([...path, key]) ||
      (key === 'data' && typeof node.kind === 'string' && parseExtensionKind(node.kind) !== null);
    let order: string[];
    if (sorted) {
      order = [...keys].sort();
    } else {
      const allowed = schema ? (allowedKeysAt(schema, value, path) ?? []) : [];
      order = [
        ...allowed.filter((key) => keys.includes(key)),
        ...keys.filter((key) => !allowed.includes(key)),
      ];
    }
    // fromEntries, so an own __proto__ key stays a key.
    return Object.fromEntries(
      order.map((key) => [key, walk(node[key], [...path, key], extensionData(key))]),
    );
  };
  return walk(value, [], false);
}

/** Throws unless the value is plain JSON data. A key whose value is undefined is left out. */
function assertPlainJson(value: unknown): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new Error("serialize() can't write a number JSON doesn't have, such as .inf.");
  }
  if (Array.isArray(value)) {
    value.forEach(assertPlainJson);
  } else if (isPlainObject(value)) {
    for (const child of Object.values(value)) if (child !== undefined) assertPlainJson(child);
  } else {
    throw new Error('serialize() takes plain JSON data only.');
  }
}
