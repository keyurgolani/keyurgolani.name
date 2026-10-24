// The catalog provenance check (#20, #12), offline: every request goes to a
// stubbed fetch, and every DNS lookup to a stubbed resolver.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BACKOFF_MS,
  catalogEntries,
  checkProvenance,
  copyrightLines,
  detectSpdx,
  githubPin,
  main,
  MAX_REDIRECTS,
  recordFor,
  tokenFor,
} from './check-catalog-provenance.mjs';
import { REPO_ROOT } from './lib/reports.mjs';
import { loadValidator } from './summarize.mjs';

const TOKEN = 'test-token-not-a-secret-7f3a';
const SELF = 'https://github.com/keyurgolani/keyurgolani.name';
const ZINC = 'https://github.com/tailwindlabs/tailwindcss/blob/v3.4.17/src/public/colors.js';
const FIXTURE_URL = 'https://fixtures.example.org/never-requested';

const MIT = `MIT License

Copyright (c) Tailwind Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
`;
const APACHE = `
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   APPENDIX: How to apply the Apache License to your work.
      Copyright [yyyy] [name of copyright owner]
`;
const OFL = `Copyright 2010 The Acme Project Authors

This Font Software is licensed under the SIL Open Font License, Version 1.1.
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
`;

// --- a tree to check ------------------------------------------------------

const write = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};

const provenance = (url, extra = {}) => ({
  source: { name: 'Somewhere', url },
  license: 'first-party',
  attribution: 'Someone.',
  researchedAt: '2026-10-17',
  maintainer: 'keyurgolani',
  ...extra,
});

/**
 * A tree like next's: one first-party pack per axis, a held language, a
 * Research record, a generated scheme, an upstream scheme pinned to a tag,
 * and a fixture package whose packs must never be read.
 */
function tree({ zinc = {}, research = SELF, generatedFile = 'example-media/one.png' } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'provenance-'));
  const pkg = (dir, kind, extra = {}) =>
    write(path.join(root, 'packages', dir, 'package.json'), {
      name: `@portfolio/${dir}`,
      portfolio: { kind, packs: './packs', ...extra },
    });
  const pack = (dir, sub, id, prov) =>
    write(path.join(root, 'packages', dir, sub, id, 'manifest.json'), { id, provenance: prov });

  pkg('appearance-languages', 'design-language');
  pack('appearance-languages', 'packs', 'platform-neutral', provenance(SELF));
  pack('appearance-languages', 'held', 'frutiger-aero', provenance(SELF));
  pkg('appearance-schemes', 'color-scheme');
  pack('appearance-schemes', 'packs', 'warm-parchment', provenance(SELF));
  pack(
    'appearance-schemes',
    'packs',
    'zinc',
    provenance(ZINC, {
      license: 'MIT',
      copyright: 'Copyright (c) Tailwind Labs, Inc.',
      ...zinc,
    }),
  );
  if (research !== null) {
    write(path.join(root, 'packages', 'appearance-schemes', 'research', 'nord.json'), {
      id: 'nord',
      kind: 'color-scheme',
      tier: 'research',
      source: { name: 'Nord', url: research },
      license: 'unverified',
    });
  }
  write(path.join(root, 'packages', 'appearance-schemes', 'generated', 'profile-image.json'), {
    scheme: 'profile-image',
    source: { sourceAsset: 'portrait', file: generatedFile },
  });
  write(path.join(root, 'packages', 'appearance-schemes', 'generated', 'brand-seed.json'), {
    scheme: 'brand-seed',
    source: { seedColor: '#5b5bd6' },
  });
  write(path.join(root, 'example-media', 'one.png'), 'png');
  pkg('appearance-typography', 'typography');
  pack('appearance-typography', 'packs', 'humanist-ui', provenance(SELF));
  // A fixture package, by its flag and by its name: never read.
  pkg('appearance-fixtures-schemes', 'color-scheme', { fixture: true });
  pack('appearance-fixtures-schemes', 'packs', 'fixture-seed', provenance(FIXTURE_URL));
  write(path.join(root, 'packages', 'appearance-fixtures-schemes', 'research', 'r.json'), {
    id: 'fixture-research',
    kind: 'color-scheme',
    source: { name: 'x', url: FIXTURE_URL },
  });
  pkg('quality-fixtures-languages', 'design-language');
  pack('quality-fixtures-languages', 'packs', 'fixture-language', provenance(FIXTURE_URL));
  // A variant isn't a pack package.
  write(path.join(root, 'packages', 'variant-x', 'package.json'), {
    name: '@portfolio/variant-x',
    portfolio: { kind: 'variant' },
  });
  write(path.join(root, 'packages', 'variant-x', 'manifest.json'), {
    id: 'x',
    provenance: provenance(FIXTURE_URL),
  });
  return root;
}

