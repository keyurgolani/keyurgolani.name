import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type APIRequestContext, type TestInfo } from '@playwright/test';
import { runChild } from '../../packages/core/src/store/test-support/spawn';
import { DEFAULT_PORTFOLIO, DEFAULT_SITE, startApp } from '../harness/app-server.mjs';
import { ownerSecret } from '../harness/owner-secret.mjs';

// The owner profile against the built server, over a revision store (#3,
// Slice 2): it serves its store's live revision through the real
// composition root, a publish from another process shows on the next
// request, one response comes from one revision, a damaged live revision
// serves the last known good, nothing servable is a 503 that says nothing,
// and the server lets publication/server.json go as it stops. The other
// process is the store's own test child, which publishes as Studio does.
const OWNER = { type: 'profile', description: 'owner' };
const secret = ownerSecret();

/** The fixture pair, with `name` as the portfolio's identity and its page title. */
function documents(name: string) {
  const portfolio = readFileSync(DEFAULT_PORTFOLIO, 'utf8');
  expect(portfolio).toContain('name: Rowan Fixture');
  expect(portfolio).toContain('title: Rowan Fixture');
  return {
    portfolio: {
      format: 'yaml',
      sourceText: portfolio.replaceAll('Rowan Fixture', name),
    },
    site: { format: 'yaml', sourceText: readFileSync(DEFAULT_SITE, 'utf8') },
  };
}

/**
 * A data directory of the test's own, outside the app's root so it outlives
 * the server, removed when the test ends. mkdtemp makes it 0700.
 */
function dataDirFor(testInfo: TestInfo): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'owner-store-'));
  testInfo.annotations.push({ type: 'data-dir', description: path.basename(dir) });
  return dir;
}

/**
 * Publishes each name's pair in turn from another process, after laying the
 * directory out as startup's preflight would, and returns the revision IDs.
 */
async function publish(dataDir: string, ...names: string[]): Promise<string[]> {
  const run = await runChild({
    kind: 'run',
    dataDir,
    steps: [
      { op: 'preflight' },
      ...names.map((name) => ({ op: 'publishDocuments', documents: documents(name) })),
    ],
  } as never);
  const { results } = (run.result ?? { results: [] }) as {
    results: { ok: boolean; outcome?: { kind?: string; revisionId: string } | null }[];
  };
  const [laidOut, ...published] = results;
  expect(laidOut, JSON.stringify(run)).toEqual({ ok: true, outcome: null });
  expect(published.length).toBe(names.length);
  for (const result of published) {
    expect(result.outcome?.kind, JSON.stringify(result)).toBe('committed');
  }
  return published.map((result) => result.outcome!.revisionId);
}

async function owner(dataDir: string) {
  return startApp({
    env: { PORTFOLIO_PROFILE: 'owner', PORTFOLIO_DATA_DIR: dataDir },
    envFiles: {
      PORTFOLIO_AUTH_PASSWORD_HASH_FILE: {
        path: 'secret/owner_password_hash',
        text: `${secret.hash}\n`,
      },
    },
  });
}

/** The identity name a page's <title>, its JSON-LD, and its body each name. */
function names(html: string) {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  const ld = /<script type="application\/ld\+json"[^>]*>([^<]*)<\/script>/.exec(html)?.[1] ?? '';
  return { title, ld, html };
}

const DAMAGE = '# damaged on disk\n';

