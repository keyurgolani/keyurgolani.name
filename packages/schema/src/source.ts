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
} from 'yaml';

// Reads one portfolio or site document from its source text. YAML and JSON
// both go through yaml's parseDocument, which reports duplicate keys and
// locates every problem by line and column; a JSON file must also pass
// JSON.parse. The text has to be plain data: one document, no anchors,
// aliases, merge keys, tags, or directives. Pure and browser-safe.

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
   * yaml's own error code (DUPLICATE_KEY, MULTIPLE_DOCS, ...), or ANCHOR,
   * ALIAS, MERGE_KEY, TAG, DIRECTIVE, JSON_SYNTAX, or UNRESOLVABLE.
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
};
const JSON_SYNTAX_UNLOCATED = "The file isn't valid JSON.";

/** RFC 6901 JSON pointer for a path; '' is the whole document. */
export function toPointer(path: readonly PropertyKey[]): string {
  return path.map((part) => `/${String(part).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

export function parseSource(source: string, format: DocumentFormat): ParsedSource {
  const text = source.charCodeAt(0) === BYTE_ORDER_MARK ? source.slice(1) : source;
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, {
    lineCounter,
    prettyErrors: false,
    version: '1.2',
    merge: false,
    uniqueKeys: true,
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

  let data: unknown;
  if (format === 'json') {
    try {
      data = JSON.parse(text);
    } catch (error) {
      // V8 names a position for only some errors, and its message can quote
      // the text, so the offset comes from a strict scan of the text instead.
      const v8 = /at position (\d+)/.exec(String(error))?.[1];
      const offset = jsonSyntaxErrorOffset(text) ?? (v8 !== undefined ? Number(v8) : undefined);
      return {
        ok: false,
        problems: [
          offset !== undefined
            ? syntax('JSON_SYNTAX', offset)
            : { code: 'JSON_SYNTAX', message: JSON_SYNTAX_UNLOCATED },
        ],
      };
    }
    // Valid JSON can still repeat a key, which JSON.parse lets the last one win.
    const repeated = doc.errors.filter((error) => error.code === 'DUPLICATE_KEY');
    if (repeated.length > 0) {
      return { ok: false, problems: repeated.map((error) => syntax(error.code, error.pos[0])) };
    }
  } else {
    if (doc.errors.length > 0) {
      return { ok: false, problems: doc.errors.map((error) => syntax(error.code, error.pos[0])) };
    }
    const tokens = sourceTokens(text);
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

  const locate: Locate = (path, at = 'value') => {
    if (at === 'key' && path.length > 0) {
      const parent = path.length === 1 ? doc.contents : doc.getIn(path.slice(0, -1), true);
      const name = String(path.at(-1));
      const pair = isMap(parent)
        ? parent.items.find((item) => isScalar(item.key) && String(item.key.value) === name)
        : undefined;
      if (pair && isNode(pair.key) && pair.key.range) return position(pair.key.range[0]);
    }
    for (let depth = path.length; depth >= 0; depth--) {
      const node = depth === 0 ? doc.contents : doc.getIn(path.slice(0, depth), true);
      if (isNode(node) && node.range) return position(node.range[0]);
    }
    return undefined;
  };
  return { ok: true, data, locate };
}

/** Offsets of the anchor, tag, and directive tokens in YAML text, each list ascending. */
interface TokenOffsets {
  readonly anchor: number[];
  readonly tag: number[];
  readonly directive: number[];
}

/**
 * The composed document keeps a node's anchor and tag but not where they
 * were written, and it applies directives without keeping them at all. The
 * concrete syntax tree has every one of those tokens at its own offset.
 */
function sourceTokens(text: string): TokenOffsets {
  const found: TokenOffsets = { anchor: [], tag: [], directive: [] };
  const visit = (token: CST.Token | null | undefined): void => {
    if (!token) return;
    switch (token.type) {
      case 'anchor':
      case 'tag':
      case 'directive':
        found[token.type].push(token.offset);
        return;
      case 'document':
        token.start.forEach(visit);
        visit(token.value);
        token.end?.forEach(visit);
        return;
      case 'block-scalar':
        token.props.forEach(visit);
        return;
      case 'block-map':
      case 'block-seq':
      case 'flow-collection':
        for (const item of token.items as CST.CollectionItem[]) {
          item.start.forEach(visit);
          visit(item.key);
          item.sep?.forEach(visit);
          visit(item.value);
        }
        return;
      default:
        return;
    }
  };
  for (const token of new Parser().parse(text)) visit(token);
  return found;
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

/**
 * Where text stops being one JSON value (RFC 8259): the offset of the first
 * character that can't continue it, or the text's length when it ends too
 * soon. Undefined when the text is valid JSON. It keeps its own stack, so
 * deep nesting can't overflow the call stack.
 */
function jsonSyntaxErrorOffset(text: string): number | undefined {
  let i = 0;
  const open: string[] = [];
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
  /** A member's key and colon, up to its value. */
  const key = (): boolean => {
    skipSpace();
    if (text[i] !== '"' || !string()) return false;
    skipSpace();
    if (text[i] !== ':') return false;
    i++;
    return true;
  };

  let expectValue = true;
  for (;;) {
    skipSpace();
    if (expectValue) {
      const char = text[i];
      if (char === '{' || char === '[') {
        i++;
        skipSpace();
        if (text[i] === (char === '{' ? '}' : ']')) {
          i++;
          expectValue = false;
        } else {
          open.push(char);
          if (char === '{' && !key()) return i;
        }
        continue;
      }
      if (!scalar()) return i;
      expectValue = false;
      continue;
    }
    const container = open.at(-1);
    if (container === undefined) return i < text.length ? i : undefined;
    if (text[i] === ',') {
      i++;
      if (container === '{' && !key()) return i;
      expectValue = true;
    } else if (text[i] === (container === '{' ? '}' : ']')) {
      i++;
      open.pop();
    } else return i;
  }
}
