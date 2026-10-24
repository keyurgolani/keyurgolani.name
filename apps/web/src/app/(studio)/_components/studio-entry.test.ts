import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

/** The sources the build's /studio chunks come from, whose newest change a build must postdate. */
const SOURCES = [
  'src/app/(studio)/studio/page.tsx',
  'src/app/(studio)/_components',
  'src/lib/demo',
  'src/lib/studio',
  'src/lib/studio-fetch.ts',
].map((each) => path.join(WEB, each));

/** The newest modification time among `paths`, directories walked, tests left out. */
function newest(paths: readonly string[]): { readonly file: string; readonly at: number } {
  let found = { file: '', at: 0 };
  for (const each of paths) {
    const stat = statSync(each);
    const candidates = stat.isDirectory()
      ? readdirSync(each, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile() && !/\.test\.tsx?$/.test(entry.name))
          .map((entry) => path.join(entry.parentPath, entry.name))
      : [each];
    for (const file of candidates) {
      const at = statSync(file).mtimeMs;
      if (at > found.at) found = { file, at };
    }
  }
  return found;
}

test("a build's /studio entry holds neither shell, and each shell's chunks hold none of the other profile's code", (t) => {
  // CI's build job sets EXPECT_BUILD=1 (pnpm check:studio-chunks), right after its build:
  // there a missing or stale build fails rather than skips.
  const expected = process.env.EXPECT_BUILD === '1';
  if (!existsSync(MANIFEST)) {
    assert.ok(!expected, `EXPECT_BUILD=1, and there is no build at ${MANIFEST}`);
    t.skip('no build of apps/web in .next to read');
    return;
  }
  const built = statSync(MANIFEST).mtimeMs;
  const source = newest(SOURCES);
  if (source.at > built) {
    const stale = `the build in .next is older than ${path.relative(WEB, source.file)}: run pnpm build first`;
    assert.ok(!expected, `EXPECT_BUILD=1, and ${stale}`);
    console.warn(`STALE BUILD: ${stale}. Its /studio chunks aren't checked.`);
    t.skip(stale);
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
