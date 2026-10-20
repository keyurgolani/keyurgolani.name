#!/usr/bin/env node
/**
 * owner.mjs: the owner's command line (#2). It needs Node and nothing else,
 * so it runs from the image as well as the repo.
 *
 *   node apps/web/bin/owner.mjs hash-password [--out <path>] [--stdin]
 *
 * hash-password asks for the password twice on the terminal, with echo off,
 * and prints the scrypt PHC string PORTFOLIO_AUTH_PASSWORD_HASH_FILE holds.
 * It never reads a password from its arguments, and refuses input that isn't
 * a terminal unless --stdin says to read the password and the same password
 * again as two lines of standard input (for tests). --stdin refuses a
 * terminal, where the password would echo. --out creates a new file, mode
 * 0400, before it asks for anything, so a file that exists is refused first,
 * writes the string there with no trailing newline, and removes the file
 * again unless the string was written. Nothing but the string goes to stdout;
 * prompts and messages go to stderr.
 *
 * Exits 0 when done, 1 when the entries are refused or the file can't be
 * made or written, 2 on a usage error, input of the wrong kind included (no
 * terminal without --stdin, a terminal with it), and 130 on Ctrl-C.
 */
import { closeSync, openSync, realpathSync, unlinkSync, writeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
// The repo and the image hold this module at the same path relative to this
// file: the Dockerfile copies both.
import {
  hashPassword,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordProblem,
} from '../../../packages/core/src/auth/phc.mjs';

const USAGE = 'Usage: node apps/web/bin/owner.mjs hash-password [--out <path>] [--stdin]';

class UsageError extends Error {}
class Cancelled extends Error {}

/**
 * The command line, checked. The messages are fixed text: an argument can be
 * a password typed in the wrong place, so none is ever repeated.
 *
 * @param {readonly string[]} argv
 * @returns {{ out?: string, stdin: boolean }}
 */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === undefined) throw new UsageError('Name a command.');
  if (command !== 'hash-password') throw new UsageError('That is not a command this takes.');
  /** @type {{ out?: string, stdin: boolean }} */
  const options = { stdin: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--stdin') {
      options.stdin = true;
    } else if (arg === '--out') {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith('--'))
        throw new UsageError('--out needs a path.');
      options.out = value;
      index += 1;
    } else {
      throw new UsageError(
        'hash-password takes only --out and --stdin. It asks for the password; never pass one.',
      );
    }
  }
  return options;
}

/**
 * Reads one line from a terminal without echoing it. Raw mode is on while it
 * reads, and nothing it reads is written: Enter ends the line, Backspace
 * takes back the last character, arrow keys, function keys, and other escape
 * sequences (CSI, ESC [, and SS3, ESC O) are dropped, Esc on its own is
 * dropped without the key after it, and Ctrl-C, or Ctrl-D on an empty line,
 * cancels.
 *
 * @param {NodeJS.ReadStream} input a TTY
 * @param {NodeJS.WritableStream} output where the prompt goes
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export function readHidden(input, output, prompt) {
  return new Promise((resolve, reject) => {
    let value = '';
    // An escape sequence in progress: ESC, then ESC [ up to its final byte,
    // or ESC O and one more.
    /** @type {'none' | 'escape' | 'csi' | 'ss3'} */
    let escape = 'none';
    output.write(prompt);
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();

    /** @param {string | Error} result */
    const finish = (result) => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    /** @param {string | Buffer} chunk */
    function onData(chunk) {
      for (const char of String(chunk)) {
        if (escape === 'escape') {
          if (char === '[' || char === 'O') {
            escape = char === '[' ? 'csi' : 'ss3';
            continue;
          }
          // Esc on its own: drop it, and read this key as typed.
          escape = 'none';
        } else if (escape === 'csi') {
          if (char >= '@' && char <= '~') escape = 'none';
          continue;
        } else if (escape === 'ss3') {
          escape = 'none';
          continue;
        }
        if (char === '\r' || char === '\n') return finish(value);
        if (char === '\u0003') return finish(new Cancelled());
        if (char === '\u0004') {
          if (value === '') return finish(new Cancelled());
          continue;
        }
        if (char === '\u007f' || char === '\b') {
          value = [...value].slice(0, -1).join('');
          continue;
        }
        if (char === '\u001b') {
          escape = 'escape';
          continue;
        }
        if (char < ' ') continue;
        value += char;
      }
      // A terminal sends a sequence in one read, so Esc last in a read is a key of its own.
      if (escape === 'escape') escape = 'none';
    }
    input.on('data', onData);
  });
}

