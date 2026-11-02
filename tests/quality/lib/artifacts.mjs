// What the quality runs upload, scrubbed (#11, Slice 1, item 11): every
// artifact under the reports directory, and everything packed in one (a
// trace's zip entries, a zip in a zip, a gzip), loses its cookie,
// Set-Cookie, Authorization, CSRF, and password values by rule, and every
// value the run knows is a secret, such as a test session's cookies. Each
// run plants a canary credential: a cookie, an Authorization header, and a
// CSRF header on every request, and the owner password of every owner
// server it starts. The scrub never takes the canary out by its value, so
// it goes only when a rule takes it, and the scan after the scrub fails the
// run if any is left: a credential in a form no rule knows fails the run.
// A file the scrub can't read is deleted, and the run fails on that too.
// Pure Node: run.ts scrubs and scans after Playwright, however it ended,
// and CI's scrub step does again before it uploads.

import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { encodings } from '../../harness/canaries.mjs';

// The zip reader and writer Playwright itself writes traces with, from the
// playwright-core this checkout's playwright installed.
const require = createRequire(import.meta.url);
const { yauzl, yazl } = createRequire(require.resolve('playwright/package.json'))(
  'playwright-core/lib/zipBundle',
);

/** What a scrubbed value becomes. */
export const SCRUBBED = '[scrubbed]';

/** A canary for one run: no response, log, or artifact has a reason to hold it. */
export function plantCanary() {
  return `quality-canary-${randomBytes(12).toString('hex')}`;
}

/** The owner password a run's owner servers start with: the canary, so scanning for it finds both. */
export const canaryPassword = (canary) => `${canary}-owner`;

/** Headers whose values are credentials. */
const SECRET_HEADERS =
  'cookie|set-cookie|authorization|proxy-authorization|x-csrf-token|x-xsrf-token';
/** JSON fields whose values are credentials: those headers, the app's CSRF token, and a password. */
const SECRET_FIELDS = `${SECRET_HEADERS}|csrf_?token|password`;

// A quote at any escape depth: " in JSON, \" inside a JSON string (an RSC
// payload, or summary.json holding an error), \\\" a level deeper.
const Q = String.raw`\\*"`;
// A quoted value, up to the quote that closes it at any depth.
const VALUE = String.raw`((?:[^"\\]|(?!\\+")\\[\s\S])*)`;

/** Every cookie's value in a cookie list: "cookies":[{"name":"a","value":"..."}], at any depth. */
const COOKIE_LIST = new RegExp(`(${Q}cookies${Q}\\s*:\\s*\\[)([^\\]]*)(\\])`, 'gi');
const COOKIE_VALUE = new RegExp(`(${Q}value${Q}\\s*:\\s*${Q})${VALUE}(${Q})`, 'gi');

const replaceValues = (rule) => (text) =>
  text.replace(rule, (_, start, _value, end) => `${start}${SCRUBBED}${end}`);

/**
 * The scrub's rules, by name, each a function from text to text. The canary
 * goes only through these, so a credential in a form no rule knows stays in,
 * and the scan after the scrub finds it. artifacts.test.mjs plants the
 * canary in each form and shows the rule that takes it out is needed.
 */
export const RULES = Object.freeze({
  // A header list entry: {"name":"cookie","value":"..."}, as traces keep them.
  'header-pair': replaceValues(
    new RegExp(
      `(${Q}name${Q}\\s*:\\s*${Q}(?:${SECRET_HEADERS})${Q}\\s*,\\s*${Q}value${Q}\\s*:\\s*${Q})${VALUE}(${Q})`,
      'gi',
    ),
  ),
  // A field, "authorization":"..." or "csrfToken":"...", or \"csrfToken\":\"...\" in an RSC payload.
  field: replaceValues(
    new RegExp(`(${Q}(?:${SECRET_FIELDS})${Q}\\s*:\\s*${Q})${VALUE}(${Q})`, 'gi'),
  ),
  // A header line: as a log prints one, as a Playwright call log keeps one
  // in a JSON string ("  cookie: ..."), as a list names one ("- authorization: ..."),
  // or after an escaped newline in a JSON string (\n  x-csrf-token: ...).
  'header-line': replaceValues(
    new RegExp(
      String.raw`((?:^|\\*"|\\+[nr])[ \t]*(?:-[ \t]*)?(?:${SECRET_HEADERS})[ \t]*:[ \t]*)((?:[^"\\\r\n]|(?!\\+"|\\+[nr])\\[\s\S])+)()`,
      'gim',
    ),
  ),
  // Each value in a cookie list.
  'cookie-list': (text) =>
    text.replace(
      COOKIE_LIST,
      (_, start, list, end) => `${start}${replaceValues(COOKIE_VALUE)(list)}${end}`,
    ),
  // A key=value spelling: authorization=..., cookie=..., csrfToken=..., up to a space, &, or quote.
  'key-value': replaceValues(new RegExp(String.raw`(\b(?:${SECRET_FIELDS})=)([^\s&"']+)()`, 'gi')),
});

