import { readFileSync } from 'node:fs';
import { expect, test } from '../harness/fixtures';
import { checkMode, MODES } from './modes';
import { FIXED_TIME, projectTarget, READ_ONLY } from './target';

// A registered composition on a contract fixture (#5, Slice 6), in every
// mode, at the site root under read-only: the project's fixture is the
// server's source directory, its site selecting the project's variant, and
// the server's clock starts at the fixed time and runs on. No fixture's
// media has a rendition (#10), so every image renders as unavailable and the
// page asks for none: any request that fails is an error.

test(
  'the server runs on the fixed clock: every line it logs says 2026-01-01',
  { annotation: [READ_ONLY] },
  async ({ app, request }) => {
    // The sitemap names no date (#22), so as in sample.spec.ts, each JSON
    // line the server logs, from startup on, is stamped from its clock.
    expect((await request.get('/')).status()).toBe(200);
    const days = () =>
      readFileSync(app.log, 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => (JSON.parse(line) as { ts: string }).ts.slice(0, 10));
    await expect.poll(days, { message: 'lines the server logged' }).not.toEqual([]);
    expect(new Set(days())).toEqual(new Set([FIXED_TIME.slice(0, 10)]));
  },
);

test(
  'the browser has no WebGL, so a shot is the document a device without a WebGL enhancement gets',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    // playwright.config.ts launches Chromium with --disable-3d-apis. A browser
    // that ignored it would run a WebGL enhancement, whose canvas never
    // holds two frames the same: this fails first, by name.
    await page.setContent('<canvas></canvas>');
    expect(
      await page.evaluate(() => {
        const canvas = document.querySelector('canvas')!;
        return [canvas.getContext('webgl2'), canvas.getContext('webgl')].every((gl) => gl === null);
      }),
    ).toBe(true);
  },
);

for (const mode of MODES) {
  test.describe(() => {
    const { reducedMotion, ...options } = mode.context;
    test.use({ ...options, contextOptions: { reducedMotion } });

    test(
      mode.name,
      { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
      async ({ page, context, request }, testInfo) => {
        const { variant, fixture } = projectTarget(testInfo);
        await checkMode({
          mode: mode.name,
          page,
          context,
          request,
          variant,
          testInfo,
          go: (target) => target.goto('/'),
          shot: `${variant.manifest.id}-${fixture}-${mode.name}`,
          fixture,
        });
      },
    );
  });
}
