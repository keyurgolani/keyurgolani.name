import test from 'node:test';
import assert from 'node:assert/strict';
import { startOrExit, type ExitIo, type Registration } from './start-or-exit';

// How register() ends the process: it exits 1 only once stdout has taken
// the whole log, gives up on a reader that never drains, and turns any
// error into a refusal rather than a rejection.

interface SlowReader {
  readonly io: ExitIo;
  readonly writes: string[];
  readonly exits: number[];
  /** Lets the reader take everything written so far. */
  drain(): void;
}

/** Stdout whose reader takes nothing until drain(), like a full pipe. */
function slowReader(flushTimeoutMs = 10_000): SlowReader {
  const writes: string[] = [];
  const exits: number[] = [];
  const waiting: Array<() => void> = [];
  return {
    writes,
    exits,
    drain: () => waiting.splice(0).forEach((done) => done()),
    io: {
      write: (text, done) => {
        writes.push(text);
        waiting.push(done);
      },
      exit: (code) => {
        exits.push(code);
      },
      flushTimeoutMs,
    },
  };
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const refusal = (log: string) => (): Registration => ({ ok: false, log });

test('a deployment that can start returns without writing or exiting', async () => {
  const reader = slowReader();
  await startOrExit(() => ({ ok: true }), reader.io);
  assert.deepEqual([reader.writes, reader.exits], [[], []]);
});

test('a refusal exits 1 only once stdout has taken the whole log', async () => {
  const reader = slowReader();
  const log = '{"event":"config.fatal"}\n'.repeat(1000);
  const exiting = startOrExit(refusal(log), reader.io);
  await settle();
  assert.deepEqual(reader.writes, [log]);
  assert.deepEqual(reader.exits, [], 'it exited before stdout took the log');

  reader.drain();
  await exiting;
  assert.deepEqual(reader.exits, [1]);
});

test('a reader that never drains holds the exit for the timeout at most', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reader = slowReader(10_000);
  const exiting = startOrExit(refusal('{"event":"config.fatal"}\n'), reader.io);
  await settle();
  t.mock.timers.tick(9_999);
  await settle();
  assert.deepEqual(reader.exits, []);

  t.mock.timers.tick(1);
  await exiting;
  assert.deepEqual(reader.exits, [1]);
});

test('a write that throws still exits 1', async () => {
  const exits: number[] = [];
  const io: ExitIo = {
    write: () => {
      throw new Error('stdout is gone');
    },
    exit: (code) => {
      exits.push(code);
    },
    flushTimeoutMs: 10_000,
  };
  await startOrExit(refusal('{"event":"config.fatal"}\n'), io);
  assert.deepEqual(exits, [1]);
});

test('an error, such as a module that throws while it loads, exits 1 and names no cause', async () => {
  const failures = [
    () => {
      throw new Error('canary-error at /srv/canary-path');
    },
    () => Promise.reject(new Error('canary-error at /srv/canary-path')),
  ];
  for (const start of failures) {
    const reader = slowReader();
    const exiting = startOrExit(start, reader.io);
    await settle();
    reader.drain();
    await exiting;

    assert.deepEqual(reader.exits, [1]);
    assert.equal(reader.writes.length, 1);
    assert.ok(!reader.writes[0]!.includes('canary'), reader.writes[0]);
    const line = JSON.parse(reader.writes[0]!) as Record<string, unknown>;
    assert.deepEqual(
      [line['level'], line['event'], line['code']],
      ['fatal', 'config.fatal', 'startup_failed'],
    );
  }
});