/**
 * `text` with every credential value replaced: each of `secrets`, in every
 * encoding a response or a trace could hold it, and the value of each
 * header or field a rule names. `secrets` are values the run knows, such as
 * a test session's cookies. The canary is never one of them.
 *
 * @param {string} text
 * @param {readonly string[]} [secrets]
 * @param {{ skip?: string }} [options] a rule to leave out, for the tests that show each one is needed
 */
export function scrubText(text, secrets = [], { skip } = {}) {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    for (const form of encodings(secret)) out = out.split(form).join(SCRUBBED);
  }
  for (const [name, rule] of Object.entries(RULES)) if (name !== skip) out = rule(out);
  return out;
}

/** Whether `bytes` is text: valid UTF-8 with no NUL. A screenshot or a font isn't. */
export function isText(bytes) {
  if (bytes.includes(0)) return false;
  return Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);
}

const starts = (bytes, magic) => magic.every((byte, index) => bytes[index] === byte);
const isZip = (bytes) =>
  bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [3, 5, 7].includes(bytes[2]);
const isGzip = (bytes) => starts(bytes, [0x1f, 0x8b]);

/** Packed formats the scrub can't open, by their first bytes. It deletes them. */
const OPAQUE = [
  ['7z', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]],
  ['rar', [0x52, 0x61, 0x72, 0x21]],
  ['bzip2', [0x42, 0x5a, 0x68]],
  ['xz', [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]],
  ['zstd', [0x28, 0xb5, 0x2f, 0xfd]],
];

/** The packed format the scrub can't open that `bytes` is, or null. */
function opaqueFormat(bytes) {
  for (const [name, magic] of OPAQUE) if (starts(bytes, magic)) return name;
  if (bytes.length > 262 && bytes.toString('latin1', 257, 262) === 'ustar') return 'tar';
  return null;
}

/** How deep packed artifacts may nest before the scrub gives up on one. */
const MAX_DEPTH = 4;

/** An artifact the scrub can't read, so it can't clean it. */
class Unreadable extends Error {}

/** Every file under `dir`, recursively, sorted. */
export function filesUnder(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

/** Every entry of the zip in `bytes`, as { name, bytes, mtime }. */
function unzip(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const entries = [];
      zip.on('error', reject);
      zip.on('end', () => resolve(entries));
      zip.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => {
            entries.push({
              name: entry.fileName,
              bytes: Buffer.concat(chunks),
              mtime: entry.getLastModDate(),
            });
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

/** Every entry of the zip `file`, as { name, bytes, mtime }. */
export function readZip(file) {
  return unzip(readFileSync(file));
}

/** `entries` as a zip's bytes. */
export function zipBytes(entries) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const { name, bytes, mtime } of entries) zip.addBuffer(bytes, name, { mtime });
    const chunks = [];
    zip.outputStream.on('data', (chunk) => chunks.push(chunk));
    zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.end();
  });
}

/** Writes `bytes` to `file` through a temporary file beside it. */
function replaceFile(file, bytes) {
  const temporary = `${file}.${process.pid}.scrub`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, file);
}

/** Writes `entries` as the zip `file`. */
export async function writeZip(file, entries) {
  replaceFile(file, await zipBytes(entries));
}

/**
 * `bytes` scrubbed, whatever it packs: text, a zip's entries, a gzip's
 * contents, each packing more in turn. Throws Unreadable for a packed
 * artifact it can't open, so the caller deletes the whole file.
 *
 * @returns {Promise<Buffer | null>} the scrubbed bytes, or null when nothing changed
 */
