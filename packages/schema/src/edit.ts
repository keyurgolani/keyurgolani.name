import {
  isCollection,
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
import { isJsonEqual, plainJsonProblem } from './json';
import { parseSource, type DocumentFormat } from './source';

// Editing a document by JSON pointer (#4, item 17). A YAML edit changes only
// the text of the value it sets or the entry it deletes, in the document's
// own line breaks, so comments and every untouched byte stay as written. A
// JSON edit re-serializes the whole document with two-space indent, keeping
// its key order.

export interface Edit {
  /** RFC 6901 pointer. In an array, `-` appends. */
  readonly pointer: string;
  readonly op: 'set' | 'delete';
  /** Plain JSON data, for `set`. */
  readonly value?: unknown;
}

/**
 * Applies the edits in order and returns the new text. A `set` adds any
 * mapping the path is missing, and a scalar in its way becomes the mapping
 * or array the path needs, in both formats; a `delete` of a path the
 * document lacks changes nothing. Throws when the text isn't a plain
 * document or an edit can't apply, such as an array index past the end.
 */
export function applyEdits(text: string, format: DocumentFormat, edits: readonly Edit[]): string {
  const parsed = parseSource(text, format);
  if (!parsed.ok) throw new Error('applyEdits() needs a document that parses.');
  if (format === 'json') return editJson(text, parsed.data, edits);
  let current = text;
  let expected = parsed.data;
  for (const edit of edits) {
    expected = editData(expected, edit);
    current = editYaml(current, edit);
    // The whole document has to read back as the old data with this one edit
    // made, so a text edit that reaches past its entry can't go unnoticed.
    const after = parseSource(current, 'yaml');
    if (!after.ok || !isJsonEqual(after.data, expected)) failed(edit);
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

/** The array index a segment names: `-` and the length are the next one. Throws for any other. */
function arrayIndex(segment: string, length: number): number {
  const index = segment === '-' ? length : Number(segment);
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new Error(`${segment} isn't an index this array can take.`);
  }
  return index;
}

/** The value the rest of a path adds: a mapping per key, an array per `-`. */
function nest(rest: readonly string[], value: unknown): unknown {
  return rest.reduceRight<unknown>(
    (inner, segment) => (segment === '-' ? [inner] : { [segment]: inner }),
    value,
  );
}

/** A plain-data copy that keeps an own `__proto__` key as a key. */
function copyData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyData);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyData(child)]));
}

