import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots, snapshotBoundary, type ParityNode } from './parity';

// Render parity's comparator (#5, Slice 6). snapshotBoundary() runs in a
// page; tests/variants/parity.spec.ts runs it on every render. Here it reads
// a small stand-in for a DOM.

const page: ParityNode = {
  tag: 'div',
  children: [
    {
      tag: 'main',
      id: 'main',
      children: [
        { tag: 'h1', children: ['Rowan Vale'] },
        { tag: 'a', href: '#about', children: ['About'] },
        { tag: 'ul', role: 'list', children: [{ tag: 'li', children: ['One'] }] },
      ],
    },
  ],
};

/** `page`, with `change` made to a copy. */
function changed(change: (copy: { children: ParityNode[] }) => void): ParityNode {
  const copy = structuredClone(page) as never;
  change(copy);
  return copy;
}

test('two renders of the same page match', () => {
  assert.deepEqual(compareSnapshots(page, structuredClone(page)), []);
  assert.deepEqual(compareSnapshots(null, null), []);
});

test('each difference names its element, what differs, and both sides', () => {
  const main = (copy: { children: ParityNode[] }) =>
    copy.children[0] as unknown as { children: Record<string, unknown>[] };
  assert.deepEqual(
    compareSnapshots(
      page,
      changed((copy) => {
        main(copy).children[0]!.children = ['Rowan V.'];
      }),
    ),
    [
      {
        path: 'div > main#main > h1',
        what: 'text',
        expected: '"Rowan Vale"',
        actual: '"Rowan V."',
      },
    ],
  );
  assert.deepEqual(
    compareSnapshots(
      page,
      changed((copy) => {
        main(copy).children[1]!.href = '/about';
      }),
    ),
    [{ path: 'div > main#main > a', what: 'href', expected: '#about', actual: '/about' }],
  );
  assert.deepEqual(
    compareSnapshots(
      page,
      changed((copy) => {
        delete main(copy).children[2]!.role;
      }),
    ),
    [{ path: 'div > main#main > ul', what: 'role', expected: 'list', actual: '(none)' }],
  );
  assert.deepEqual(
    compareSnapshots(
      page,
      changed((copy) => {
        main(copy).children[0]!.tag = 'h2';
      }),
    ),
    [{ path: 'div > main#main > h1', what: 'tag', expected: 'h1', actual: 'h2' }],
  );
  assert.deepEqual(
    compareSnapshots(
      page,
      changed((copy) => {
        main(copy).children.pop();
      }),
    ),
    [{ path: 'div > main#main', what: 'children', expected: '<ul>', actual: '(nothing)' }],
  );
  assert.deepEqual(compareSnapshots(page, null), [
    { path: '', what: 'children', expected: '<div>', actual: '(no boundary)' },
  ]);
});

test('it stops at the limit', () => {
  const wide = (text: string): ParityNode => ({
    tag: 'ul',
    children: Array.from({ length: 30 }, (_, index) => ({
      tag: 'li',
      children: [`${text}${index}`],
    })),
  });
  assert.equal(compareSnapshots(wide('a'), wide('b')).length, 20);
  assert.equal(compareSnapshots(wide('a'), wide('b'), 5).length, 5);
});

/** A tiny DOM: enough of Element and Text for snapshotBoundary(). */
function element(tag: string, attributes: Record<string, string>, children: unknown[]): unknown {
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    getAttribute: (name: string) => (name in attributes ? attributes[name] : null),
    childNodes: children,
    querySelector: () => null,
  };
}
const text = (value: string) => ({ nodeType: 3, textContent: value });
const comment = { nodeType: 8, textContent: ' ' };

test('snapshotBoundary reads tags, ids, links, roles, and joined text, and skips what React and Next add', () => {
  const boundary = element('DIV', { 'data-variant': 'fallback' }, [
    element('MAIN', { id: 'main', class: 'x' }, [
      element('H1', {}, [text('Rowan'), comment, text('  Vale ')]),
      element('A', { href: '#about', 'aria-label': 'About' }, [text('About')]),
      element('SCRIPT', {}, [text('self.__next_f.push([1])')]),
      element('TEMPLATE', {}, []),
      element('UL', { role: 'list' }, [text('\n  '), element('LI', {}, [text('One')])]),
    ]),
  ]);
  const root = {
    querySelector: (selector: string) => (selector === '[data-variant]' ? boundary : null),
  };
  assert.deepEqual(snapshotBoundary(root as never), page);
  assert.equal(snapshotBoundary({ querySelector: () => null } as never), null);
});
