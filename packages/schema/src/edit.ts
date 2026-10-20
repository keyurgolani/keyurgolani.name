import {
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
  type Document,
  type Node,
  type Pair,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml';
import { isJsonEqual } from './json';
import { parseSource, type DocumentFormat } from './source';

// Editing a document by JSON pointer (#4, item 17). A YAML edit changes only
// the text of the value it sets or the entry it deletes, so comments and
// every untouched byte stay as written. A JSON edit re-serializes the whole
// document with two-space indent, keeping its key order.

export interface Edit {
  /** RFC 6901 pointer. In an array, `-` appends. */
  readonly pointer: string;
  readonly op: 'set' | 'delete';
  /** Plain JSON data, for `set`. */
  readonly value?: unknown;
}

/**
 * Applies the edits in order and returns the new text. A `set` adds any
 * mapping the path is missing; a `delete` of a path the document lacks
 * changes nothing. Throws when the text isn't a plain document or an edit
 * can't apply, such as an array index past the end.
 */
export function applyEdits(text: string, format: DocumentFormat, edits: readonly Edit[]): string {
  const parsed = parseSource(text, format);
  if (!parsed.ok) throw new Error('applyEdits() needs a document that parses.');
  if (format === 'json') return editJson(text, edits);
  let current = text;
  for (const edit of edits) {
    current = editYaml(current, edit);
    // Every edit is checked, so a bug can't quietly write the wrong document.
    const after = parseSource(current, 'yaml');
    if (!after.ok || !applied(after.data, edit)) failed(edit);
  }
  return current;
}

function failed(edit: Edit): never {
  throw new Error(`applyEdits() couldn't apply the edit at ${edit.pointer}.`);
}

/** RFC 6901: '' is the document, and ~1 and ~0 stand for / and ~. */
function segments(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`${pointer} isn't a JSON pointer.`);
  return pointer
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** Whether the data now holds what the edit asked for. */
function applied(data: unknown, edit: Edit): boolean {
  const path = segments(edit.pointer);
  let node = data;
  for (const [index, segment] of path.entries()) {
    const last = index === path.length - 1;
    if (Array.isArray(node)) {
      const position = segment === '-' ? node.length - 1 : Number(segment);
      if (last && edit.op === 'delete') return true;
      node = node[position];
    } else if (node !== null && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (last && edit.op === 'delete') return !Object.hasOwn(record, segment);
      node = record[segment];
    } else {
      return edit.op === 'delete';
    }
  }
  return edit.op === 'delete' ? path.length > 0 : isJsonEqual(node, edit.value);
}

/** Text parseSource() has accepted, so it repeats no key and yaml needn't check. */
function parse(text: string): Document {
  return parseDocument(text, {
    version: '1.2',
    merge: false,
    uniqueKeys: false,
    stringKeys: true,
    keepSourceTokens: false,
  });
}

// --- JSON ---------------------------------------------------------------

function editJson(text: string, edits: readonly Edit[]): string {
  const doc = parse(text);
  for (const edit of edits) {
    const path = segments(edit.pointer);
    if (edit.op === 'set') {
      // Never an alias: JSON has none, so a value used twice is written twice.
      const value = doc.createNode(edit.value, { aliasDuplicateObjects: false });
      if (path.length === 0) doc.contents = value as never;
      else doc.setIn(resolvePath(doc, path), value);
    } else {
      if (path.length === 0) throw new Error("applyEdits() can't delete the whole document.");
      const resolved = resolvePath(doc, path);
      if (doc.hasIn(resolved)) doc.deleteIn(resolved);
    }
    if (!applied(doc.toJS(), edit)) failed(edit);
  }
  const written = `${json(doc.contents, '')}\n`;
  if (!isJsonEqual(JSON.parse(written), doc.toJS())) {
    throw new Error("applyEdits() couldn't write the edited document.");
  }
  return written;
}

/**
 * The path with array indexes as numbers. `-` is the next index of an
 * array, and a new array where the document has nothing yet.
 */
function resolvePath(doc: Document, path: readonly string[]): (string | number)[] {
  const resolved: (string | number)[] = [];
  let node: unknown = doc.contents;
  for (const segment of path) {
    if (isSeq(node)) {
      const index = segment === '-' ? node.items.length : Number(segment);
      if (!Number.isInteger(index) || index < 0 || index > node.items.length) {
        throw new Error(`${segment} isn't an index this array can take.`);
      }
      resolved.push(index);
      node = node.items[index];
    } else if (segment === '-' && node === undefined) {
      resolved.push(0);
    } else {
      resolved.push(segment);
      node = isMap(node) ? node.get(segment, true) : undefined;
    }
  }
  return resolved;
}

/** JSON.stringify(value, null, 2) for a node tree, in the tree's own key order. */
function json(node: unknown, indent: string): string {
  const inner = `${indent}  `;
  if (isMap(node)) {
    if (node.items.length === 0) return '{}';
    const entries = node.items.map(
      (pair) => `${inner}${JSON.stringify(keyOf(pair))}: ${json(pair.value, inner)}`,
    );
    return `{\n${entries.join(',\n')}\n${indent}}`;
  }
  if (isSeq(node)) {
    if (node.items.length === 0) return '[]';
    return `[\n${node.items.map((item) => `${inner}${json(item, inner)}`).join(',\n')}\n${indent}]`;
  }
  const value = isScalar(node) ? node.value : node;
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error("applyEdits() can't write a number JSON doesn't have.");
  }
  return JSON.stringify(value ?? null);
}

