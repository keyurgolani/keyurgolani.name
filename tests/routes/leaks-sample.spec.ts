import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../harness/fixtures';
import { DEMO, DEMO_APP } from './apps';
import { expectNoLeaks, SEEDED, sectionsOf, type View } from './leaks';

// The leak scan below /sample (leaks.ts). demo renders each fixture variant
// under its own ?variant=: every sample section as a fixture-chapters
// chapter, and fixture-notes' notes. demo serves the sample without its
// github sections until #10 (apps/web/src/server/catalog-sample.ts), so the
// chapter of one renders no section. A view only the other variant declares
// is a 307 to the selected one's home, and credits, under work, is the 404
// page until #10.

test.use({ appOptions: { ...DEMO_APP, envFiles: SEEDED } });

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sections = sectionsOf(path.join(REPO_ROOT, 'portfolio.example.yml'));
const chapters = '?variant=fixture-chapters';
const notes = '?variant=fixture-notes';

test(
  'no declared view, or the answer for one this selection lacks, carries a secret or the request body',
  { annotation: [{ type: 'route', description: '/sample/[[...path]]' }, DEMO] },
  async ({ app, request }) => {
    expect(sections.length, 'sections to render').toBeGreaterThan(1);
    await expectNoLeaks(request, app, [
      ...sections.map(({ id, kind }): View => ({
        path: `/sample/chapters/${id}${chapters}`,
        status: 200,
        variant: 'fixture-chapters',
        section: kind === 'github' ? null : id,
      })),
      { path: `/sample/notes${chapters}`, status: 307, location: `/sample${chapters}` },
      { path: `/sample/work/probe/credits${chapters}`, status: 404 },
      { path: `/sample/notes${notes}`, status: 200, variant: 'fixture-notes' },
      {
        path: `/sample/chapters/${sections[0]!.id}${notes}`,
        status: 307,
        location: `/sample${notes}`,
      },
    ]);
  },
);
