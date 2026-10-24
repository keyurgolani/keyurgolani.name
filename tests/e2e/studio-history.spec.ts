import { readFileSync } from 'node:fs';
import type { Page, Request } from '@playwright/test';
import { DEFAULT_PORTFOLIO } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { seedDraft, signIn } from '../harness/preview-grants';
import { openTask } from '../harness/studio-tasks';
import { ownerApp } from '../harness/profile-matrix';

// Studio's Publish history task (#8, Slice 6), against the built server
// with the password provider: publish only after a confirmation naming the
// live revision and what replaces it, live state read from live.get after
// it, a lost answer after the server committed asked again with the same
// key and published once, each revision's authored and derived changes,
// and a rollback that asks first, says what's live after, and leaves the
// working draft as it was.
const STUDIO = { type: 'route', description: '/studio' };

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });
test.describe.configure({ mode: 'serial' });

const line = (page: Page, label: string) =>
  page
    .locator('.studio-state__line')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');

const short = (id: string) => id.slice(0, 16);

/** The harness's own portfolio, which publishes, with its identity renamed `name`. */
const named = (name: string) =>
  readFileSync(DEFAULT_PORTFOLIO, 'utf8').replace('  name: Rowan Fixture\n', `  name: ${name}\n`);

/** The working draft, holding the harness's documents with the portfolio named `name`. */
const draftNamed = (app: Parameters<typeof seedDraft>[0], name: string) =>
  seedDraft(app, name, undefined, named(name));

interface Live {
  readonly liveRevisionId: string | null;
  readonly seq: number | null;
}

/** What live.get says now, asked from the open Studio page as Studio asks. */
const liveOf = (page: Page) =>
  page.evaluate(async () => {
    const response = await fetch('/api/studio/live.get');
    return ((await response.json()) as { data: Live }).data;
  });

/** The publication events, oldest first. */
const eventsOf = (page: Page) =>
  page.evaluate(async () => {
    const response = await fetch('/api/studio/history.list?limit=100');
    return ((await response.json()) as { data: { events: { type: string; seq: number }[] } }).data
      .events;
  });

const history = (page: Page) => page.getByRole('region', { name: 'Publish history' });

/**
 * Makes the working draft publishable the owner's way: the harness's site
 * names a composition no build registers, so the Appearance task picks one
 * this build offers and applies it as the next version, which the server
 * checks. Returns that version.
 */
async function choosePublishable(page: Page, version: number): Promise<number> {
  await openTask(page, 'Appearance');
  const form = page.getByRole('form', { name: 'Appearance' });
  const composition = form.getByRole('combobox', { name: 'Composition the site shows' });
  // The workspace renders its options once the draft is in: wait for one, as #124 does.
  await expect(composition.locator('option:not([value="missing-variant"])').first()).toBeAttached();
  const offered = await composition
    .locator('option')
    .evaluateAll((options) =>
      options
        .map((option) => (option as HTMLOptionElement).value)
        .filter((value) => value !== '' && value !== 'missing-variant'),
    );
  expect(offered.length, 'a composition this build offers').toBeGreaterThan(0);
  await composition.selectOption(offered[0]!);
  await form.getByRole('button', { name: 'Apply to the draft' }).click();
  await expect(line(page, 'Draft')).toHaveText(`Saved draft, version ${version + 1}.`);
  return version + 1;
}

async function openHistory(page: Page) {
  await openTask(page, 'Publish history');
  await expect(page.getByRole('heading', { level: 3, name: 'Publish' })).toBeVisible();
}

