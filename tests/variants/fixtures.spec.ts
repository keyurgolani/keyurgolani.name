import { expect, test } from '../harness/fixtures';
import { checkMode, MODES } from './modes';
import { FIXED_TIME, projectTarget, READ_ONLY } from './target';

// A registered composition on a contract fixture (#5, Slice 6), in every
// mode, at the site root under read-only: the project's fixture is the
// server's source directory, its site selecting the project's variant, and
// the server's clock starts at the fixed time and runs on. missing-media's
// images answer 404, which is the point.

test(
  'the server runs on the fixed clock: the sitemap, modified per request, says 2026-01-01',
  { annotation: [{ type: 'route', description: '/sitemap.xml' }, READ_ONLY] },
  async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain(`<lastmod>${FIXED_TIME.slice(0, 10)}T`);
  },
);

const missingMedia = (url: string) => new URL(url).pathname.startsWith('/media/missing-');

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
          expectedFailure: missingMedia,
        });
      },
    );
  });
}
