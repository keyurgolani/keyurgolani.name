import {
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  Parser,
  parseDocument,
  type CST,
  type Pair,
  type YAMLMap,
} from 'yaml';

// Reads one portfolio or site document from its source text. The text has to
// be plain data: one document, no anchors, aliases, merge keys, tags, or
// directives, no repeated keys, within size, nesting, and entry limits checked
// before any recursive parser reads it. JSON is scanned strictly first, then
// read by JSON.parse; YAML's syntax tree is scanned first, then composed by
// yaml's parseDocument, which also locates every problem by line and column
// in both formats. Each step is linear in the text. Pure and browser-safe.

export type DocumentFormat = 'yaml' | 'json';

/** The format a document's file name declares: `.yml` and `.yaml` are YAML, `.json` is JSON. */
export function detectFormat(filename: string): DocumentFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.json')) return 'json';
  throw new Error('Documents are YAML (.yml, .yaml) or JSON (.json).');
}

/** 1-based line and column in the source text. */
export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

/**
 * Where a path into the data starts in the source: its value, or with `key`,
 * the key naming it in its mapping. For a path the document lacks, the
 * position of the nearest ancestor it has.
 */
export type Locate = (
  path: readonly PropertyKey[],
  at?: 'value' | 'key',
) => SourcePosition | undefined;

