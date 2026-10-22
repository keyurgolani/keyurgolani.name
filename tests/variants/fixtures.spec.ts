import { test } from '../harness/fixtures';
import { checkMode, MODES } from './modes';
import { projectTarget, READ_ONLY } from './target';

// A registered composition on a contract fixture (#5, Slice 6), in every
// mode, at the site root under read-only: the project's fixture is the
// server's source directory, its site selecting the project's variant, and
// the server's clock is the fixed one. missing-media's images answer 404,
// which is the point.

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
