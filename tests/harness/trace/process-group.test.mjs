import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { groupTracker, signalGroup, spawnGroup, stopGroup } from './process-group.mjs';

/** Whether `pid` is gone, waiting up to two seconds for it to go. */
async function gone(pid) {
  for (let tries = 0; tries < 40; tries += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await delay(50);
  }
  return false;
}

/** A shell, leading its own group, that starts a sleep and prints the sleep's pid. */
async function shellWithChild(spawn, script = '') {
  const group = spawn('sh', ['-c', `${script} sleep 30 & echo $!; wait`], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const [line] = await once(group.child.stdout, 'data');
  return { group, grandchild: Number(String(line).trim()) };
}

test('stopping a group stops what its leader started too', async () => {
  const { group, grandchild } = await shellWithChild(spawnGroup);
  assert.doesNotThrow(() => process.kill(grandchild, 0), 'the sleep runs');
  await stopGroup(group, { graceMs: 2000 });
  assert.equal((await group.exited).signal, 'SIGTERM');
  assert.equal(await gone(grandchild), true, 'the sleep went with its shell');
  assert.equal(signalGroup(group.child.pid, 0), false, 'nothing is left in the group');
});

test('a group that ignores SIGTERM gets SIGKILL once the grace period is over', async () => {
  const { group, grandchild } = await shellWithChild(spawnGroup, 'trap "" TERM;');
  const started = Date.now();
  await stopGroup(group, { graceMs: 300 });
  assert.ok(Date.now() - started >= 300, 'it waited the grace period out');
  assert.equal((await group.exited).signal, 'SIGKILL');
  assert.equal(await gone(grandchild), true);
});

test('a group left with only its exited leader, not yet reaped, stops without an error', async () => {
  const group = spawnGroup('sh', ['-c', 'exit 0'], { stdio: 'ignore' });
  // A busy wait, so the event loop can't reap the leader: the group holds
  // nothing but a zombie, which macOS answers EPERM for.
  const until = Date.now() + 300;
  while (Date.now() < until) {
    // waiting
  }
  assert.doesNotThrow(() => signalGroup(group.child.pid, 0));
  assert.doesNotThrow(() => signalGroup(group.child.pid, 'SIGTERM'));
  await stopGroup(group, { graceMs: 1000 });
  assert.equal((await group.exited).code, 0);
});

test('a command that cannot start settles with its error', async () => {
  const group = spawnGroup('/nonexistent/command', []);
  const { error } = await group.exited;
  assert.equal(/** @type {NodeJS.ErrnoException} */ (error).code, 'ENOENT');
  await stopGroup(group);
});

test('teardown stops the step that is running, and nothing starts after it', async () => {
  const groups = groupTracker();
  const { grandchild } = await shellWithChild(groups.spawn);
  const finished = groups.spawn('sh', ['-c', 'exit 0']);
  await finished.exited;
  assert.equal(groups.running, 1, 'only the running step is tracked');
  assert.equal(groups.stopped, false);
  await groups.stopAll({ graceMs: 2000 });
  assert.equal(groups.stopped, true);
  assert.equal(groups.running, 0);
  assert.equal(await gone(grandchild), true, "the running step's child went too");
  assert.throws(() => groups.spawn('sh', ['-c', 'exit 0']), /Stopping: sh does not start\./);
});