/** Why the text isn't one plain YAML or JSON document. Never quotes the text. */
export interface SourceProblem {
  /**
   * yaml's own error code (MULTIPLE_DOCS, ...), or DUPLICATE_KEY, ANCHOR,
   * ALIAS, MERGE_KEY, TAG, DIRECTIVE, JSON_SYNTAX, UNRESOLVABLE, TOO_LARGE,
   * TOO_DEEP, or TOO_MANY.
   */
  readonly code: string;
  /** JSON pointer to the offending node, when the problem is a node. */
  readonly pointer?: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export type ParsedSource =
  | { readonly ok: true; readonly data: unknown; readonly locate: Locate }
  | { readonly ok: false; readonly problems: readonly SourceProblem[] };

const BYTE_ORDER_MARK = 0xfeff;

/**
 * The largest document the parsers read, in UTF-8 bytes. The bundled example
 * is about 30 KB. Larger text is refused before any parser sees it.
 */
export const DOCUMENT_MAX_BYTES = 1024 * 1024;
/**
 * How deeply mappings and sequences may nest. yaml's composer recurses, and
 * past some depth it runs out of stack or memory (on Node 22 it can abort the
 * process), so deeper text is refused before the composer sees it.
 */
export const DOCUMENT_MAX_DEPTH = 64;
/**
 * How many entries one mapping or sequence may hold. The bundled example's
 * largest holds a few dozen. Checked before the composer, like the depth.
 */
export const DOCUMENT_MAX_ENTRIES = 10_000;

const PLAIN_DATA = 'Documents hold plain data only.';
const CONSTRUCT_MESSAGES: Record<string, (where: string) => string> = {
  ANCHOR: (where) => `${where} has a YAML anchor. ${PLAIN_DATA} Write each value out in full.`,
  ALIAS: (where) => `${where} is a YAML alias. ${PLAIN_DATA} Write each value out in full.`,
  MERGE_KEY: (where) => `${where} uses a YAML merge key (<<). ${PLAIN_DATA} Write each key out.`,
  TAG: (where) => `${where} has a YAML tag. ${PLAIN_DATA} Remove the tag.`,
};

const SYNTAX_MESSAGES: Record<string, string> = {
  DUPLICATE_KEY: 'A mapping repeats a key here. Keys must be unique.',
  MULTIPLE_DOCS: 'The file holds a second YAML document here. Keep exactly one.',
  DIRECTIVE: `The document has a YAML directive (%YAML or %TAG). ${PLAIN_DATA} Remove it.`,
  JSON_SYNTAX: "The file isn't valid JSON at this position.",
  TOO_LARGE: `The document passes the ${DOCUMENT_MAX_BYTES / 1024 / 1024} MiB limit here. Documents hold at most ${DOCUMENT_MAX_BYTES / 1024 / 1024} MiB.`,
  TOO_DEEP: `Mappings and sequences nest more than ${DOCUMENT_MAX_DEPTH} levels deep here. Documents nest at most ${DOCUMENT_MAX_DEPTH} levels.`,
  TOO_MANY: `A mapping or sequence passes ${DOCUMENT_MAX_ENTRIES.toLocaleString('en')} entries here. Each holds at most ${DOCUMENT_MAX_ENTRIES.toLocaleString('en')}.`,
};
const JSON_SYNTAX_UNLOCATED = "The file isn't valid JSON.";

/** RFC 6901 JSON pointer for a path; '' is the whole document. */
export function toPointer(path: readonly PropertyKey[]): string {
  return path.map((part) => `/${String(part).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

export function parseSource(source: string, format: DocumentFormat): ParsedSource {
  const text = source.charCodeAt(0) === BYTE_ORDER_MARK ? source.slice(1) : source;
  const refuse = (code: string, offset: number): ParsedSource => ({
    ok: false,
    problems: [{ code, message: SYNTAX_MESSAGES[code]!, ...positionIn(text, offset) }],
  });
  const oversize = oversizeOffset(text);
  if (oversize !== undefined) return refuse('TOO_LARGE', oversize);

  // JSON is checked in full before anything else reads it: yaml's composer
  // recurses, and text that isn't JSON could hide its nesting from a scan
  // that follows JSON's rules.
  let data: unknown;
  let tokens: TokenOffsets = { anchor: [], tag: [], directive: [] };
  if (format === 'json') {
    const scan = scanJson(text);
    if (scan.stop) return refuse(scan.stop.code, scan.stop.offset);
    if (scan.repeated.length > 0) {
      return {
        ok: false,
        problems: scan.repeated.map((offset) => ({
          code: 'DUPLICATE_KEY',
          message: SYNTAX_MESSAGES.DUPLICATE_KEY!,
          ...positionIn(text, offset),
        })),
      };
    }
    try {
      data = JSON.parse(text);
    } catch {
      // The scan accepts only what JSON.parse does, so this shouldn't happen.
      return { ok: false, problems: [{ code: 'JSON_SYNTAX', message: JSON_SYNTAX_UNLOCATED }] };
    }
  } else {
    const scan = scanYaml(text);
    if (scan.stop) return refuse(scan.stop.code, scan.stop.offset);
    tokens = scan.tokens;
  }

  const lineCounter = new LineCounter();
  // yaml's own repeated-key check compares each key with every earlier one,
  // so repeatedKeys() below does it in one pass per mapping instead.
  const doc = parseDocument(text, {
    lineCounter,
    prettyErrors: false,
    version: '1.2',
    merge: false,
    uniqueKeys: false,
    stringKeys: true,
  });
  const position = (offset: number): SourcePosition => {
    const { line, col } = lineCounter.linePos(offset);
    return { line, column: col };
  };
  const syntax = (code: string, offset?: number): SourceProblem => ({
    code,
    message:
      SYNTAX_MESSAGES[code] ?? `The document isn't well-formed YAML at this position (${code}).`,
    ...(offset !== undefined ? position(offset) : {}),
  });

  if (format === 'yaml') {
    const errors: Array<readonly [string, number]> = [
      ...doc.errors.map((error) => [error.code, error.pos[0]] as const),
      ...repeatedKeys(doc.contents).map((offset) => ['DUPLICATE_KEY', offset] as const),
    ];
    if (errors.length > 0) {
      errors.sort(([, a], [, b]) => a - b);
      return { ok: false, problems: errors.map(([code, offset]) => syntax(code, offset)) };
    }
    if (tokens.directive.length > 0) {
      return { ok: false, problems: tokens.directive.map((offset) => syntax('DIRECTIVE', offset)) };
    }
    const constructs = findConstructs(doc.contents, tokens, position);
    if (constructs.length > 0) return { ok: false, problems: constructs };
    try {
      data = doc.toJS({ maxAliasCount: 0 });
    } catch {
      return { ok: false, problems: [syntax('UNRESOLVABLE')] };
    }
  }

