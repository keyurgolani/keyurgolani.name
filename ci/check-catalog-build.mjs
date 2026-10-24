#!/usr/bin/env node
// A Research record never reaches a build (#20): it's never registered,
// selectable, published, exported, or bundled. This reads a production
// build for one, after pnpm build, and fails when a Research record or id
// reaches:
//
// - the metadata module, or any other module registry generation writes in
//   apps/web/src/lib/generated/, as a quoted id;
// - ASSET_MANIFEST, in asset-manifest.json, as a quoted id;
// - any .next/static chunk, as a registry key ("id":"<id>", however the
//   chunk quotes or escapes it) or by its record's own reason text;
// - the image, through the build output CI ships into it (the Dockerfile
//   copies .next/standalone whole, .next/static, and public/): any
//   research/<id>.json path, a registry key or reason text in the server
//   output or public/, and any quoted id in public/_portfolio/.
//
// The records are each workspace pack package's research/<id>.json. A
// common word that's also a Research id, such as nord, is read only where
// the platform writes ids, so a library's own string never trips it.
//
//   node ci/check-catalog-build.mjs [apps/web dir]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentGate, REPO_ROOT, reportError, writeFailureRecord } from './lib/reports.mjs';

export const WEB_DIR = path.join(REPO_ROOT, 'apps', 'web');

const PACK_KINDS = new Set(['design-language', 'color-scheme', 'typography']);

/** Every workspace package with a pack kind, and its research records. */
export function researchRecords(root = REPO_ROOT) {
  const records = [];
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
        const research = path.join(full, 'research');
        if (PACK_KINDS.has(pkg.portfolio?.kind) && existsSync(research)) {
          for (const name of readdirSync(research).sort()) {
            if (!name.endsWith('.json')) continue;
            const file = path.join(research, name);
            let record = null;
            try {
              record = JSON.parse(readFileSync(file, 'utf8'));
            } catch {
              record = null;
            }
            records.push({
              id: typeof record?.id === 'string' ? record.id : name.slice(0, -'.json'.length),
              reason: typeof record?.reason === 'string' ? record.reason : null,
              file: path.relative(root, file).split(path.sep).join('/'),
            });
          }
        }
      }
      if (depth < 1) visit(full, depth + 1);
    }
  };
  visit(path.join(root, 'packages'), 0);
  return records;
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

/** The id quoted, as JSON, a JS string, or a string inside another, writes it. */
const quoted = (id) => new RegExp(`(?:\\\\*["'\`])${escape(id)}(?:\\\\*["'\`])`);

/** The id as a registry key: an id property set to it, however the output quotes or escapes it. */
const keyed = (id) =>
  new RegExp(`(?:\\\\*["']?)id(?:\\\\*["']?)\\s*:\\s*(?:\\\\*["'\`])${escape(id)}(?:\\\\*["'\`])`);

const TEXT = /\.(?:[cm]?js|json|ts|html?|rsc|txt|css|map|body|meta)$/;

/**
 * What a build holds of each Research record: `web` is apps/web after
 * pnpm build. Null when nothing; else the findings, each with the record
 * and the file it's in, relative to `web`.
 */
export function researchInBuild(web, records) {
  const findings = [];
  if (records.length === 0) return findings;
  const shown = (file) => path.relative(web, file).split(path.sep).join('/');
  const scan = (files, tests, where) => {
    for (const file of files) {
      if (!TEXT.test(file) || statSync(file).size > 16 * 1024 * 1024) continue;
      const text = readFileSync(file, 'utf8');
      for (const record of records) {
        for (const [what, test] of tests(record)) {
          if (test(text)) {
            findings.push({ id: record.id, file: shown(file), where, what });
            break;
          }
        }
      }
    }
  };
  const strict = (record) => [['its id', (text) => quoted(record.id).test(text)]];
  const registryKey = (record) => [
    ['its id as a registry key', (text) => keyed(record.id).test(text)],
    ...(record.reason ? [['its record', (text) => text.includes(record.reason)]] : []),
  ];

  // The generated modules, ASSET_MANIFEST among them: any quoted id.
  scan(filesUnder(path.join(web, 'src', 'lib', 'generated')), strict, 'the generated modules');
  // Every static chunk: a registry key or the record.
  scan(filesUnder(path.join(web, '.next', 'static')), registryKey, '.next/static');
  // The image: the standalone tree the Dockerfile copies whole, and public/.
  const standalone = path.join(web, '.next', 'standalone');
  for (const file of filesUnder(standalone)) {
    const rel = shown(file);
    for (const record of records) {
      if (rel.endsWith(`/research/${record.id}.json`)) {
        findings.push({ id: record.id, file: rel, where: 'the image', what: 'its research file' });
      }
    }
  }
  scan(
    filesUnder(standalone).filter((file) => !file.split(path.sep).includes('node_modules')),
    registryKey,
    'the image',
  );
  scan(filesUnder(path.join(web, 'public', '_portfolio')), strict, 'the image');
  scan(
    filesUnder(path.join(web, 'public')).filter(
      (file) => !file.startsWith(path.join(web, 'public', '_portfolio')),
    ),
    registryKey,
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
  const records = researchRecords();
  const findings = researchInBuild(web, records);
  if (findings.length === 0) {
    console.log(
      `[catalog-build] none of ${records.length} Research record(s) reaches the generated modules, .next/static, or the image's build output`,
    );
    return 0;
  }
  const gate = currentGate();
  for (const { id, file, where, what } of findings) {
    const message = `The Research record ${id} reaches ${where}: ${file} holds ${what}. A Research record is never registered, selectable, published, exported, or bundled.`;
    reportError(message, { title: 'catalog build', file });
    if (gate) {
      writeFailureRecord({
        schemaVersion: '1.1',
        gate: gate.gate,
        reproCommand: gate.reproCommand,
        test: `Research record in the build: ${where}`,
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
