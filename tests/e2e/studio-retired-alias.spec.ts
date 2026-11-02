import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { seedDraft, signIn } from '../harness/preview-grants';
import { ownerApp } from '../harness/profile-matrix';
import { checkedIn, openTask, optionsIn, pick, picker, reveal } from '../harness/studio-tasks';

// Retired ids in Studio (LANG-1, LANG-5a), against the built server with the
// password provider: a saved draft that names a retired design language,
// color scheme, and typography profile opens with each survivor checked,
// no retired id offered, the alias notices before publish, and nothing to
// save. A save of another axis writes that axis alone, and a pick on an
// aliased axis writes the owner's pick.
const STUDIO = { type: 'route', description: '/studio' };

const secret = ownerSecret();
test.use({ appOptions: ownerApp(secret.hash) });
test.describe.configure({ mode: 'serial' });

const SITE = `schemaVersion: 2
appearance:
  variant: editorial-evidence
  designLanguage: ant-inspired
  colorScheme: bookcloth
  typography: literary-reading
  displayMode: system
visitorControls:
  variant: locked
  designLanguage: locked
  colorScheme: selectable
  typography: locked
  displayMode: selectable
motionPolicy: respect-os
features:
  feed: false
`;

const RETIRED = {
  'Design language the site shows': ['ant-inspired', 'primer-inspired'],
  'Color scheme the site shows': ['bookcloth', 'paper-ink'],
  'Typography the site shows': ['literary-reading', 'editorial-serif'],
} as const;
const NOT_OFFERED = [
  'ant-inspired',
  'radix-inspired',
  'polaris-inspired',
  'atlassian-inspired',
  'bookcloth',
  'zinc',
  'earthy-clay',
  'literary-reading',
];

const workspace = (page: Page) => page.getByRole('form', { name: 'Appearance' });
const line = (page: Page, label: string) =>
  page
    .locator('.studio-state__line')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');

test(
  'a draft that names retired ids opens on their survivors, offers none of them, says so before publish, and has nothing to save',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    await seedDraft(app, 'Rowan Alias', SITE);
    await signIn(page, app, secret.password);
    await openTask(page, 'Appearance');
    const form = workspace(page);
    for (const [name, [retired, survivor]] of Object.entries(RETIRED)) {
      const group = picker(form, name);
      await reveal(group);
      await expect
        .poll(() => checkedIn(group), `${name} checks ${survivor} for ${retired}`)
        .toBe(survivor);
      const offered = await optionsIn(group);
      expect(offered, `${name} offers ${survivor}`).toContain(survivor);
      for (const id of NOT_OFFERED) expect(offered, `${name} offers ${id}`).not.toContain(id);
    }
    // The survivors are checked with nothing pending, so there's nothing to save.
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // The validator's own findings, once Studio has saved the draft and the server checked it:
    // a save from Content, which leaves the site document, aliases and all, as it was.
    await openTask(page, 'Content');
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    const portfolio = page.getByLabel(/^portfolio\.(?:yml|json)$/);
    await portfolio.fill(`${await portfolio.inputValue()}# saved from Studio\n`);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(line(page, 'This browser')).toHaveText('No unsaved changes.');
    await expect(page.getByLabel(/^site\.(?:yml|json)$/)).toHaveValue(SITE);
    await openTask(page, 'Appearance');
    await form.getByText(/^Before publish:/).click();
    const findings = form.getByRole('region', { name: 'Before publish' });
    await expect(findings).toContainText(
      "bookcloth was merged into paper-ink and follows its updates; bookcloth now resolves to paper-ink's dove-grey stock; its cloth inks survive in paper-ink's categorical set.",
    );
    await expect(findings).toContainText(
      'literary-reading was merged into editorial-serif and follows its updates; at the merge, its serif became an old-style face (Iowan Old Style on Apple devices) and its labels a neutral sans.',
    );
    await expect(findings).not.toContainText('Blocks publishing');
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  },
);

test(
  'a save of another axis writes that axis alone, and a pick on an aliased axis writes what the owner picked',
  { annotation: [STUDIO] },
  async ({ page, app }) => {
    const draft = await seedDraft(app, 'Rowan Alias', SITE);
    await signIn(page, app, secret.password);
    await openTask(page, 'Appearance');
    const form = workspace(page);
    await pick(picker(form, 'Display mode the site shows'), 'dark');
    let applied = page.waitForRequest((request) =>
      request.url().endsWith('/api/studio/draft.applyEdits'),
    );
    await page.getByRole('button', { name: 'Save draft' }).click();
    expect((await applied).postDataJSON().edits).toEqual([
      { document: 'site', pointer: '/appearance/displayMode', op: 'set', value: 'dark' },
    ]);
    await expect(page.getByRole('status').first()).toHaveText(
      `Applied the appearance as draft version ${draft.version + 1}.`,
    );
    // The aliases are still the draft's: the survivors stay checked, with nothing pending.
    await expect
      .poll(() => checkedIn(picker(form, 'Color scheme the site shows')))
      .toBe('paper-ink');
    await pick(picker(form, 'Color scheme the site shows'), 'signal-paper');
    await pick(picker(form, 'Typography the site shows'), 'book-serif');
    applied = page.waitForRequest((request) =>
      request.url().endsWith('/api/studio/draft.applyEdits'),
    );
    await page.getByRole('button', { name: 'Save draft' }).click();
    expect((await applied).postDataJSON().edits).toEqual([
      { document: 'site', pointer: '/appearance/colorScheme', op: 'set', value: 'signal-paper' },
      { document: 'site', pointer: '/appearance/typography', op: 'set', value: 'book-serif' },
    ]);
    await expect(page.getByRole('status').first()).toHaveText(
      `Applied the appearance as draft version ${draft.version + 2}.`,
    );
  },
);
