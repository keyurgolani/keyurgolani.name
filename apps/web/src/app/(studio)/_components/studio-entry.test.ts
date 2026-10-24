import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// What a build of /studio ships to each profile (#9): the page's entry, which
// StudioEntry is, holds neither shell, and each shell is an async chunk group
// of its own. Owner Studio's group, with everything it loads, holds none of
// Demo Studio's code, and Demo Studio's none of the owner's: its shell,
// studioFetch, its journal, or its adapter. This reads the build in
// apps/web/.next, when there is one; the browser check,
// tests/e2e/demo-studio-chunks.spec.ts, reads what each profile's page
// loads. With no build here, it has nothing to read, and says so.

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const NEXT = path.join(WEB, '.next');
const MANIFEST = path.join(
  NEXT,
  'server',
  'app',
  '(studio)',
  'studio',
  'page_client-reference-manifest.js',
);

/** Strings only Owner Studio's client code holds. */
const OWNER = [
  'The data directory is full. Your changes are kept in this browser.',
  'studio:auth-required',
  'portfolio-studio:',
  'Portfolio Studio needs JavaScript',
];
/** Strings only Demo Studio's client code holds. */
const DEMO = ['The demo changes the appearance only.', 'portfolio-demo:', 'Demo sandbox'];

const CHUNK = /static\/chunks\/[\w.-]+\.js/g;

const chunkText = (chunk: string) => readFileSync(path.join(NEXT, chunk), 'utf8');

/** `chunks`, and every chunk they name, however deep. */
function closure(chunks: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...chunks];
  while (queue.length > 0) {
    const chunk = queue.pop()!;
    if (seen.has(chunk)) continue;
    seen.add(chunk);
    queue.push(...(chunkText(chunk).match(CHUNK) ?? []));
  }
  return seen;
}

const holding = (chunks: Iterable<string>, markers: readonly string[]) =>
  markers.filter((marker) => [...chunks].some((chunk) => chunkText(chunk).includes(marker)));

test('the /studio page renders its shell through StudioEntry, with no lazy component of its own, so each response is whole and the same', () => {
  // A server-side next/dynamic resolves on the first render after start, which
  // ordered that response's payload rows differently from every later one (#9, A7).
  const page = readFileSync(
    path.join(WEB, 'src', 'app', '(studio)', 'studio', 'page.tsx'),
    'utf8',
  ).replace(/^\s*\/\/.*$/gm, '');
  assert.match(page, /from '\.\.\/_components\/studio-entry'/);
  assert.doesNotMatch(page, /next\/dynamic|\bimport\(|React\.lazy|\blazy\(/);
  assert.doesNotMatch(page, /_components\/(?:shell\/studio-shell|demo\/demo-shell)/);
});

test("a build's /studio entry holds neither shell, and each shell's chunks hold none of the other profile's code", (t) => {
  if (!existsSync(MANIFEST)) {
    t.skip('no build of apps/web in .next to read');
    return;
  }
  const scope = globalThis as { __RSC_MANIFEST?: Record<string, unknown> };
  scope.__RSC_MANIFEST = {};
  new Function(readFileSync(MANIFEST, 'utf8'))();
  const manifest = Object.values(scope.__RSC_MANIFEST)[0] as {
    entryJSFiles: Record<string, string[]>;
  };
  delete scope.__RSC_MANIFEST;
  const page = Object.entries(manifest.entryJSFiles).find(([name]) =>
    name.endsWith('/app/(studio)/studio/page'),
  )?.[1];
  assert.ok(page && page.length > 0, "the manifest names /studio's entry chunks");
  // The entry itself holds neither profile's code.
  assert.deepEqual(holding(page, [...OWNER, ...DEMO]), []);
  // Each async group the entry loads, as Turbopack writes it: a list of chunks it loads together.
  const groups = page.flatMap((chunk) =>
    [...chunkText(chunk).matchAll(/Promise\.all\(\[((?:"static\/chunks\/[^"]+",?)+)\]/g)].map(
      ([, list]) =>
        (list!.match(/static\/chunks\/[\w.-]+\.(?:js|css)/g) ?? []).filter((each) =>
          each.endsWith('.js'),
        ),
    ),
  );
  const shells = groups.map((group) => closure(group));
  const owner = shells.filter(
    (chunks) => holding(chunks, ['Portfolio Studio needs JavaScript']).length > 0,
  );
  const demo = shells.filter((chunks) => holding(chunks, ['Demo sandbox']).length > 0);
  assert.equal(owner.length, 1, "one async group holds Owner Studio's shell");
  assert.equal(demo.length, 1, "one async group holds Demo Studio's shell");
  assert.deepEqual(holding(owner[0]!, DEMO), [], "Owner Studio's chunks hold Demo Studio's code");
  assert.deepEqual(holding(demo[0]!, OWNER), [], "Demo Studio's chunks hold Owner Studio's code");
  // Each holds its own, its backend included.
  assert.deepEqual(holding(owner[0]!, OWNER), OWNER);
  assert.deepEqual(holding(demo[0]!, DEMO), DEMO);
});
