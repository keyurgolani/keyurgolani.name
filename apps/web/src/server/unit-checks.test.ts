import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UnitChecks } from '@portfolio/core';
import { derivedChanges, mediaBlobs } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import { APPEARANCE_REGISTRY } from '~/lib/appearance-registry';
import { OriginError, storeChecks, storeOrigin } from '../../scripts/portfolio-store';
import { deploymentUnitChecks } from './register';
import { buildUnitChecks } from './unit-checks';

// One unit check for a revision, whoever writes it (#3, items 21 and 26):
// the composition root's, as register() binds it, and portfolio-store's.
// A revision the CLI imports records the rendering the server's would, so
// the server reads no render drift into it, and the two find the same.

const ROOT = '../../../../';
const EXAMPLES = {
  portfolio: fileURLToPath(new URL(`${ROOT}portfolio.example.yml`, import.meta.url)),
  site: fileURLToPath(new URL(`${ROOT}site.example.yml`, import.meta.url)),
};
const ORIGIN = 'https://rowan.name';

test('the CLI and the composition root check a pair alike: one rendering, snapshots, findings, and app version', () => {
  const read = readPair(EXAMPLES);
  assert.ok(read.ok, 'the bundled example reads');
  const server = deploymentUnitChecks(ORIGIN);
  const cli = storeChecks({ PORTFOLIO_ORIGIN: ORIGIN });
  const served = server.validateLive!(read.sources);
  assert.ok(served.pair, 'the example serves');

  assert.deepEqual(cli.rendering!(served.pair), server.rendering!(served.pair));
  assert.deepEqual(
    cli.snapshots!(served.pair, undefined),
    server.snapshots!(served.pair, undefined),
  );
  assert.equal(cli.appVersion, server.appVersion);
  const findings = (checks: UnitChecks, rule: 'validate' | 'validateLive') =>
    checks[rule]!(read.sources).diagnostics.map(
      (diagnostic) => `${diagnostic.severity} ${diagnostic.code} ${diagnostic.pointer}`,
    );
  for (const rule of ['validate', 'validateLive'] as const) {
    assert.deepEqual(findings(cli, rule), findings(server, rule), rule);
  }
  // The example's variant, the platform default, is registered (#13).
  for (const rule of ['validate', 'validateLive'] as const) {
    assert.ok(!findings(server, rule).some((line) => line.includes('variant.unavailable')), rule);
  }
});

test("a variant this build doesn't register blocks a publish and warns when served, from the CLI and the composition root alike", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'unit-checks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const site = path.join(dir, 'site.yml');
  writeFileSync(
    site,
    readFileSync(EXAMPLES.site, 'utf8').replace(
      'variant: editorial-evidence',
      'variant: missing-variant',
    ),
  );
  const read = readPair({ portfolio: EXAMPLES.portfolio, site });
  assert.ok(read.ok, 'the pair reads');
  const unavailable = (checks: UnitChecks, rule: 'validate' | 'validateLive') =>
    checks[rule]!(read.sources)
      .diagnostics.filter((diagnostic) => diagnostic.code === 'variant.unavailable')
      .map((diagnostic) => `${diagnostic.severity} ${diagnostic.pointer}`);
  for (const checks of [deploymentUnitChecks(ORIGIN), storeChecks({ PORTFOLIO_ORIGIN: ORIGIN })]) {
    assert.deepEqual(unavailable(checks, 'validate'), ['blocks-publish /appearance/variant']);
    assert.deepEqual(unavailable(checks, 'validateLive'), ['warning /appearance/variant']);
  }
});