  // Each mapping's keys, indexed the first time a path goes through it.
  const indexes = new WeakMap<YAMLMap, Map<string, Pair>>();
  const pairIn = (map: YAMLMap, name: string): Pair | undefined => {
    let index = indexes.get(map);
    if (!index) {
      index = new Map();
      for (const pair of map.items) {
        const key = keyName(pair.key);
        if (!index.has(key)) index.set(key, pair);
      }
      indexes.set(map, index);
    }
    return index.get(name);
  };
  const childOf = (node: unknown, segment: PropertyKey): unknown => {
    if (isMap(node)) return pairIn(node, String(segment))?.value ?? undefined;
    if (isSeq(node)) {
      const index = Number(segment);
      return Number.isInteger(index) && index >= 0 ? node.items[index] : undefined;
    }
    return undefined;
  };
  const locate: Locate = (path, at = 'value') => {
    let node: unknown = doc.contents;
    let start = isNode(node) ? node.range?.[0] : undefined;
    for (const [depth, segment] of path.entries()) {
      if (at === 'key' && depth === path.length - 1 && isMap(node)) {
        const key = pairIn(node, String(segment))?.key;
        if (isNode(key) && key.range) return position(key.range[0]);
      }
      node = childOf(node, segment);
      if (node === undefined) break;
      if (isNode(node) && node.range) start = node.range[0];
    }
    return start === undefined ? undefined : position(start);
  };
  return { ok: true, data, locate };
}

/** A mapping key as the data has it: keys parse as strings. */
function keyName(key: unknown): string {
  return isScalar(key) ? String(key.value) : String(key);
}

/** Where each key a mapping already has starts, in text order: one pass per mapping. */
function repeatedKeys(root: unknown): number[] {
  const offsets: number[] = [];
  const pending: unknown[] = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (isMap(node)) {
      const seen = new Set<string>();
      for (const pair of node.items) {
        const key = keyName(pair.key);
        if (!seen.has(key)) seen.add(key);
        else if (isNode(pair.key) && pair.key.range) offsets.push(pair.key.range[0]);
        pending.push(pair.value);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) pending.push(item);
    }
  }
  return offsets.sort((a, b) => a - b);
}

type LimitCode = 'TOO_DEEP' | 'TOO_MANY';

/** Offsets of the anchor, tag, and directive tokens in YAML text, each list ascending. */
interface TokenOffsets {
  readonly anchor: number[];
  readonly tag: number[];
  readonly directive: number[];
}

/**
 * Reads YAML's concrete syntax tree before anything composes it. The composed
 * document keeps a node's anchor and tag but not where they were written, and
 * it applies directives without keeping them at all; the tree has every one of
 * those tokens at its own offset. The walk keeps its own stack, so it also
 * finds the first collection nested past DOCUMENT_MAX_DEPTH, or holding more
 * than DOCUMENT_MAX_ENTRIES, without recursing, before the composer, which
 * does recurse, sees the text.
 */
function scanYaml(text: string): {
  tokens: TokenOffsets;
  stop?: { readonly code: LimitCode; readonly offset: number };
} {
  const tokens: TokenOffsets = { anchor: [], tag: [], directive: [] };
  // Each entry is a token and how many collections enclose it.
  const pending: Array<readonly [CST.Token, number]> = [];
  for (const token of new Parser().parse(text)) pending.push([token, 0]);
  const props = (list: readonly CST.Token[] | undefined, depth: number) => {
    for (const token of list ?? []) pending.push([token, depth]);
  };
  let stop: { code: LimitCode; offset: number } | undefined;
  const limit = (code: LimitCode, offset: number) => {
    if (!stop || offset < stop.offset) stop = { code, offset };
  };
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [token, depth] = next;
    switch (token.type) {
      case 'anchor':
      case 'tag':
      case 'directive':
        tokens[token.type].push(token.offset);
        break;
      case 'document':
        props(token.start, depth);
        if (token.value) pending.push([token.value, depth]);
        break;
      case 'block-scalar':
        props(token.props, depth);
        break;
      case 'block-map':
      case 'block-seq':
      case 'flow-collection': {
        if (depth + 1 > DOCUMENT_MAX_DEPTH) {
          limit('TOO_DEEP', token.offset);
          break;
        }
        let entries = 0;
        for (const item of token.items as CST.CollectionItem[]) {
          const start = entryStart(item);
          if (start !== undefined && ++entries > DOCUMENT_MAX_ENTRIES) {
            limit('TOO_MANY', start);
            break;
          }
          props(item.start, depth + 1);
          if (item.key) pending.push([item.key, depth + 1]);
          props(item.sep, depth + 1);
          if (item.value) pending.push([item.value, depth + 1]);
        }
        break;
      }
      default:
        break;
    }
  }
  for (const list of [tokens.anchor, tokens.tag, tokens.directive]) list.sort((a, b) => a - b);
  return stop ? { tokens, stop } : { tokens };
}