function setOwn(record: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * The data with the edit made, by the rules the text edits follow. Each
 * edit's text is checked against it.
 */
function editData(data: unknown, edit: Edit): unknown {
  const path = segments(edit.pointer);
  if (edit.op === 'set' && plainJsonProblem(edit.value, Number.POSITIVE_INFINITY)) {
    throw new Error('applyEdits() takes plain JSON values only.');
  }
  if (path.length === 0) {
    if (edit.op === 'delete') throw new Error("applyEdits() can't delete the whole document.");
    return copyData(edit.value);
  }
  const root = copyData(data);
  let node = root;
  // The array or mapping holding `node`, and its index or key there.
  let parent: unknown[] | Record<string, unknown> | undefined;
  let at: string | number = '';
  for (const [depth, segment] of path.entries()) {
    const last = depth === path.length - 1;
    if (Array.isArray(node)) {
      const index = arrayIndex(segment, node.length);
      if (index === node.length) {
        if (edit.op === 'set') node.push(copyData(nest(path.slice(depth + 1), edit.value)));
        return root;
      }
      if (last) {
        if (edit.op === 'delete') node.splice(index, 1);
        else node[index] = copyData(edit.value);
        return root;
      }
      parent = node;
      at = index;
      node = node[index];
    } else if (node !== null && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (!Object.hasOwn(record, segment)) {
        if (edit.op === 'set')
          setOwn(record, segment, copyData(nest(path.slice(depth + 1), edit.value)));
        return root;
      }
      if (last) {
        if (edit.op === 'delete') delete record[segment];
        else setOwn(record, segment, copyData(edit.value));
        return root;
      }
      parent = record;
      at = segment;
      node = record[segment];
    } else {
      // A scalar in the way: a delete has nothing to take out, and a set
      // replaces it with the mapping or array the path needs.
      if (edit.op === 'delete') return root;
      const container = copyData(nest(path.slice(depth), edit.value));
      if (!parent) return container;
      if (Array.isArray(parent)) parent[at as number] = container;
      else setOwn(parent, at as string, container);
      return root;
    }
  }
  return root;
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

function editJson(text: string, data: unknown, edits: readonly Edit[]): string {
  const doc = parse(text);
  let expected = data;
  for (const edit of edits) {
    expected = editData(expected, edit);
    editTree(doc, segments(edit.pointer), edit);
    if (!isJsonEqual(doc.toJS(), expected)) failed(edit);
  }
  const written = `${json(doc.contents, '')}\n`;
  if (!isJsonEqual(JSON.parse(written), expected)) {
    throw new Error("applyEdits() couldn't write the edited document.");
  }
  return written;
}

/** Makes one edit to a JSON document's node tree, by the rules the YAML text edits follow. */
function editTree(doc: Document, path: readonly string[], edit: Edit): void {
  // Never an alias: JSON has none, so a value used twice is written twice.
  const options = { aliasDuplicateObjects: false };
  const node = (value: unknown) => doc.createNode(value, options);
  // The collection holding `current`, and its key or index there.
  let parent: YAMLMap | YAMLSeq | undefined;
  let at: string | number = '';
  let current: unknown = doc.contents;
  const replace = (value: unknown) => {
    if (parent) parent.set(at, node(value));
    else doc.contents = node(value) as never;
  };
  for (const [depth, segment] of path.entries()) {
    const rest = path.slice(depth + 1);
    if (isMap(current)) {
      const pair = current.items.find((item) => keyOf(item) === segment);
      if (!pair) {
        if (edit.op === 'set')
          current.add(doc.createPair(segment, nest(rest, edit.value), options));
        return;
      }
      parent = current;
      at = segment;
      current = pair.value;
    } else if (isSeq(current)) {
      const index = arrayIndex(segment, current.items.length);
      if (index === current.items.length) {
        if (edit.op === 'set') current.add(node(nest(rest, edit.value)));
        return;
      }
      parent = current;
      at = index;
      current = current.items[index];
    } else {
      // A scalar or nothing in the way becomes the mapping or array the path needs.
      if (edit.op === 'set') replace(nest(path.slice(depth), edit.value));
      return;
    }
  }
  if (edit.op === 'set') replace(edit.value);
  else if (isSeq(parent)) parent.items.splice(at as number, 1);
  else if (isMap(parent))
    parent.items.splice(
      parent.items.findIndex((item) => keyOf(item) === at),
      1,
    );
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
    return `${inline(edit.value)}${lineBreak(text)}`;
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
      const index = arrayIndex(segment, node.items.length);
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
  const value = nest(rest.slice(1), edit.value);
  if (isMap(node)) return addPair(text, node, rest[0]!, value);
  if (isSeq(node)) return addItem(text, node, value);
  // A scalar or empty value in the way becomes the mapping or array the path needs.
  return replaceNode(text, node, nest(rest, edit.value), owners.get(node));
}

/** The document's line break: CRLF when its first line ends with one, else LF. */
function lineBreak(text: string): string {
  const newline = text.indexOf('\n');
  return newline > 0 && text[newline - 1] === '\r' ? '\r\n' : '\n';
}

/** Where the line holding `offset` starts. */
function lineStart(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

/** Where the line holding `offset` ends, after its newline; `offset` itself when a line just ended there. */
function lineEnd(text: string, offset: number): number {
  if (offset > 0 && text[offset - 1] === '\n') return offset;
  return nextLine(text, offset);
}

/** Where the line after the one holding `offset` starts, or the text's end. */
function nextLine(text: string, offset: number): number {
  const newline = text.indexOf('\n', offset);
  return newline === -1 ? text.length : newline + 1;
}

function column(text: string, offset: number): number {
  return offset - lineStart(text, offset);
}

function splice(text: string, start: number, end: number, insert: string): string {
  return text.slice(0, start) + insert + text.slice(end);
}

/**
 * Where a node's own content ends. A block collection's range runs on over
 * the comment lines after its last entry, so this follows the last entries
 * down to the last scalar instead.
 */
function contentEnd(node: unknown): number | undefined {
  if (isMap(node) && !node.flow && node.items.length > 0) {
    const last = node.items.at(-1)!;
    return contentEnd(last.value) ?? (last.key as Node | null)?.range?.[1];
  }
  if (isSeq(node) && !node.flow && node.items.length > 0) return contentEnd(node.items.at(-1));
  return isNode(node) ? node.range?.[1] : undefined;
}

/** Replaces a value; `owner` is the pair it belongs to when it's a mapping value. */
function replaceNode(text: string, node: unknown, value: unknown, owner?: Pair): string {
  if (!isNode(node) || !node.range) {
    // The document is empty, or the value is: write it out.
    return text.trim() === '' ? `${inline(value)}${lineBreak(text)}` : text;
  }
  const [start] = node.range;
  let end = node.range[1];
  if (isCollection(node) && !node.flow) {
    // A comment less indented than the collection introduces what follows it.
    end = entryStop(text, contentEnd(node)!, end, column(text, start) - 1).stop;
  }
  const replaced = text.slice(start, end);
  // A block collection or block scalar ends with its last line's line break.
  const newline = /\r?\n$/.exec(replaced)?.[0] ?? '';
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
  const keyColumn = column(text, (map.items[0]!.key as Node).range![0]);
  const indent = ' '.repeat(keyColumn);
  // After the last entry and the comments under it, before one that introduces what follows.
  const at = entryStop(text, contentEnd(map)!, map.range[2], keyColumn).stop;
  const eol = lineBreak(text);
  const lead = at === text.length && !text.endsWith('\n') ? eol : '';
  return splice(text, at, at, `${lead}${indent}${entry}${eol}`);
}

function addItem(text: string, seq: YAMLSeq, value: unknown): string {
  const last = seq.items.at(-1) as Node | undefined;
  if (seq.flow || !last || !seq.range) {
    const end = last?.range?.[1] ?? (seq.range ? seq.range[0] + 1 : text.length);
    return splice(text, end, end, last ? `, ${inline(value)}` : inline(value));
  }
  const dash = column(text, seq.range[0]);
  const indent = ' '.repeat(dash);
  const at = entryStop(text, contentEnd(seq)!, seq.range[2], dash).stop;
  const eol = lineBreak(text);
  const lead = at === text.length && !text.endsWith('\n') ? eol : '';
  return splice(text, at, at, `${lead}${indent}- ${inline(value)}${eol}`);
}

function valueEnd(pair: Pair): number | undefined {
  return isNode(pair.value) && pair.value.range
    ? pair.value.range[1]
    : (pair.key as Node | null)?.range?.[1];
}

/**
 * Where a block entry being deleted stops: after the line its content ends
 * on, and after each comment line under it, indented past `indent`. yaml
 * counts the comment lines before the next entry in the deleted node, but a
 * comment at `indent` or less introduces what follows, so it stays, and so
 * does every line after it. `comment` is where that first kept comment
 * starts, if there is one before `limit`.
 */
function entryStop(
  text: string,
  contentEnd: number,
  limit: number,
  indent: number,
): { stop: number; comment?: number } {
  // Content can end where only indentation precedes it, on the next entry's line.
  const line = lineStart(text, contentEnd);
  let stop = text.slice(line, contentEnd).trim() === '' ? line : lineEnd(text, contentEnd);
  for (let at = stop; at < limit; at = nextLine(text, at)) {
    const line = text.slice(at, nextLine(text, at));
    const first = line.search(/\S/);
    if (first === -1) continue;
    if (line[first] !== '#') break;
    if (first <= indent) return { stop, comment: at + first };
    stop = nextLine(text, at);
  }
  return { stop };
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
  const content = contentEnd(pair.value) ?? valueEnd(pair)!;
  if (!ownLine && next) {
    // `- kind: lede`: the first key shares its line with the item's dash, so
    // the next key moves up beside the dash, or a comment introducing it does.
    const nextKey = (next.key as Node).range![0];
    const { comment } = entryStop(text, content, nextKey, column(text, nextKey));
    return splice(text, key, comment ?? nextKey, '');
  }
  const nodeEnd = (isNode(pair.value) ? pair.value.range?.[2] : undefined) ?? content;
  const { stop } = entryStop(text, content, nodeEnd, column(text, key));
  return splice(text, ownLine ? start : key, stop, '');
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
  const line = lineStart(text, start);
  // The item's dash, which the item's own lines and comments are indented past.
  const dash = text.slice(line, start).search(/\S/);
  const indent = dash === -1 ? column(text, start) : dash;
  const { stop } = entryStop(text, contentEnd(item) ?? end, nodeEnd, indent);
  return splice(text, line, stop, '');
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
