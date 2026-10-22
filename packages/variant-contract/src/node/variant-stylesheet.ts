// A variant's compiled stylesheet (#6, Slice 2, item 2): its ./styles.css
// export, after the stylesheets every variant starts from, such as the kit's
// shared renderers' layout, as one file. Registry generation writes it to
// the host's gitignored public/_portfolio/variant/ by content hash, and the
// host links it on a page that renders the variant and on no other.
//
// - It starts with #19's layer-order statement, and every rule goes inside
//   one cascade layer, variant-layout, so the order stylesheets load in
//   can't change which rule wins.
// - An @import of the package's own file, by relative path, is inlined in
//   place, inside @media when it has a media query. A remote one is hoisted
//   into the same layer and left for `pnpm check:variants` and #6's budget
//   check to report. Any other @import can't be served, so it's a problem.
// - Each url() target in the package, an image, is copied to
//   /_portfolio/asset/ by content hash, and the url() names the copy.
//   data:, fragment, root-relative, and remote URLs stay as they are.
//
// Nothing here throws for a stylesheet's sake: what can't compile is a
// problem naming the file, line, and column.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Where the host serves compiled variant stylesheets from: public/_portfolio/variant/. */
export const VARIANT_URL = '/_portfolio/variant/';
/** Where the host serves the files their url()s name: public/_portfolio/asset/. */
export const ASSET_URL = '/_portfolio/asset/';

/** The file types a variant stylesheet's url() may name in its package: images. */
export const ASSET_EXTENSIONS = ['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'] as const;

/** How deep relative @imports may nest. */
const MAX_IMPORT_DEPTH = 8;

