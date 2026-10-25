import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HASH_FLOOR, parseHash, verifyPassword } from '../../../packages/core/src/auth/phc.mjs';
import {
  listSessionDigests,
  readRevokedBefore,
  writeSessionFile,
} from '../../../packages/core/src/auth/session-files.mjs';
import { probeDataDirectory } from '../../../packages/core/src/data/layout.mjs';
import { main, readHidden } from './owner.mjs';

// apps/web/bin/owner.mjs (#2). hash-password: the password comes from a
// terminal with echo off, or from two lines of stdin with --stdin, never
// from the arguments, and the output is the PHC string and nothing else.
// revoke-sessions: every session in the data directory ends.

const SCRIPT = fileURLToPath(new URL('./owner.mjs', import.meta.url));
const PASSWORD = 'canary-passphrase-4e1f0b9d';

/**
 * Runs the CLI with `input` on a pipe (or no stdin at all).
 *
 * @param {string[]} args
 * @param {string | null} input
 * @param {Record<string, string | undefined>} [env] added to this process's, without PORTFOLIO_*
 */
function run(args, input, env = {}) {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('PORTFOLIO_')),
  );
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      env: { ...base, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (input !== null) child.stdin.end(input);
  });
}

function tempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'owner-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('--stdin prints only a PHC string at the floor, which verifies the password', async () => {
  const { code, stdout, stderr } = await run(
    ['hash-password', '--stdin'],
    `${PASSWORD}\n${PASSWORD}\n`,
  );
  assert.equal(code, 0, stderr);
  assert.equal(stderr, '');
  assert.match(stdout, /^\$scrypt\$ln=17,r=8,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}\n$/);
  const parsed = parseHash(stdout.trimEnd());
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.hash.params, HASH_FLOOR);
  assert.equal(await verifyPassword(PASSWORD, parsed.hash), true);
});

test('entries that differ, or a password out of length, write nothing and repeat nothing', async () => {
  for (const [input, says] of [
    [`${PASSWORD}\n${PASSWORD}x\n`, /differ/],
    ['too short\ntoo short\n', /15 to 256 characters/],
    [`${'x'.repeat(257)}\n${'x'.repeat(257)}\n`, /15 to 256 characters/],
    [`${PASSWORD}\n`, /differ/],
    [`${PASSWORD}\n${PASSWORD}\nthird\n`, /one per line/],
  ]) {
    const { code, stdout, stderr } = await run(['hash-password', '--stdin'], input);
    assert.equal(code, 1, stderr);
    assert.equal(stdout, '');
    assert.match(stderr, says);
    assert.ok(!stderr.includes(PASSWORD) && !stderr.includes('too short'), stderr);
  }
});

test('without --stdin, input that is not a terminal is refused before anything is read', async () => {
  for (const input of [`${PASSWORD}\n${PASSWORD}\n`, null]) {
    const { code, stdout, stderr } = await run(['hash-password'], input);
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /reads the password from a terminal/);
  }
});

test('a password in the arguments is a usage error, and is never repeated', async () => {
  for (const args of [
    ['hash-password', PASSWORD],
    ['hash-password', '--stdin', PASSWORD],
    [PASSWORD],
    ['hash-password', '--out'],
    [],
  ]) {
    const { code, stdout, stderr } = await run(args, '');
    assert.equal(code, 2, args.join(' '));
    assert.equal(stdout, '');
    assert.ok(!stderr.includes(PASSWORD), stderr);
    assert.match(stderr, /Usage: node apps\/web\/bin\/owner\.mjs hash-password/);
  }
});