test(
  'publish asks first, naming the live revision and the draft version that replaces it, and says what live.get says after',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await draftNamed(app, 'Rowan Published');
    await signIn(page, app, secret.password);
    const version = await choosePublishable(page, draft.version);
    await openHistory(page);
    const before = await liveOf(page);
    const publish = page.getByRole('button', { name: `Publish version ${version}` });
    await expect(publish).toBeVisible();
    await expect(publish).not.toHaveAttribute('aria-disabled', 'true');

    // The confirmation names both, and Cancel publishes nothing.
    await publish.click();
    const dialog = page.getByRole('dialog', { name: 'Publish this draft?' });
    await expect(dialog).toContainText(`Live now: revision ${short(before.liveRevisionId!)}`);
    await expect(dialog).toContainText(`version ${version} of the draft`);
    // What the complete summary says of that version, 8-2's own data.
    await expect(dialog).toContainText('The complete draft validates');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect((await liveOf(page)).liveRevisionId).toBe(before.liveRevisionId);
    // By keyboard alone: Enter opens it with focus inside, and Escape closes it back on its button.
    await publish.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: `Publish version ${version} now` }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(publish).toBeFocused();
    expect((await liveOf(page)).liveRevisionId).toBe(before.liveRevisionId);

    const sent = page.waitForRequest((request) => request.url().endsWith('/api/studio/publish'));
    await publish.click();
    await dialog.getByRole('button', { name: `Publish version ${version} now` }).click();
    const body = (await sent).postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({
      draftId: draft.draftId,
      draftVersion: version,
      expectedLiveRevisionId: before.liveRevisionId,
    });
    expect(String(body.idempotencyKey)).toMatch(/^studio-/);

    await expect
      .poll(async () => (await liveOf(page)).liveRevisionId)
      .not.toBe(before.liveRevisionId);
    const after = await liveOf(page);
    await expect(history(page).getByRole('status')).toHaveText(
      new RegExp(
        `^Published: .* Revision ${short(after.liveRevisionId!)}, number ${after.seq}, is live now\\.$`,
      ),
    );
    await expect(line(page, 'Live')).toHaveText(
      `Revision ${short(after.liveRevisionId!)}, number ${after.seq}, is live.`,
    );
    // Publishing closes the draft, and the new revision heads the list as live.
    await expect(line(page, 'Draft')).toHaveText('No saved draft yet.');
    await expect(history(page).locator('.studio-history__revision').first()).toContainText(
      `Revision ${short(after.liveRevisionId!)}`,
    );
    await expect(history(page).locator('.studio-history__revision').first()).toContainText(
      'Live now.',
    );
  },
);

