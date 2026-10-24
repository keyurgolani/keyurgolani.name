import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { APIResponse } from '@playwright/test';
import { startApp } from '../harness/app-server.mjs';
import { referenceLeaks } from '../harness/canaries.mjs';
import { fixtureHostWeb } from '../harness/fixture-host.mjs';
import { expect, test } from '../harness/fixtures';
import {
  copyReferenceFixture,
  REFERENCE_FIXTURE,
  REFERENCE_MOUNT,
} from '../harness/reference-fixture';
import { DEMO_CSP } from '../harness/route-headers.mjs';
import { DEMO, DEMO_APP } from './apps';

// The demo's read-only reference (#9) on the fixture host, under demo, with
// the CI fixture mounted: its pages render its own verified view, under the
// demo policy framed by no one, with /sample's canonical query; a private
// work and anything else its view doesn't route is the 404 page; its
// renditions serve from memory with the record's type, nosniff, and a year,
// and everything else there is a no-store 404; no canary the fixture holds
// reaches any body or header; and a client's own content mark changes
// nothing. A demo with no reference, and one whose mount doesn't verify,
// answer 404 everywhere under /reference, the second with startup warnings
// that say why and name no path.

const REFERENCE_APP = {
  ...DEMO_APP,
  env: { ...DEMO_APP.env, PORTFOLIO_REFERENCE_DIR: REFERENCE_MOUNT },
};
test.use({ appOptions: REFERENCE_APP });

/** DEMO_APP as startApp() takes it, for a server of the spec's own on the fixture host's build. */
const DEMO_SERVER = { env: DEMO_APP.env ?? {}, portfolio: null, site: null };

const ROUTE = { type: 'route', description: '/reference/[[...path]]' };
const MEDIA_ROUTE = { type: 'route', description: '/reference/media/[...path]' };

interface Rendition {
  readonly name: string;
  readonly ext: string;
  readonly sha256: string;
}
interface MediaRecord {
  readonly assetId: string;
  readonly sha256: string;
  readonly renditions: readonly Rendition[];
}

const MEDIA = JSON.parse(
  readFileSync(path.join(REFERENCE_FIXTURE, 'media', 'media.json'), 'utf8'),
) as {
  assets: MediaRecord[];
};

/** The rendition URL of `assetId`'s first rendition, and its blob's bytes. */
function rendition(assetId: string): { url: string; bytes: Buffer } {
  const found = MEDIA.assets.find((record) => record.assetId === assetId)!;
  const [first] = found.renditions;
  return {
    url: `/reference/media/${assetId}/${found.sha256}/${first!.name}.${first!.ext}`,
    bytes: readFileSync(path.join(REFERENCE_FIXTURE, 'media', 'blobs', first!.sha256)),
  };
}

/**
 * Every reference canary the response carries, in its body or a header,
 * but one that is exactly a segment or a query value its own request sent:
 * Next echoes the URL as sent in its payloads, the 404 page's included
 * (canaries.mjs's referenceLeaks(), whose unit test plants the private
 * image's id in an answer to the private work's path and finds it).
 */
async function leaks(response: APIResponse, sent: string): Promise<string[]> {
  const text = `${JSON.stringify(response.headers())}\n${(await response.body()).toString('latin1')}`;
  return referenceLeaks(text, sent);
}

test(
  'a reference page renders its own view, under the demo policy framed by no one, with no JSON-LD',
  { annotation: [ROUTE, DEMO] },
  async ({ request }) => {
    for (const at of ['/reference', '/reference/work/tide-tables']) {
      const response = await request.get(at, { maxRedirects: 0 });
      expect(response.status(), at).toBe(200);
      const headers = response.headers();
      const policy = DEMO_CSP.exec(headers['content-security-policy'] ?? '');
      expect(policy, at).not.toBeNull();
      expect(policy![2], at).toBe("'none'");
      expect(headers['x-robots-tag'], at).toBe('noindex');
      expect(headers['set-cookie'], at).toBeUndefined();
      const html = await response.text();
      expect(html, at).toContain('Wren Halloway');
      expect(html, at).not.toContain('Anamika Devi');
      expect(html, at).not.toContain('application/ld+json');
      // The layout read the reference's view, not the sample's.
      expect(html, at).toMatch(/<title>[^<]*Wren Halloway/);
      expect(await leaks(response, at), at).toEqual([]);
    }
  },
);

test(
  "the reference takes /sample's canonical query, and sends anything else to it",
  { annotation: [ROUTE, DEMO] },
  async ({ request, app }) => {
    expect((await request.get('/reference?mode=dark', { maxRedirects: 0 })).status()).toBe(200);
    for (const [sent, canonical] of [
      ['/reference?bogus=1', '/reference'],
      ['/reference?variant=no-such-variant', '/reference'],
      ['/reference?mode=dark&mode=light', '/reference'],
      ['/reference/work/tide-tables?x=CANARY-REF-PRIVATE-RECORD', '/reference/work/tide-tables'],
    ] as const) {
      const response = await request.get(sent, { maxRedirects: 0 });
      expect(response.status(), sent).toBe(307);
      expect(response.headers()['location'], sent).toBe(`${app.origin}${canonical}`);
    }
  },
);

