#!/usr/bin/env node
// A Research record, or a held pack, never reaches a build (#20): it's
// never registered, selectable, published, exported, or bundled. This reads
// a production build for one, after pnpm build, and fails when one reaches:
//
// - the metadata module, ASSET_MANIFEST (asset-manifest.json), the
//   excluded-packs module, or any other module registry generation writes
//   in apps/web/src/lib/generated/, as its id in any quoted form ("<id>",
//   '<id>', `<id>`, escaped, as an object key, or in an array), or as a
//   bare object key;
// - any .next/static chunk, as a registry key (id:"<id>", however the chunk
//   quotes or escapes it) or by its record's own reason text, and in any of
//   the forms above when the chunk carries the registry's data;
// - the image, through the build output CI ships into it (the Dockerfile
//   copies .next/standalone whole, .next/static, and public/): any
//   research/<id>.json or held/<id>/ path, a registry key or reason text in
//   the server output or public/ (any form where it carries the registry's
//   data), and any form at all in public/_portfolio/.
//
// The records are each workspace pack package's research/<id>.json, and its
// held/<id>/ packs, which fail their gate (their gate.json says why). A
// distinctive id, hyphenated or with a digit, such as fixture-research or
// tokyo-night, is read in any quoted or attribute form in every output. A
// common word that's also a Research id, such as nord or horizon, is read
// in any quoted form only where the platform writes appearance data: the
// generated modules, public/_portfolio/, and a chunk or server file that
// carries appearance data, which it shows by naming a platform default pack
// (APPEARANCE_MARKERS), a string no library holds. Everywhere else only the registry-key
// form and the reason text count, so a library's own string never trips it.
//
//   node ci/check-catalog-build.mjs [apps/web dir]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentGate, REPO_ROOT, reportError, writeFailureRecord } from './lib/reports.mjs';

export const WEB_DIR = path.join(REPO_ROOT, 'apps', 'web');

const PACK_KINDS = new Set(['design-language', 'color-scheme', 'typography']);

/**
 * The platform default packs (PLATFORM_DEFAULTS in packages/appearance),
 * which every registry holds: an output that names one as a registry key
 * carries the registry's data. check-catalog-build.test.mjs holds the list
 * to PLATFORM_DEFAULTS.
 */
export const APPEARANCE_MARKERS = ['platform-neutral', 'warm-parchment', 'humanist-ui'];

/** Every workspace pack package's directory: packages/<dir>/ and packages/<group>/<dir>/. */
function packPackageDirs(root) {
  const found = [];
  const visit = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.'))
        continue;
      const full = path.join(dir, entry.name);
      const manifest = path.join(full, 'package.json');
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        if (PACK_KINDS.has(pkg.portfolio?.kind)) found.push(full);
      }
      if (depth < 1) visit(full, depth + 1);
    }
  };
  visit(path.join(root, 'packages'), 0);
  return found.sort();
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');

/** Every pack package's research/<id>.json, as a record: its id, its reason, and its file. */
export function researchRecords(root = REPO_ROOT) {
  const records = [];
  for (const dir of packPackageDirs(root)) {
    const research = path.join(dir, 'research');
    if (!existsSync(research)) continue;
    for (const name of readdirSync(research).sort()) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(research, name);
      const record = readJson(file);
      records.push({
        id: typeof record?.id === 'string' ? record.id : name.slice(0, -'.json'.length),
        reason: typeof record?.reason === 'string' ? record.reason : null,
        file: relative(root, file),
      });
    }
  }
  return records;
}

/**
 * Every pack package's held/<id>/ pack, as a record: its id, its
 * gate.json's reason, and its directory. A held pack fails its gate and
 * never registers, so the build holds it to what it holds a Research
 * record to.
 */
export function heldRecords(root = REPO_ROOT) {
  const records = [];
  for (const dir of packPackageDirs(root)) {
    const held = path.join(dir, 'held');
    if (!existsSync(held)) continue;
    for (const entry of readdirSync(held, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const gate = readJson(path.join(held, entry.name, 'gate.json'));
      const manifest = readJson(path.join(held, entry.name, 'manifest.json'));
      // The manifest's id is what would register; a directory named otherwise is held too.
      const ids = new Set([...(typeof manifest?.id === 'string' ? [manifest.id] : []), entry.name]);
      for (const id of ids) {
        records.push({
          id,
          held: true,
          reason: typeof gate?.reason === 'string' ? gate.reason : null,
          file: relative(root, path.join(held, entry.name)),
        });
      }
    }
  }
  return records.sort((a, b) => (a.file < b.file ? -1 : 1));
}

/** Every file under `dir`, absolute, sorted; none when it's missing. */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(full);
    }
  };
  walk(dir);
  return found.sort();
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The id quoted, as JSON, a JS string, or a string inside another, writes it: a value, a key, or an array item. */
const quoted = (id) => new RegExp(`(?:\\\\*["'\`])${escape(id)}(?:\\\\*["'\`])`);

/** The id as a bare object key, as minified JS writes one that's an identifier. */
const bareKey = (id) =>
  /^[A-Za-z_$][\w$]*$/.test(id) ? new RegExp(`(?<![\\w$.-])${escape(id)}\\s*:(?!:)`) : null;

/** The id as an attribute selector's value, quoted or not, such as [data-color-scheme="<id>"]. */
const attribute = (id) =>
  new RegExp(
    `\\[[\\w-]+[~|^$*]?=\\s*(?:\\\\*["'])?${escape(id)}(?:\\\\*["'])?(?:\\s+[is])?\\s*\\]`,
  );