function keyOf(pair: Pair): string {
  return isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
}

// --- YAML ---------------------------------------------------------------

function editYaml(text: string, edit: Edit): string {
  const path = segments(edit.pointer);
  const doc = parse(text);
  if (path.length === 0) {
    if (edit.op === 'delete') throw new Error("applyEdits() can't delete the whole document.");
    return `${inline(edit.value)}\n`;
  }

  // Walk as far as the document goes.
  let node: unknown = doc.contents;
  let depth = 0;
  let pair: Pair | undefined;
  let parent: YAMLMap | YAMLSeq | undefined;
  // The pair each mapping value on the way belongs to.
  const owners = new Map<unknown, Pair>();
  for (; depth < path.length; depth++) {
    const segment = path[depth]!;
    if (isMap(node)) {
      const found = node.items.find((item) => keyOf(item) === segment);
      if (!found) break;
      parent = node;
      pair = found;
      node = found.value;
      owners.set(node, found);
    } else if (isSeq(node)) {
      const index = segment === '-' ? node.items.length : Number(segment);
      if (!Number.isInteger(index) || index < 0 || index > node.items.length) {
        throw new Error(`${segment} isn't an index this array can take.`);
      }
      if (index === node.items.length) break;
      parent = node;
      pair = undefined;
      node = node.items[index];
    } else {
      break;
    }
  }

  if (edit.op === 'delete') {
    if (depth < path.length || !parent) return text;
    const owner = owners.get(parent);
    return isMap(parent)
      ? deletePair(text, parent, pair!, owner)
      : deleteItem(text, parent, node as Node, owner);
  }

  if (depth === path.length) return replaceNode(text, node, edit.value, owners.get(node));
  // The path stops here: add the rest of it, built from the missing segments.
  const rest = path.slice(depth);
  const value = rest
    .slice(1)
    .reduceRight<unknown>(
      (inner, segment) => (segment === '-' ? [inner] : { [segment]: inner }),
      edit.value,
    );
  if (isMap(node)) return addPair(text, node, rest[0]!, value);
  if (isSeq(node)) return addItem(text, node, value);
  // A scalar or empty value in the way becomes the mapping or array the path needs.
  const container = rest[0] === '-' ? [value] : { [rest[0]!]: value };
  return replaceNode(text, node, container, owners.get(node));
}