test('--out writes the string alone to a new 0400 file, and never over one', async (t) => {
  const dir = tempDir(t);
  const out = path.join(dir, 'owner_password_hash');
  const first = await run(['hash-password', '--stdin', '--out', out], `${PASSWORD}\n${PASSWORD}\n`);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stdout, '');
  const written = readFileSync(out, 'utf8');
  assert.ok(parseHash(written).ok, 'the file is the PHC string with no newline');
  assert.equal(statSync(out).mode & 0o777, 0o400);

  const again = await run(['hash-password', '--stdin', '--out', out], `${PASSWORD}\n${PASSWORD}\n`);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /exists already/);
  assert.equal(readFileSync(out, 'utf8'), written);

  const missing = path.join(dir, 'no-such-dir', 'hash');
  const refused = await run(
    ['hash-password', '--stdin', '--out', missing],
    `${PASSWORD}\n${PASSWORD}\n`,
  );
  assert.equal(refused.code, 1);
  assert.equal(existsSync(missing), false);
});

/** A terminal as readHidden sees one: raw mode, data events, and nothing else. */
function fakeTerminal() {
  const input = Object.assign(new EventEmitter(), {
    isTTY: true,
    modes: /** @type {boolean[]} */ ([]),
    setRawMode(mode) {
      this.modes.push(mode);
      return this;
    },
    setEncoding() {
      return this;
    },
    resume() {
      return this;
    },
    pause() {
      return this;
    },
  });
  const written = /** @type {string[]} */ ([]);
  const output = { write: (text) => written.push(text) };
  return { input, output, written };
}

test('the terminal reader echoes nothing, and takes Backspace and escape sequences', async () => {
  const { input, output, written } = fakeTerminal();
  const read = readHidden(input, output, 'Password: ');
  // Typed in pieces: "secret", Backspace, an arrow key, then a pasted tail and Enter.
  input.emit('data', 'secrex');
  input.emit('data', '\u007f');
  input.emit('data', 't\u001b[D');
  input.emit('data', ' passphrase\r');
  assert.equal(await read, 'secret passphrase');
  assert.deepEqual(written, ['Password: ', '\n']);
  assert.deepEqual(input.modes, [true, false]);
  assert.equal(input.listenerCount('data'), 0);
});

test('the terminal reader drops SS3 keys and a lone Esc, and keeps the key after the Esc', async () => {
  const { input, output } = fakeTerminal();
  const read = readHidden(input, output, 'Password: ');
  // F1 and Home in application mode are SS3 sequences: ESC O and one more.
  input.emit('data', 'one\u001bOP');
  input.emit('data', '\u001bOH two');
  // Esc pressed on its own arrives in a read of its own.
  input.emit('data', '\u001b');
  input.emit('data', ' three');
  // Esc then a key in one read: the Esc goes, the key stays.
  input.emit('data', '\u001bx\u001b\u001b[Cy\r');
  assert.equal(await read, 'one two threexy');
});

test('Ctrl-C, or Ctrl-D on an empty line, cancels the read and restores the terminal', async () => {
  for (const key of ['\u0003', '\u0004']) {
    const { input, output } = fakeTerminal();
    const read = readHidden(input, output, 'Password: ');
    input.emit('data', key);
    await assert.rejects(read);
    assert.deepEqual(input.modes, [true, false]);
  }
});

/** Standard streams for main(), with a terminal's stdin when `terminal` is given. */
function streams(terminal) {
  const out = [];
  const err = [];
  const stdin = terminal ?? {
    isTTY: false,
    setEncoding() {
      throw new Error('stdin was read');
    },
    [Symbol.asyncIterator]() {
      throw new Error('stdin was read');
    },
  };
  return {
    io: {
      stdin,
      stdout: { write: (text) => out.push(text) },
      stderr: { write: (text) => err.push(text) },
    },
    out,
    err,
  };
}