/**
 * Whether an id is distinctive: hyphenated or with a digit, such as
 * fixture-research or tokyo-night, which no library writes by chance. A
 * single plain word, such as nord, is common, and read in every form only
 * where an output carries appearance data.
 */
export const distinctive = (id) => /[-\d]/.test(id);

/** The id as a registry key: an id property set to it, however the output quotes or escapes it. */
const keyed = (id) =>
  new RegExp(`(?:\\\\*["']?)id(?:\\\\*["']?)\\s*:\\s*(?:\\\\*["'\`])${escape(id)}(?:\\\\*["'\`])`);

/** Whether `text` carries appearance data: it names a platform default pack, quoted, as only the platform does. */
export const carriesRegistry = (text) => APPEARANCE_MARKERS.some((id) => quoted(id).test(text));

const TEXT = /\.(?:[cm]?js|json|ts|html?|rsc|txt|css|map|body|meta)$/;

/**
 * What a build holds of each record, a Research record or a held pack:
 * `web` is apps/web after pnpm build. The findings, each with the record
 * and the file it's in, relative to `web`; none when nothing.
 */
export function researchInBuild(web, records) {
  const findings = [];
  if (records.length === 0) return findings;
  const shown = (file) => relative(web, file);
  const any = (record) => [
    ['its id', (text) => quoted(record.id).test(text)],
    ['its id as an object key', (text) => bareKey(record.id)?.test(text) ?? false],
    ['its id as an attribute value', (text) => attribute(record.id).test(text)],
  ];
  const registryKey = (record) => [
    ['its id as a registry key', (text) => keyed(record.id).test(text)],
    ...(record.reason ? [['its record', (text) => text.includes(record.reason)]] : []),
  ];
  /**
   * A distinctive id in any form, everywhere. A common word in any form in
   * an output that carries the registry, else as a registry key and by
   * its reason alone.
   */
  const byOutput = (text) => {
    const carries = carriesRegistry(text);
    return (record) =>
      carries || distinctive(record.id)
        ? [...registryKey(record), ...any(record)]
        : registryKey(record);
  };
  const strict = () => (record) => [...registryKey(record), ...any(record)];
  const scan = (files, tests, where) => {
    for (const file of files) {
      if (!TEXT.test(file) || statSync(file).size > 16 * 1024 * 1024) continue;
      const text = readFileSync(file, 'utf8');
      const testsHere = tests(text);
      for (const record of records) {
        for (const [what, test] of testsHere(record)) {
          if (test(text)) {
            findings.push({ id: record.id, file: shown(file), where, what });
            break;
          }
        }
      }
    }
  };

  // The generated modules, ASSET_MANIFEST and the excluded packs among them: any form.
  scan(filesUnder(path.join(web, 'src', 'lib', 'generated')), strict, 'the generated modules');
  // Every static chunk: a registry key or the record, and any form in one that carries the registry.
  scan(filesUnder(path.join(web, '.next', 'static')), byOutput, '.next/static');
  // The image: the standalone tree the Dockerfile copies whole, and public/.
  const standalone = path.join(web, '.next', 'standalone');
  for (const file of filesUnder(standalone)) {
    const rel = shown(file);
    for (const record of records) {
      const own = record.held
        ? rel.includes(`/held/${record.id}/`)
        : rel.endsWith(`/research/${record.id}.json`);
      if (own) {
        findings.push({
          id: record.id,
          file: rel,
          where: 'the image',
          what: record.held ? 'its held pack' : 'its research file',
        });
      }
    }
  }
  scan(
    filesUnder(standalone).filter((file) => !file.split(path.sep).includes('node_modules')),
    byOutput,
    'the image',
  );
  scan(filesUnder(path.join(web, 'public', '_portfolio')), strict, 'the image');
  scan(
    filesUnder(path.join(web, 'public')).filter(
      (file) => !file.startsWith(path.join(web, 'public', '_portfolio') + path.sep),
    ),
    byOutput,
    'the image',
  );
  return findings;
}

function main(argv) {
  const web = path.resolve(argv[0] ?? WEB_DIR);
  if (!existsSync(path.join(web, '.next', 'static'))) {
    reportError(`No build at ${path.relative(REPO_ROOT, web)}/.next. Run pnpm build first.`, {
      title: 'catalog build',
    });
    return 1;
  }
  const research = researchRecords();
  const held = heldRecords();
  const findings = researchInBuild(web, [...research, ...held]);
  if (findings.length === 0) {
    console.log(
      `[catalog-build] none of ${research.length} Research record(s) and ${held.length} held pack(s) reaches the generated modules, .next/static, or the image's build output`,
    );
    return 0;
  }
  const gate = currentGate();
  const heldIds = new Set(held.map(({ id }) => id));
  for (const { id, file, where, what } of findings) {
    const kind = heldIds.has(id) ? 'The held pack' : 'The Research record';
    const message = `${kind} ${id} reaches ${where}: ${file} holds ${what}. ${heldIds.has(id) ? 'A held pack fails its gate, and' : 'A Research record'} is never registered, selectable, published, exported, or bundled.`;
    reportError(message, { title: 'catalog build', file });
    if (gate) {
      writeFailureRecord({
        schemaVersion: '1.1',
        gate: gate.gate,
        reproCommand: gate.reproCommand,
        test: `${heldIds.has(id) ? 'Held pack' : 'Research record'} in the build: ${where}`,
        pack: id,
        asset: file,
      });
    }
  }
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