test(
  'a private work, a view the reference does not route, and /reference/media itself are the 404 page',
  { annotation: [ROUTE, DEMO] },
  async ({ request }) => {
    for (const at of [
      '/reference/work/canary-ref-private',
      '/reference/work/no-such-work',
      '/reference/no-such-view',
      '/reference/media',
    ]) {
      const response = await request.get(at, { maxRedirects: 0 });
      expect(response.status(), at).toBe(404);
      expect(response.headers()['content-type'], at).toMatch(/^text\/html/);
      expect(await response.text(), at).toMatch(/<h1>Page not found<\/h1>/);
      expect(await leaks(response, at), at).toEqual([]);
    }
  },
);

test(
  "a rendition the reference's view keeps serves its verified bytes with the record's type, nosniff, and a year",
  { annotation: [MEDIA_ROUTE, DEMO] },
  async ({ request }) => {
    const { url, bytes } = rendition('tide-tables-cover');
    const response = await request.get(url, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await response.body()).equals(bytes)).toBe(true);
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const refused = await request.fetch(url, { method, maxRedirects: 0 });
      expect(refused.status(), method).toBe(405);
      expect(refused.headers()['allow'], method).toBe('GET, HEAD');
    }
  },
);

test(
  'private, unplaced, malformed, and wrong-hash renditions are the same no-store 404, with no canary',
  { annotation: [MEDIA_ROUTE, DEMO] },
  async ({ request }) => {
    const cover = rendition('tide-tables-cover').url;
    const [, , , , asset, , file] = cover.split('/');
    for (const url of [
      rendition('canary-ref-private-media').url,
      rendition('ref-unplaced').url,
      `/reference/media/${asset}/${'0'.repeat(64)}/${file}`,
      `/reference/media/${asset}/${'0'.repeat(64)}`,
      `/reference/media/${asset}/x/../../bundle.json`,
      '/reference/media/bundle.json',
    ]) {
      const response = await request.get(url, { maxRedirects: 0 });
      expect(response.status(), url).toBe(404);
      expect(response.headers()['cache-control'], url).toBe('no-store');
      expect(await leaks(response, url), url).toEqual([]);
    }
  },
);

test(
  "a client's own x-portfolio-content changes nothing: the showroom and /sample still show the sample",
  { annotation: [ROUTE, DEMO] },
  async ({ request }) => {
    for (const at of ['/', '/sample']) {
      const response = await request.get(at, {
        headers: { 'x-portfolio-content': 'reference' },
        maxRedirects: 0,
      });
      expect(response.status(), at).toBe(200);
      const html = await response.text();
      expect(html, at).toContain('Anamika Devi');
      expect(html, at).not.toContain('Wren Halloway');
    }
  },
);

test(
  'a demo with no reference answers 404 everywhere under /reference',
  { annotation: [ROUTE, MEDIA_ROUTE, DEMO] },
  async () => {
    test.setTimeout(180_000);
    const server = await startApp({ ...DEMO_SERVER, web: fixtureHostWeb() });
    try {
      for (const at of [
        '/reference',
        '/reference/work/tide-tables',
        rendition('tide-tables-cover').url,
      ]) {
        const response = await fetch(`${server.origin}${at}`, { redirect: 'manual' });
        expect(response.status, at).toBe(404);
      }
    } finally {
      await server.stop();
    }
  },
);

test(
  "a mount that doesn't verify leaves the demo on its sample, says why at startup, names no path, and serves nothing of it",
  { annotation: [ROUTE, MEDIA_ROUTE, DEMO] },
  async () => {
    test.setTimeout(180_000);
    const dir = mkdtempSync(path.join(tmpdir(), 'reference-tampered-'));
    copyReferenceFixture(dir);
    const { bytes } = rendition('tide-tables-cover');
    const hex = MEDIA.assets.find((record) => record.assetId === 'tide-tables-cover')!
      .renditions[0]!.sha256;
    const flipped = Buffer.from(bytes);
    flipped.writeUInt8(flipped.readUInt8(flipped.length - 1) ^ 1, flipped.length - 1);
    writeFileSync(path.join(dir, 'media', 'blobs', hex), flipped);
    const server = await startApp({
      ...DEMO_SERVER,
      web: fixtureHostWeb(),
      env: { ...DEMO_APP.env, PORTFOLIO_REFERENCE_DIR: dir },
    });
    try {
      for (const at of ['/reference', rendition('tide-tables-cover').url]) {
        const response = await fetch(`${server.origin}${at}`, { redirect: 'manual' });
        expect(response.status, at).toBe(404);
      }
      const sample = await fetch(`${server.origin}/sample`);
      expect(sample.status).toBe(200);
      const lines = readFileSync(server.log, 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const warnings = lines.filter((line) => line.key === 'PORTFOLIO_REFERENCE_DIR');
      expect(warnings.map((line) => line.code)).toEqual([
        'reference_hash_mismatch',
        'reference_unavailable',
      ]);
      for (const line of warnings) expect(JSON.stringify(line)).not.toContain(dir);
      expect(lines.find((line) => line.event === 'deployment.config')?.reference).toBe(
        'unavailable',
      );
    } finally {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