/** A file registry generation writes where the host serves it, named by its content. */
export interface ServedFile {
  /** Its name in its directory, such as fallback.<sha256-12>.css. */
  readonly name: string;
  /** Where the host serves it, such as /_portfolio/variant/fallback.<sha256-12>.css. */
  readonly url: string;
  /** The hex SHA-256 of its bytes. */
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

/** A stylesheet, and the package it ships in, which every file it reaches must stay inside. */
export interface StylesheetSource {
  /** The package's directory. */
  readonly dir: string;
  /** The stylesheet. */
  readonly file: string;
}

export interface VariantStylesheetOptions {
  /** The variant's id, which names the compiled file. */
  readonly id: string;
  /** The stylesheet its ./styles.css export names. */
  readonly source: StylesheetSource;
  /** What every variant's stylesheet starts with, inside the same layer, in this order. */
  readonly shared?: readonly StylesheetSource[];
  /** The statement the file starts with: #19's LAYER_ORDER. */
  readonly layerOrder: string;
  /** The layer every rule goes in: variant-layout. */
  readonly layer: string;
}

/** Why a stylesheet can't compile, at a place in one of its files. */
export interface StylesheetProblem {
  /** The file, as an absolute path. */
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly remedy: string;
}

export type VariantStylesheet =
  | {
      readonly ok: true;
      readonly stylesheet: ServedFile;
      /** The files its url()s name, sorted by name. */
      readonly assets: readonly ServedFile[];
      /** Every file compilation read, as real paths, sorted: what a watcher watches. */
      readonly inputs: readonly string[];
    }
  | { readonly ok: false; readonly problems: readonly StylesheetProblem[] };

const REMOTE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** The functions whose plain string arguments are URLs, beside url(). */
const URL_STRING_FUNCTIONS = new Set(['image-set', '-webkit-image-set', 'src']);

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The compiled stylesheet for `options`, or every problem in the way of one. */
export function compileVariantStylesheet(options: VariantStylesheetOptions): VariantStylesheet {
  const state: CompileState = {
    problems: [],
    assets: new Map(),
    inputs: new Set(),
    remote: [],
    layer: options.layer,
  };
  const bodies: string[] = [];
  for (const source of [...(options.shared ?? []), options.source]) {
    let root: string;
    try {
      root = fs.realpathSync(source.dir);
    } catch {
      state.problems.push({
        file: source.file,
        line: 1,
        column: 1,
        message: `is in ${source.dir}, which can't be read.`,
        remedy: 'Reinstall the package.',
      });
      continue;
    }
    const body = compileFile(source.file, root, [], state, null);
    if (body !== null) bodies.push(body);
  }
  if (state.problems.length > 0) return { ok: false, problems: state.problems };
  const text = tidy(
    [
      options.layerOrder,
      ...state.remote,
      `@layer ${options.layer} {`,
      ...bodies.map((body) => body.trim()),
      '}',
      '',
    ].join('\n'),
  );
  const bytes = new TextEncoder().encode(text);
  const hash = sha256(bytes);
  const name = `${options.id}.${hash.slice(0, 12)}.css`;
  return {
    ok: true,
    stylesheet: { name, url: `${VARIANT_URL}${name}`, sha256: hash, bytes },
    assets: [...state.assets.values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
    inputs: [...state.inputs].sort(),
  };
}

interface CompileState {
  readonly problems: StylesheetProblem[];
  readonly assets: Map<string, ServedFile>;
  readonly inputs: Set<string>;
  /** Hoisted remote @imports, in the order they appear. */
  readonly remote: string[];
  readonly layer: string;
}

/** Where an @import named the file, for a problem in reaching it. */
interface ImportSite {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/**
 * One stylesheet's text with its relative @imports inlined and its url()s
 * rewritten, or null when a problem stops it. `chain` holds the files that
 * import it, outermost first.
 */
function compileFile(
  file: string,
  root: string,
  chain: readonly string[],
  state: CompileState,
  site: ImportSite | null,
): string | null {
  const at = site ?? { file, line: 1, column: 1 };
  let real: string;
  try {
    real = fs.realpathSync(file);
  } catch {
    state.problems.push({
      ...at,
      message: `${site ? 'imports' : 'names'} ${path.basename(file)}, which the package doesn't have.`,
      remedy: 'Ship the file in the package, or remove the reference.',
    });
    return null;
  }
  if (!within(root, real)) {
    state.problems.push({
      ...at,
      message: `reaches ${path.basename(file)}, which is outside the package.`,
      remedy: 'Keep every stylesheet in the package it ships in.',
    });
    return null;
  }
  if (chain.includes(real)) {
    state.problems.push({
      ...at,
      message: `imports ${path.basename(file)}, which imports it back.`,
      remedy: 'Break the @import cycle.',
    });
    return null;
  }
  if (chain.length >= MAX_IMPORT_DEPTH) {
    state.problems.push({
      ...at,
      message: `nests @import more than ${MAX_IMPORT_DEPTH} deep.`,
      remedy: 'Import fewer files inside each other.',
    });
    return null;
  }
  let text: string;
  try {
    text = fs.readFileSync(real, 'utf8');
  } catch {
    state.problems.push({
      ...at,
      message: `reaches ${path.basename(file)}, which can't be read.`,
      remedy: 'Ship a readable file.',
    });
    return null;
  }
  state.inputs.add(real);

  const source = stripComments(text);
  const position = positions(source);
  const problem = (offset: number, message: string, remedy: string) => {
    state.problems.push({ file: real, ...position(offset), message, remedy });
  };
  const out: string[] = [];
  let seenRule = false;
  let failed = false;
  for (const statement of topLevelStatements(source)) {
    if (statement.unbalanced) {
      problem(
        statement.start,
        statement.unbalanced === 'close'
          ? 'has a } with no { before it.'
          : 'has a { the file never closes.',
        'Balance the braces, so every rule stays inside the layer.',
      );
      failed = true;
      continue;
    }
    const name = statement.atName?.toLowerCase();
    if (name === '@charset') continue;
    if (name !== '@import') {
      // A @layer statement may come before an @import; any other rule may not.
      if (!(name === '@layer' && !statement.block)) seenRule = true;
      const rewritten = rewriteUrls(statement.text, statement.start, real, root, state, problem);
      if (rewritten === null) failed = true;
      else out.push(rewritten);
      continue;
    }
    if (seenRule) {
      problem(
        statement.start,
        'has an @import after a rule, which a browser ignores.',
        'Move every @import to the top of the file.',
      );
      failed = true;
      continue;
    }
    const parsed = parseImport(statement.prelude ?? '');
    if (!parsed) {
      problem(
        statement.start,
        "has an @import whose URL can't be read.",
        'Name the file in quotes.',
      );
      failed = true;
      continue;
    }
    const { target, conditions } = parsed;
    const hasLayer = /(?:^|\s)layer(?:\(|\s|$)/i.test(conditions);
    if (REMOTE.test(target)) {
      if (hasLayer) {
        problem(
          statement.start,
          `imports ${target} into a layer of its own, and every rule goes in ${state.layer}.`,
          'Drop the layer from the @import.',
        );
        failed = true;
        continue;
      }
      state.remote.push(
        `@import url(${quote(target)}) layer(${state.layer})${conditions ? ` ${conditions}` : ''};`,
      );
      continue;
    }
    if (!target.startsWith('./') && !target.startsWith('../')) {
      problem(
        statement.start,
        `imports ${target}, which isn't a file in the package by relative path.`,
        "Import only the package's own stylesheets, as ./file.css.",
      );
      failed = true;
      continue;
    }
    if (hasLayer || /(?:^|\s)supports\(/i.test(conditions)) {
      problem(
        statement.start,
        `imports ${target} with a layer() or supports() condition, which the compiled file can't keep.`,
        'Import it plainly, or with a media query, and put any @supports in the file itself.',
      );
      failed = true;
      continue;
    }
    let decoded: string;
    try {
      decoded = decodeURI(target);
    } catch {
      problem(statement.start, `imports ${target}, which doesn't decode.`, 'Fix the path.');
      failed = true;
      continue;
    }
    const inlined = compileFile(
      path.resolve(path.dirname(real), decoded),
      root,
      [...chain, real],
      state,
      { file: real, ...position(statement.start) },
    );
    if (inlined === null) {
      failed = true;
      continue;
    }
    out.push(conditions ? `@media ${conditions} {\n${inlined.trim()}\n}` : inlined.trim());
  }
  return failed ? null : out.join('\n');
}

/** Whether `file` is inside `root`, both real paths. */
function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** A CSS string for `value`, in double quotes. */
function quote(value: string): string {
  return `"${value.replace(/["\\\n\r\f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `)}"`;
}

/** Trailing whitespace off every line, and no blank ones, such as a comment leaves. */
function tidy(text: string): string {
  return text.replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n');
}

/** The offset of the quote that closes the string opening at `from`, or the text's end. */
function skipString(text: string, from: number): number {
  const quoteChar = text[from];
  for (let index = from + 1; index < text.length; index++) {
    const char = text[index];
    if (char === '\\') index++;
    else if (char === quoteChar || char === '\n') return index;
  }
  return text.length;
}

/** Comments become spaces, so offsets, lines, and columns stay where they were. Strings keep theirs. */
export function stripComments(text: string): string {
  let out = '';
  for (let index = 0; index < text.length;) {
    const char = text[index]!;
    if (char === '"' || char === "'") {
      const end = Math.min(skipString(text, index) + 1, text.length);
      out += text.slice(index, end);
      index = end;
    } else if (char === '\\') {
      out += text.slice(index, index + 2);
      index += 2;
    } else if (char === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2);
      const end = close < 0 ? text.length : close + 2;
      out += text.slice(index, end).replace(/[^\n]/g, ' ');
      index = end;
    } else {
      out += char;
      index++;
    }
  }
  return out;
}

/** An offset's line and column, both from 1. */
function positions(text: string): (offset: number) => { line: number; column: number } {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - starts[low]! + 1 };
  };
}

