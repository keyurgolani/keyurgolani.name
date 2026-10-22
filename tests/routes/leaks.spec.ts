import { DEFAULT_PORTFOLIO } from '../harness/app-server.mjs';
import { CANARY_SOURCE } from '../harness/canaries.mjs';
import { expect, test } from '../harness/fixtures';
import { READ_ONLY, readOnlyApp } from './apps';
import { expectNoLeaks, SEEDED, sectionsOf, type View } from './leaks';

// The leak scan at the root (leaks.ts). read-only selects fixture-chapters,
// its source directory at a canary path too. fixture-chapters declares
// chapters/{chapter} under home and credits under work, and fixture-notes
// declares notes under home: each harness section renders through its
// chapter view, notes is a 307 home, and credits is the 404 page until #10.

test.use({
  appOptions: { ...readOnlyApp('fixture-chapters'), sourceName: CANARY_SOURCE, envFiles: SEEDED },
});

const sections = sectionsOf(DEFAULT_PORTFOLIO).map(({ id }) => id);

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
