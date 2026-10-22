// Render parity (#5, Slice 6): one render input renders one page, through
// the host's server, through react-dom/server outside Next, and through a
// browser's createRoot. snapshotBoundary() reads the presentation boundary's
// subtree as the tags, text, roles, links, and ids a visitor and an
// assistive technology meet, and compareSnapshots() says where two differ.
// #7's preview frame and #11's quality gates compare their renders with the
// same two functions.

/** An element of the boundary's subtree, as parity compares it. */
export interface ParityNode {
  readonly tag: string;
  readonly id?: string;
  readonly href?: string;
  readonly role?: string;
  /** Elements, and text: adjacent text joined, with every run of whitespace one space. */
  readonly children: readonly (ParityNode | string)[];
}

/**
 * The subtree of the first `[data-variant]` element under `root`, or null
 * when there's none. It runs in a page, so it reads nothing from outside its
 * own body: pass it to page.evaluate() with no argument for the page's own
 * document, or evaluate its source against a parsed one. Comments, scripts,
 * styles, and templates drop out, since React and Next place their own.
 */
export function snapshotBoundary(root: ParentNode = document): ParityNode | null {
  const boundary = root.querySelector('[data-variant]');
  if (!boundary) return null;
  const skipped = new Set(['script', 'style', 'template', 'noscript']);
  const read = (element: Element): ParityNode => {
    const children: (ParityNode | string)[] = [];
    let text = '';
    const flush = () => {
      const joined = text.replace(/\s+/g, ' ').trim();
      if (joined !== '') children.push(joined);
      text = '';
    };
    for (const child of Array.from(element.childNodes)) {
      // 3 is a text node, 1 an element: Node.TEXT_NODE and Node.ELEMENT_NODE.
      if (child.nodeType === 3) {
        text += child.textContent ?? '';
      } else if (child.nodeType === 1) {
        const tag = (child as Element).tagName.toLowerCase();
        if (skipped.has(tag)) continue;
        flush();
        children.push(read(child as Element));
      }
    }
    flush();
    const node: { -readonly [K in keyof ParityNode]: ParityNode[K] } = {
      tag: element.tagName.toLowerCase(),
      children,
    };
    for (const name of ['id', 'href', 'role'] as const) {
      const value = element.getAttribute(name);
      if (value !== null) node[name] = value;
    }
    return node;
  };
  return read(boundary);
}

/** Where two snapshots differ. */
export interface ParityDifference {
  /** The element, as a CSS-like path from the boundary, such as `div > main#main > section#about`. */
  readonly path: string;
  /** What differs: the tag, an attribute, the text, or the number of children. */
  readonly what: 'tag' | 'id' | 'href' | 'role' | 'text' | 'children';
  readonly expected: string;
  readonly actual: string;
}

function label(node: ParityNode): string {
  return node.id === undefined ? node.tag : `${node.tag}#${node.id}`;
}

function describe(child: ParityNode | string | undefined): string {
  if (child === undefined) return '(nothing)';
  if (typeof child === 'string') return JSON.stringify(child);
  return `<${label(child)}>`;
}

/**
 * Every difference between `expected` and `actual`, the first `limit` of
 * them, in document order. An empty list means the renders match.
 */
export function compareSnapshots(
  expected: ParityNode | null,
  actual: ParityNode | null,
  limit = 20,
): ParityDifference[] {
  const found: ParityDifference[] = [];
  if (expected === null || actual === null) {
    if (expected !== actual) {
      found.push({
        path: '',
        what: 'children',
        expected: expected === null ? '(no boundary)' : `<${label(expected)}>`,
        actual: actual === null ? '(no boundary)' : `<${label(actual)}>`,
      });
    }
    return found;
  }
  const walk = (a: ParityNode, b: ParityNode, parent: string) => {
    const path = parent === '' ? label(a) : `${parent} > ${label(a)}`;
    const add = (what: ParityDifference['what'], left: string, right: string) => {
      if (found.length < limit) found.push({ path, what, expected: left, actual: right });
    };
    if (a.tag !== b.tag) {
      add('tag', a.tag, b.tag);
      return;
    }
    for (const name of ['id', 'href', 'role'] as const) {
      if (a[name] !== b[name]) add(name, a[name] ?? '(none)', b[name] ?? '(none)');
    }
    const count = Math.max(a.children.length, b.children.length);
    for (let index = 0; index < count && found.length < limit; index++) {
      const left = a.children[index];
      const right = b.children[index];
      if (typeof left === 'object' && typeof right === 'object') {
        walk(left, right, path);
      } else if (left !== right) {
        add(
          typeof left === 'string' && typeof right === 'string' ? 'text' : 'children',
          describe(left),
          describe(right),
        );
      }
    }
  };
  walk(expected, actual, '');
  return found;
}
