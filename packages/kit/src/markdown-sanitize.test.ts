import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { isAllowedUrl } from '@portfolio/schema';
import { renderInlineMarkdown, renderMarkdown } from './markdown';
import { renderers } from './markdown-post-pass';
import * as server from './markdown.server';
import { sanitizeBlocks, sanitizeInline } from './markdown-sanitize';
import {
  ALLOWED_URLS,
  allSpellings,
  ATTRIBUTES,
  corpus,
  ELEMENTS,
  REFUSED_SCHEMES,
  TAG_FORMS,
} from './test-support/markdown-corpus';
import { destinationProblems, hrefProblems, type Allowlist } from './test-support/strict-html';

// The server's post-pass (#10): sanitize-html over the renderer's markup, with
// the renderer's own allowlist (markdown-sanitize.ts), which React Server
// Components get through the react-server condition (markdown.server.ts). On
// everything the renderer writes it changes nothing, and on what a broken
// renderer could write it leaves only the allowlist. Every body is the inert
// word x.

const KIT = fileURLToPath(new URL('../', import.meta.url));

const BLOCK = ['p', 'a', 'em', 'strong', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote'];
const ALLOWED: Record<Allowlist, ReadonlySet<string>> = {
  block: new Set([...BLOCK, 'h3', 'h4', 'h5', 'h6', 'br', 'hr']),
  inline: new Set(['a', 'em', 'strong', 'code', 'br']),
};
const SANITIZE: Record<Allowlist, (html: string) => string> = {
  block: sanitizeBlocks,
  inline: sanitizeInline,
};
const MODES = ['block', 'inline'] as const;

test('the post-pass leaves the markup the renderer writes as it is, for every corpus input, block and inline', () => {
  const entries = corpus();
  const samples = [
    '- a\n- b\n\n1. c\n\n> q\n\n```js\nx < y && z\n```\n\n| a | b |\n|-|-|\n| c | d |\n\n### h\n\n---',
    '[a link](https://example.com/a?b=1&c=2), <https://example.com>, www.example.com, and a@example.com',
    'It\'s "quoted", &copy; &#169; &#xA9; &amp; & a < b > c, and &CounterClockwiseContourIntegral;',
    '**strong** *em* `code` ~~del~~ ![alt](https://example.com/x.png) a  \nbreak',
  ];
  const changed: string[] = [];
  for (const source of [...entries.map((entry) => entry.source), ...samples]) {
    if (server.renderMarkdown(source) !== renderMarkdown(source)) changed.push(`block ${source}`);
    if (server.renderInlineMarkdown(source) !== renderInlineMarkdown(source)) {
      changed.push(`inline ${source}`);
    }
  }
  assert.ok(entries.length > 100_000, `${entries.length} corpus inputs`);
  assert.deepEqual(changed.slice(0, 10), [], `${changed.length} renders changed`);
});

/** Each tag in sanitize-html's output, with its attributes; it writes `<tag name="value">` and escapes < in text. */
function tags(html: string): Array<{ name: string; attributes: Array<[string, string]> }> {
  return Array.from(html.matchAll(/<\/?([^\s/>]+)([^>]*)>/g), ([, name = '', rest = '']) => ({
    name: name.toLowerCase(),
    attributes: Array.from(rest.matchAll(/([^\s=]+)="([^"]*)"/g), ([, key = '', value = '']) => [
      key,
      value,
    ]),
  }));
}

/**
 * What's outside the allowlist in sanitized markup: another element, another
 * attribute, or, with `hrefs`, an href the strict reader refuses.
 */
function leaks(html: string, mode: Allowlist, hrefs = true): string[] {
  const found: string[] = [];
  for (const { name, attributes } of tags(html)) {
    if (!ALLOWED[mode].has(name)) found.push(`<${name}>`);
    for (const [key, value] of attributes) {
      if (name !== 'a' || key !== 'href') found.push(`${key} on <${name}>`);
      else if (hrefs) found.push(...hrefProblems(value));
    }
  }
  return found;
}

test('the post-pass drops what a broken renderer could write: every other element in every tag form, every other attribute, and every href the link rule refuses, however it is spelled', () => {
  const allowedElements = new Set([...ALLOWED.block, 'li']);
  const injected: string[] = [];
  // Every element outside the allowlist, in each tag form, inside a paragraph.
  for (const element of ELEMENTS.filter((name) => !allowedElements.has(name.toLowerCase()))) {
    for (const form of TAG_FORMS) injected.push(`<p>x${form(element, 'title')}x</p>`);
  }
  // Every attribute on each allowed element, and on a link to an allowed URL.
  for (const attribute of ATTRIBUTES) {
    for (const element of ['p', 'em', 'strong', 'code', 'h3', 'blockquote', 'pre']) {
      injected.push(`<${element} ${attribute}="x">x</${element}>`);
    }
    injected.push(`<ul ${attribute}="x"><li ${attribute}="x">x</li></ul>`);
    injected.push(`<p><a href="https://x.test" ${attribute}="x">x</a><br ${attribute}="x"></p>`);
  }
  const problems: string[] = [];
  for (const html of injected) {
    for (const mode of MODES) {
      const found = leaks(SANITIZE[mode](html), mode);
      if (found.length > 0) problems.push(`${html} (${mode}): ${found.join(', ')}`);
    }
  }
  // Every spelling of every refused and allowed URL as a raw href, its
  // references live: a link stays only where a browser would follow it to
  // a URL the rule allows, and the link's text stays either way.
  let refused = 0;
  for (const { written, reads } of allSpellings()) {
    const value = written.replaceAll('\0', '\uFFFD').replaceAll('"', '&quot;');
    const url = reads.replaceAll('\0', '\uFFFD');
    const html = `<p><a href="${value}">x</a></p>`;
    const allowed = isAllowedUrl(url);
    for (const mode of MODES) {
      const out = SANITIZE[mode](html);
      const linked = out.includes('<a ');
      if (!allowed) refused++;
      if (linked !== allowed) {
        problems.push(`${html} (${mode}) ${linked ? 'links' : 'drops the link'}: ${out}`);
      }
      if (linked) {
        problems.push(...destinationProblems(url).map((problem) => `${html}: ${problem}`));
      }
      if (out.replace(/<[^>]*>/g, '') !== 'x')
        problems.push(`${html} (${mode}) lost its text: ${out}`);
      problems.push(...leaks(out, mode, false).map((leak) => `${html} (${mode}): ${leak}`));
    }
  }
  assert.ok(
    injected.length > 1000 && refused > 1000,
    `${injected.length} injected, ${refused} refused`,
  );
  assert.deepEqual(problems.slice(0, 10), [], `${problems.length} leaks`);
});

