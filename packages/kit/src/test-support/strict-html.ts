// For tests: a strict reader of the markup the markdown renderer writes. It
// accepts only the exact shapes the renderer writes (lowercase tags, one
// space and a double-quoted value per attribute, no comments or other
// markup, and no raw <, >, quote, NUL, or unreferenced & in text) and
// reports anything else. Every element must be on the allowlist and somewhere
// a browser's parser keeps it as written (no p in an em, no li outside a list,
// no a inside an a), so the tree read here is the tree a browser builds. The
// one attribute is href on a. Its value must pass #4's link rule, and the URL
// a browser resolves it to must be https, http, mailto, or tel, or, for a
// reference without a scheme, stay on the page's own origin.

import { isAllowedUrl } from '@portfolio/schema';

export type Allowlist = 'block' | 'inline';

const PHRASING = new Set(['a', 'em', 'strong', 'code', 'br']);
const BLOCKS = new Set(['p', 'pre', 'ul', 'ol', 'blockquote', 'h3', 'h4', 'h5', 'h6', 'hr']);
const ALLOWED: Record<Allowlist, ReadonlySet<string>> = {
  inline: PHRASING,
  block: new Set([...PHRASING, ...BLOCKS, 'li']),
};

/**
 * What an element holds: phrasing (text and inline elements), flow (that and
 * blocks), blocks (whitespace and blocks), items (whitespace and li), code
 * (one code element), text, or nothing.
 */
type Content = 'phrasing' | 'flow' | 'blocks' | 'items' | 'code' | 'text' | 'void';
const CONTENT: Record<string, Content> = {
  a: 'phrasing',
  em: 'phrasing',
  strong: 'phrasing',
  code: 'text',
  br: 'void',
  p: 'phrasing',
  h3: 'phrasing',
  h4: 'phrasing',
  h5: 'phrasing',
  h6: 'phrasing',
  pre: 'code',
  ul: 'items',
  ol: 'items',
  li: 'flow',
  blockquote: 'blocks',
  hr: 'void',
};

function holds(content: Content, child: string): boolean {
  switch (content) {
    case 'phrasing':
      return PHRASING.has(child);
    case 'flow':
      return PHRASING.has(child) || BLOCKS.has(child);
    case 'blocks':
      return BLOCKS.has(child);
    case 'items':
      return child === 'li';
    case 'code':
      return child === 'code';
    default:
      return false;
  }
}