/** Where the line holding `offset` starts. */
function lineStart(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

/** Where the line holding `offset` ends, after its newline; `offset` itself when a line just ended there. */
function lineEnd(text: string, offset: number): number {
  if (offset > 0 && text[offset - 1] === '\n') return offset;
  const newline = text.indexOf('\n', offset);
  return newline === -1 ? text.length : newline + 1;
}

function column(text: string, offset: number): number {
  return offset - lineStart(text, offset);
}

function splice(text: string, start: number, end: number, insert: string): string {
  return text.slice(0, start) + insert + text.slice(end);
}

/** Replaces a value; `owner` is the pair it belongs to when it's a mapping value. */
function replaceNode(text: string, node: unknown, value: unknown, owner?: Pair): string {
  if (!isNode(node) || !node.range) {
    // The document is empty, or the value is: write it out.
    return text.trim() === '' ? `${inline(value)}\n` : text;
  }
  const [start, end] = node.range;
  const replaced = text.slice(start, end);
  // A block collection or block scalar ends with its last line's newline.
  const newline = replaced.endsWith('\n') ? '\n' : '';
  // A value on the lines under `key:`, with no comment between, moves up beside the key.
  const keyEnd = (owner?.key as Node | null | undefined)?.range?.[1];
  if (keyEnd !== undefined && /^[ \t]*:[ \t]*(?:\r?\n[ \t]*)+$/.test(text.slice(keyEnd, start))) {
    return splice(text, keyEnd, end, `: ${inline(value)}${newline}`);
  }
  // `key:` with nothing after it needs a space before the new value.
  const space = start === end && text[start - 1] === ':' ? ' ' : '';
  return splice(text, start, end, `${space}${inline(value)}${newline}`);
}

function addPair(text: string, map: YAMLMap, key: string, value: unknown): string {
  const entry = `${inlineKey(key)}: ${inline(value)}`;
  const last = map.items.at(-1);
  if (map.flow || !last || !map.range) {
    // { a: 1 } and {}: add before the closing brace.
    const end = (last ? valueEnd(last) : undefined) ?? (map.range ? map.range[0] + 1 : text.length);
    return splice(text, end, end, last ? `, ${entry}` : entry);
  }
  const indent = ' '.repeat(column(text, (map.items[0]!.key as Node).range![0]));
  const at = lineEnd(text, map.range[1]);
  const lead = at === text.length && !text.endsWith('\n') ? '\n' : '';
  return splice(text, at, at, `${lead}${indent}${entry}\n`);
}

function addItem(text: string, seq: YAMLSeq, value: unknown): string {
  const last = seq.items.at(-1) as Node | undefined;
  if (seq.flow || !last || !seq.range) {
    const end = last?.range?.[1] ?? (seq.range ? seq.range[0] + 1 : text.length);
    return splice(text, end, end, last ? `, ${inline(value)}` : inline(value));
  }
  const indent = ' '.repeat(column(text, seq.range[0]));
  const at = lineEnd(text, seq.range[1]);
  const lead = at === text.length && !text.endsWith('\n') ? '\n' : '';
  return splice(text, at, at, `${lead}${indent}- ${inline(value)}\n`);
}

function valueEnd(pair: Pair): number | undefined {
  return isNode(pair.value) && pair.value.range
    ? pair.value.range[1]
    : (pair.key as Node | null)?.range?.[1];
}

function deletePair(text: string, map: YAMLMap, pair: Pair, owner?: Pair): string {
  const index = map.items.indexOf(pair);
  if (map.items.length === 1) return replaceNode(text, map, {}, owner);
  const key = (pair.key as Node).range![0];
  const next = map.items[index + 1];
  if (map.flow) {
    if (next) return splice(text, key, (next.key as Node).range![0], '');
    return splice(text, valueEnd(map.items[index - 1]!)!, valueEnd(pair)!, '');
  }
  const start = lineStart(text, key);
  const ownLine = text.slice(start, key).trim() === '';
  // `- kind: lede`: the first key shares its line with the item's dash.
  if (!ownLine && next) return splice(text, key, (next.key as Node).range![0], '');
  const nodeEnd = isNode(pair.value) && pair.value.range ? pair.value.range[2] : valueEnd(pair)!;
  return splice(text, ownLine ? start : key, lineEnd(text, nodeEnd), '');
}

function deleteItem(text: string, seq: YAMLSeq, item: Node, owner?: Pair): string {
  if (seq.items.length === 1) return replaceNode(text, seq, [], owner);
  const index = seq.items.indexOf(item);
  const [start, end, nodeEnd] = item.range!;
  if (seq.flow) {
    const next = seq.items[index + 1] as Node | undefined;
    if (next) return splice(text, start, next.range![0], '');
    const previous = seq.items[index - 1] as Node;
    return splice(text, previous.range![1], end, '');
  }
  return splice(text, lineStart(text, start), lineEnd(text, nodeEnd), '');
}

/** A key as YAML writes it: plain when that reads back the same, else double-quoted. */
function inlineKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) && !RESERVED_PLAIN.test(key)
    ? key
    : JSON.stringify(key);
}

/** Words YAML 1.2 reads as something other than a string. */
const RESERVED_PLAIN = /^(?:null|Null|NULL|~|true|True|TRUE|false|False|FALSE)$/;

/** Text that reads back as the same string when written plain, even inside [ ] and { }. */
const PLAIN_STRING = /^[A-Za-z](?:[A-Za-z0-9 ._-]*[A-Za-z0-9._-])?$/;

/**
 * A value as one line of YAML flow syntax. A string is plain when that reads
 * back the same, else double-quoted, which JSON's escaping writes correctly.
 */
function inline(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('applyEdits() takes plain JSON values only.');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return PLAIN_STRING.test(value) && !RESERVED_PLAIN.test(value) ? value : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, child]) => `${inlineKey(key)}: ${inline(child)}`,
    );
    return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
  }
  throw new Error('applyEdits() takes plain JSON values only.');
}