test(
  'owner serves its store, and a publish from another process shows on the next request to every visitor route',
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'route', description: '/feed.xml' },
      OWNER,
    ],
  },
  async ({ request }, testInfo) => {
    const dataDir = dataDirFor(testInfo);
    try {
      await servesAndReleases(dataDir, request);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
);

async function servesAndReleases(dataDir: string, request: APIRequestContext) {
  await publish(dataDir, 'Rowan Revision One');
  const app = await owner(dataDir);
  try {
    const first = await (await request.get(`${app.origin}/`)).text();
    expect(first).toContain('Rowan Revision One');
    // A store with a revision is authoritative: the mounted pair doesn't serve.
    expect(first).not.toContain('Rowan Fixture');

    await publish(dataDir, 'Rowan Revision Two');
    const home = await request.get(`${app.origin}/`);
    expect(home.status()).toBe(200);
    const page = names(await home.text());
    expect(page.title).toContain('Rowan Revision Two');
    expect(page.ld).toContain('Rowan Revision Two');
    expect(page.html).not.toContain('Rowan Revision One');
    const feed = await request.get(`${app.origin}/feed.xml`);
    expect(feed.status()).toBe(200);
    expect(await feed.text()).toContain('Rowan Revision Two');
    const image = await request.get(`${app.origin}/opengraph-image-12o0cb`);
    expect(image.status()).toBe(200);
    for (const route of ['/robots.txt', '/sitemap.xml']) {
      expect((await request.get(`${app.origin}${route}`)).status(), route).toBe(200);
    }
    const ready = await request.get(`${app.origin}/api/ready`);
    expect(ready.status()).toBe(200);
    const body = (await ready.json()) as { checks: { id: string; status: string }[] };
    expect(body.checks.find((check) => check.id === 'catalog')?.status).toBe('ok');
    expect(body.checks.find((check) => check.id === 'data-directory')?.status).toBe('ok');
    expect(app.egress()).toEqual([]);
    // The server holds the data directory while it runs.
    expect(existsSync(path.join(dataDir, 'publication', 'server.json'))).toBe(true);
  } finally {
    await app.stop();
  }
  // And lets it go as it stops.
  expect(existsSync(path.join(dataDir, 'publication', 'server.json'))).toBe(false);
}

test(
  "one response's body, title, and JSON-LD come from one revision while another process publishes",
  { annotation: [{ type: 'route', description: '/' }, OWNER] },
  async ({ request }, testInfo) => {
    const dataDir = dataDirFor(testInfo);
    await publish(dataDir, 'Rowan Even');
    const app = await owner(dataDir);
    try {
      const publishing = publish(
        dataDir,
        ...Array.from({ length: 8 }, (_, index) => (index % 2 === 0 ? 'Rowan Odd' : 'Rowan Even')),
      );
      let done = false;
      void publishing.finally(() => {
        done = true;
      });
      const seen = new Set<string>();
      while (!done || seen.size === 0) {
        const page = names(await (await request.get(`${app.origin}/`)).text());
        const name = ['Rowan Odd', 'Rowan Even'].find((candidate) =>
          page.title.includes(candidate),
        );
        expect(name, page.title).toBeDefined();
        const other = name === 'Rowan Odd' ? 'Rowan Even' : 'Rowan Odd';
        expect(page.ld).toContain(name!);
        expect(page.html).not.toContain(other);
        seen.add(name!);
      }
      await publishing;
    } finally {
      await app.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
);

test(
  'a damaged live revision serves the last known good, degraded, says so to the owner, and live.json stays as it was',
  { annotation: [{ type: 'route', description: '/' }, OWNER] },
  async ({ request }, testInfo) => {
    const dataDir = dataDirFor(testInfo);
    const [, damaged] = await publish(dataDir, 'Rowan Good', 'Rowan Damaged');
    writeFileSync(path.join(dataDir, 'revisions', damaged!, 'documents', 'portfolio.yml'), DAMAGE);
    const pointer = readFileSync(path.join(dataDir, 'publication', 'live.json'));
    const app = await owner(dataDir);
    try {
      const home = await (await request.get(`${app.origin}/`)).text();
      expect(home).toContain('Rowan Good');
      expect(home).not.toContain('Rowan Damaged');
      const ready = await request.get(`${app.origin}/api/ready`);
      expect(ready.status()).toBe(200);
      const body = (await ready.json()) as {
        status: string;
        checks: { id: string; status: string }[];
      };
      expect(body.status).toBe('degraded');
      expect(body.checks.find((check) => check.id === 'catalog')?.status).toBe('degraded');
      expect(JSON.stringify(body)).not.toContain('rev_');
      // The owner's diagnostic: the IDs and why, never a path or content.
      const log = readFileSync(app.log, 'utf8');
      const line = log.split('\n').find((entry) => entry.includes('"store.catalog.degraded"'));
      expect(line).toBeDefined();
      expect(line).toContain(damaged!);
      expect(line).toContain('damaged:hash_mismatch');
      expect(log).not.toContain(dataDir);
      expect(readFileSync(path.join(dataDir, 'publication', 'live.json'))).toEqual(pointer);
    } finally {
      await app.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
);

test(
  'with nothing servable every visitor route answers 503 with no path, ID, or validator text, and never the example',
  { annotation: [{ type: 'route', description: '/' }, OWNER] },
  async ({ request }, testInfo) => {
    const dataDir = dataDirFor(testInfo);
    const [only] = await publish(dataDir, 'Rowan Only');
    writeFileSync(path.join(dataDir, 'revisions', only!, 'documents', 'portfolio.yml'), DAMAGE);
    const app = await owner(dataDir);
    try {
      // The bundled example's identity, which production never renders.
      const example = readFileSync(
        path.join(DEFAULT_PORTFOLIO, '../../../portfolio.example.yml'),
        'utf8',
      );
      const exampleName = /^ {2}name: (.+)$/m.exec(example)?.[1]?.trim() ?? '';
      expect(exampleName).toBe('Anamika Devi');
      for (const route of [
        '/',
        '/feed.xml',
        '/robots.txt',
        '/sitemap.xml',
        '/opengraph-image-12o0cb',
      ]) {
        const response = await request.get(`${app.origin}${route}`);
        expect(response.status(), route).toBe(503);
        const text = await response.text();
        for (const leak of [
          only!,
          'rev_',
          dataDir,
          'hash_mismatch',
          'damaged',
          'Rowan',
          exampleName,
        ]) {
          expect(text, `${route} says ${leak}`).not.toContain(leak);
        }
      }
      const ready = await request.get(`${app.origin}/api/ready`);
      expect(ready.status()).toBe(503);
      expect(JSON.stringify(await ready.json())).not.toContain('rev_');
    } finally {
      await app.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
