import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAll, currentField, enters, entrance, fragmentId, holdsStill } from './field';

// The field enhancement's decisions, apart from the DOM: which destination
// is current, when the page holds still, how the entrances are timed, and
// how a fragment reads.

test('no destination is current above every field; below, the last one reached', () => {
  const fields = ['work', 'writing', 'record'];
  assert.equal(currentField(fields, new Set()), undefined);
  assert.equal(currentField(fields, new Set(['work'])), 'work');
  assert.equal(currentField(fields, new Set(['work', 'record'])), 'record');
});

test('the page holds still under the visitor’s reduce, the owner’s reduce, or the pause', () => {
  assert.equal(holdsStill(false, undefined), false);
  assert.equal(holdsStill(false, 'full'), false);
  assert.equal(holdsStill(true, 'full'), true);
  assert.equal(holdsStill(false, 'reduced'), true);
  assert.equal(holdsStill(false, 'static'), true);
});

test('entrances fill backwards and spread at most 500 ms across a group (TF-S3)', () => {
  for (const count of [1, 4, 9, 40]) {
    const last = entrance(count - 1, count, 700, 'ease-out');
    assert.equal(last.fill, 'backwards');
    assert.equal(last.duration, 700);
    assert.ok(last.delay <= 500, `${count}: ${last.delay}`);
  }
  assert.equal(entrance(1, 2, 700, 'ease-out').delay, 60);
});

test('what holds focus never plays an entrance: it shows at once, never transparent while focused', () => {
  const child = {};
  const row = { contains: (other: unknown) => other === child };
  assert.equal(enters(row, null), true);
  assert.equal(enters(row, {}), true);
  assert.equal(enters(row, child), false);
});

test('a fragment that isn’t valid percent-encoding reads as written, never throws', () => {
  assert.equal(fragmentId('#talks'), 'talks');
  assert.equal(fragmentId('#%E0%A4%85'), 'अ');
  assert.equal(fragmentId('#%E0%A4%A'), '%E0%A4%A');
  assert.equal(fragmentId(''), '');
});

test('a part that throws strands nothing: the others attach, and the stop undoes each that did', () => {
  const log: string[] = [];
  const part = (name: string) => () => {
    log.push(`on ${name}`);
    return () => log.push(`off ${name}`);
  };
  const reported: unknown[] = [];
  const stop = attachAll(
    [
      part('records'),
      () => {
        throw new URIError('URI malformed');
      },
      part('spy'),
    ],
    (error) => reported.push(error),
  );
  assert.deepEqual(log, ['on records', 'on spy']);
  assert.equal(reported.length, 1);
  assert.ok(reported[0] instanceof URIError);
  stop();
  assert.deepEqual(log, ['on records', 'on spy', 'off records', 'off spy']);
});
