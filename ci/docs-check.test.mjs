import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  anchorsOf,
  checkDocs,
  checkExternal,
  privateIPv4,
  privateIPv6,
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
    // A trailing dot is the same host.
    'https://keyurgolani.name./x',
    'https://localhost./x',
    'https://app.local/x',
    'https://foo.localhost/x',
    // Private, loopback, link-local, and shared ranges, and mapped IPv6.
    'http://10.1.2.3/x',
    'http://172.16.0.1/x',
    'http://172.31.255.255/x',
    'http://192.168.1.1/x',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/x',
    'http://0.0.0.0/x',
    'http://2130706433/x',
    'http://[::1]/x',
    'http://[::ffff:127.0.0.1]/x',
    'http://[::ffff:10.0.0.1]/x',
    'http://[fe80::1]/x',
    'http://[fd00::1]/x',
    'https://user:pass@github.com/x',
  ]) {
    assert.ok(!externallyChecked(url), url);
  }
});

const response = (status, location) => ({
  status,
  headers: { get: (name) => (name === 'location' ? (location ?? null) : null) },
});
const PUBLIC_DNS = async () => [{ address: '93.184.215.14', family: 4 }];

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
  const result = await checkExternal(external, {
    fetchImpl,
    lookupImpl: PUBLIC_DNS,
    concurrency: 2,
  });
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

test('a redirect is followed by hand, and each hop is checked before it is requested', async () => {
  const requested = [];
  const hops = {
    'https://a.dev/': response(301, '/moved'),
    'https://a.dev/moved': response(302, 'https://b.dev/final'),
    'https://b.dev/final': response(200),
    'https://to-live.dev/': response(301, 'https://keyurgolani.name./studio'),
    'https://to-metadata.dev/': response(302, 'http://169.254.169.254/latest/meta-data'),
    'https://to-mapped.dev/': response(302, 'http://[::ffff:127.0.0.1]:3000/'),
  };
  const fetchImpl = async (url, init) => {
    assert.equal(init.redirect, 'manual');
    requested.push(url);
    return hops[url] ?? response(500);
  };
  const external = new Map(
    Object.keys(hops)
      .filter((u) => !u.includes('moved') && !u.includes('final'))
      .map((u) => [u, ['README.md:1']]),
  );
  const result = await checkExternal(external, {
    fetchImpl,
    lookupImpl: PUBLIC_DNS,
    concurrency: 1,
  });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.warnings.map((w) => w.message).sort(), [
    "http://169.254.169.254/latest/meta-data is a host CI doesn't request; not requested",
    "http://[::ffff:7f00:1]:3000/ is a host CI doesn't request; not requested",
    "https://keyurgolani.name./studio is a host CI doesn't request; not requested",
  ]);
  assert.ok(requested.includes('https://b.dev/final'));
  assert.ok(
    !requested.some((u) => /keyurgolani\.name|169\.254|\[::ffff/.test(u)),
    requested.join(' '),
  );
});

test('a redirect loop stops after 5 hops and fails', async () => {
  let n = 0;
  const fetchImpl = async () => response(302, `https://loop.dev/${++n}`);
  const result = await checkExternal(new Map([['https://loop.dev/0', ['README.md:1']]]), {
    fetchImpl,
    lookupImpl: PUBLIC_DNS,
  });
  assert.deepEqual(
    result.problems.map((p) => p.message),
    ['https://loop.dev/0 failed: more than 5 redirects'],
  );
  // Two attempts of six requests each, never more.
  assert.equal(n, 12);
});

test('a name that resolves to a private address is never requested', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    return response(200);
  };
  const lookupImpl = async (host) =>
    host === 'rebind.dev'
      ? [
          { address: '93.184.215.14', family: 4 },
          { address: '10.0.0.5', family: 4 },
        ]
      : host === 'six.dev'
        ? [{ address: '::ffff:192.168.0.1', family: 6 }]
        : [{ address: '93.184.215.14', family: 4 }];
  const external = new Map([
    ['https://rebind.dev/', ['a.md:1']],
    ['https://six.dev/', ['a.md:2']],
    ['https://fine.dev/', ['a.md:3']],
  ]);
  const result = await checkExternal(external, { fetchImpl, lookupImpl });
  assert.deepEqual(requested, ['https://fine.dev/']);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.warnings.map((w) => w.url).sort(), [
    'https://rebind.dev/',
    'https://six.dev/',
  ]);
});

test('address ranges', () => {
  for (const a of [
    '10.0.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.168.0.1',
    '100.64.0.1',
    '0.1.2.3',
    '224.0.0.1',
    '255.255.255.255',
  ])
    assert.ok(privateIPv4(a), a);
  for (const a of ['8.8.8.8', '172.32.0.1', '93.184.215.14']) assert.ok(!privateIPv4(a), a);
  for (const a of [
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'fe80::1',
    'fd12::1',
    'fc00::1',
    '64:ff9b::a00:1',
    '2002:a00:1::',
    'ff02::1',
  ])
    assert.ok(privateIPv6(a), a);
  assert.ok(!privateIPv6('2606:4700::1111'));
});