interface Statement {
  /** Its text, through its `;` or its block's `}`. */
  readonly text: string;
  readonly start: number;
  /** Its at-keyword, such as @import, when it's an at-rule. */
  readonly atName?: string;
  /** What follows the at-keyword, up to its `;` or block. */
  readonly prelude?: string;
  /** Whether it has a block. */
  readonly block: boolean;
  /** A `}` with no `{` before it, or a `{` the file never closes: either would move rules out of the layer. */
  readonly unbalanced?: 'close' | 'open';
}

/** The stylesheet's top-level statements, each a rule or an at-rule. */
function topLevelStatements(source: string): Statement[] {
  const found: Statement[] = [];
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index]!)) index++;
    if (index >= source.length) break;
    const start = index;
    let depth = 0;
    let parens = 0;
    let preludeEnd = -1;
    let block = false;
    for (; index < source.length; index++) {
      const char = source[index]!;
      if (char === '"' || char === "'") {
        index = skipString(source, index);
      } else if (char === '\\') {
        index++;
      } else if (char === '(') {
        parens++;
      } else if (char === ')') {
        parens = Math.max(0, parens - 1);
      } else if (parens === 0 && char === '{') {
        if (depth === 0 && preludeEnd < 0) preludeEnd = index;
        depth++;
        block = true;
      } else if (parens === 0 && char === '}') {
        depth--;
        if (depth <= 0) {
          index++;
          break;
        }
      } else if (parens === 0 && depth === 0 && char === ';') {
        preludeEnd = index;
        index++;
        break;
      }
    }
    const text = source.slice(start, index);
    const keyword = /^@[a-zA-Z-]+/.exec(text)?.[0];
    const unbalanced = depth < 0 ? 'close' : depth > 0 ? 'open' : undefined;
    found.push({
      text,
      start,
      block,
      ...(unbalanced ? { unbalanced } : {}),
      ...(keyword
        ? {
            atName: keyword,
            prelude: source.slice(start + keyword.length, preludeEnd < 0 ? index : preludeEnd),
          }
        : {}),
    });
  }
  return found;
}