/**
 * @param {NodeJS.ReadableStream} input
 * @returns {Promise<string>}
 */
async function readAll(input) {
  let text = '';
  input.setEncoding('utf8');
  for await (const chunk of input) text += chunk;
  return text;
}

/**
 * @typedef {object} Io
 * @property {NodeJS.ReadStream} stdin
 * @property {NodeJS.WritableStream} stdout
 * @property {NodeJS.WritableStream} stderr
 */

/**
 * @param {{ out?: string, stdin: boolean }} options
 * @param {Io} io
 * @returns {Promise<number>}
 */
async function hashPasswordCommand(options, io) {
  const say = (/** @type {string} */ line) => io.stderr.write(`${line}\n`);
  if (options.stdin && io.stdin.isTTY) {
    say(
      "--stdin reads standard input that isn't a terminal, since a password typed there echoes. " +
        'Run hash-password without it to type the password.',
    );
    return 2;
  }
  if (!options.stdin && !io.stdin.isTTY) {
    say(
      'hash-password reads the password from a terminal: under docker run, pass -it. ' +
        'It reads standard input only with --stdin.',
    );
    return 2;
  }
  // The file first, so one that exists is refused before anything is typed.
  /** @type {number | undefined} */
  let fd;
  if (options.out !== undefined) {
    try {
      fd = openSync(options.out, 'wx', 0o400);
    } catch (error) {
      const exists = /** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST';
      say(
        `${exists ? 'That file exists already' : "That path can't be written"}. Nothing was written.`,
      );
      return 1;
    }
  }
  let written = false;
  try {
    const code = await hashInto(options, io, fd, say);
    written = code === 0;
    return code;
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
      if (!written) unlinkSync(/** @type {string} */ (options.out));
    }
  }
}

/**
 * Reads the two entries, checks them, and prints the hash or writes it to
 * `fd`. Returns the exit code.
 *
 * @param {HashOptions} options
 * @param {Io} io
 * @param {number | undefined} fd
 * @param {(line: string) => void} say
 * @returns {Promise<number>}
 */
async function hashInto(options, io, fd, say) {
  /** @type {string | undefined} */
  let entry;
  /** @type {string | undefined} */
  let again;
  if (options.stdin) {
    const lines = (await readAll(io.stdin)).split(/\r?\n/);
    if (lines.length < 2 || lines.slice(2).some((line) => line !== '')) {
      say(
        '--stdin reads the password and the same password again, one per line. Nothing was written.',
      );
      return 1;
    }
    [entry, again] = lines;
  } else {
    entry = await readHidden(io.stdin, io.stderr, 'Password: ');
    again = await readHidden(io.stdin, io.stderr, 'Same password again: ');
  }
  // A confirmation of what was just typed, not a sign-in, so a plain compare.
  if (entry !== again) {
    say('The two entries differ. Nothing was written.');
    return 1;
  }
  if (entry === undefined || passwordProblem(entry)) {
    say(`The password needs ${PASSWORD_MIN} to ${PASSWORD_MAX} characters. Nothing was written.`);
    return 1;
  }
  const phc = await hashPassword(entry);
  if (fd === undefined) {
    io.stdout.write(`${phc}\n`);
    return 0;
  }
  try {
    if (writeSync(fd, phc) !== Buffer.byteLength(phc)) throw new Error('short write');
  } catch {
    say("The hash couldn't be written. Nothing was kept.");
    return 1;
  }
  say('Wrote the hash.');
  return 0;
}

/**
 * Runs the command line and returns the exit code.
 *
 * @param {readonly string[]} argv
 * @param {Io} [io]
 * @returns {Promise<number>}
 */
export async function main(
  argv,
  io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr.write(`${error.message}\n${USAGE}\n`);
    return 2;
  }
  try {
    return await hashPasswordCommand(options, io);
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
    io.stderr.write('Cancelled. Nothing was written.\n');
    return 130;
  }
}

/** Whether Node is running this file, rather than a test importing it. */
function invoked() {
  try {
    return (
      process.argv[1] !== undefined &&
      pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
    );
  } catch {
    return false;
  }
}

if (invoked()) process.exitCode = await main(process.argv.slice(2));
