import assert from 'node:assert/strict';
import test from 'node:test';
import { namesOver, withNames, type ElementDetails, type NameSession } from './probes';

const link: ElementDetails = { found: true, semanticRole: 'link', accessibleName: 'More1' };

test("a found element takes the tree's name, and one the tree doesn't name keeps axe's", () => {
  assert.deepEqual(withNames([link], ['More 1']), [{ ...link, accessibleName: 'More 1' }]);
  assert.deepEqual(withNames([link], [undefined]), [link]);
  assert.deepEqual(withNames([link], []), [link]);
});

test('an element the details lookup found none of takes no name from the tree', () => {
  assert.deepEqual(withNames([{ found: false }], ['More 1']), [{ found: false }]);
});

/** A stand-in session: `answer` gives each call's reply, and every call is counted. */
function session(answer: (method: string, params: Record<string, unknown>) => Promise<unknown>) {
  const calls: string[] = [];
  const stub: NameSession = {
    send: (method, params) => {
      calls.push(method);
      return answer(method, params);
    },
  };
  return { stub, calls };
}

test('a session that answers names each element it finds, and leaves one it finds none of', async () => {
  const { stub } = session(async (method, params) => {
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelector') return { nodeId: params.selector === '#more' ? 2 : 0 };
    return { nodes: [{ name: { value: 'More 1' } }] };
  });
  const breaker = { off: false };
  assert.deepEqual(await namesOver(stub, ['#more', '#gone'], breaker), ['More 1', undefined]);
  assert.equal(breaker.off, false);
});

test("a page's first timed-out call turns the overlay off: the elements after it, now and in a later read, keep axe's name with no further call", async () => {
  // The document read hangs past the bound.
  const { stub, calls } = session(() => new Promise<never>(() => undefined));
  const breaker = { off: false };
  const many = Array.from({ length: 12 }, (_, index) => `#item-${index}`);
  assert.deepEqual(
    await namesOver(stub, many, breaker, 10),
    many.map(() => undefined),
  );
  assert.equal(breaker.off, true);
  assert.deepEqual(calls, ['DOM.getDocument']);
  assert.deepEqual(await namesOver(stub, ['#later'], breaker, 10), [undefined]);
  assert.deepEqual(calls, ['DOM.getDocument']);
});

test("a session error part way turns it off too: the element it failed on and every one after keep axe's name", async () => {
  const { stub, calls } = session(async (method, params) => {
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelector') {
      if (params.selector === '#second') throw new Error('Protocol error: Target closed');
      return { nodeId: 2 };
    }
    return { nodes: [{ name: { value: 'First link' } }] };
  });
  const breaker = { off: false };
  const names = await namesOver(stub, ['#first', '#second', '#third'], breaker, 10);
  assert.deepEqual(names, ['First link', undefined, undefined]);
  assert.equal(breaker.off, true);
  assert.deepEqual(calls, [
    'DOM.getDocument',
    'DOM.querySelector',
    'Accessibility.getPartialAXTree',
    'DOM.querySelector',
  ]);
});