test(
  "while a publish runs, Escape leaves its dialog open, so it can't close on a move still going",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await draftNamed(app, 'Rowan Held');
    await signIn(page, app, secret.password);
    const version = await choosePublishable(page, draft.version);
    await openHistory(page);
    // The publish waits at the network until the test lets it go.
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    await page.route('**/api/studio/publish', async (route) => {
      await held;
      await route.continue();
    });
    await page.getByRole('button', { name: `Publish version ${version}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Publish this draft?' });
    await dialog.getByRole('button', { name: `Publish version ${version} now` }).click();
    await expect(history(page).getByRole('status')).toHaveText('Publishing…');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    release();
    await expect(history(page).getByRole('status')).toHaveText(/^Published: /);
    await expect(dialog).toBeHidden();
  },
);

test(
  'a lost answer after the server committed: Studio asks again with the same key, publishes once, and reports the true live revision',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await draftNamed(app, 'Rowan Retried');
    await signIn(page, app, secret.password);
    const version = await choosePublishable(page, draft.version);
    await openHistory(page);
    const before = await liveOf(page);
    const published = (await eventsOf(page)).filter(({ type }) => type === 'publish').length;

    // The first publish reaches the server, which commits; its answer never comes back.
    const sent: Request[] = [];
    await page.route('**/api/studio/publish', async (route) => {
      sent.push(route.request());
      if (sent.length === 1) {
        await route.fetch();
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });
    await page.getByRole('button', { name: `Publish version ${version}` }).click();
    await page
      .getByRole('dialog', { name: 'Publish this draft?' })
      .getByRole('button', { name: `Publish version ${version} now` })
      .click();

    await expect(history(page).getByRole('status')).toHaveText(/^Published: /);
    const after = await liveOf(page);
    expect(after.liveRevisionId).not.toBe(before.liveRevisionId);
    // Two requests, one key, one publish.
    expect(sent).toHaveLength(2);
    const keys = sent.map(
      (request) => (request.postDataJSON() as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys[1]).toBe(keys[0]);
    expect((await eventsOf(page)).filter(({ type }) => type === 'publish')).toHaveLength(
      published + 1,
    );
    await expect(history(page).getByRole('status')).toContainText(
      `Revision ${short(after.liveRevisionId!)}, number ${after.seq}, is live now.`,
    );
  },
);

test(
  "each revision shows its authored changes as the text's diff and its derived ones by pointer",
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    await openHistory(page);
    const live = await liveOf(page);
    // The live revision, published from "Rowan Retried" over "Rowan Held".
    await history(page)
      .getByRole('button', { name: `Changes in ${short(live.liveRevisionId!)}` })
      .click();
    const diff = history(page).getByLabel('Changes to portfolio.yml');
    await expect(diff).toContainText('-  name: Rowan Held');
    await expect(diff).toContainText('+  name: Rowan Retried');
    const derived = history(page).getByRole('region', { name: 'Derived changes' });
    await expect(derived.getByRole('row', { name: /portfolio \/identity\/name/ })).toContainText(
      '"Rowan Retried"',
    );
  },
);

test(
  'a rollback asks first, makes the earlier revision live, says so from live.get, and leaves the working draft as it was',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await draftNamed(app, 'Rowan Kept');
    await signIn(page, app, secret.password);
    await openHistory(page);
    const before = await liveOf(page);
    const target = await page.evaluate(async (live) => {
      const response = await fetch('/api/studio/revision.list');
      const { data } = (await response.json()) as {
        data: { revisions: { revisionId: string; compatible: boolean }[] };
      };
      return data.revisions.find((each) => each.compatible && each.revisionId !== live)!.revisionId;
    }, before.liveRevisionId);

    await history(page)
      .getByRole('button', { name: `Roll back to ${short(target)}` })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Roll back the live site?' });
    await expect(dialog).toContainText(`Live now: revision ${short(before.liveRevisionId!)}.`);
    await expect(dialog).toContainText(`Revision ${short(target)} replaces it.`);
    await expect(dialog).toContainText('The working draft stays as it is.');
    const sent = page.waitForRequest((request) => request.url().endsWith('/api/studio/rollback'));
    await dialog.getByRole('button', { name: `Roll back to ${short(target)} now` }).click();
    expect((await sent).postDataJSON()).toMatchObject({
      targetRevisionId: target,
      expectedLiveRevisionId: before.liveRevisionId,
    });

    await expect(history(page).getByRole('status')).toHaveText(/^Rolled back: /);
    const after = await liveOf(page);
    expect(after.liveRevisionId).toBe(target);
    await expect(history(page).getByRole('status')).toContainText(
      `Revision ${short(target)}, number ${after.seq}, is live now.`,
    );
    // The working draft is the one seeded, at its version, and now starts from a revision that isn't live.
    await expect(line(page, 'Draft')).toHaveText(`Saved draft, version ${draft.version}.`);
    await expect(line(page, 'Publish')).toHaveText(
      'Not ready to publish: the live revision changed since the draft started.',
    );
    const kept = await page.evaluate(async () => {
      const response = await fetch('/api/studio/draft.getWorking');
      return ((await response.json()) as { data: { draft: { draftId: string; version: number } } })
        .data.draft;
    });
    expect(kept).toMatchObject({ draftId: draft.draftId, version: draft.version });
  },
);

test(
  'a revision #3 marks incompatible says why and offers no rollback',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await signIn(page, app, secret.password);
    const live = await liveOf(page);
    // #3's answer, with every revision but the live one marked as this build can't serve it.
    await page.route('**/api/studio/revision.list*', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        data: { revisions: { revisionId: string; compatible: boolean; reason?: string }[] };
      };
      for (const revision of body.data.revisions) {
        if (revision.revisionId !== live.liveRevisionId) {
          revision.compatible = false;
          revision.reason = 'removed';
        }
      }
      await route.fulfill({ response, json: body });
    });
    await openHistory(page);
    const revisions = history(page).locator('.studio-history__revision');
    await expect(
      revisions.filter({ hasText: "can't make it live (removed)" }).first(),
    ).toBeVisible();
    await expect(history(page).getByRole('button', { name: /^Roll back to / })).toHaveCount(0);
  },
);
