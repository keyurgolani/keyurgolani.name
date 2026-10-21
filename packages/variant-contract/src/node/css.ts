// A small CSS reader for the source audit (#5, Slice 3, item 5): rules,
// at-rules, keyframes, and declarations with their positions, enough to check
// scope, nesting, imports and URLs, physical properties, and appearance
// values. It reads what a browser would and skips what it can't parse,
// without failing.

export interface Position {
  readonly line: number;
  readonly column: number;
}

export type CssNode =
  | {
      readonly type: 'rule';
      readonly selector: string;
      readonly at: Position;
      readonly children: readonly CssNode[];
    }
  | {
      readonly type: 'at-rule';
      readonly name: string;
      readonly prelude: string;
      readonly at: Position;
      /** Undefined for a statement such as `@import ...;`. */
      readonly children?: readonly CssNode[];
    }
  | {
      readonly type: 'declaration';
      readonly property: string;
      readonly value: string;
      readonly at: Position;
    };

/** The stylesheet's top-level rules and at-rules. */
export function parseCss(text: string): CssNode[] {
  const source = stripComments(text);
  const lines = lineStarts(source);
  const positionOf = (offset: number): Position => {
    let low = 0;
    let high = lines.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lines[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - lines[low]! + 1 };
  };
  return parseBlock(source, 0, source.length, positionOf, false);
}

/** Comments become spaces, so offsets and lines stay where they were. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++)
    if (text[index] === '\n') starts.push(index + 1);
  return starts;
}

/** The offset of the next `{`, `;`, or `}` at this level, skipping strings and parentheses. */
function nextStop(text: string, from: number, end: number): number {
  let depth = 0;
  for (let index = from; index < end; index++) {
    const char = text[index]!;
    if (char === '"' || char === "'") {
      index = skipString(text, index, end);
    } else if (char === '(' || char === '[') {
      depth++;
    } else if (char === ')' || char === ']') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && (char === '{' || char === ';' || char === '}')) {
      return index;
    }
  }
  return end;
}

function skipString(text: string, start: number, end: number): number {
  const quote = text[start];
  for (let index = start + 1; index < end; index++) {
    if (text[index] === '\\') index++;
    else if (text[index] === quote || text[index] === '\n') return index;
  }
  return end;
}

/** The offset of the `}` that closes the block opened at `open`. */
function closing(text: string, open: number, end: number): number {
  let depth = 0;
  for (let index = open; index < end; index++) {
    const char = text[index]!;
    if (char === '"' || char === "'") index = skipString(text, index, end);
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return index;
  }
  return end;
}

function parseBlock(
  text: string,
  start: number,
  end: number,
  positionOf: (offset: number) => Position,
  inRule: boolean,
): CssNode[] {
  const nodes: CssNode[] = [];
  let index = start;
  while (index < end) {
    while (index < end && /\s/.test(text[index]!)) index++;
    if (index >= end) break;
    const stop = nextStop(text, index, end);
    const prelude = text.slice(index, stop).trim();
    const at = positionOf(index);
    if (stop >= end || text[stop] === '}') {
      // A last declaration without its semicolon, or stray text.
      if (inRule && prelude) nodes.push(declaration(prelude, at));
      index = stop + 1;
      continue;
    }
    if (text[stop] === ';') {
      if (prelude.startsWith('@')) {
        const [name = '', ...rest] = prelude.split(/\s+/);
        nodes.push({ type: 'at-rule', name: name.toLowerCase(), prelude: rest.join(' '), at });
      } else if (inRule && prelude) {
        nodes.push(declaration(prelude, at));
      }
      index = stop + 1;
      continue;
    }
    const close = closing(text, stop, end);
    if (prelude.startsWith('@')) {
      const [name = '', ...rest] = prelude.split(/\s+/);
      const lowered = name.toLowerCase();
      // A keyframes block parses as rules too: from, to, and percentages, each with declarations.
      nodes.push({
        type: 'at-rule',
        name: lowered,
        prelude: rest.join(' '),
        at,
        children: parseBlock(
          text,
          stop + 1,
          close,
          positionOf,
          inRule || isDeclarationBlock(lowered),
        ),
      });
    } else {
      nodes.push({
        type: 'rule',
        selector: prelude,
        at,
        children: parseBlock(text, stop + 1, close, positionOf, true),
      });
    }
    index = close + 1;
  }
  return nodes;
}

/** At-rules whose block holds declarations, not rules. */
function isDeclarationBlock(name: string): boolean {
  return ['@font-face', '@page', '@property', '@counter-style', '@font-palette-values'].includes(
    name,
  );
}

function declaration(text: string, at: Position): CssNode {
  const colon = text.indexOf(':');
  if (colon < 0) return { type: 'declaration', property: text.trim().toLowerCase(), value: '', at };
  return {
    type: 'declaration',
    property: text.slice(0, colon).trim().toLowerCase(),
    value: text.slice(colon + 1).trim(),
    at,
  };
}

/** A selector list's selectors, split at its top-level commas. */
export function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let index = 0; index < list.length; index++) {
    const char = list[index]!;
    if (char === '"' || char === "'") {
      const end = skipString(list, index, list.length);
      current += list.slice(index, end + 1);
      index = end;
      continue;
    }
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