const START = /<([a-z][a-z0-9]*)((?: [a-z]+="[^"]*")*)>/y;
const END = /<\/([a-z][a-z0-9]*)>/y;
const ATTRIBUTE = / ([a-z]+)="([^"]*)"/g;
const TEXT = /[^<>&"'\0]+/y;
const TEXT_REFERENCE = /&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|\w+);/y;
/** The references the renderer writes in an attribute value, and nothing else. */
const ATTRIBUTE_VALUE = /^(?:[^&<>"']|&(?:amp|lt|gt|quot|#39);)*$/;
const ATTRIBUTE_REFERENCES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};
const ASCII_WHITESPACE = /^[ \t\n\f\r]*$/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const PAGE = new URL('https://site.test/work/page');
const SCHEMES = new Set(['https:', 'http:', 'mailto:', 'tel:']);

interface Open {
  readonly name: string;
  readonly content: Content;
  children: number;
}

/** Each way `html` strays from what the renderer may write under `allowlist`; none when it's clean. */
export function htmlProblems(html: string, allowlist: Allowlist): string[] {
  const problems: string[] = [];
  const root: Open = {
    name: allowlist === 'block' ? 'the block root' : 'the inline root',
    content: allowlist === 'block' ? 'blocks' : 'phrasing',
    children: 0,
  };
  const stack: Open[] = [];
  const current = () => stack.at(-1) ?? root;
  const at = (index: number) => `${JSON.stringify(html.slice(index, index + 40))} at ${index}`;
  let text = '';
  const flushText = (index: number) => {
    if (text === '') return;
    const { content, name } = current();
    const whitespaceOnly = ASCII_WHITESPACE.test(text);
    if (
      content === 'void' ||
      content === 'code' ||
      (!whitespaceOnly && /^(?:blocks|items)$/.test(content))
    ) {
      problems.push(`text inside ${name}: ${at(index - text.length)}`);
    }
    text = '';
  };

  let index = 0;
  while (index < html.length) {
    TEXT.lastIndex = index;
    const run = TEXT.exec(html);
    if (run) {
      text += run[0];
      index += run[0].length;
      continue;
    }
    const char = html[index]!;
    if (char === '&') {
      TEXT_REFERENCE.lastIndex = index;
      const reference = TEXT_REFERENCE.exec(html);
      if (reference) {
        text += reference[0];
        index += reference[0].length;
      } else {
        problems.push(`an & that starts no reference: ${at(index)}`);
        text += char;
        index++;
      }
      continue;
    }
    if (char !== '<') {
      problems.push(`a raw ${JSON.stringify(char)} in text: ${at(index)}`);
      text += char;
      index++;
      continue;
    }
    flushText(index);
    START.lastIndex = index;
    const start = START.exec(html);
    if (start) {
      const name = start[1]!;
      problems.push(...startProblems(name, start[2] ?? '', allowlist, current(), stack));
      current().children++;
      if (CONTENT[name] !== 'void')
        stack.push({ name, content: CONTENT[name] ?? 'flow', children: 0 });
      index += start[0].length;
      continue;
    }
    END.lastIndex = index;
    const end = END.exec(html);
    if (end) {
      const name = end[1]!;
      const open = stack.at(-1);
      if (open?.name !== name) {
        problems.push(`</${name}> closes ${open ? `<${open.name}>` : 'nothing'}: ${at(index)}`);
      } else {
        stack.pop();
        if (name === 'pre' && open.children !== 1)
          problems.push(`<pre> holds ${open.children} elements, not one code`);
      }
      index += end[0].length;
      continue;
    }
    problems.push(`markup the renderer never writes: ${at(index)}`);
    text += char;
    index++;
  }
  flushText(index);
  for (const open of stack.reverse()) problems.push(`<${open.name}> is never closed`);
  return problems;
}

function startProblems(
  name: string,
  attributes: string,
  allowlist: Allowlist,
  parent: Open,
  stack: readonly Open[],
): string[] {
  const problems: string[] = [];
  if (!ALLOWED[allowlist].has(name))
    problems.push(`<${name}> is not on the ${allowlist} allowlist`);
  else if (!holds(parent.content, name)) problems.push(`<${name}> inside ${parent.name}`);
  if (parent.content === 'code' && parent.children > 0) problems.push(`a second element in <pre>`);
  if (name === 'a' && stack.some((open) => open.name === 'a')) problems.push('<a> inside <a>');
  const pairs = [...attributes.matchAll(ATTRIBUTE)].map((match) => [match[1]!, match[2]!] as const);
  if (name !== 'a') {
    for (const [attribute] of pairs) problems.push(`<${name}> has ${attribute}`);
    return problems;
  }
  if (pairs.length !== 1 || pairs[0]![0] !== 'href') {
    problems.push(
      `<a> has ${pairs.map(([attribute]) => attribute).join(', ') || 'no attribute'}, not href alone`,
    );
  }
  for (const [attribute, value] of pairs) {
    if (attribute === 'href') problems.push(...hrefProblems(value));
  }
  return problems;
}

/** What's wrong with an href value as written: its markup, the link rule, and where a browser would go. */
export function hrefProblems(value: string): string[] {
  if (!ATTRIBUTE_VALUE.test(value)) return [`an href with markup or another reference: ${value}`];
  const href = value.replace(
    /&(?:amp|lt|gt|quot|#39);/g,
    (reference) => ATTRIBUTE_REFERENCES[reference]!,
  );
  const problems: string[] = [];
  if (!/^[\x21-\x7e]+$/.test(href))
    problems.push(`an href that isn't printable ASCII: ${JSON.stringify(href)}`);
  if (!isAllowedUrl(href)) problems.push(`an href the link rule refuses: ${JSON.stringify(href)}`);
  return [...problems, ...destinationProblems(href)];
}

/**
 * Where a browser would go from a link to `href`, the URL it reads from the
 * attribute: anywhere but https, http, mailto, or tel, or, for a reference
 * without a scheme, off the page's own origin, is a problem. Only the
 * resolved URL's scheme and origin decide. Node's URL and Chromium's differ
 * on some path details, such as whether %2E inside a segment counts as a
 * dot, and none of those changes the scheme or origin.
 */
export function destinationProblems(href: string): string[] {
  let resolved: URL;
  try {
    resolved = new URL(href, PAGE);
  } catch {
    return [`an href no browser resolves: ${JSON.stringify(href)}`];
  }
  if (SCHEME.test(href) ? !SCHEMES.has(resolved.protocol) : resolved.origin !== PAGE.origin) {
    return [`an href that resolves to ${resolved.href}`];
  }
  return [];
}