/** An @import's URL and what follows it: its layer, supports, and media conditions. */
function parseImport(prelude: string): { target: string; conditions: string } | null {
  const trimmed = prelude.trim();
  const url = /^url\(\s*(?:(["'])((?:\\.|(?!\1).)*)\1|([^"')\s]*))\s*\)/i.exec(trimmed);
  if (url) {
    return {
      target: unescape(url[2] ?? url[3] ?? '').trim(),
      conditions: trimmed.slice(url[0].length).trim(),
    };
  }
  const string = /^(["'])((?:\\.|(?!\1).)*)\1/.exec(trimmed);
  if (string) {
    return { target: unescape(string[2]!), conditions: trimmed.slice(string[0].length).trim() };
  }
  return null;
}

/** A CSS string's text with its escapes undone. */
function unescape(value: string): string {
  return value.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|(.))/gs, (_match, hex: string, char: string) =>
    hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : char === '\n' ? '' : char,
  );
}

/**
 * `text` with each url() target in the package, and each plain string an
 * image-set() or src() names, pointing at its copy under /_portfolio/asset/.
 * Null when a target can't be copied.
 */
function rewriteUrls(
  text: string,
  offset: number,
  file: string,
  root: string,
  state: CompileState,
  problem: (offset: number, message: string, remedy: string) => void,
): string | null {
  let out = '';
  let failed = false;
  const functions: string[] = [];
  const replace = (raw: string, at: number): string | null => {
    const url = raw.trim();
    if (url === '' || url.startsWith('#') || url.startsWith('/') || SCHEME.test(url)) return null;
    if (REMOTE.test(url)) return null;
    const [, filePart = '', suffix = ''] = /^([^?#]*)(.*)$/s.exec(url) ?? [];
    let decoded: string;
    try {
      decoded = decodeURI(filePart);
    } catch {
      problem(at, `names ${url}, which doesn't decode.`, 'Fix the path.');
      failed = true;
      return null;
    }
    const target = path.resolve(path.dirname(file), decoded);
    let real: string;
    try {
      real = fs.realpathSync(target);
    } catch {
      problem(
        at,
        `names ${url}, which the package doesn't have.`,
        'Ship the file, or remove the url().',
      );
      failed = true;
      return null;
    }
    if (!within(root, real) || !fs.statSync(real).isFile()) {
      problem(
        at,
        `names ${url}, which isn't a file in the package.`,
        'Name a file the package ships, by a path relative to the stylesheet.',
      );
      failed = true;
      return null;
    }
    const extension = path.extname(real).slice(1).toLowerCase();
    if (!(ASSET_EXTENSIONS as readonly string[]).includes(extension)) {
      problem(
        at,
        `names ${url}, and a variant's stylesheet ships only images: ${ASSET_EXTENSIONS.join(', ')}.`,
        'Name an image, or leave the file out of the stylesheet.',
      );
      failed = true;
      return null;
    }
    const bytes = new Uint8Array(fs.readFileSync(real));
    const hash = sha256(bytes);
    const name = `${hash.slice(0, 12)}.${extension}`;
    state.inputs.add(real);
    state.assets.set(name, { name, url: `${ASSET_URL}${name}`, sha256: hash, bytes });
    return `${ASSET_URL}${name}${suffix}`;
  };

  for (let index = 0; index < text.length;) {
    const char = text[index]!;
    if (char === '"' || char === "'") {
      const end = Math.min(skipString(text, index) + 1, text.length);
      const literal = text.slice(index, end);
      const inUrlFunction = URL_STRING_FUNCTIONS.has(functions.at(-1) ?? '');
      const rewritten = inUrlFunction
        ? replace(unescape(literal.slice(1, -1)), offset + index)
        : null;
      out += rewritten === null ? literal : quote(rewritten);
      index = end;
      continue;
    }
    if (char === '\\') {
      out += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    const word = /^-?[a-zA-Z_][a-zA-Z0-9_-]*\(/.exec(text.slice(index, index + 64));
    const boundary = index === 0 || !/[a-zA-Z0-9_-]/.test(text[index - 1]!);
    if (word && boundary) {
      const name = word[0].slice(0, -1).toLowerCase();
      if (name === 'url') {
        const url = /^url\(\s*(?:(["'])((?:\\.|(?!\1).)*)\1|([^"')\s]*))\s*\)/i.exec(
          text.slice(index),
        );
        if (url) {
          const raw = url[2] !== undefined ? unescape(url[2]) : (url[3] ?? '');
          const rewritten = replace(raw, offset + index);
          out += rewritten === null ? url[0] : `url(${quote(rewritten)})`;
          index += url[0].length;
          continue;
        }
      }
      functions.push(name);
      out += word[0];
      index += word[0].length;
      continue;
    }
    if (char === '(') functions.push('');
    else if (char === ')') functions.pop();
    out += char;
    index++;
  }
  return failed ? null : out;
}