// --- a stubbed network ----------------------------------------------------

const response = (status, { body = null, location, text } = {}) =>
  new Response(text ?? body, {
    status,
    headers: location ? { location } : {},
  });

const TAG = 'https://api.github.com/repos/tailwindlabs/tailwindcss/git/ref/tags/v3.4.17';
const LATEST = 'https://api.github.com/repos/tailwindlabs/tailwindcss/releases/latest';
const TAGS = 'https://api.github.com/repos/tailwindlabs/tailwindcss/tags?per_page=100';
const RAW_LICENSE = 'https://raw.githubusercontent.com/tailwindlabs/tailwindcss/v3.4.17/LICENSE';

/** Every upstream answer healthy: the pin's tag, its MIT license, and v3.4.17 as latest. */
function healthy() {
  return {
    [SELF]: () => response(200),
    [ZINC]: () => response(200),
    [TAG]: () => response(200, { text: '{"ref":"refs/tags/v3.4.17"}' }),
    [LATEST]: () => response(200, { text: '{"tag_name":"v3.4.17"}' }),
    [RAW_LICENSE]: () => response(200, { text: MIT }),
  };
}

/**
 * A fetch over `routes` (url to a handler), recording each request. An
 * unrouted URL answers 599, which no test expects, so it shows.
 */
function network(routes = {}) {
  const requests = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl = async (url, init) => {
    requests.push({ url, method: init.method, headers: { ...init.headers }, init });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      const handler = routes[url];
      if (!handler) return response(599);
      return await handler(init, requests.filter((r) => r.url === url).length);
    } finally {
      inFlight--;
    }
  };
  return { requests, fetchImpl, maxInFlight: () => maxInFlight };
}

const publicDns = async () => [{ address: '140.82.112.3', family: 4 }];

async function run(root, routes, options = {}) {
  const net = network({ ...healthy(), ...routes });
  const sleeps = [];
  const result = await checkProvenance({
    root,
    fetchImpl: net.fetchImpl,
    lookupImpl: options.lookupImpl ?? publicDns,
    sleep: async (ms) => sleeps.push(ms),
    token: options.token,
  });
  return { ...result, net, sleeps };
}

const kinds = (findings) => findings.map((f) => `${f.kind} ${f.pack} ${f.field}`);

// --- what it reads --------------------------------------------------------

