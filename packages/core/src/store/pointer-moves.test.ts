import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { memoryAuditSink } from '../audit/sink';
import { revisionCatalogReader } from './reader';
import { claimServer } from './server-claim';
import { preflight } from './preflight';
import { nodeFs, takePointerPass, type PointerPass } from './fs-port';
import { storePaths } from './layout';
import {
  contentVariant,
  mediaDocument,
  newStore,
  owned,
  pairInput,
  publishInput,
  tempDir,
  testChecks,
} from './test-support/fixtures';
import { relativeImports } from './test-support/imports';

// What moves the published pointer (#3, item 20; threat publish-3): the
// PublicationService alone. The commit point, writeLive(), is in commit.ts,
// which only publication.ts imports; besides the module that names the
// store's paths, only four name the pointer's file, and three of them only
// read it; and every store operation outside the PublicationService leaves
// live.json as it was. That much is a lint, which a module that means to
// can get past. At run time, the store's FsPort refuses to move the
// pointer's paths for any module but commit.ts, which alone holds the pass.

const STORE = fileURLToPath(new URL('.', import.meta.url));
const REPO = path.resolve(STORE, '../../../..');
const SOURCE_DIRS = ['apps/web/src', 'apps/web/scripts', 'apps/web/bin', 'packages'];
const SKIPPED = new Set(['node_modules', '__fixtures__', 'test-support', 'generated', 'dist']);

/** Every source file under `dir`, tests and their helpers aside. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : walk(full);
    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name)) return [];
    return [full];
  });
}

/** Every source file of the app and the packages. */
const sources = () => SOURCE_DIRS.flatMap((dir) => walk(path.join(REPO, dir)));

/** A file's text without its comment lines, which may name anything. */
const code = (file: string) => readFileSync(file, 'utf8').replace(/^\s*(?:\/\/|\/\*|\*).*$/gm, '');

const relativeTo = (file: string) => path.relative(REPO, file).split(path.sep).join('/');

/** The calls that make or replace a file or a directory where they're pointed. */
const MOVES = /\b(?:rename|link|symlink|writeFile|copyFile|cp)(?:Sync)?\s*\(/g;

/**
 * Each call in `text` that makes or replaces something at a target naming
 * the publication directory or live.json: its arguments mention
 * `publication` or `live` as a word, such as `paths.live`, a `live` taken
 * out of the store's paths, or a path spelled out.
 */
function movesNamingThePointer(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(MOVES)) {
    let depth = 1;
    let at = match.index + match[0].length;
    for (; at < text.length && depth > 0; at++) {
      if (text[at] === '(') depth += 1;
      if (text[at] === ')') depth -= 1;
    }
    const args = text.slice(match.index + match[0].length, at - 1);
    if (/\b(?:publication|live)\b/.test(args)) found.push(`${match[0]}${args})`);
  }
  return found;
}

/** `file`'s syntax tree, and where in it a node starts, as `<file>:<line>: <text>`. */
function treeOf(file: string) {
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const at = (node: ts.Node) =>
    `${relativeTo(file)}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${node.getText()}`;
  return { tree, at };
}

/** The key a destructuring takes, when it's spelled out: a name, a string, or `['live']`. */
function keyOf(name: ts.PropertyName | ts.BindingName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text;
  }
  return undefined;
}

/**
 * Each place `file` takes `live` or `publication` out of an object by
 * destructuring, whatever name it binds, as `<file>: <the destructuring>`:
 * `const { live: target } = paths`, a parameter's pattern, or an
 * assignment's, `({ publication: dir } = paths)`.
 */
