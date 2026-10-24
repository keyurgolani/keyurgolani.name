import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCsp, demoPagePath } from './demo-headers';
import { studioCsp } from './studio-headers';

// The demo deployment's policy (#9, Slice 1 item 6): Studio's nonce policy
// with worker-src 'self' and form-action 'none', framed only on /sample.

const NONCE = 'MVlEoQyHU2PoMq1Imu8oSA==';

const directives = (policy: string) =>
  new Map(
    policy.split('; ').map((directive) => {
      const [name, ...values] = directive.split(' ');
      return [name!, values.join(' ')];
    }),
  );

test("the demo policy is Studio's, plus worker-src 'self', with form-action 'none' and the framing it's given", () => {
  const studio = directives(studioCsp(NONCE, 'production'));
  for (const framing of ["'self'", "'none'"] as const) {
    const demo = directives(demoCsp(NONCE, 'production', framing));
    assert.equal(demo.get('worker-src'), "'self'");
    assert.equal(demo.get('form-action'), "'none'");
    assert.equal(demo.get('frame-ancestors'), framing);
    for (const [name, value] of studio) {
      if (name === 'form-action' || name === 'frame-ancestors') continue;
      assert.equal(demo.get(name), value, name);
    }
    assert.deepEqual(
      [...demo.keys()].filter((name) => !studio.has(name)),
      ['worker-src'],
    );
  }
});

test("only a development build's policy lets React evaluate, and no script source is inline", () => {
  assert.doesNotMatch(demoCsp(NONCE, 'production', "'none'"), /unsafe-eval/);
  assert.match(demoCsp(NONCE, 'development', "'none'"), /'strict-dynamic' 'unsafe-eval'/);
  const scripts = directives(demoCsp(NONCE, 'production', "'self'")).get('script-src');
  assert.equal(scripts, `'self' 'nonce-${NONCE}' 'strict-dynamic'`);
});

test('the showroom is / alone, and /sample is it and every path below it, read percent-decoded', () => {
  assert.equal(demoPagePath('/'), 'showroom');
  for (const path of [
    '/sample',
    '/sample/',
    '/sample/chapters/about',
    '/%73ample',
    '/sample%2Fx',
  ]) {
    assert.equal(demoPagePath(path), 'sample', path);
  }
  for (const path of ['/samples', '/x/sample', '/Sample', '/studio', '/%', '//', '/index']) {
    assert.equal(demoPagePath(path), null, path);
  }
});

test('/reference is it and every path below it, its renditions included, read percent-decoded (#9)', () => {
  for (const path of [
    '/reference',
    '/reference/',
    '/reference/work/tide-tables',
    '/reference/media/cover/abc/w480-a1.webp',
    '/%72eference',
    '/reference%2Fx',
  ]) {
    assert.equal(demoPagePath(path), 'reference', path);
  }
  for (const path of ['/references', '/x/reference', '/Reference', '/sample/reference']) {
    assert.notEqual(demoPagePath(path), 'reference', path);
  }
});
