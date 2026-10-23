// What the quality runs upload, scrubbed (#11, Slice 1, item 11): every
// artifact under the reports directory, traces' zip entries included, loses
// its cookie, Set-Cookie, Authorization, and CSRF values, and every value
// the run knows is a secret. Each run plants a canary credential (a cookie,
// an Authorization header, and a CSRF header on every request, and the
// owner password of every owner server it starts), and the run fails if the
// canary is in any artifact once the scrub is done. Pure Node: run.mjs
// scrubs and scans after Playwright, however it ended, before CI uploads.

import { randomBytes } from 'node:crypto';
import {
  createWriteStream,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
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
const SECRET_HEADERS = 'cookie|set-cookie|authorization|proxy-authorization|x-csrf-token';

const RULES = [
  // A trace's header lists: {"name":"cookie","value":"..."}.
  new RegExp(
    `("name"\\s*:\\s*"(?:${SECRET_HEADERS})"\\s*,\\s*"value"\\s*:\\s*")((?:[^"\\\\]|\\\\.)*)(")`,
    'gi',
  ),
  // Headers as an object: "authorization":"...".
  new RegExp(`("(?:${SECRET_HEADERS})"\\s*:\\s*")((?:[^"\\\\]|\\\\.)*)(")`, 'gi'),
  // The app's own token field: "csrfToken":"...".
  /("csrf_?token"\s*:\s*")((?:[^"\\]|\\.)*)(")/gi,
  // Header lines, as a log or an HTTP dump prints them.
  new RegExp(`^(\\s*(?:${SECRET_HEADERS})\\s*:[ \\t]*)([^\\r\\n]+)()`, 'gim'),
];

/** Every cookie's value in a trace's cookie lists: "cookies":[{"name":"a","value":"..."}]. */
const COOKIE_LIST = /("cookies"\s*:\s*\[)([^\]]*)(\])/gi;
const COOKIE_VALUE = /("value"\s*:\s*")((?:[^"\\]|\\.)*)(")/gi;

/**
 * `text` with every credential value replaced: each of `secrets` in every
 * encoding a response or a trace could hold it, and each value of a header
 * or field that carries one.
 *
 * @param {string} text
 * @param {readonly string[]} secrets
 */
export function scrubText(text, secrets = []) {
  let out = text;
  for (const secret of secrets) {
    for (const form of encodings(secret)) out = out.split(form).join(SCRUBBED);
  }
  for (const rule of RULES)
    out = out.replace(rule, (_, start, _value, end) => `${start}${SCRUBBED}${end}`);
  out = out.replace(
    COOKIE_LIST,
    (_, start, list, end) =>
      `${start}${list.replace(COOKIE_VALUE, (__, a, _v, b) => `${a}${SCRUBBED}${b}`)}${end}`,
  );
  return out;
}

/** Whether `bytes` is text: valid UTF-8 with no NUL. A screenshot or a font isn't. */
export function isText(bytes) {
  if (bytes.includes(0)) return false;
  return Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);
}

const isZip = (bytes) => bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;

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

/** Every entry of the zip `file`, as { name, bytes, mode, mtime }. */
export function readZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
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

/** Writes `entries` as the zip `file`, through a temporary file beside it. */
export function writeZip(file, entries) {
  return new Promise((resolve, reject) => {
    const temporary = `${file}.${process.pid}.scrub`;
    const zip = new yazl.ZipFile();
    for (const { name, bytes, mtime } of entries) zip.addBuffer(bytes, name, { mtime });
    const out = createWriteStream(temporary);
    out.on('error', reject);
    out.on('close', () => {
      renameSync(temporary, file);
      resolve();
    });
    zip.outputStream.pipe(out);
    zip.end();
  });
}

/**
 * Scrubs every artifact under `dir` in place: text files, and each text
 * entry of a zip, such as a trace's network log and response bodies.
 * Returns the files it changed.
 *
 * @param {string} dir
 * @param {readonly string[]} secrets
 */
export async function scrubArtifacts(dir, secrets = []) {
  const changed = [];
  for (const file of filesUnder(dir)) {
    const bytes = readFileSync(file);
    if (isZip(bytes)) {
      const entries = await readZip(file);
      let touched = false;
      const scrubbed = entries.map((entry) => {
        if (!isText(entry.bytes)) return entry;
        const text = entry.bytes.toString('utf8');
        const clean = scrubText(text, secrets);
        if (clean === text) return entry;
        touched = true;
        return { ...entry, bytes: Buffer.from(clean, 'utf8') };
      });
      if (touched) {
        await writeZip(file, scrubbed);
        changed.push(file);
      }
    } else if (isText(bytes)) {
      const text = bytes.toString('utf8');
      const clean = scrubText(text, secrets);
      if (clean !== text) {
        writeFileSync(file, clean);
        changed.push(file);
      }
    }
  }
  return changed;
}

/**
 * Every place under `dir` a canary is, in any encoding: each file, and each
 * entry of a zip, as { file, entry?, canary }. The canary is reported by
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
  const check = (bytes, where) => {
    for (const { label, form } of forms) {
      if (bytes.includes(form)) {
        hits.push({ ...where, canary: label });
        return;
      }
    }
  };
  for (const file of filesUnder(dir)) {
    if (!statSync(file).isFile()) continue;
    const bytes = readFileSync(file);
    check(bytes, { file });
    if (isZip(bytes)) {
      for (const entry of await readZip(file)) check(entry.bytes, { file, entry: entry.name });
    }
  }
  return hits;
}
