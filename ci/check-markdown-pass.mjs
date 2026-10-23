#!/usr/bin/env node
// The build gives React Server Components the Markdown post-pass and the
// browser none of it (#10). The pass leaves the renderer's markup as it is,
// so no page test can tell whether it runs: this reads the build instead.
// Every page under app/(site) and app/(preview) must load a server chunk
// whose source map holds packages/kit/src/markdown-post-pass.ts, at once or
// through a chunk it loads on demand, as a variant's import() is (#6,
// Slice 2: each experience segment loads its variant, and the kit's
// sections with it, that way). Since a page passes on any chunk it loads,
// every server chunk whose map holds the renderer, markdown.ts, must hold
// the post-pass beside it, so no server render gets the renderer alone. And
// nothing
// under .next/static may hold sanitize-html's code or a source map that
// names it. CI runs it after pnpm ci:standalone.
//
//   node ci/check-markdown-pass.mjs [.next dir]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentGate, REPO_ROOT, reportError, writeFailureRecord } from './lib/reports.mjs';

export const NEXT_DIR = path.join(REPO_ROOT, 'apps', 'web', '.next');
const PAGE_GROUPS = ['(site)', '(preview)'];
const POST_PASS = 'packages/kit/src/markdown-post-pass.ts';
const RENDERER = 'packages/kit/src/markdown.ts';
/** Names only sanitize-html and the parser it brings write, which survive minifying. */
export const MARKERS = [
  'recursiveEscape',
  'recognizeSelfClosing',
  'allowedSchemesAppliedToAttributes',
];

/** Every file under `dir`, relative to it. */
function files(dir) {
  const found = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(full);
    }
  };
  walk(dir);
  return found.map((file) => path.relative(dir, file)).sort();
}

/** The page entries of the site's and the preview's routes, relative to `nextDir`. */
export function pageEntries(nextDir) {
  const app = path.join(nextDir, 'server', 'app');
  return PAGE_GROUPS.flatMap((group) =>
    existsSync(path.join(app, group))
      ? files(path.join(app, group))
          .filter((file) => path.basename(file) === 'page.js')
          .map((file) => path.join('server', 'app', group, file))
      : [],
  );
}

/** The server chunks a page entry names at once: its R.c() calls. */
const DIRECT = /R\.c\("(server\/chunks\/[^"]+)"\)/g;
/** The server chunks a chunk loads on demand: Turbopack's a.l("server/chunks/...") for an import(). */
const ON_DEMAND = /"(server\/chunks\/[^"]+\.js)"/g;

/**
 * The server chunks a page entry loads, relative to `nextDir`: the ones it
 * names, and every one those load on demand that the build has, in turn.
 */
export function chunksOf(nextDir, page) {
  const text = readFileSync(path.join(nextDir, page), 'utf8');
  const found = Array.from(text.matchAll(DIRECT), ([, chunk]) => chunk);
  const seen = new Set(found);
  for (let index = 0; index < found.length; index += 1) {
    const file = path.join(nextDir, found[index]);
    if (!existsSync(file)) continue;
    for (const [, chunk] of readFileSync(file, 'utf8').matchAll(ON_DEMAND)) {
      if (seen.has(chunk) || !existsSync(path.join(nextDir, chunk))) continue;
      seen.add(chunk);
      found.push(chunk);
    }
  }
  return found;
}

/** The sources a chunk's source map names, or null when it has none. */
export function mapSources(nextDir, chunk) {
  const map = path.join(nextDir, `${chunk}.map`);
  if (!existsSync(map)) return null;
  const parsed = JSON.parse(readFileSync(map, 'utf8'));
  const sections = parsed.sections ?? [{ map: parsed }];
  return sections.flatMap((section) => section.map?.sources ?? []);
}

/**
 * What the check finds: null when it passes, else the message.
 *
 * @param {string} nextDir the web app's .next
 */
export function checkMarkdownPass(nextDir) {
  const shown = path.relative(REPO_ROOT, nextDir) || nextDir;
  if (!existsSync(path.join(nextDir, 'server')))
    return `No build at ${shown}. Run pnpm build first.`;
  const pages = pageEntries(nextDir);
  if (pages.length === 0) return `${shown} has no page under app/(site) or app/(preview).`;
  const problems = [];
  for (const page of pages) {
    const chunks = chunksOf(nextDir, page);
    const sources = chunks.map((chunk) => mapSources(nextDir, chunk));
    if (sources.some((list) => list === null)) {
      problems.push(`${page} loads a chunk with no source map, so the check can't read it`);
    } else if (!sources.some((list) => list.some((source) => source.endsWith(POST_PASS)))) {
      problems.push(`${page} loads no chunk with the Markdown post-pass (${POST_PASS})`);
    }
  }
  const chunksDir = path.join(nextDir, 'server', 'chunks');
  if (existsSync(chunksDir)) {
    for (const file of files(chunksDir).filter((name) => name.endsWith('.js'))) {
      const chunk = path.join('server', 'chunks', file);
      const sources = mapSources(nextDir, chunk) ?? [];
      if (
        sources.some((source) => source.endsWith(RENDERER)) &&
        !sources.some((source) => source.endsWith(POST_PASS))
      ) {
        problems.push(`${chunk} holds the renderer (${RENDERER}) without the post-pass`);
      }
    }
  }
  const staticDir = path.join(nextDir, 'static');
  if (existsSync(staticDir)) {
    for (const file of files(staticDir)) {
      const text = readFileSync(path.join(staticDir, file), 'utf8');
      const marker = MARKERS.find((name) => text.includes(name));
      if (marker) problems.push(`static/${file} holds sanitize-html's code (${marker})`);
      else if (file.endsWith('.map') && text.includes('sanitize-html')) {
        problems.push(`static/${file} maps sanitize-html`);
      }
    }
  }
  if (problems.length === 0) return null;
  return `The Markdown post-pass isn't wired as #10 has it: ${problems.slice(0, 10).join('; ')}${problems.length > 10 ? `; and ${problems.length - 10} more` : ''}. React Server Components get it through @portfolio/kit/markdown's react-server condition (packages/kit/src/markdown.server.ts), and no browser bundle may carry it.`;
}

function main(argv) {
  const dir = path.resolve(argv[0] ?? NEXT_DIR);
  const problem = checkMarkdownPass(dir);
  if (!problem) {
    console.log(
      `[markdown-pass] ${pageEntries(dir).length} site and preview pages load the post-pass, every server chunk with the renderer holds it, and nothing under static carries sanitize-html`,
    );
    return 0;
  }
  reportError(problem, { title: 'Markdown post-pass' });
  const gate = currentGate();
  if (gate) {
    writeFailureRecord({
      ...gate,
      test: 'the site and preview pages load the Markdown post-pass, and no browser chunk carries sanitize-html',
      expected: `every page under app/(site) and app/(preview) loads ${POST_PASS}, and nothing under .next/static holds sanitize-html`,
      actual: problem,
    });
  }
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