const BETWEEN_ENTRIES = new Set(['comment', 'newline', 'space']);

/** Where a collection item's entry starts, or undefined for a place only a comment holds. */
function entryStart(item: CST.CollectionItem): number | undefined {
  const content = item.key ?? item.value;
  if (content) return content.offset;
  // `-` with nothing after it, say.
  return [...item.start, ...(item.sep ?? [])].find((token) => !BETWEEN_ENTRIES.has(token.type))
    ?.offset;
}

/** Where the text's UTF-8 encoding passes DOCUMENT_MAX_BYTES, or undefined when it doesn't. */
function oversizeOffset(text: string): number | undefined {
  // Each UTF-16 unit takes at most 3 bytes, so short text can't pass the cap.
  if (text.length * 3 <= DOCUMENT_MAX_BYTES) return undefined;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const pair = code >= 0xd800 && code <= 0xdbff && isLowSurrogate(text.charCodeAt(i + 1));
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : pair ? 4 : 3;
    if (bytes > DOCUMENT_MAX_BYTES) return i;
    if (pair) i++;
  }
  return undefined;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Line and column of an offset, counted the way yaml's LineCounter counts them. */
function positionIn(text: string, offset: number): SourcePosition {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 0x0a) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/**
 * Every anchor, alias, merge key, and tag in the tree, each located where it's
 * written. A node's properties come straight before its content, and a
 * collection's before its first entry's, so the walk below (each node before
 * its children, children in order) meets anchored and tagged nodes in the
 * order their anchor and tag tokens appear.
 */
function findConstructs(
  root: unknown,
  tokens: TokenOffsets,
  position: (offset: number) => SourcePosition,
): SourceProblem[] {
  const found: SourceProblem[] = [];
  let anchors = 0;
  let tags = 0;
  const report = (code: string, path: readonly PropertyKey[], offset: number | undefined) => {
    const pointer = toPointer(path);
    found.push({
      code,
      pointer,
      message: CONSTRUCT_MESSAGES[code]!(pointer || 'The document'),
      ...(offset !== undefined ? position(offset) : {}),
    });
  };
  const walk = (node: unknown, path: readonly PropertyKey[]): void => {
    if (isAlias(node)) {
      report('ALIAS', path, node.range?.[0]);
      return;
    }
    if (!isNode(node)) return;
    if (node.anchor) report('ANCHOR', path, tokens.anchor[anchors++] ?? node.range?.[0]);
    if (node.tag) report('TAG', path, tokens.tag[tags++] ?? node.range?.[0]);
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
        const at = [...path, key];
        if (key === '<<') {
          report('MERGE_KEY', at, isNode(pair.key) ? pair.key.range?.[0] : undefined);
        }
        walk(pair.key, at);
        walk(pair.value, at);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, index) => walk(item, [...path, index]));
    }
  };
  walk(root, []);
  return found;
}

const JSON_SPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);
const JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);
const HEX_DIGIT = /^[0-9a-fA-F]$/;
const DIGIT = /^[0-9]$/;

interface JsonScan {
  /** The first problem that stops the scan: a syntax error or a limit passed. */
  readonly stop?: { readonly code: 'JSON_SYNTAX' | LimitCode; readonly offset: number };
  /** Where each key an object already has starts, in text order. */
  readonly repeated: readonly number[];
}

/** One array or object the scan is inside. */
interface OpenJson {
  readonly close: ']' | '}';
  entries: number;
  /** An object's keys so far. */
  readonly keys?: Set<string>;
}