test('portfolio-store reads PORTFOLIO_ORIGIN or PORTFOLIO_ORIGIN_FILE as the server does, and refuses an origin that is not bare', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'store-origin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name: string, text: string) => {
    const at = path.join(dir, name);
    writeFileSync(at, text);
    return at;
  };
  assert.equal(storeOrigin({}), undefined);
  assert.equal(storeOrigin({ PORTFOLIO_ORIGIN: ORIGIN }), ORIGIN);
  // One trailing newline trimmed, as config.ts trims it.
  assert.equal(storeOrigin({ PORTFOLIO_ORIGIN_FILE: file('origin', `${ORIGIN}\n`) }), ORIGIN);
  assert.equal(storeOrigin({ PORTFOLIO_ORIGIN_FILE: file('crlf', `${ORIGIN}\r\n`) }), ORIGIN);
  assert.equal(storeOrigin({ PORTFOLIO_ORIGIN_FILE: file('empty', '') }), undefined);

  const refused = (env: Record<string, string>, message: RegExp) =>
    assert.throws(
      () => storeChecks(env),
      (error) => error instanceof OriginError && message.test(error.message),
    );
  refused({ PORTFOLIO_ORIGIN: `${ORIGIN}/` }, /^PORTFOLIO_ORIGIN must be a bare origin/);
  refused({ PORTFOLIO_ORIGIN: 'rowan.name' }, /^PORTFOLIO_ORIGIN must be a bare origin/);
  refused({ PORTFOLIO_ORIGIN: 'ftp://rowan.name' }, /^PORTFOLIO_ORIGIN must be a bare origin/);
  refused(
    { PORTFOLIO_ORIGIN_FILE: file('path', `${ORIGIN}/about\n`) },
    /^PORTFOLIO_ORIGIN must be a bare origin/,
  );
  refused(
    { PORTFOLIO_ORIGIN: ORIGIN, PORTFOLIO_ORIGIN_FILE: file('both', ORIGIN) },
    /^Set PORTFOLIO_ORIGIN or PORTFOLIO_ORIGIN_FILE, not both\.$/,
  );
  const folder = path.join(dir, 'folder');
  mkdirSync(folder);
  refused({ PORTFOLIO_ORIGIN_FILE: folder }, /^PORTFOLIO_ORIGIN_FILE must name a regular file/);
  refused(
    { PORTFOLIO_ORIGIN_FILE: path.join(dir, 'missing') },
    /^PORTFOLIO_ORIGIN_FILE must name a regular file/,
  );
});

// The blobs a unit's media document references (#10): every source and
// rendition blob, so a draft or a publish that names one the AssetStore
// lacks fails with asset_missing, and each manifest lists what its revision
// keeps.

const hex = (digit: string) => digit.repeat(64);

const DOCUMENT = {
  assets: [
    {
      assetId: 'atlas-cover',
      sha256: hex('a'),
      mime: 'image/jpeg',
      bytes: 10,
      renditions: [
        { name: 'w480-a1', ext: 'webp', mime: 'image/webp', bytes: 5, sha256: hex('b') },
        { name: 'w480-a1-jpg', ext: 'jpg', mime: 'image/jpeg', bytes: 6, sha256: hex('c') },
      ],
      derivedAt: '2026-10-23T08:00:00Z',
      algorithmVersion: 1,
      source: { kind: 'local', path: 'atlas/cover.jpg' },
      availability: { state: 'available' },
    },
  ],
};

test("a unit references its media document's source and rendition blobs", () => {
  const checks = buildUnitChecks({
    registry: [],
    appearance: APPEARANCE_REGISTRY,
    appVersion: 'test',
  });
  assert.deepEqual(checks.referencedBlobs?.(DOCUMENT), [
    `sha256:${hex('a')}`,
    `sha256:${hex('b')}`,
    `sha256:${hex('c')}`,
  ]);
  assert.deepEqual(checks.referencedBlobs?.(DOCUMENT), mediaBlobs(DOCUMENT));
  // portfolio-store's retention and verify reference the same blobs as the server.
  const cli = storeChecks({ PORTFOLIO_ORIGIN: 'https://rowan.name' });
  assert.deepEqual(cli.referencedBlobs?.(DOCUMENT), mediaBlobs(DOCUMENT));
  assert.deepEqual(checks.referencedBlobs?.(undefined), []);
});

test("the deployment's checks and portfolio-store's run the publish gate with a publication: an unapproved change refuses the pair, the accepted one passes", () => {
  const read = readPair(EXAMPLES);
  assert.ok(read.ok, 'the bundled example reads');
  const asset = (sha: string) => ({ ...DOCUMENT.assets[0]!, sha256: hex(sha) });
  const live = deploymentUnitChecks(ORIGIN).validateLive!(read.sources);
  assert.ok(live.pair);
  const publication = (changes: unknown[]) => ({
    live: { pair: live.pair!, media: { assets: [asset('a')] }, snapshots: {} },
    derived: { changes },
    draft: { media: { assets: [asset('e')] } },
  });
  for (const [name, checks] of [
    ['the deployment', deploymentUnitChecks(ORIGIN)],
    ['portfolio-store', storeChecks({ PORTFOLIO_ORIGIN: ORIGIN })],
  ] as const) {
    const codes = (result: ReturnType<UnitChecks['validate']>) =>
      result.diagnostics.map(({ code }) => code).filter((code) => code === 'derived.unapproved');
    const held = checks.validate(read.sources, publication([]));
    assert.deepEqual(codes(held), ['derived.unapproved'], name);
    const [change] = derivedChanges(publication([]).live, publication([]).draft);
    const accepted = {
      ...change!,
      id: `dch_${'0'.repeat(32)}`,
      decision: { state: 'accepted', at: 'x', by: 'owner' },
    };
    assert.deepEqual(codes(checks.validate(read.sources, publication([accepted]))), [], name);
    // Without a publication, as a preview checks, there's nothing to compare.
    assert.deepEqual(codes(checks.validate(read.sources)), [], name);
  }
});
