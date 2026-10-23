import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { parse } from 'yaml';
import {
  CANARY_BODY,
  CANARY_SECRET,
  canaries as leakCanaries,
  HOPS_FILE,
} from '../harness/canaries.mjs';
import { expect, type App } from '../harness/fixtures';
import { withRscHash } from '../harness/rsc';

// The canary scan (#1, Verification item 2) over every view the fixture
// variants declare (#5, Slice 4): leaks.spec.ts at the root, and
// leaks-sample.spec.ts below /sample, each on its own server. The
// checkout's build registers the fallback composition and kinetic-cosmos,
// which declare none, so the profile matrices never render one. Each server is seeded as
// the matrix seeds it, with a _FILE it reads at a canary path. No answer to
// GET, to a GET for the RSC payload, or to POST carries a canary, in a body
// or a header.

/** The _FILE each server reads, at a canary path. */
export const SEEDED = {
  [HOPS_FILE.key]: { path: `${CANARY_SECRET}/${HOPS_FILE.name}`, text: HOPS_FILE.text },
};

/** The sections of a portfolio document, each its id and kind. */
export const sectionsOf = (file: string): { id: string; kind: string }[] =>
  (parse(readFileSync(file, 'utf8')) as { sections: { id: string; kind: string }[] }).sections.map(
    ({ id, kind }) => ({ id, kind }),
  );

export interface View {
  readonly path: string;
  readonly status: 200 | 307 | 404;
  /** The variant that renders a 200, and the section it renders, null for none. */
  readonly variant?: string;
  readonly section?: string | null;
  /** Where a 307 goes. */
  readonly location?: string;
}

/** GET, a GET for the RSC payload, and POST to each view, and no canary in any answer. */
export async function expectNoLeaks(
  request: APIRequestContext,
  app: App,
  views: readonly View[],
): Promise<void> {
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
      // The view renders from the server, in its variant, with the section it names or none.
      expect(html, view.path).toContain(`data-variant="${view.variant}"`);
      if (view.section) expect(html, view.path).toContain(`data-section-id="${view.section}"`);
      if (view.section === null) expect(html, view.path).not.toContain('data-section-id=');
    } else if (view.status === 307) {
      expect(page.headers().location, view.path).toBe(view.location);
    } else {
      expect(html, view.path).toMatch(/<h1>Page not found<\/h1>/);
    }
    await expectNone(page, `GET ${view.path}`);
    const rsc = { rsc: '1' };
    const payload = await request.get(await withRscHash(view.path, rsc), {
      maxRedirects: 0,
      headers: rsc,
    });
    if (view.status === 200) {
      expect(payload.status(), `RSC ${view.path}`).toBe(200);
      expect(payload.headers()['content-type'], `RSC ${view.path}`).toMatch(/^text\/x-component/);
    }
    await expectNone(payload, `RSC ${view.path}`);
    const posted = await request.post(view.path, { maxRedirects: 0, data: { draft: CANARY_BODY } });
    await expectNone(posted, `POST ${view.path}`);
  }
}