test('--stdin refuses a terminal, where the password would echo, before anything is read', async () => {
  const { input } = fakeTerminal();
  input.setEncoding = () => {
    throw new Error('stdin was read');
  };
  const { io, out, err } = streams(input);
  assert.equal(await main(['hash-password', '--stdin'], io), 2);
  assert.deepEqual(out, []);
  assert.match(err.join(''), /isn't a terminal/);
  assert.deepEqual(input.modes, []);
});

test('--out refuses a file that exists before it asks for anything, and keeps no file unless the hash is in it', async (t) => {
  const dir = tempDir(t);
  // A file that exists: refused before the first prompt.
  const existing = path.join(dir, 'existing');
  writeFileSync(existing, 'kept');
  const terminal = fakeTerminal();
  const first = streams(terminal.input);
  assert.equal(await main(['hash-password', '--out', existing], first.io), 1);
  assert.match(first.err.join(''), /exists already/);
  assert.ok(!first.err.join('').includes('Password: '), 'it prompted first');
  assert.deepEqual(terminal.input.modes, []);
  assert.equal(readFileSync(existing, 'utf8'), 'kept');

  // Entries that differ, or a password out of length: no file is left.
  const out = path.join(dir, 'owner_password_hash');
  for (const input of [`${PASSWORD}\n${PASSWORD}x\n`, 'short\nshort\n']) {
    const refused = await run(['hash-password', '--stdin', '--out', out], input);
    assert.equal(refused.code, 1, refused.stderr);
    assert.equal(existsSync(out), false, 'a refused entry left its file');
  }

  // Ctrl-C at the prompt: no file is left either.
  const cancel = fakeTerminal();
  const cancelled = streams(cancel.input);
  const running = main(['hash-password', '--out', out], cancelled.io);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(existsSync(out), 'the file is made before the prompt');
  cancel.input.emit('data', '\u0003');
  assert.equal(await running, 130);
  assert.equal(existsSync(out), false, 'a cancelled entry left its file');
});

/** A data directory, prepared as owner startup leaves it, holding `count` session records. */
async function dataDirWith(t, count) {
  const dir = tempDir(t);
  assert.equal(await probeDataDirectory(dir), null);
  const at = Date.UTC(2026, 9, 20, 9, 0, 0);
  for (let index = 0; index < count; index += 1) {
    await writeSessionFile(dir, {
      digest: index.toString(16).padStart(64, 'a'),
      createdAt: at,
      lastSeenAt: at,
      absoluteExpiresAt: at + 12 * 3_600_000,
      credentialFingerprint: 'MKhpw6F1Y5AkDvbeT_fgmw',
      uaFamily: 'firefox',
    });
  }
  return dir;
}

test('revoke-sessions writes revoked-before, deletes every session record, and audits sessions_revoked_all by the operator', async (t) => {
  const dir = await dataDirWith(t, 3);
  const before = Date.now();
  const { code, stdout, stderr } = await run(['revoke-sessions'], '', { PORTFOLIO_DATA_DIR: dir });
  assert.equal(code, 0, stderr);
  assert.equal(stdout, '');
  assert.match(stderr, /^Revoked 3 sessions\./);
  assert.deepEqual(await listSessionDigests(dir), []);
  const revokedBefore = await readRevokedBefore(dir);
  assert.ok(revokedBefore !== null && revokedBefore >= before && revokedBefore <= Date.now());
  const auditDir = path.join(dir, 'audit');
  const [month] = readdirSync(auditDir);
  assert.ok(month);
  assert.equal(statSync(path.join(auditDir, month)).mode & 0o777, 0o600);
  const records = readFileSync(path.join(auditDir, month), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map(({ type, actor, outcome, refs }) => ({ type, actor, outcome, refs })),
    [{ type: 'sessions_revoked_all', actor: 'operator', outcome: 'success', refs: { count: 3 } }],
  );
  assert.equal(new Date(records[0].at).getTime(), revokedBefore);

  // Through PORTFOLIO_DATA_DIR_FILE, and with the directories not made yet.
  const fresh = tempDir(t);
  const pointer = path.join(tempDir(t), 'data-dir');
  writeFileSync(pointer, `${fresh}\n`);
  const again = await run(['revoke-sessions'], '', { PORTFOLIO_DATA_DIR_FILE: pointer });
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stderr, /^Revoked 0 sessions\./);
  // Each writer makes its own directory: revoked-before's and the audit
  // log's. With no session to delete, sessions/ isn't made.
  for (const sub of ['ephemeral', 'ephemeral/auth', 'audit']) {
    assert.equal(statSync(path.join(fresh, sub)).mode & 0o777, 0o700, sub);
  }
  assert.equal(existsSync(path.join(fresh, 'ephemeral/auth/sessions')), false);
});

