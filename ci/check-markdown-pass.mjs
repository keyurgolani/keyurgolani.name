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
// nothing under .next/static may hold sanitize-html's code or a source map
// that names it, with one exception: Demo Studio's local frame (#9),
// /preview/local, renders in the browser alone, through the same post-pass,
// which it loads there. Its page renders no Markdown on the server, so it
// must load no server chunk with the renderer. A static file may hold the
// post-pass only when the local page's client reference manifest reaches
// it, through the chunks it names and those they load on demand, and no
// other page's or route's manifest does: the build says which chunks those
// are, never a list here. CI runs it after pnpm ci:standalone.
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
/** Demo Studio's local frame (#9): the one page whose browser chunks may hold the post-pass. */
export const LOCAL_PAGE = path.join('server', 'app', '(preview)', 'preview', 'local', 'page');
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

const MANIFEST_SUFFIX = '_client-reference-manifest.js';
/** A manifest's one assignment: globalThis.__RSC_MANIFEST["<entry>"] = {...}; */
const MANIFEST = /^globalThis\.__RSC_MANIFEST\[("(?:[^"\\]|\\.)*")\] = (\{.*\});\s*$/m;
/** A browser chunk a chunk loads on demand: Turbopack's e.l("static/chunks/...") for an import(). */
const STATIC_ON_DEMAND = /"(static\/chunks\/[^"]+\.js)"/g;

/**
 * Every page's and route's client reference manifest in the build, by its
 * entry relative to `nextDir` (the page.js or route.js beside it, with no
 * extension), to what it names.
 */
export function clientManifests(nextDir) {
  const app = path.join(nextDir, 'server', 'app');
  if (!existsSync(app)) return new Map();
  const found = new Map();
  for (const file of files(app).filter((name) => name.endsWith(MANIFEST_SUFFIX))) {
    const text = readFileSync(path.join(app, file), 'utf8');
    const match = MANIFEST.exec(text);
    const entry = path.join('server', 'app', file.slice(0, -MANIFEST_SUFFIX.length));
    // One the check can't read reaches every chunk, so it can't let one pass.
    found.set(entry, match ? JSON.parse(match[2]) : null);
  }
  return found;
}

/** A browser chunk's path relative to .next, as a manifest or a chunk names it. */
const staticChunk = (chunk) => chunk.replace(/^\/?_next\//, '');

/**
 * The browser chunks a page's or route's manifest reaches, relative to
 * `nextDir`: the ones it names for the entry and each client module, the
 * ones every page loads (build-manifest.json's root and polyfill files), and
 * every one those load on demand, in turn. Null for a manifest the check
 * can't read.
 */
export function clientChunksOf(nextDir, manifest) {
  if (manifest === null) return null;
  const buildManifest = path.join(nextDir, 'build-manifest.json');
  const shared = existsSync(buildManifest) ? JSON.parse(readFileSync(buildManifest, 'utf8')) : {};
  const named = [
    ...(shared.rootMainFiles ?? []),
    ...(shared.polyfillFiles ?? []),
    ...Object.values(manifest.entryJSFiles ?? {}).flat(),
    ...Object.values(manifest.clientModules ?? {}).flatMap((module) => module.chunks ?? []),
  ].map(staticChunk);
  const seen = new Set(named);
  const found = [...seen];
  for (let index = 0; index < found.length; index += 1) {
    const file = path.join(nextDir, found[index]);
    if (!existsSync(file)) continue;
    for (const [, chunk] of readFileSync(file, 'utf8').matchAll(STATIC_ON_DEMAND)) {
      if (seen.has(chunk)) continue;
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
    } else if (page === `${LOCAL_PAGE}.js`) {
      // The local frame renders in the browser alone, so no server render of it has the renderer.
      if (sources.some((list) => list.some((source) => source.endsWith(RENDERER)))) {
        problems.push(
          `${page}, Demo Studio's local frame, loads a server chunk with the renderer (${RENDERER}), though it renders no Markdown on the server`,
        );
      }
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
  // Which pages and routes reach each browser chunk, by their manifests.
  const reachedBy = new Map();
  const unreadable = [];
  for (const [entry, manifest] of clientManifests(nextDir)) {
    const chunks = clientChunksOf(nextDir, manifest);
    if (chunks === null) unreadable.push(entry);
    for (const chunk of chunks ?? []) {
      if (!reachedBy.has(chunk)) reachedBy.set(chunk, new Set());
      reachedBy.get(chunk).add(entry);
    }
  }
  /** What is wrong with static `file` holding the post-pass, or null when the local frame alone reaches it. */
  const unscoped = (file, what) => {
    const chunk = `static/${file.endsWith('.map') ? file.slice(0, -'.map'.length) : file}`;
    const by = reachedBy.get(chunk) ?? new Set();
    if (!by.has(LOCAL_PAGE)) return `static/${file} ${what}`;
    if (unreadable.length > 0) {
      return `static/${file} ${what}, and ${unreadable.join(', ')} has a client reference manifest the check can't read, so it can't tell what else reaches it`;
    }
    const others = [...by].filter((entry) => entry !== LOCAL_PAGE).sort();
    if (others.length > 0) {
      return `static/${file} ${what}, and ${others.join(', ')} reaches it beside ${LOCAL_PAGE}`;
    }
    return null;
  };
  const staticDir = path.join(nextDir, 'static');
  if (existsSync(staticDir)) {
    for (const file of files(staticDir)) {
      const text = readFileSync(path.join(staticDir, file), 'utf8');
      const marker = MARKERS.find((name) => text.includes(name));
      const problem = marker
        ? unscoped(file, `holds sanitize-html's code (${marker})`)
        : file.endsWith('.map') && text.includes('sanitize-html')
          ? unscoped(file, 'maps sanitize-html')
          : null;
      if (problem) problems.push(problem);
    }
  }
  if (problems.length === 0) return null;
  return `The Markdown post-pass isn't wired as #10 has it: ${problems.slice(0, 10).join('; ')}${problems.length > 10 ? `; and ${problems.length - 10} more` : ''}. React Server Components get it through @portfolio/kit/markdown's react-server condition (packages/kit/src/markdown.server.ts), and no browser bundle may carry it but the chunks Demo Studio's local frame (${LOCAL_PAGE}) alone loads, through @portfolio/kit/markdown-local.`;
}

function main(argv) {
  const dir = path.resolve(argv[0] ?? NEXT_DIR);
  const problem = checkMarkdownPass(dir);
  if (!problem) {
    const pages = pageEntries(dir);
    const local = pages.includes(`${LOCAL_PAGE}.js`);
    console.log(
      `[markdown-pass] ${pages.length - (local ? 1 : 0)} site and preview pages load the post-pass, every server chunk with the renderer holds it, and nothing under static carries sanitize-html${local ? ' but what the local frame alone loads, which renders no Markdown on the server' : ''}`,
    );
    return 0;
  }
  reportError(problem, { title: 'Markdown post-pass' });
  const gate = currentGate();
  if (gate) {
    writeFailureRecord({
      ...gate,
      test: 'the site and preview pages load the Markdown post-pass, and no browser chunk carries sanitize-html but the local frame alone',
      expected: `every page under app/(site) and app/(preview) but ${LOCAL_PAGE} loads ${POST_PASS}, ${LOCAL_PAGE} loads no server chunk with the renderer, and nothing under .next/static holds sanitize-html but chunks ${LOCAL_PAGE}'s client manifest alone reaches`,
      actual: problem,
    });
  }
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
