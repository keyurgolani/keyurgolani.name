import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderInlineMarkdown, renderMarkdown, setMarkdownPostPass } from './markdown';
import { installPostPass, requirePostPass } from './markdown-local';
import * as server from './markdown.server';
import { corpus } from './test-support/markdown-corpus';

// The browser's post-pass (#9, B's conditions on it): it fails closed, it is
// markdown-sanitize.ts's own pass and no other, it installs once and stays,
// and only a browser installs it. Node runs each test file in a process of
// its own, so this file's document is the one these tests install into.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const HOSTILE = '**bold** <img src=x onerror=alert(1)> [x](javascript:alert(1)) <script>1</script>';

test('only a browser may ask for or install the post-pass, so no server render has it', async () => {
  assert.throws(() => requirePostPass(), /browser alone/);
  assert.throws(() => installPostPass(), /browser alone/);
  // Nothing asked: the renderer is the renderer, as it is wherever no frame installs the pass.
  assert.equal(renderMarkdown('**x**'), '<p><strong>x</strong></p>\n');
});

test('once asked for, Markdown renders nothing until the pass is in, then exactly the server pass, which stays', async () => {
  // A document, as the frame is.
  Object.assign(globalThis, { window: globalThis, document: {} });
  requirePostPass();
  // Before the chunk arrives, and with no chunk at all: nothing, never the renderer's markup.
  assert.equal(renderMarkdown(HOSTILE), '');
  assert.equal(renderInlineMarkdown(HOSTILE), '');
  await installPostPass();
  // The same promise for a second call, and no second install.
  await installPostPass();
  for (const source of [HOSTILE, ...corpus().map((entry) => entry.source)]) {
    assert.equal(renderMarkdown(source), server.renderMarkdown(source), source);
    assert.equal(renderInlineMarkdown(source), server.renderInlineMarkdown(source), source);
  }
  // Inert: the markup is escaped text, with no element or link it names.
  assert.doesNotMatch(renderMarkdown(HOSTILE), /<img|<script|href="javascript:/);
  // It can't be replaced or removed.
  assert.throws(
    () => setMarkdownPostPass({ block: (html) => html, inline: (html) => html }),
    /already installed/,
  );
  assert.equal(renderMarkdown(HOSTILE), server.renderMarkdown(HOSTILE));
});

/** Every source file under the workspace's packages and the web app, tests aside. */
function sources(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'generated', '.next', 'test-support'].includes(entry.name)
        ? []
        : sources(file);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

test("the hook's one caller passes markdown-sanitize.ts's own pass, and one module installs it", () => {
  const files = [...sources('packages'), ...sources('apps/web/src')];
  const callers = (pattern: RegExp) =>
    files.filter((file) => pattern.test(readFileSync(path.join(ROOT, file), 'utf8')));
  // markdown.ts defines the hook; markdown-local.ts alone calls it.
  assert.deepEqual(callers(/\bsetMarkdownPostPass\(/), [
    path.join('packages', 'kit', 'src', 'markdown-local.ts'),
    path.join('packages', 'kit', 'src', 'markdown.ts'),
  ]);
  const local = readFileSync(path.join(ROOT, 'packages/kit/src/markdown-local.ts'), 'utf8');
  assert.match(local, /import\('\.\/markdown-sanitize'\)/);
  assert.match(local, /setMarkdownPostPass\(\{ block: sanitizeBlocks, inline: sanitizeInline \}\)/);
  // And one module of the web app installs it: Demo Studio's local preview frame.
  assert.deepEqual(callers(/\binstallPostPass\(/), [
    path.join('apps', 'web', 'src', 'app', '(preview)', '_local', 'local-document.tsx'),
    path.join('packages', 'kit', 'src', 'markdown-local.ts'),
  ]);
});