test('it reads shipping, held, Research, and generated entries, and never a fixture package', () => {
  const root = tree();
  try {
    const { sources, upstream, files } = catalogEntries(root);
    assert.deepEqual(sources.map((s) => `${s.axis} ${s.pack} ${s.field}`).sort(), [
      'colorScheme nord source.url',
      'colorScheme warm-parchment provenance.source.url',
      'colorScheme zinc provenance.source.url',
      'designLanguage frutiger-aero provenance.source.url',
      'designLanguage platform-neutral provenance.source.url',
      'typography humanist-ui provenance.source.url',
    ]);
    assert.deepEqual(
      upstream.map((u) => [u.pack, u.license, u.pin]),
      [
        [
          'zinc',
          'MIT',
          { owner: 'tailwindlabs', repo: 'tailwindcss', ref: 'v3.4.17', version: [3, 4, 17] },
        ],
      ],
    );
    assert.deepEqual(
      files.map((f) => [f.pack, f.file]),
      [['profile-image', 'example-media/one.png']],
    );
    assert.ok(
      ![...sources, ...upstream].some((s) => s.url === FIXTURE_URL),
      'no fixture or variant entry is read',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("on next's own tree it reads the shipping packs and no fixture", () => {
  const { sources } = catalogEntries(REPO_ROOT);
  assert.ok(sources.length >= 3);
  for (const s of sources) {
    assert.match(s.asset, /^packages\/appearance-(languages|schemes|typography)\//, s.asset);
  }
  for (const id of ['platform-neutral', 'warm-parchment', 'humanist-ui']) {
    assert.ok(
      sources.some((s) => s.pack === id),
      id,
    );
  }
});

test('a healthy tree has no findings, and requests each URL once with HEAD', async () => {
  const root = tree();
  try {
    const { findings, net, checked } = await run(root, {});
    assert.deepEqual(kinds(findings), []);
    assert.equal(checked.urls, 2);
    const heads = net.requests.filter((r) => r.method === 'HEAD').map((r) => r.url);
    assert.deepEqual(heads.sort(), [SELF, ZINC].sort());
    assert.ok(!net.requests.some((r) => r.url === FIXTURE_URL));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- dead -----------------------------------------------------------------

for (const status of [404, 410, 500, 503]) {
  test(`a ${status} is dead after two retries with backoff`, async () => {
    const root = tree({ research: 'https://nordtheme.com/' });
    try {
      const { findings, net, sleeps } = await run(root, {
        'https://nordtheme.com/': () => response(status),
      });
      assert.deepEqual(kinds(findings), ['dead nord source.url']);
      assert.match(findings[0].actual, new RegExp(`answered ${status} after 3 attempts`));
      const tries = net.requests.filter((r) => r.url === 'https://nordtheme.com/');
      // Each attempt is a HEAD, then a GET where HEAD wasn't a 2xx.
      assert.deepEqual(
        tries.map((r) => r.method),
        ['HEAD', 'GET', 'HEAD', 'GET', 'HEAD', 'GET'],
      );
      assert.deepEqual(sleeps, [...BACKOFF_MS]);
      assert.ok(BACKOFF_MS[1] > BACKOFF_MS[0], 'the backoff grows');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('a timeout is dead after two retries', async () => {
  const root = tree({ research: 'https://nordtheme.com/' });
  try {
    const { findings, net } = await run(root, {
      'https://nordtheme.com/': () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
    });
    assert.deepEqual(kinds(findings), ['dead nord source.url']);
    assert.match(findings[0].actual, /timed out after 12 s after 3 attempts/);
    assert.equal(net.requests.filter((r) => r.url === 'https://nordtheme.com/').length, 3);
    for (const r of net.requests) assert.ok(r.init.signal instanceof AbortSignal, 'a timeout');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a DNS failure is dead after two retries, and never reaches fetch', async () => {
  const root = tree({ research: 'https://gone.nordtheme.com/' });
  try {
    let lookups = 0;
    const { findings, net } = await run(
      root,
      {},
      {
        lookupImpl: async (host) => {
          if (host !== 'gone.nordtheme.com') return publicDns();
          lookups++;
          throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
        },
      },
    );
    assert.deepEqual(kinds(findings), ['dead nord source.url']);
    assert.match(findings[0].actual, /DNS lookup failed \(ENOTFOUND\) after 3 attempts/);
    assert.equal(lookups, 3);
    assert.ok(!net.requests.some((r) => r.url.includes('gone.nordtheme.com')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failure that recovers on a retry is no finding', async () => {
  const root = tree({ research: 'https://nordtheme.com/' });
  try {
    const { findings, sleeps } = await run(root, {
      'https://nordtheme.com/': (init, n) => response(n <= 2 ? 503 : 200),
    });
    assert.deepEqual(kinds(findings), []);
    assert.deepEqual(sleeps, [BACKOFF_MS[0]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('HEAD that is refused falls back to GET', async () => {
  const root = tree({ research: 'https://nordtheme.com/' });
  try {
    const { findings, net } = await run(root, {
      'https://nordtheme.com/': (init) => response(init.method === 'HEAD' ? 405 : 200),
    });
    assert.deepEqual(kinds(findings), []);
    assert.deepEqual(
      net.requests.filter((r) => r.url === 'https://nordtheme.com/').map((r) => r.method),
      ['HEAD', 'GET'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing generated source file is dead', async () => {
  for (const [file, actual] of [
    ['example-media/missing.png', 'missing'],
    ['../outside.png', 'outside the tree'],
  ]) {
    const root = tree({ generatedFile: file });
    try {
      const { findings } = await run(root, {});
      assert.deepEqual(kinds(findings), ['dead profile-image source.file']);
      assert.equal(findings[0].actual, actual);
      assert.equal(findings[0].url, file);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

// --- unverified -----------------------------------------------------------

for (const status of [403, 429]) {
  test(`a ${status} is unverified, not dead, and isn't retried`, async () => {
    const root = tree({ research: 'https://nordtheme.com/' });
    try {
      const { findings, net, sleeps } = await run(root, {
        'https://nordtheme.com/': () => response(status),
      });
      assert.deepEqual(kinds(findings), ['unverified nord source.url']);
      assert.equal(findings[0].actual, `answered ${status}`);
      assert.equal(net.requests.filter((r) => r.url === 'https://nordtheme.com/').length, 2);
      assert.deepEqual(sleeps, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// --- redirects and refusals -----------------------------------------------

/** A chain of `n` redirects from https://nordtheme.com/ to a 200. */
function chain(n) {
  const routes = {};
  for (let i = 0; i < n; i++) {
    const from = i === 0 ? 'https://nordtheme.com/' : `https://nordtheme.com/${i}`;
    routes[from] = () => response(301, { location: `/${i + 1}` });
  }
  routes[n === 0 ? 'https://nordtheme.com/' : `https://nordtheme.com/${n}`] = () => response(200);
  return routes;
}

test(`${MAX_REDIRECTS} redirects are followed, and one more is dead`, async () => {
  assert.equal(MAX_REDIRECTS, 5);
  const root = tree({ research: 'https://nordtheme.com/' });
  try {
    const ok = await run(root, chain(MAX_REDIRECTS));
    assert.deepEqual(kinds(ok.findings), []);
    const over = await run(root, chain(MAX_REDIRECTS + 1));
    assert.deepEqual(kinds(over.findings), ['dead nord source.url']);
    assert.match(over.findings[0].actual, /more than 5 redirects/);
    assert.ok(
      !over.net.requests.some((r) => r.url === `https://nordtheme.com/${MAX_REDIRECTS + 1}`),
      'the hop past the cap is never requested',
    );
    for (const r of over.net.requests) assert.equal(r.init.redirect, 'manual');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('http is refused, at the start and on a redirect, and never requested', async () => {
  const start = tree({ research: 'http://nordtheme.com/' });
  const hop = tree({ research: 'https://nordtheme.com/' });
  try {
    const a = await run(start, {});
    assert.deepEqual(kinds(a.findings), ['unverified nord source.url']);
    assert.match(a.findings[0].actual, /not requested: http:\/\/nordtheme\.com\/ isn't https/);
    assert.ok(!a.net.requests.some((r) => r.url.startsWith('http:')));

    const b = await run(hop, {
      'https://nordtheme.com/': () => response(302, { location: 'http://nordtheme.com/plain' }),
    });
    assert.deepEqual(kinds(b.findings), ['unverified nord source.url']);
    assert.match(b.findings[0].actual, /isn't https/);
    assert.ok(!b.net.requests.some((r) => r.url.startsWith('http:')));
  } finally {
    rmSync(start, { recursive: true, force: true });
    rmSync(hop, { recursive: true, force: true });
  }
});

test('a refused or private host is unverified and never requested', async () => {
  for (const [url, lookupImpl] of [
    ['https://keyurgolani.name/', publicDns],
    ['https://localhost/', publicDns],
    ['https://user:pw@nordtheme.com/', publicDns],
    [
      'https://nordtheme.com/',
      async (host) =>
        host === 'nordtheme.com' ? [{ address: '10.0.0.7', family: 4 }] : publicDns(),
    ],
    [
      'https://nordtheme.com/',
      async (host) =>
        host === 'nordtheme.com' ? [{ address: 'fd00::1', family: 6 }] : publicDns(),
    ],
  ]) {
    const root = tree({ research: url });
    try {
      const { findings, net } = await run(root, {}, { lookupImpl });
      assert.deepEqual(kinds(findings), ['unverified nord source.url'], url);
      assert.match(findings[0].actual, /^not requested: /, url);
      assert.ok(!net.requests.some((r) => r.url === url || r.url.includes('nordtheme')), url);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('no request carries cookies or credentials', async () => {
  const root = tree({ research: 'https://nordtheme.com/' });
  try {
    const { net } = await run(root, { 'https://nordtheme.com/': () => response(200) });
    for (const r of net.requests) {
      assert.equal(r.init.credentials, 'omit');
      assert.ok(!('cookie' in r.headers), r.url);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('at most 4 requests are in flight at once', async () => {
  const root = tree({ research: 'https://nordtheme.com/' });
  try {
    // Ten more distinct sources, each slow to answer.
    for (let i = 0; i < 10; i++) {
      write(path.join(root, 'packages', 'appearance-schemes', 'research', `r${i}.json`), {
        id: `r${i}`,
        kind: 'color-scheme',
        source: { name: 'r', url: `https://nordtheme.com/r${i}` },
      });
    }
    const routes = { 'https://nordtheme.com/': () => response(200) };
    for (let i = 0; i < 10; i++) {
      routes[`https://nordtheme.com/r${i}`] = async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return response(200);
      };
    }
    const { net, findings } = await run(root, routes);
    assert.deepEqual(kinds(findings), []);
    assert.ok(net.maxInFlight() <= 4, `${net.maxInFlight()} in flight`);
    assert.ok(net.maxInFlight() > 1, 'requests do run in parallel');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- upstream license and version -----------------------------------------

test('a license file that is another license is license drift', async () => {
  const root = tree();
  try {
    const { findings } = await run(root, {
      [RAW_LICENSE]: () => response(200, { text: APACHE }),
    });
    assert.deepEqual(kinds(findings).slice(0, 1), ['license-drift zinc provenance.license']);
    assert.equal(findings[0].expected, 'MIT');
    assert.match(
      findings[0].actual,
      /^Apache-2\.0 in LICENSE at tailwindlabs\/tailwindcss@v3\.4\.17/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a manifest that names another license than the file is license drift', async () => {
  const root = tree({ zinc: { license: 'Apache-2.0' } });
  try {
    const { findings } = await run(root, {});
    assert.ok(kinds(findings).includes('license-drift zinc provenance.license'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no license file at the pinned tag is license drift', async () => {
  const root = tree();
  try {
    const routes = Object.fromEntries(
      ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'OFL.txt', 'COPYING'].map((name) => [
        RAW_LICENSE.replace(/LICENSE$/, name),
        () => response(404),
      ]),
    );
    const { findings, net } = await run(root, routes);
    assert.deepEqual(kinds(findings), ['license-drift zinc provenance.license']);
    assert.match(findings[0].actual, /no license file at tailwindlabs\/tailwindcss@v3\.4\.17/);
    // Each name is tried once: a missing file isn't retried.
    const raw = net.requests.filter((r) => r.url.startsWith('https://raw.githubusercontent.com/'));
    assert.deepEqual(
      raw.map((r) => r.url.split('/').at(-1)),
      ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'OFL.txt', 'COPYING'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('another copyright line is copyright drift, and the same one in any case is not', async () => {
  const root = tree({ zinc: { copyright: 'Copyright (c) Someone Else' } });
  const same = tree({ zinc: { copyright: '  copyright (C)   Tailwind Labs, Inc. ' } });
  const none = tree({ zinc: { copyright: undefined } });
  try {
    const { findings } = await run(root, {});
    assert.deepEqual(kinds(findings), ['copyright-drift zinc provenance.copyright']);
    assert.equal(findings[0].expected, 'Copyright (c) Someone Else');
    assert.equal(findings[0].actual, 'Copyright (c) Tailwind Labs, Inc.');
    assert.deepEqual(kinds((await run(same, {})).findings), []);
    assert.deepEqual(kinds((await run(none, {})).findings), [
      'copyright-drift zinc provenance.copyright',
    ]);
  } finally {
    for (const r of [root, same, none]) rmSync(r, { recursive: true, force: true });
  }
});

test('a license file with no copyright line leaves the copyright unverified', async () => {
  const root = tree({ zinc: { license: 'Apache-2.0' } });
  try {
    const { findings } = await run(root, {
      [RAW_LICENSE]: () => response(200, { text: APACHE }),
    });
    assert.deepEqual(kinds(findings), ['unverified zinc provenance.copyright']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a newer upstream minor or major is informational; a newer patch is nothing', async () => {
  const root = tree();
  try {
    for (const [tag, expected] of [
      ['v4.1.0', ['newer-upstream zinc provenance.source.url']],
      ['v3.5.0', ['newer-upstream zinc provenance.source.url']],
      ['v3.4.18', []],
      ['v3.4.17', []],
    ]) {
      const { findings } = await run(root, {
        [LATEST]: () => response(200, { text: JSON.stringify({ tag_name: tag }) }),
      });
      assert.deepEqual(kinds(findings), expected, tag);
      if (expected.length > 0)
        assert.match(findings[0].actual, new RegExp(tag.replace('.', '\\.')));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('without releases, the highest version tag is the newest', async () => {
  const root = tree();
  try {
    const { findings } = await run(root, {
      [LATEST]: () => response(404),
      [TAGS]: () =>
        response(200, {
          text: JSON.stringify([{ name: 'v3.4.17' }, { name: 'nightly' }, { name: 'v4.0.2' }]),
        }),
    });
    assert.deepEqual(kinds(findings), ['newer-upstream zinc provenance.source.url']);
    assert.match(findings[0].actual, /has v4\.0\.2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the pinned tag gone from the repository is dead', async () => {
  const root = tree();
  try {
    const { findings } = await run(root, { [TAG]: () => response(404) });
    assert.deepEqual(kinds(findings).slice(0, 1), ['dead zinc provenance.source.url']);
    assert.match(
      findings[0].actual,
      /the pinned tag v3\.4\.17 is gone from tailwindlabs\/tailwindcss/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a rate-limited API is unverified, never dead', async () => {
  const root = tree();
  try {
    const { findings } = await run(root, {
      [TAG]: () => response(403),
      [LATEST]: () => response(429),
    });
    assert.deepEqual(kinds(findings), [
      'unverified zinc provenance.source.url',
      'unverified zinc provenance.source.url',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('each repository is asked once per run, however many packs pin it', async () => {
  const root = tree();
  try {
    write(
      path.join(root, 'packages', 'appearance-schemes', 'packs', 'oled-black', 'manifest.json'),
      {
        id: 'oled-black',
        provenance: provenance(ZINC, {
          license: 'MIT',
          copyright: 'Copyright (c) Tailwind Labs, Inc.',
        }),
      },
    );
    const { net, findings } = await run(root, {});
    assert.deepEqual(kinds(findings), []);
    const api = net.requests.filter((r) => r.url.startsWith('https://api.github.com/'));
    assert.deepEqual(api.map((r) => r.url).sort(), [LATEST, TAG].sort());
    assert.equal(net.requests.filter((r) => r.url === RAW_LICENSE).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- the token ------------------------------------------------------------

test('the token goes to https api.github.com alone', () => {
  assert.equal(tokenFor('https://api.github.com/repos/o/r', TOKEN), TOKEN);
  for (const url of [
    'http://api.github.com/repos/o/r',
    'https://api.github.com:8443/repos/o/r',
    'https://api.github.com.evil.example/repos/o/r',
    'https://user@api.github.com/repos/o/r',
    'https://github.com/o/r',
    'https://raw.githubusercontent.com/o/r/v1.0.0/LICENSE',
    'https://uploads.github.com/x',
    'not a url',
  ]) {
    assert.equal(tokenFor(url, TOKEN), undefined, url);
  }
  assert.equal(tokenFor('https://api.github.com/x', undefined), undefined);
});

test('in a run, only api.github.com requests carry the token, and a redirect off it drops it', async () => {
  const root = tree();
  try {
    const { net } = await run(
      root,
      {
        // The API moves the repository to another host, which must not see the token.
        [LATEST]: () =>
          response(301, { location: 'https://codeload.github.com/tailwindlabs/latest' }),
        'https://codeload.github.com/tailwindlabs/latest': () =>
          response(200, { text: '{"tag_name":"v3.4.17"}' }),
      },
      { token: TOKEN },
    );
    const carrying = net.requests.filter((r) => 'authorization' in r.headers);
    assert.ok(carrying.length >= 2, 'the API requests carry it');
    for (const r of carrying) {
      assert.equal(new URL(r.url).origin, 'https://api.github.com', r.url);
      assert.equal(r.headers.authorization, `Bearer ${TOKEN}`);
    }
    for (const r of net.requests.filter((x) => new URL(x.url).hostname !== 'api.github.com')) {
      assert.ok(!JSON.stringify(r.headers).includes(TOKEN), r.url);
    }
    assert.ok(net.requests.some((r) => r.url.startsWith('https://codeload.github.com/')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the token never reaches a log, a record, or the summary', async () => {
  const root = tree({ research: 'https://nordtheme.com/' });
  const reports = mkdtempSync(path.join(tmpdir(), 'provenance-reports-'));
  const summary = path.join(reports, 'summary.md');
  try {
    const net = network({
      ...healthy(),
      // A failure whose message carries the token, as a careless library's might.
      'https://nordtheme.com/': () => {
        throw new Error(`connect failed with ${TOKEN}`);
      },
      [TAG]: () => {
        throw new Error(`api broke for Bearer ${TOKEN}`);
      },
    });
    const logs = [];
    const errors = [];
    const original = { error: console.error, log: console.log };
    console.error = (...args) => errors.push(args.join(' '));
    console.log = (...args) => errors.push(args.join(' '));
    let code;
    try {
      code = await main({
        argv: ['--root', root],
        env: {
          GITHUB_TOKEN: TOKEN,
          CI_GATE: 'catalog-provenance',
          CI_REPRO: 'pnpm ci:catalog-provenance',
          GITHUB_STEP_SUMMARY: summary,
        },
        log: (line) => logs.push(line),
        fetchImpl: net.fetchImpl,
        lookupImpl: publicDns,
        sleep: async () => {},
        failuresDir: path.join(reports, 'failures'),
      });
    } finally {
      Object.assign(console, original);
    }
    assert.equal(code, 1);
    const records = readdirSync(path.join(reports, 'failures')).map((f) =>
      readFileSync(path.join(reports, 'failures', f), 'utf8'),
    );
    assert.ok(records.length > 0);
    const everything = [...logs, ...errors, ...records, readFileSync(summary, 'utf8')].join('\n');
    assert.ok(everything.includes('***'), 'the token is redacted where it appeared');
    assert.ok(!everything.includes(TOKEN), 'the token appears nowhere');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(reports, { recursive: true, force: true });
  }
});

// --- records and the exit code --------------------------------------------

test('failing findings are failure records that match the schema; informational ones are not', async () => {
  const validate = await loadValidator();
  const root = tree({ research: 'https://nordtheme.com/', zinc: { copyright: 'Copyright X' } });
  const reports = mkdtempSync(path.join(tmpdir(), 'provenance-reports-'));
  try {
    const net = network({
      ...healthy(),
      'https://nordtheme.com/': () => response(410),
      [SELF]: () => response(429),
      [LATEST]: () => response(200, { text: '{"tag_name":"v4.1.0"}' }),
    });
    const logs = [];
    const original = { error: console.error, log: console.log };
    console.error = () => {};
    console.log = () => {};
    let code;
    try {
      code = await main({
        argv: ['--root', root],
        env: { CI_GATE: 'catalog-provenance', CI_REPRO: 'pnpm ci:catalog-provenance' },
        log: (line) => logs.push(line),
        fetchImpl: net.fetchImpl,
        lookupImpl: publicDns,
        sleep: async () => {},
        failuresDir: path.join(reports, 'failures'),
      });
    } finally {
      Object.assign(console, original);
    }
    assert.equal(code, 1);
    const records = readdirSync(path.join(reports, 'failures')).map((f) =>
      JSON.parse(readFileSync(path.join(reports, 'failures', f), 'utf8')),
    );
    for (const record of records) {
      assert.equal(validate(record), true, JSON.stringify(validate.errors));
      assert.equal(record.gate, 'catalog-provenance');
      assert.equal(record.reproCommand, 'pnpm ci:catalog-provenance');
    }
    assert.deepEqual(records.map((r) => `${r.rule} ${r.pack} ${r.axis}`).sort(), [
      'copyright-drift zinc colorScheme',
      'dead nord colorScheme',
    ]);
    const dead = records.find((r) => r.rule === 'dead');
    assert.equal(dead.test, 'source.url: https://nordtheme.com/');
    assert.equal(dead.asset, 'packages/appearance-schemes/research/nord.json');
    // unverified and newer-upstream are in the log and the summary only.
    const text = logs.join('\n');
    assert.match(text, /::warning title=catalog-provenance::unverified: warm-parchment/);
    assert.match(text, /::warning title=catalog-provenance::newer-upstream: zinc/);
    assert.match(text, /\| newer-upstream \| zinc \| colorScheme \|/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(reports, { recursive: true, force: true });
  }
});

test('only informational findings exit zero with no records', async () => {
  const root = tree();
  const reports = mkdtempSync(path.join(tmpdir(), 'provenance-reports-'));
  try {
    const net = network({
      ...healthy(),
      [SELF]: () => response(403),
      [LATEST]: () => response(200, { text: '{"tag_name":"v4.1.0"}' }),
    });
    const code = await main({
      argv: ['--root', root],
      env: { CI_GATE: 'catalog-provenance', CI_REPRO: 'pnpm ci:catalog-provenance' },
      log: () => {},
      fetchImpl: net.fetchImpl,
      lookupImpl: publicDns,
      sleep: async () => {},
      failuresDir: path.join(reports, 'failures'),
    });
    assert.equal(code, 0);
    assert.deepEqual(readdirSync(reports), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(reports, { recursive: true, force: true });
  }
});

test('a record names the pack, axis, field, URL, and kind', () => {
  const record = recordFor(
    {
      kind: 'dead',
      pack: 'zinc',
      axis: 'colorScheme',
      field: 'provenance.source.url',
      url: ZINC,
      asset: 'packages/appearance-schemes/packs/zinc/manifest.json',
      expected: '2xx',
      actual: 'answered 404 after 3 attempts',
    },
    { gate: 'catalog-provenance', reproCommand: 'pnpm ci:catalog-provenance' },
  );
  assert.deepEqual(record, {
    gate: 'catalog-provenance',
    reproCommand: 'pnpm ci:catalog-provenance',
    schemaVersion: '1.1',
    test: `provenance.source.url: ${ZINC}`,
    pack: 'zinc',
    axis: 'colorScheme',
    asset: 'packages/appearance-schemes/packs/zinc/manifest.json',
    rule: 'dead',
    expected: '2xx',
    actual: 'answered 404 after 3 attempts',
  });
});

// --- the parsers ----------------------------------------------------------

test('license files are told apart by their text, or their SPDX tag', () => {
  assert.equal(detectSpdx(MIT), 'MIT');
  assert.equal(detectSpdx(APACHE), 'Apache-2.0');
  assert.equal(detectSpdx(OFL), 'OFL-1.1');
  assert.equal(detectSpdx('SPDX-License-Identifier: ISC\n'), 'ISC');
  assert.equal(
    detectSpdx('Permission is hereby granted, free of charge, to any person obtaining a copy'),
    null,
  );
  assert.equal(detectSpdx('All rights reserved.'), null);
  assert.deepEqual(copyrightLines(MIT), ['Copyright (c) Tailwind Labs, Inc.']);
  assert.deepEqual(copyrightLines(APACHE), []);
  assert.deepEqual(copyrightLines(OFL), ['Copyright 2010 The Acme Project Authors']);
});

test('an upstream license with no pinned GitHub source is unverified, and nothing is fetched for it', async () => {
  const root = tree({ zinc: { license: 'Apache-2.0' } });
  try {
    const unpinned = 'https://tailwindcss.com/docs/colors';
    write(path.join(root, 'packages', 'appearance-schemes', 'packs', 'zinc', 'manifest.json'), {
      id: 'zinc',
      provenance: provenance(unpinned, { license: 'MIT', copyright: 'Copyright (c) X' }),
    });
    const { findings, net } = await run(root, { [unpinned]: () => response(200) });
    assert.deepEqual(kinds(findings), ['unverified zinc provenance.license']);
    assert.ok(!net.requests.some((r) => /api\.github\.com|raw\.githubusercontent/.test(r.url)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a pin is a GitHub source at a version tag', () => {
  assert.deepEqual(githubPin(ZINC), {
    owner: 'tailwindlabs',
    repo: 'tailwindcss',
    ref: 'v3.4.17',
    version: [3, 4, 17],
  });
  assert.deepEqual(
    githubPin('https://raw.githubusercontent.com/o/r/1.2/LICENSE')?.version,
    [1, 2, 0],
  );
  assert.deepEqual(githubPin('https://github.com/o/r/tree/v2.0.0')?.ref, 'v2.0.0');
  assert.equal(githubPin(SELF), null);
  assert.equal(githubPin('https://github.com/o/r/blob/main/x.js'), null);
  assert.equal(githubPin('https://gitlab.com/o/r/-/blob/v1.0.0/x'), null);
});
