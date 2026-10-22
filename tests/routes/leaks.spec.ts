import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { APIResponse } from '@playwright/test';
import { parse } from 'yaml';
import { DEFAULT_PORTFOLIO } from '../harness/app-server.mjs';
import {
  CANARY_BODY,
  CANARY_SECRET,
  CANARY_SOURCE,
  canaries as leakCanaries,
  HOPS_FILE,
} from '../harness/canaries.mjs';
import { expect, test } from '../harness/fixtures';
import { READ_ONLY, readOnlyApp } from './apps';

// The canary scan (#1, Verification item 2) over the views a variant
// declares (#5, Slice 4). The checkout's build registers only the fallback
// composition, which declares none, so the profile matrices never render
// one. Here read-only selects fixture-chapters, seeded as the matrix seeds
// it: the source directory and a _FILE the server reads sit at canary
// paths. Each section of the harness portfolio renders through
// chapters/{chapter}, and fixture-notes' notes view is a 307 home. No answer
// to GET, to a GET for the RSC payload, or to POST carries a canary, in a
// body or a header.

test.use({
  appOptions: {
    ...readOnlyApp('fixture-chapters'),
    sourceName: CANARY_SOURCE,
    envFiles: {
      [HOPS_FILE.key]: { path: `${CANARY_SECRET}/${HOPS_FILE.name}`, text: HOPS_FILE.text },
    },
  },
});

const { sections } = parse(readFileSync(DEFAULT_PORTFOLIO, 'utf8')) as {
  sections: { id: string }[];
};

/** Each section's chapter view, which renders it, and fixture-notes' view, a 307 home. */
const VIEWS: readonly (readonly [path: string, status: number, section?: string])[] = [
  ...sections.map(({ id }) => [`/chapters/${id}`, 200, id] as const),
  ['/notes', 307],
];

test(
  'no declared view, or the redirect for one another variant declares, carries a path, a secret, or the request body',
  { annotation: [{ type: 'route', description: '/[...view]' }, READ_ONLY] },
  async ({ app, request }) => {
    expect(app.env.PORTFOLIO_SOURCE_DIR).toContain(CANARY_SOURCE);
    expect(app.env[HOPS_FILE.key]).toContain(CANARY_SECRET);
    expect(sections.length, 'sections to render').toBeGreaterThan(1);
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
    for (const [target, status, section] of VIEWS) {
      const page = await request.get(target, { maxRedirects: 0 });
      expect(page.status(), target).toBe(status);
      if (section) {
        // The view renders its section, from the server.
        const html = await page.text();
        expect(html, target).toContain('data-variant="fixture-chapters"');
        expect(html, target).toContain(`data-section-id="${section}"`);
      } else {
        expect(page.headers().location, target).toBe('/');
      }
      await expectNone(page, `GET ${target}`);
      const payload = await request.get(target, { maxRedirects: 0, headers: { rsc: '1' } });
      if (section) {
        expect(payload.headers()['content-type'], `RSC ${target}`).toMatch(/^text\/x-component/);
      }
      await expectNone(payload, `RSC ${target}`);
      const posted = await request.post(target, {
        maxRedirects: 0,
        data: { draft: CANARY_BODY },
      });
      await expectNone(posted, `POST ${target}`);
    }
  },
);