async function scrubBytes(bytes, secrets, depth = 0) {
  if (depth > MAX_DEPTH) throw new Unreadable(`it's packed more than ${MAX_DEPTH} deep`);
  if (isZip(bytes)) {
    let entries;
    try {
      entries = await unzip(bytes);
    } catch (error) {
      throw new Unreadable(`a zip the scrub can't read: ${error.message}`);
    }
    let touched = false;
    const scrubbed = [];
    for (const entry of entries) {
      const clean = await scrubBytes(entry.bytes, secrets, depth + 1);
      if (clean) touched = true;
      scrubbed.push(clean ? { ...entry, bytes: clean } : entry);
    }
    return touched ? zipBytes(scrubbed) : null;
  }
  if (isGzip(bytes)) {
    let inner;
    try {
      inner = gunzipSync(bytes);
    } catch (error) {
      throw new Unreadable(`a gzip the scrub can't read: ${error.message}`);
    }
    const clean = await scrubBytes(inner, secrets, depth + 1);
    return clean ? gzipSync(clean) : null;
  }
  const opaque = opaqueFormat(bytes);
  if (opaque) throw new Unreadable(`a ${opaque} archive, which the scrub can't open`);
  // Text that isn't valid UTF-8, such as a log with one stray byte, goes
  // through the rules too, read byte for byte, so every other byte stays.
  const encoding = isText(bytes) ? 'utf8' : 'latin1';
  const text = bytes.toString(encoding);
  const clean = scrubText(text, secrets);
  return clean === text ? null : Buffer.from(clean, encoding);
}

/**
 * Scrubs every artifact under `dir` in place: text files, and every text
 * file packed in a zip or a gzip, nested or not, such as a trace's network
 * log and response bodies. It never stops on one file. A file it can't
 * read, or a packed artifact it can't open, is deleted and listed in
 * `removed`, and the caller fails the run on any.
 *
 * @param {string} dir
 * @param {readonly string[]} [secrets]
 * @returns {Promise<{ changed: string[], removed: { file: string, reason: string }[] }>}
 */
export async function scrubArtifacts(dir, secrets = []) {
  const changed = [];
  const removed = [];
  for (const file of filesUnder(dir)) {
    try {
      const clean = await scrubBytes(readFileSync(file), secrets);
      if (clean) {
        replaceFile(file, clean);
        changed.push(file);
      }
    } catch (error) {
      rmSync(file, { force: true });
      removed.push({ file, reason: error instanceof Unreadable ? error.message : String(error) });
    }
  }
  return { changed, removed };
}

/** Each place in `bytes`, or packed in it, a canary form is: [{ entry?, canary }], a nested entry as a/b. */
async function findIn(bytes, forms, depth = 0, entry = undefined) {
  const hits = [];
  const found = forms.find(({ form }) => bytes.includes(form));
  if (found) hits.push({ entry, canary: found.label });
  if (depth > MAX_DEPTH) return hits;
  try {
    if (isZip(bytes)) {
      for (const inner of await unzip(bytes)) {
        const name = entry ? `${entry}/${inner.name}` : inner.name;
        hits.push(...(await findIn(inner.bytes, forms, depth + 1, name)));
      }
    } else if (isGzip(bytes)) {
      hits.push(...(await findIn(gunzipSync(bytes), forms, depth + 1, entry ?? '(gzip)')));
    }
  } catch {
    // Unreadable: the scrub deletes it, and the run fails on that.
  }
  return hits;
}

/**
 * Every place under `dir` a canary is, in any encoding: each file, and each
 * entry packed in it, as { file, entry?, canary }. The canary is reported by
 * what it stands for, never by its value.
 *
 * @param {string} dir
 * @param {readonly { label: string, value: string }[]} canaries
 */
export async function scanArtifacts(dir, canaries) {
  const forms = canaries.flatMap(({ label, value }) =>
    encodings(value).map((form) => ({ label, form: Buffer.from(form, 'utf8') })),
  );
  const hits = [];
  for (const file of filesUnder(dir)) {
    if (!statSync(file).isFile()) continue;
    for (const { entry, canary } of await findIn(readFileSync(file), forms)) {
      hits.push(entry ? { file, entry, canary } : { file, canary });
    }
  }
  return hits;
}

/**
 * The secrets a run knows by value, one JSON string per line of `file`,
 * such as a test session's cookies (lib/session.ts's recordSessionSecrets).
 * None when there's no file.
 *
 * @param {string | undefined} file
 * @returns {string[]}
 */
export function readSecrets(file) {
  if (!file) return [];
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((value) => typeof value === 'string' && value.length > 0);
}
