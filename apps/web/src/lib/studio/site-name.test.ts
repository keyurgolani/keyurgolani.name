import test from 'node:test';
import assert from 'node:assert/strict';
import { siteName } from './site-name';

const named = (name: unknown) => ({ documents: { portfolio: { model: { identity: { name } } } } });

test("the top bar names the site by its host, or by the portfolio's name where the host is an address", () => {
  assert.equal(siteName('keyurgolani.name', named('Rowan')), 'keyurgolani.name');
  assert.equal(siteName('127.0.0.1', named('Rowan Vale')), 'Rowan Vale');
  assert.equal(siteName('localhost', named('Rowan Vale')), 'Rowan Vale');
  assert.equal(siteName('[::1]', named('Rowan Vale')), 'Rowan Vale');
  assert.equal(siteName('127.0.0.1', named('  ')), '127.0.0.1');
  assert.equal(siteName('127.0.0.1', null), '127.0.0.1');
  assert.equal(siteName('', undefined), '');
});