test('revoke-sessions in auth directories an operator loosened puts them back to 0700 and still deletes every session', async (t) => {
  const dir = await dataDirWith(t, 2);
  const auth = path.join(dir, 'ephemeral', 'auth');
  chmodSync(path.join(dir, 'ephemeral'), 0o755);
  chmodSync(auth, 0o777);
  chmodSync(path.join(auth, 'sessions'), 0o755);
  const { code, stderr } = await run(['revoke-sessions'], '', { PORTFOLIO_DATA_DIR: dir });
  assert.equal(code, 0, stderr);
  assert.match(stderr, /^Revoked 2 sessions\./);
  assert.deepEqual(await listSessionDigests(dir), []);
  assert.ok((await readRevokedBefore(dir)) !== null);
  for (const sub of ['ephemeral', 'ephemeral/auth', 'ephemeral/auth/sessions']) {
    assert.equal(statSync(path.join(dir, sub)).mode & 0o777, 0o700, sub);
  }
});

test('revoke-sessions names a link planted in place of ephemeral/auth/, and the server reads no session through it either', async (t) => {
  // The planted directory holds a valid session record.
  const planted = await dataDirWith(t, 1);
  const dir = tempDir(t);
  mkdirSync(path.join(dir, 'ephemeral'), { mode: 0o700 });
  symlinkSync(path.join(planted, 'ephemeral', 'auth'), path.join(dir, 'ephemeral', 'auth'));
  const { code, stdout, stderr } = await run(['revoke-sessions'], '', { PORTFOLIO_DATA_DIR: dir });
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /^ephemeral\/auth is a link\. /);
  assert.match(stderr, /Nothing was revoked\./);
  assert.ok(!stderr.includes(dir), 'it names the data directory itself');
  // What it refuses, the server's readers refuse too: no session counts.
  await assert.rejects(listSessionDigests(dir), /is a link/);
  await assert.rejects(readRevokedBefore(dir), /is a link/);
});

test('revoke-sessions with no usable data directory revokes nothing', async (t) => {
  const dir = await dataDirWith(t, 1);
  const file = path.join(tempDir(t), 'a-file');
  writeFileSync(file, '');
  const cases = [
    [{}, /needs PORTFOLIO_DATA_DIR/],
    [{ PORTFOLIO_DATA_DIR: dir, PORTFOLIO_DATA_DIR_FILE: file }, /not both/],
    [{ PORTFOLIO_DATA_DIR_FILE: path.join(dir, 'no-such-file') }, /can't be read/],
    [{ PORTFOLIO_DATA_DIR: path.join(dir, 'absent') }, /names no directory/],
    [{ PORTFOLIO_DATA_DIR: file }, /names no directory/],
  ];
  for (const [env, message] of cases) {
    const { code, stdout, stderr } = await run(['revoke-sessions'], '', env);
    assert.equal(code, 1, JSON.stringify(env));
    assert.equal(stdout, '');
    assert.match(stderr, message);
    assert.match(stderr, /Nothing was revoked\./);
  }
  assert.equal((await listSessionDigests(dir)).length, 1);
  assert.equal(await readRevokedBefore(dir), null);
  const extra = await run(['revoke-sessions', '--all'], '', { PORTFOLIO_DATA_DIR: dir });
  assert.equal(extra.code, 2);
  assert.match(extra.stderr, /takes no arguments/);
});
