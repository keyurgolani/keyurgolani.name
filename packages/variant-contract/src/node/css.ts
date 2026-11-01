// The variant CSS audit's reader (#5, Slice 3, item 5; K-5 round 5): PostCSS
// 8.5.31 parses a stylesheet into rules, at-rules, and declarations with
// their positions, and its own tokenizer reads every token of the text and of
// each value, so what the audit judges is what a CSS parser reads, never a
// regular expression's guess at it. A stylesheet PostCSS can't parse, an
// unclosed string, comment, bracket, or block, or a word where a rule should
// be, is a problem, and the audit refuses it: a browser would read past it.
//
// The audit's own rules sit on top of this (./css-audit): a declaration's
// value is PostCSS's, comments out and `!important` lifted into its flag.

import { createRequire } from 'node:module';
import postcss, { CssSyntaxError, Input, type ChildNode } from 'postcss';

/** `[type, text, start offset, end offset]`; some tokens carry no offsets. */
type Token = [string, string, number?, number?];
type Tokenizer = (
  input: Input,
  options?: { ignoreErrors?: boolean },
) => {
  nextToken(options?: { ignoreUnclosed?: boolean }): Token | undefined;
  endOfFile(): boolean;
};
// PostCSS's own tokenizer, which its parser reads every stylesheet with. postcss@8.5.31 ships
// it without a declaration or an export entry of its own, so it's required by path.
const tokenizer = createRequire(import.meta.url)('postcss/lib/tokenize') as Tokenizer;

export interface Position {
  readonly line: number;
  readonly column: number;
}

export type CssNode =
  | {
      readonly type: 'rule';
      /** PostCSS's selector, which drops a comment next to a space. */
      readonly selector: string;
      /** The selector as written, up to its `{`, comments in it kept. */
      readonly rawSelector?: string;
      readonly at: Position;
      readonly children: readonly CssNode[];
    }
  | {
      readonly type: 'at-rule';
      readonly name: string;
      readonly prelude: string;
      /** The prelude as written, from the name to its `{` or `;`, comments in it kept. */
      readonly rawPrelude?: string;
      readonly at: Position;
      /** Undefined for a statement such as `@import ...;`. */
      readonly children?: readonly CssNode[];
    }
  | {
      readonly type: 'declaration';
      /** Lowercased. */
      readonly property: string;
      /** PostCSS's value: comments out, and no `!important`. */
      readonly value: string;
      readonly at: Position;
      /** Whether it ends in `!important`. */
      readonly important?: boolean;
      /** Where it starts and ends in the stylesheet's text. */
      readonly start?: number;
      readonly end?: number;
    };

/** Something PostCSS can't read: an unclosed string, comment, bracket, or block, or an unknown word. */
export interface CssProblem {
  readonly at: Position;
  readonly message: string;
}

/** One token of CSS text, as PostCSS's tokenizer reads it, with where it starts. */
export interface CssToken {
  /** `word`, `string`, `brackets`, `(`, `)`, `[`, `]`, `{`, `}`, `;`, `:`, `,`, `space`, `comment`, or `at-word`. */
  readonly type: string;
  readonly text: string;
  /** Its offset in the text it came from, where PostCSS gives one. */
  readonly start: number | undefined;
}

/** Every token of `text`, comments among them, as PostCSS reads them; unclosed ones end the list. */
export function cssTokens(text: string): CssToken[] {
  const read = tokenizer(new Input(text), { ignoreErrors: true });
  const tokens: CssToken[] = [];
  while (!read.endOfFile()) {
    const token: Token | undefined = read.nextToken({ ignoreUnclosed: true });
    if (!token) break;
    tokens.push({ type: token[0], text: token[1], start: token[2] });
  }
  return tokens;
}

/** The stylesheet's top-level rules and at-rules. */
export function parseCss(text: string): CssNode[] {
  return parseCssText(text).nodes;
}

/** The stylesheet's top-level rules and at-rules, or the problem that stops PostCSS reading it. */
export function parseCssText(text: string): {
  readonly nodes: CssNode[];
  readonly problems: readonly CssProblem[];
} {
  try {
    const root = postcss.parse(text);
    const read = (node: ChildNode) => toNode(node, text);
    return { nodes: root.nodes.flatMap(read), problems: [] };
  } catch (error) {
    if (!(error instanceof CssSyntaxError)) throw error;
    return {
      nodes: [],
      problems: [
        { at: { line: error.line ?? 1, column: error.column ?? 1 }, message: error.reason },
      ],
    };
  }
}

function positionOf(node: ChildNode): Position {
  return { line: node.source?.start?.line ?? 1, column: node.source?.start?.column ?? 1 };
}

function toNode(node: ChildNode, text: string): CssNode[] {
  switch (node.type) {
    case 'rule':
      return [
        {
          type: 'rule',
          selector: node.selector,
          ...(node.source?.start?.offset === undefined
            ? {}
            : { rawSelector: headAt(text, node.source.start.offset, false) }),
          at: positionOf(node),
          children: node.nodes.flatMap((child) => toNode(child, text)),
        },
      ];
    case 'atrule':
      return [
        {
          type: 'at-rule',
          name: `@${node.name.toLowerCase()}`,
          prelude: node.params,
          ...(node.source?.start?.offset === undefined
            ? {}
            : { rawPrelude: headAt(text, node.source.start.offset, true) }),
          at: positionOf(node),
          ...(node.nodes === undefined
            ? {}
            : { children: node.nodes.flatMap((child) => toNode(child, text)) }),
        },
      ];
    case 'decl':
      return [
        {
          type: 'declaration',
          property: node.prop.toLowerCase(),
          value: node.value.trim(),
          at: positionOf(node),
          ...(node.important ? { important: true } : {}),
          ...(node.source?.start?.offset === undefined
            ? {}
            : { start: node.source.start.offset, end: node.source.end?.offset }),
        },
      ];
    default:
      return [];
  }
}

/**
 * The head of the rule or at-rule starting at `offset`, up to its `{`, `;`, or `}`, as
 * PostCSS's tokens read it: a rule's selector, or an at-rule's prelude past its name. PostCSS
 * keeps neither as written: a comment next to a space leaves `selector`, and one after an
 * at-rule's name leaves `params`.
 */
function headAt(text: string, offset: number, pastName: boolean): string {
  const read = tokenizer(new Input(text.slice(offset)), { ignoreErrors: true });
  let head = '';
  let first = true;
  while (!read.endOfFile()) {
    const token: Token | undefined = read.nextToken({ ignoreUnclosed: true });
    if (!token || token[0] === '{' || token[0] === ';' || token[0] === '}') break;
    if (!(first && pastName)) head += token[1];
    first = false;
  }
  return head;
}

/** A selector list's selectors, split at its top-level commas. */
export function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let index = 0; index < list.length; index++) {
    const char = list[index]!;
    if (char === '"' || char === "'") {
      let end = index + 1;
      while (end < list.length && list[end] !== char) end += list[end] === '\\' ? 2 : 1;
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
