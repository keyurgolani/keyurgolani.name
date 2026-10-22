import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { parse } from 'yaml';
import { DEFAULT_PORTFOLIO } from '../harness/app-server.mjs';
import {
  CANARY_BODY,
  CANARY_SECRET,
  CANARY_SOURCE,
  canaries as leakCanaries,
  HOPS_FILE,
} from '../harness/canaries.mjs';
import { expect, test, type App } from '../harness/fixtures';
import { DEMO, DEMO_APP, READ_ONLY, readOnlyApp } from './apps';

// The canary scan (#1, Verification item 2) over every view the fixture
// variants declare (#5, Slice 4). The checkout's build registers only the
// fallback composition, which declares none, so the profile matrices never
// render one. Each server is seeded as the matrix seeds it: a _FILE it reads
// sits at a canary path, and so does read-only's source directory.
// fixture-chapters declares chapters/{chapter} under home and credits under
// work, and fixture-notes declares notes under home. At the root, read-only
// selects fixture-chapters: each harness section renders through its
// chapter view, notes is a 307 home, and credits is the 404 page until #10.
// Below /sample, demo renders each of them under its own ?variant=, every
// sample section as a chapter, and answers the other's views with a 307.
// No answer to GET, to a GET for the RSC payload, or to POST carries a
// canary, in a body or a header.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SEEDED = {
  [HOPS_FILE.key]: { path: `${CANARY_SECRET}/${HOPS_FILE.name}`, text: HOPS_FILE.text },
};

const sectionsOf = (file: string) =>
  (parse(readFileSync(file, 'utf8')) as { sections: { id: string }[] }).sections.map(
    ({ id }) => id,
  );

interface View {
  readonly path: string;
  readonly status: 200 | 307 | 404;
  /** The variant that renders a 200, and the section it renders, if it renders one. */
  readonly variant?: string;
  readonly section?: string;
  /** Where a 307 goes. */
  readonly location?: string;
}

/** GET, a GET for the RSC payload, and POST to each view, and no canary in any answer. */
async function expectNoLeaks(request: APIRequestContext, app: App, views: readonly View[]) {
  expect(app.env[HOPS_FILE.key]).toContain(CANARY_SECRET);
  const canaries = leakCanaries(path.basename(app.root));
  const expectNone = async (response: APIResponse, what: string) => {
    const body = (await response.body()).toString('latin1');
    const sent = response
      .headersArray()
      .map(({ name, value }) => `${name}: ${value}`)
      .join('\n');
    for (const canary of canaries) {
      expect(body, `${what}: body`).not.toContain(canary);
      expect(sent, `${what}: headers`).not.toContain(canary);
    }
  };
  for (const view of views) {
    const page = await request.get(view.path, { maxRedirects: 0 });
    expect(page.status(), view.path).toBe(view.status);
    const html = await page.text();
    if (view.status === 200) {
      // The view renders from the server, in its variant, its section if it has one.
      expect(html, view.path).toContain(`data-variant="${view.variant}"`);
      if (view.section) expect(html, view.path).toContain(`data-section-id="${view.section}"`);
    } else if (view.status === 307) {
      expect(page.headers().location, view.path).toBe(view.location);
    } else {
      expect(html, view.path).toMatch(/<h1>Page not found<\/h1>/);
    }
    await expectNone(page, `GET ${view.path}`);
    const payload = await request.get(view.path, { maxRedirects: 0, headers: { rsc: '1' } });
    if (view.status === 200) {
      expect(payload.headers()['content-type'], `RSC ${view.path}`).toMatch(/^text\/x-component/);
    }
    await expectNone(payload, `RSC ${view.path}`);
    const posted = await request.post(view.path, { maxRedirects: 0, data: { draft: CANARY_BODY } });
    await expectNone(posted, `POST ${view.path}`);
  }
}

test.describe('read-only, at the root', () => {
  test.use({
    appOptions: { ...readOnlyApp('fixture-chapters'), sourceName: CANARY_SOURCE, envFiles: SEEDED },
  });

  const sections = sectionsOf(DEFAULT_PORTFOLIO);

  test(
    'no declared view, or the answer for one this selection lacks, carries a path, a secret, or the request body',
    { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
    async ({ app, request }) => {
      expect(app.env.PORTFOLIO_SOURCE_DIR).toContain(CANARY_SOURCE);
      expect(sections.length, 'sections to render').toBeGreaterThan(1);
      await expectNoLeaks(request, app, [
        ...sections.map((id): View => ({
          path: `/chapters/${id}`,
          status: 200,
          variant: 'fixture-chapters',
          section: id,
        })),
        { path: '/notes', status: 307, location: '/' },
        { path: '/work/probe/credits', status: 404 },
      ]);
    },
  );
});

test.describe('demo, below /sample', () => {
  test.use({ appOptions: { ...DEMO_APP, envFiles: SEEDED } });

  const sections = sectionsOf(path.join(REPO_ROOT, 'portfolio.example.yml'));
  const chapters = '?variant=fixture-chapters';
  const notes = '?variant=fixture-notes';

  test(
    'no declared view, or the answer for one this selection lacks, carries a secret or the request body',
    { annotation: [{ type: 'route', description: '/sample/[[...path]]' }, DEMO] },
    async ({ app, request }) => {
      expect(sections.length, 'sections to render').toBeGreaterThan(1);
      await expectNoLeaks(request, app, [
        ...sections.map((id): View => ({
          path: `/sample/chapters/${id}${chapters}`,
          status: 200,
          variant: 'fixture-chapters',
          section: id,
        })),
        { path: `/sample/notes${chapters}`, status: 307, location: `/sample${chapters}` },
        { path: `/sample/work/probe/credits${chapters}`, status: 404 },
        { path: `/sample/notes${notes}`, status: 200, variant: 'fixture-notes' },
        {
          path: `/sample/chapters/${sections[0]}${notes}`,
          status: 307,
          location: `/sample${notes}`,
        },
      ]);
    },
  );
});
