import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  anchorsOf,
  checkDocs,
  checkExternal,
  externallyChecked,
  extractLinks,
  pnpmProblem,
  pnpmReferences,
  renderSummary,
  slug,
  splitMarkdown,
} from './docs-check.mjs';

function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'docs-check-'));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

const PACKAGES = {
  'package.json': JSON.stringify({ scripts: { build: 'x', 'check:docs': 'x', test: 'x' } }),
  'apps/web/package.json': JSON.stringify({
    name: '@portfolio/web',
    scripts: { 'test:profiles': 'x' },
  }),
};

test('the tree check passes good links, anchors, and scripts', () => {
  const root = tree({
    ...PACKAGES,
    'README.md':
      '# Title\n\nSee [the guide](docs/guide.md#set-up-the-data-directory), [here](#title), [img](docs/a.png), and [dir](docs/).\n\n```sh\npnpm install\npnpm build && pnpm check:docs\npnpm --filter @portfolio/web test:profiles\n```\n',
    'docs/guide.md': '# Guide\n\n## Set up the `data` directory\n\n<a id="custom"></a>\n',
    'docs/a.png': 'x',
  });
  try {
    const { problems } = checkDocs({ root, files: ['README.md', 'docs/guide.md'] });
    assert.deepEqual(problems, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the tree check reports a missing file, a missing anchor, and an unknown script', () => {
  const root = tree({
    ...PACKAGES,
    'README.md': [
      '# Title',
      '[gone](docs/gone.md)',
      '[bad anchor](docs/guide.md#nope)',
      '[out](../../etc/passwd)',
      'Run `pnpm check:nope` or `pnpm --filter @portfolio/web test:nope` or `pnpm --filter @portfolio/nope build`.',
      '```',
      '[not a link](inside/code.md)',
      '```',
    ].join('\n'),
    'docs/guide.md': '# Guide\n',
  });
  try {
    const { problems } = checkDocs({ root, files: ['README.md'] });
    assert.deepEqual(
      problems.map((p) => [p.line, p.message]),
      [
        [2, 'docs/gone.md names no file in the tree'],
        [3, 'docs/guide.md#nope: docs/guide.md has no heading or id #nope'],
        [4, '../../etc/passwd points outside the repository'],
        [5, 'pnpm check:nope: package.json has no script check:nope'],
        [5, 'pnpm test:nope: @portfolio/web has no script test:nope'],
        [5, 'pnpm build: no workspace package @portfolio/nope'],
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('code is kept out of the prose, inline and fenced', () => {
  const { prose, code } = splitMarkdown('a `pnpm x` b\n```sh\npnpm y\n```\n~~~\n[z](q)\n~~~\n');
  assert.deepEqual(
    code.map((c) => c.text.trim()),
    ['pnpm x', 'pnpm y', '[z](q)'],
  );
  assert.equal(extractLinks(prose).length, 0);
});

test('links are read from inline links, images, definitions, autolinks, and HTML', () => {
  const { prose } = splitMarkdown(
    '[a](one.md "t") ![b](two.png)\n[c]: three.md\n<https://x.dev/y> <a href="four.md">x</a>\n',
  );
  assert.deepEqual(
    extractLinks(prose).map((l) => l.url),
    ['one.md', 'two.png', 'three.md', 'https://x.dev/y', 'four.md'],
  );
});

test("anchors follow GitHub's slugs, with numbered duplicates", () => {
  assert.equal(slug('Migrating a version 2 portfolio'), 'migrating-a-version-2-portfolio');
  assert.equal(slug('The `data` directory, and **why**'), 'the-data-directory-and-why');
  assert.equal(slug('Reverse proxy & HTTPS'), 'reverse-proxy--https');
  assert.equal(slug('[Link](x.md) text'), 'link-text');
  const anchors = anchorsOf(
    '# Setup\n## Setup\n### Setup\n<a name="legacy"></a>\n```\n# not a heading\n```\n',
  );
  assert.deepEqual([...anchors].sort(), ['legacy', 'setup', 'setup-1', 'setup-2']);
});

test('pnpm references name the filter and the script', () => {
  assert.deepEqual(pnpmReferences('pnpm install && pnpm --filter @portfolio/web build:registry'), [
    { filter: null, recursive: false, script: 'install' },
    { filter: '@portfolio/web', recursive: false, script: 'build:registry' },
  ]);
  assert.deepEqual(pnpmReferences('corepack pnpm run test:routes'), [
    { filter: null, recursive: false, script: 'test:routes' },
  ]);
  // A placeholder isn't a script name.
  assert.deepEqual(pnpmReferences('pnpm ci:<job>'), []);
  const scripts = new Set(['build']);
  const packages = new Map([['@portfolio/web', new Set(['dev'])]]);
  assert.equal(pnpmProblem({ script: 'exec' }, scripts, packages), null);
  assert.equal(pnpmProblem({ script: 'test', recursive: true }, scripts, packages), null);
  assert.equal(pnpmProblem({ filter: './apps/*', script: 'x' }, scripts, packages), null);
  assert.match(pnpmProblem({ script: 'nope' }, scripts, packages), /no script nope/);
});

test('external checks skip local, reserved, and live hosts', () => {
  for (const url of [
    'https://github.com/keyurgolani/keyurgolani.name',
    'https://nodejs.org/en/about/previous-releases',
  ]) {
    assert.ok(externallyChecked(url), url);
  }
  for (const url of [
    'http://localhost:3000',
    'http://127.0.0.1:3000/x',
    'https://portfolio.test',
    'https://example.com',
    'https://www.example.org/a',
    'https://keyurgolani.name',
    'https://www.keyurgolani.name/work',
    'https://<your-host>/x',
    'mailto:a@b.c',
  ]) {
    assert.ok(!externallyChecked(url), url);
  }
});

const response = (status) => ({ status });

test('external links fail on 4xx and 5xx and network errors, and only warn on 401, 403, and 429', async () => {
  const answers = {
    'https://ok.dev/': [200],
    'https://head-refused.dev/': [405, 200],
    'https://gone.dev/': [404, 404],
    'https://down.dev/': [503, 503, 503, 503],
    'https://flaky.dev/': [502, 200],
    'https://blocked.dev/': [403, 403],
    'https://busy.dev/': [429, 429, 429, 429],
  };
  const calls = [];
  const fetchImpl = async (url, { method }) => {
    calls.push(`${method} ${url}`);
    if (url === 'https://dns.dev/')
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    return response(answers[url].shift());
  };
  const external = new Map(
    [...Object.keys(answers), 'https://dns.dev/', 'https://localhost/'].map((u) => [
      u,
      ['README.md:1'],
    ]),
  );
  const result = await checkExternal(external, { fetchImpl, concurrency: 2 });
  assert.equal(result.checked, 8);
  assert.deepEqual(result.problems.map((p) => p.message).sort(), [
    'https://dns.dev/ failed: ENOTFOUND',
    'https://down.dev/ answered 503',
    'https://gone.dev/ answered 404',
  ]);
  assert.deepEqual(result.warnings.map((w) => w.url).sort(), [
    'https://blocked.dev/',
    'https://busy.dev/',
  ]);
  assert.ok(!calls.some((c) => c.includes('localhost')));
  assert.match(
    renderSummary({ title: 'links', ...result }),
    /\| problem \| README.md:1 \| https:\/\/gone.dev\/ answered 404 \|/,
  );
});

test("the repository's own docs pass", () => {
  const { problems } = checkDocs();
  assert.deepEqual(
    problems.map((p) => `${p.file}:${p.line} ${p.message}`),
    [],
  );
});