test('the post-pass keeps an allowed link as written, leaves a refused one going nowhere, drops script and comments, and holds inline markup to the inline allowlist', () => {
  for (const url of ALLOWED_URLS) {
    const html = `<p><a href="${url.replaceAll('&', '&amp;').replaceAll("'", '&#39;')}">x</a></p>\n`;
    assert.equal(sanitizeBlocks(html), html, url);
  }
  for (const scheme of REFUSED_SCHEMES) {
    assert.equal(sanitizeBlocks(`<p><a href="${scheme}:x">x</a></p>`), '<p><a>x</a></p>', scheme);
  }
  assert.equal(
    sanitizeBlocks('<p>x<script>x</script><style>x</style><!-- x -->x</p>'),
    '<p>xx</p>',
  );
  assert.equal(sanitizeInline('<p>x</p><h3>x</h3><ul><li>x</li></ul><hr>x<br>'), 'xxxx<br>');
  assert.equal(sanitizeBlocks('<p>x<br>x</p>\n<hr>\n'), '<p>x<br>x</p>\n<hr>\n');
  assert.equal(sanitizeBlocks(''), '');
});

test('the server entry runs the post-pass over whatever the renderer writes: a broken renderer swapped in loses its other element, attribute, and refused link', () => {
  const broken =
    '<p class="x">x<img src="https://x.test/x.png"><a href="data:x">x</a><a href="https://x.test" title="x">x</a></p>\n';
  const { block, inline } = renderers;
  try {
    renderers.block = () => broken;
    renderers.inline = () => broken;
    assert.equal(server.renderMarkdown('x'), '<p>x<a>x</a><a href="https://x.test">x</a></p>\n');
    assert.equal(server.renderInlineMarkdown('x'), 'x<a>x</a><a href="https://x.test">x</a>\n');
  } finally {
    renderers.block = block;
    renderers.inline = inline;
  }
  assert.equal(server.renderMarkdown('*x*'), renderMarkdown('*x*'));
});

/** Where `@portfolio/kit/markdown` resolves from the kit, with `conditions`. */
function resolved(conditions: string[]): string {
  return execFileSync(
    process.execPath,
    [
      ...conditions.map((condition) => `--conditions=${condition}`),
      '--input-type=module',
      '-e',
      "process.stdout.write(import.meta.resolve('@portfolio/kit/markdown'))",
    ],
    { cwd: KIT, encoding: 'utf8' },
  );
}

test('@portfolio/kit/markdown is the post-pass under the react-server condition and the renderer alone elsewhere, and RichText and the kit index import it by that name', () => {
  assert.match(resolved(['react-server']), /\/src\/markdown\.server\.ts$/);
  assert.match(resolved([]), /\/src\/markdown\.ts$/);
  for (const file of ['src/sections/rich-text.tsx', 'src/index.ts']) {
    const source = readFileSync(new URL(file, new URL('../', import.meta.url)), 'utf8');
    assert.match(source, /from '@portfolio\/kit\/markdown';/, file);
    assert.doesNotMatch(source, /from '\.\.?\/markdown';/, file);
  }
});

/** The node_modules packages a browser bundle of `@portfolio/kit/markdown` holds, with `conditions`. */
async function bundled(conditions: string[]): Promise<Set<string>> {
  const result = await build({
    stdin: { contents: "export * from '@portfolio/kit/markdown';", resolveDir: KIT, loader: 'ts' },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    conditions,
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  return new Set(
    Object.keys(result.metafile.inputs).flatMap((file) => {
      const name = /node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*node_modules\/)/.exec(file)?.[1];
      return name ? [name] : [];
    }),
  );
}

test('a browser bundle of the renderer carries no sanitize-html, and a react-server one does', async () => {
  const browser = await bundled([]);
  assert.ok(browser.has('marked'), [...browser].join(', '));
  for (const name of ['sanitize-html', 'htmlparser2', 'postcss']) {
    assert.ok(!browser.has(name), `${name} in a browser bundle`);
  }
  assert.ok((await bundled(['react-server'])).has('sanitize-html'));
});
