import { isAlias, isMap, isNode, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';

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
 * Where a path into the data starts in the source. For a key the document
 * lacks, the position of the nearest ancestor it has.
 */
export type Locate = (path: readonly PropertyKey[]) => SourcePosition | undefined;

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
      // Only the offset is taken from the message, which can quote the text.
      const offset = /at position (\d+)/.exec(String(error))?.[1];
      return {
        ok: false,
        problems: [
          syntax('JSON_SYNTAX', offset !== undefined ? Number(offset) : doc.errors[0]?.pos[0]),
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
    const directives = doc.directives;
    if (
      directives?.yaml.explicit ||
      Object.keys(directives?.tags ?? {}).some((handle) => handle !== '!!') ||
      doc.warnings.some((warning) => warning.code === 'BAD_DIRECTIVE')
    ) {
      return { ok: false, problems: [syntax('DIRECTIVE', 0)] };
    }
    const constructs = findConstructs(doc.contents, position);
    if (constructs.length > 0) return { ok: false, problems: constructs };
    try {
      data = doc.toJS({ maxAliasCount: 0 });
    } catch {
      return { ok: false, problems: [syntax('UNRESOLVABLE')] };
    }
  }

  const locate: Locate = (path) => {
    for (let depth = path.length; depth >= 0; depth--) {
      const node = depth === 0 ? doc.contents : doc.getIn(path.slice(0, depth), true);
      if (isNode(node) && node.range) return position(node.range[0]);
    }
    return undefined;
  };
  return { ok: true, data, locate };
}

/** Every anchor, alias, merge key, and tag in the tree, each located by its node. */
function findConstructs(
  root: unknown,
  position: (offset: number) => SourcePosition,
): SourceProblem[] {
  const found: SourceProblem[] = [];
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
    if (node.anchor) report('ANCHOR', path, node.range?.[0]);
    if (node.tag) report('TAG', path, node.range?.[0]);
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
