import type { Page } from '@playwright/test';

// A Studio journal an e2e spec can seed (row 88c-RC2): one valid entry, as a real tab writes it,
// dated by the page's own clock (apps/web/src/lib/studio/journal.ts: an array of entries, each with
// a tab id, a draft id, a base version, the portfolio and site documents, and savedAt). Studio's
// readJournal removes any value that isn't one as it reads, so a stand-in like '{"kept":true}' can
// vanish under a live shell, and a check that a discard cleared it could pass on the prune alone.
// This entry survives the prune: only a discard removes it.

/** The journal's key in localStorage (journal.ts's JOURNAL_KEY). */
export const JOURNAL_KEY = 'portfolio-studio:journal:v1';

/** Seeds `page`'s origin with a one-entry journal and returns the stored value. */
export async function seedJournal(page: Page): Promise<string> {
  return page.evaluate((key) => {
    const entry = {
      tabId: 'e2e-seeded-tab-0001',
      draftId: `drf_${'0'.repeat(31)}1`,
      baseVersion: 1,
      documents: {
        portfolio: { format: 'yaml', sourceText: 'name: Seeded Person\n' },
        site: { format: 'yaml', sourceText: 'title: Seeded\n' },
      },
      savedAt: Date.now(),
    };
    const value = JSON.stringify([entry]);
    localStorage.setItem(key, value);
    return value;
  }, JOURNAL_KEY);
}