function destructuresThePointer(file: string): string[] {
  const { tree } = treeOf(file);
  const found: string[] = [];
  const pointer = (key: string | undefined) => key === 'live' || key === 'publication';
  const whole = (node: ts.Node) => {
    let at = node;
    while (!ts.isVariableDeclaration(at) && !ts.isParameter(at) && !ts.isBinaryExpression(at)) {
      at = at.parent;
    }
    return `${relativeTo(file)}: ${at.getText().replace(/\s+/g, ' ')}`;
  };
  const visit = (node: ts.Node) => {
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      if (pointer(keyOf(node.propertyName ?? node.name))) found.push(whole(node));
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isObjectLiteralExpression(node.left)
    ) {
      for (const property of node.left.properties) {
        if (
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
          pointer(keyOf(property.name))
        ) {
          found.push(whole(node));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/**
 * Each import() in `file` whose specifier no scan can read: anything but a
 * string or a template with nothing in it, so what it loads, commit.ts
 * among what it could, can't be told from the source.
 */
function computedImports(file: string): string[] {
  const { tree, at } = treeOf(file);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments;
      if (!specifier || !ts.isStringLiteralLike(specifier)) found.push(at(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/** The bytes and inode of live.json, which a move over it changes. */
function pointerFile(file: string) {
  return { bytes: readFileSync(file).toString('utf8'), ino: statSync(file).ino };
}

test('no code outside PublicationService moves the published pointer', async (t) => {
  const files = sources();
  assert.ok(files.length > 100, `${files.length} source files`);

  // Only the PublicationService imports the commit point, `import()` included.
  const commit = path.join(STORE, 'commit.ts');
  assert.deepEqual(files.filter((file) => relativeImports(file).includes(commit)).map(relativeTo), [
    'packages/core/src/store/publication.ts',
  ]);
  // An import() whose specifier can't be read could load it too. The one
  // there is, in the variant registry, loads each registered variant's
  // built entry by its resolved path.
  assert.deepEqual(
    [...new Set(files.flatMap(computedImports).map((found) => found.split(':')[0]))],
    ['packages/variant-contract/src/node/registry.ts'],
  );
  // The pass a move of the pointer takes at run time: fs-port.ts makes it,
  // and commit.ts takes it as it loads.
  assert.deepEqual(
    files
      .filter((file) => /\btakePointerPass\b/.test(code(file)))
      .map(relativeTo)
      .sort(),
    ['packages/core/src/store/commit.ts', 'packages/core/src/store/fs-port.ts'],
  );
  assert.deepEqual(
    files
      .filter((file) => /\bfunction writeLive\b/.test(readFileSync(file, 'utf8')))
      .map(relativeTo),
    ['packages/core/src/store/commit.ts'],
  );
  // The pointer's file, by the store's paths: commit.ts writes it, and
  // pointer.ts, the reader, and the health cache, which stats it to tell
  // when it moved, only read it. No other module names it, or names
  // live.json at all; the service's repair finds a temporary one a crash
  // left by its name pattern.
  const named = (key: string) => (file: string) =>
    new RegExp(`(?:\\bpaths|\\bstorePaths\\([^()]*\\))\\.${key}\\b`).test(code(file));
  assert.deepEqual(files.filter(named('(?:live|liveTemp)')).map(relativeTo).sort(), [
    'packages/core/src/store/commit.ts',
    'packages/core/src/store/health-cache.ts',
    'packages/core/src/store/pointer.ts',
    'packages/core/src/store/reader.ts',
  ]);
  // publication/ itself: preflight makes it, and the service syncs it and
  // clears what a crash left in it. No other module names it.
  assert.deepEqual(files.filter(named('publication')).map(relativeTo).sort(), [
    'packages/core/src/store/preflight.ts',
    'packages/core/src/store/publication.ts',
  ]);
  // Nor does any module take either out of the store's paths, or out of
  // anything, under another name, but Studio's store, which takes the
  // PublicationService out of the Store.
  assert.deepEqual(files.flatMap(destructuresThePointer), [
    'apps/web/src/server/owner/store.ts: { drafts, publication } = store',
  ]);
  // The health cache and the reader only read: they import nothing that writes.
  for (const reader of ['health-cache.ts', 'reader.ts']) {
    const imports = relativeImports(path.join(STORE, reader)).map(relativeTo);
    for (const writer of ['commit.ts', 'publication.ts', 'drafts.ts', 'assets.ts', 'lock.ts']) {
      assert.ok(
        !imports.includes(`packages/core/src/store/${writer}`),
        `${reader} imports ${writer}`,
      );
    }
  }
  // live.json anywhere in a string or a template, as in 'publication/live.json':
  // only the module that names the store's paths, pointer.ts's error, and
  // the FsPort, which knows the pointer's paths by their names to guard them.
  assert.deepEqual(
    files
      .filter((file) => /['"`][^'"`\n]*\blive\.json/.test(code(file)))
      .map(relativeTo)
      .sort(),
    [
      'packages/core/src/store/fs-port.ts',
      'packages/core/src/store/layout.ts',
      'packages/core/src/store/pointer.ts',
    ],
  );
  // And no write outside commit.ts points at publication/ or live.json, by
  // whatever name it got the path.
  assert.deepEqual(
    files
      .filter((file) => file !== commit)
      .flatMap((file) =>
        movesNamingThePointer(code(file)).map((call) => `${relativeTo(file)}: ${call}`),
      ),
    [],
  );

  // And at run time: every store operation but the PublicationService's,
  // one after another, leaves live.json as it was.
  const store = await newStore(t, { audit: memoryAuditSink() });
  const live = await publishInput(store, pairInput('engineering'));
  const before = pointerFile(store.paths.live);
  const blob = await store.assets.put(Buffer.from('a blob'), 'text/plain');
  const created = await store.drafts.create(
    {
      documents: {
        ...contentVariant(pairInput('engineering'), 'draft'),
        media: mediaDocument([blob.sha256]),
      },
    },
    'owner',
  );
  assert.equal(created.kind, 'saved');
  if (created.kind !== 'saved') return;
  const saved = await store.drafts.save(
    {
      draftId: created.draft.draftId,
      expectedVersion: created.draft.version,
      documents: contentVariant(pairInput('engineering'), 'saved'),
    },
    'owner',
  );
  assert.equal(saved.kind, 'saved');
  if (saved.kind !== 'saved') return;
  const edited = await store.drafts.applyEdits(
    {
      draftId: saved.draft.draftId,
      expectedVersion: saved.draft.version,
      edits: [{ document: 'portfolio', pointer: '/meta/description', op: 'set', value: 'Edited.' }],
    },
    'owner',
  );
  assert.equal(edited.kind, 'saved');
  if (edited.kind !== 'saved') return;
  const rebased = await store.drafts.rebase(
    {
      draftId: edited.draft.draftId,
      expectedVersion: edited.draft.version,
      documents: pairInput('engineering'),
      baseRevisionId: live,
    },
    'owner',
  );
  assert.equal(rebased.kind, 'saved');
  if (rebased.kind !== 'saved') return;
  await store.lock.withLock('test', async () => {});
  const claim = await claimServer({ fs: nodeFs, paths: store.paths });
  assert.ok(claim.ok);
  if (claim.ok) await claim.claim.release();
  assert.equal(await preflight({ dataDir: store.paths.root }), null);
  const reader = revisionCatalogReader({ dataDir: store.paths.root, checks: testChecks() });
  await reader.getLive();
  await reader.status();
  const discarded = await store.drafts.discard(
    { draftId: rebased.draft.draftId, expectedVersion: rebased.draft.version },
    'owner',
  );
  assert.equal(discarded.kind, 'discarded');
  assert.deepEqual(pointerFile(store.paths.live), before);

  // The PublicationService does move it.
  const moved = await owned(store).recover(
    { targetRevisionId: live, expectedLiveRevisionId: live },
    'owner',
  );
  assert.equal(moved.kind === 'rejected' && moved.code, 'nothing_to_publish');
  await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  assert.notDeepEqual(pointerFile(store.paths.live), before);
});

test("the store's FsPort moves the pointer's paths for commit.ts alone: without its pass, a rename, a link, a write in place, or a removal is EPERM", async (t) => {
  const store = await newStore(t);
  await publishInput(store, pairInput('engineering'));
  const { paths } = store;
  const before = pointerFile(paths.live);
  const staged = path.join(paths.root, 'staged.json');
  writeFileSync(staged, '{}\n');
  const refused = (error: unknown) => (error as NodeJS.ErrnoException).code === 'EPERM';
  const alias = path.join(tempDir(t, 'store-alias-'), 'data');
  symlinkSync(paths.root, alias);
  const moves: Array<[string, () => Promise<void>]> = [
    ['a rename over live.json', () => nodeFs.rename(staged, paths.live, 'test')],
    ['a rename of live.json away', () => nodeFs.rename(paths.live, staged, 'test')],
    ['a rename over publication/', () => nodeFs.rename(staged, paths.publication, 'test')],
    ['a rename of events/ away', () => nodeFs.rename(paths.events, staged, 'test')],
    ['a rename over an event', () => nodeFs.rename(staged, paths.event(2), 'test')],
    ['an event moved aside', () => nodeFs.rename(paths.event(1), paths.eventAside(1), 'test')],
    ['a link at an event', () => nodeFs.link(staged, paths.event(2), 'test')],
    ['live.json written in place', () => nodeFs.writeFile(paths.live, '{}\n', 'test')],
    [
      'an event written in place',
      () => nodeFs.writeFile(paths.event(2), '{}\n', 'test', { exclusive: true }),
    ],
    ['live.json removed', () => nodeFs.remove(paths.live, 'test')],
    ['publication/ removed', () => nodeFs.remove(paths.publication, 'test')],
    // By another spelling of the data directory, too.
    ['live.json through a link', () => nodeFs.rename(staged, storePaths(alias).live, 'test')],
    [
      'live.json spelled with ..',
      () => nodeFs.rename(staged, [paths.events, '..', 'live.json'].join(path.sep), 'test'),
    ],
    // A pass of a module's own is none.
    [
      'a pass made up',
      () => nodeFs.rename(staged, paths.live, 'test', Symbol('pointer pass') as PointerPass),
    ],
  ];
  for (const [what, move] of moves) await assert.rejects(move(), refused, what);
  assert.deepEqual(pointerFile(paths.live), before);
  assert.deepEqual(readdirSync(paths.events), ['1.json']);
  // And commit.ts holds the one there is, taken as it loaded.
  assert.throws(() => takePointerPass(), /commit\.ts holds the pointer pass/);

  // What isn't the pointer's moves as before: a temporary file beside
  // live.json, and the lock's and the claim's files, which their own tests
  // cover.
  const temp = path.join(paths.publication, '.live.json.0123456789ab.tmp');
  await nodeFs.writeFile(temp, '{}\n', 'test');
  await nodeFs.rename(temp, `${temp}.moved`, 'test');
  await nodeFs.remove(`${temp}.moved`, 'test');
  // And the PublicationService moves the pointer, through commit.ts.
  await publishInput(store, contentVariant(pairInput('engineering'), 'two'));
  assert.notDeepEqual(pointerFile(paths.live), before);
});