/**
 * Checks that text is one JSON value (RFC 8259) within DOCUMENT_MAX_DEPTH and
 * DOCUMENT_MAX_ENTRIES, and finds repeated keys, in one pass. A syntax error
 * is located at the first character that can't continue the value, or at the
 * text's length when it ends too soon. It keeps its own stack, so deep nesting
 * can't overflow the call stack.
 */
function scanJson(text: string): JsonScan {
  let i = 0;
  const open: OpenJson[] = [];
  const repeated: number[] = [];
  const stop = (code: 'JSON_SYNTAX' | LimitCode): JsonScan => ({
    stop: { code, offset: i },
    repeated,
  });
  const skipSpace = () => {
    while (i < text.length && JSON_SPACE.has(text.charCodeAt(i))) i++;
  };
  const digits = (): boolean => {
    if (!DIGIT.test(text[i] ?? '')) return false;
    while (DIGIT.test(text[i] ?? '')) i++;
    return true;
  };
  const string = (): boolean => {
    i++; // the opening quote
    while (i < text.length) {
      const char = text[i]!;
      if (char === '"') {
        i++;
        return true;
      }
      if (text.charCodeAt(i) < 0x20) return false;
      if (char === '\\') {
        i++;
        const escape = text[i];
        if (escape === 'u') {
          for (let k = 1; k <= 4; k++) {
            if (!HEX_DIGIT.test(text[i + k] ?? '')) {
              i += k;
              return false;
            }
          }
          i += 5;
          continue;
        }
        if (escape === undefined || !JSON_ESCAPES.has(escape)) return false;
      }
      i++;
    }
    return false;
  };
  const number = (): boolean => {
    if (text[i] === '-') i++;
    if (text[i] === '0') i++;
    else if (!digits()) return false;
    if (text[i] === '.') {
      i++;
      if (!digits()) return false;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++;
      if (text[i] === '+' || text[i] === '-') i++;
      if (!digits()) return false;
    }
    return true;
  };
  const literal = (word: string): boolean => {
    for (let k = 0; k < word.length; k++) {
      if (text[i + k] !== word[k]) {
        i += k;
        return false;
      }
    }
    i += word.length;
    return true;
  };
  const scalar = (): boolean => {
    const char = text[i];
    if (char === '"') return string();
    if (char === '-' || DIGIT.test(char ?? '')) return number();
    if (char === 't') return literal('true');
    if (char === 'f') return literal('false');
    if (char === 'n') return literal('null');
    return false;
  };
  /** Starts the innermost container's next entry at i: an object member's key and colon. */
  const entry = (): 'JSON_SYNTAX' | 'TOO_MANY' | undefined => {
    const container = open.at(-1)!;
    if (++container.entries > DOCUMENT_MAX_ENTRIES) return 'TOO_MANY';
    if (!container.keys) return undefined;
    const start = i;
    if (text[i] !== '"' || !string()) return 'JSON_SYNTAX';
    const key = JSON.parse(text.slice(start, i)) as string;
    if (container.keys.has(key)) repeated.push(start);
    else container.keys.add(key);
    skipSpace();
    if (text[i] !== ':') return 'JSON_SYNTAX';
    i++;
    return undefined;
  };

  let expectValue = true;
  for (;;) {
    skipSpace();
    if (expectValue) {
      const char = text[i];
      if (char === '{' || char === '[') {
        if (open.length >= DOCUMENT_MAX_DEPTH) return stop('TOO_DEEP');
        const close = char === '{' ? '}' : ']';
        i++;
        skipSpace();
        if (text[i] === close) {
          i++;
          expectValue = false;
          continue;
        }
        open.push(close === '}' ? { close, entries: 0, keys: new Set() } : { close, entries: 0 });
        const problem = entry();
        if (problem) return stop(problem);
        continue;
      }
      if (!scalar()) return stop('JSON_SYNTAX');
      expectValue = false;
      continue;
    }
    const container = open.at(-1);
    if (!container) return i < text.length ? stop('JSON_SYNTAX') : { repeated };
    if (text[i] === ',') {
      i++;
      skipSpace();
      const problem = entry();
      if (problem) return stop(problem);
      expectValue = true;
    } else if (text[i] === container.close) {
      i++;
      open.pop();
    } else return stop('JSON_SYNTAX');
  }
}
