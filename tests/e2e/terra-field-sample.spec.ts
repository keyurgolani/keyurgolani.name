import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { SAMPLE_APP } from '../variants/target';

// On a phone, on the sample as the demo serves it (the Swiss x Terra fix's review: no test held
// the phone): the seal whole in all three looks, the photograph touching the arc's low point,
// four type sizes in the first view; and under 64rem Field notes reaches every destination.

const annotation = [
  { type: 'route', description: '/sample?variant=terra-field' },
  { type: 'profile', description: 'demo' },
];

test.use({ appOptions: SAMPLE_APP });

const LOOKS = {
  own: 'language=soft-organic&scheme=botanical-sage&type=field-serif',
  default: 'language=platform-neutral&scheme=warm-parchment&type=humanist-ui',
  'poster-mono': 'language=poster-press&scheme=poster-primaries&type=console-mono',
};
const open = async (page: Page, look: string, width = 390, height = 844) => {
  await page.setViewportSize({ width, height });
  await page.goto(`/sample?variant=terra-field&${look}&mode=light`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-variant="terra-field"]')).toHaveCount(1);
};

test(
  'at 390 the seal is whole in every look, a circle, no word broken (TF-M2)',
  { annotation },
  async ({ page }) => {
    for (const [name, look] of Object.entries(LOOKS)) {
      await open(page, look);
      const fit = await page.locator('.tf-seal').evaluate((element) => {
        const box = element.getBoundingClientRect();
        const label = element.querySelector('.tf-seal__label');
        const broken: string[] = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          for (const match of text.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index!);
            range.setEnd(node, match.index! + match[0].length);
            if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1)
              broken.push(match[0]);
          }
        }
        return {
          w: box.width,
          h: box.height,
          broken,
          overflows: label ? label.scrollWidth > label.clientWidth + 1 : false,
        };
      });
      expect(fit.broken, name).toEqual([]);
      expect(fit.overflows, name).toBe(false);
      expect(Math.abs(fit.w - fit.h), `${name}: a circle`).toBeLessThan(2);
    }
  },
);

/**
 * The sample on a phone once its band has its photograph. The demo derives the sample's media
 * after it starts, so a cold server can serve the page before the photograph is ready, and the
 * band then has none (TF-M6: only a ready image anchors it): load again until it's there, as
 * editorial-evidence-plate.spec.ts waits for Pl. 1, then let the image decode before measuring.
 */
async function withBandPhoto(page: Page, look: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await open(page, look);
        return page.locator('.tf-band__photo img').count();
      },
      {
        message:
          "the band had no photograph within 20 s: the demo derives the sample's media after it starts, and the photograph never became ready, so there's nothing to measure",
        // Under the test's own 30 s, so this message is what reports.
        timeout: 20_000,
      },
    )
    .toBeGreaterThan(0);
  await page.locator('.tf-band__photo img').evaluate((img) => (img as HTMLImageElement).decode());
}

/** The arc's low point, the photograph's top, and the seal's edges (TF-M4). */
async function bandAtArc(page: Page) {
  const at = await page.evaluate(() => {
    const hero = document.querySelector('.tf-hero')!.getBoundingClientRect();
    const photo = document.querySelector('.tf-band__photo')?.getBoundingClientRect();
    const seal = document.querySelector('.tf-seal')!.getBoundingClientRect();
    return { arc: hero.bottom, photo: photo?.top, sealTop: seal.top, sealBottom: seal.bottom };
  });
  expect(at.photo, 'the sample anchors the band on its photograph').toBeDefined();
  expect(Math.abs(at.photo! - at.arc)).toBeLessThan(1.5);
  expect(at.sealTop).toBeLessThan(at.photo!);
  expect(at.sealBottom).toBeGreaterThan(at.photo!);
}

test(
  'at 390 the photograph starts at the arc’s low point, the seal over its top edge (TF-M4)',
  { annotation },
  async ({ page }) => {
    await withBandPhoto(page, LOOKS.own);
    await bandAtArc(page);
  },
);

test.describe('on a cold server', () => {
  // With no script, so nothing re-renders the page the server sent.
  test.use({ javaScriptEnabled: false });

  test(
    'TF-M4 waits for the band’s photograph when the first loads come before the sample’s media is ready',
    { annotation },
    async ({ page }) => {
      // The first two loads are what a cold server sends: the band without its photograph.
      let loads = 0;
      await page.route(/\/sample\?variant=terra-field/, async (route) => {
        if (route.request().resourceType() !== 'document' || ++loads > 2) return route.continue();
        const response = await route.fetch();
        const body = (await response.text())
          .replace(/<figure class="tf-band__photo"[\s\S]*?<\/figure>/, '')
          .replace(/(class="tf-page tf-band"[^>]*data-photo=")"/, '$1none"');
        await route.fulfill({ response, body });
      });
      await withBandPhoto(page, LOOKS.own);
      expect(loads, 'it loaded again until the photograph was there').toBeGreaterThan(2);
      await bandAtArc(page);
    },
  );
});

test(
  'at 390 the first view holds four type sizes at most (T1)',
  { annotation },
  async ({ page }) => {
    for (const [name, look] of Object.entries(LOOKS)) {
      await open(page, look);
      const sizes = await page.evaluate(() => {
        const seen = new Set<number>();
        const walker = document.createTreeWalker(
          document.querySelector('[data-variant]')!,
          NodeFilter.SHOW_TEXT,
        );
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!(node.textContent ?? '').trim()) continue;
          const parent = node.parentElement!;
          if (
            parent.closest(
              '.tf-sr, [aria-hidden="true"], dialog:not([open]), [data-ui-slot="skip-link"]',
            )
          )
            continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const box = range.getBoundingClientRect();
          if (box.width === 0 || box.bottom <= 0 || box.top >= innerHeight) continue;
          seen.add(Math.round(parseFloat(getComputedStyle(parent).fontSize) * 2) / 2);
        }
        return [...seen].sort((a, b) => a - b);
      });
      expect(sizes.length, `${name}: ${sizes.join(', ')}`).toBeLessThanOrEqual(4);
    }
  },
);

test(
  'under 64rem the masthead is the name and Field notes, and Field notes reaches all five',
  { annotation },
  async ({ page }) => {
    for (const width of [768, 390]) {
      await open(page, LOOKS.own, width, 1024);
      const destinations = await page
        .locator('.tf-mast [data-tf-to]')
        .evaluateAll((links) => links.map((link) => link.getAttribute('data-tf-to')));
      expect(destinations.length, `${width}`).toBe(5);
      // In the DOM for the wide masthead, out of sight here (code review low 2).
      for (const link of await page.locator('.tf-mast [data-tf-to]').all())
        await expect(link, `${width}`).toBeHidden();
      await expect(page.locator('.tf-mast__name')).toBeVisible();
      await page.locator('.tf-mast [data-tf-notes]').click();
      const dialog = page.locator('dialog.tf-notes');
      await expect(dialog).toHaveJSProperty('open', true);
      // Contact leads the dialog; every other destination heads a column of its sections.
      const reached = await dialog.evaluate((element) => [
        ...[...element.querySelectorAll('.tf-notes__reach a')].map((a) => a.getAttribute('href')),
        ...[...element.querySelectorAll('.tf-notes__dest')].map((a) => a.getAttribute('href')),
      ]);
      expect(
        reached.filter((href) => href?.startsWith('#')).length,
        `${width}`,
      ).toBeGreaterThanOrEqual(5);
      for (const href of reached.filter((each) => each?.startsWith('#')))
        expect(await page.locator(`[id="${href!.slice(1)}"]`).count(), href!).toBe(1);
      await page.keyboard.press('Escape');
    }
  },
);

test(
  'at 390 on a work’s page, from deep in the account the marker opens Field notes, which reaches Contact and every part',
  {
    annotation: [
      { type: 'route', description: '/sample/work/postmortem-template-kit' },
      annotation[1]!,
    ],
  },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `/sample/work/postmortem-template-kit?variant=terra-field&${LOOKS.own}&mode=light`,
      {
        waitUntil: 'networkidle',
      },
    );
    await expect(page.locator('[data-tf-page="case"]')).toHaveCount(1);
    // The sample's cover is ready, so it breaks the field's arc: it starts above the arc's low
    // point and ends below it, at 390 and at 1440 (code re-review R1, E7).
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.evaluate(() => scrollTo(0, 0));
      const at = await page.evaluate(() => ({
        arc: document.querySelector('.tf-hero--case[data-cover]')?.getBoundingClientRect().bottom,
        cover: document.querySelector('.tf-casecover__frame img')?.getBoundingClientRect(),
      }));
      expect(at.arc, `${width}: the field waits for its cover`).toBeDefined();
      expect(at.cover, `${width}: the cover`).toBeDefined();
      expect(at.cover!.top, `${width}: the cover rises into the field`).toBeLessThan(at.arc! - 8);
      expect(at.cover!.bottom, `${width}: and ends on paper`).toBeGreaterThan(at.arc! + 8);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // Work stays the current page's destination once the spy runs, through to the close
    // (code re-review R2).
    const work = page.locator('.tf-mast [data-tf-to="work"]');
    await expect(work).toHaveAttribute('aria-current', 'page');
    await page.locator('.tf-close').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await expect(work).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.tf-mast [aria-current="page"]')).toHaveCount(1);
    const dialog = page.locator('dialog.tf-notes');
    const fromDepth = async () => {
      await page.locator('[data-part="decisions"]').scrollIntoViewIfNeeded();
      const button = page.locator('.tf-marker [data-tf-notes]');
      await expect(button, 'the marker holds Field notes at depth').toBeInViewport();
      await button.click();
      await expect(dialog).toHaveJSProperty('open', true);
    };
    // Field notes, then Contact: this page's own close.
    await fromDepth();
    const contact = dialog.locator('.tf-notes__reach a[href^="#"]').first();
    const to = (await contact.getAttribute('href'))!;
    expect(to.startsWith('#'), to).toBe(true);
    await contact.click();
    await expect(dialog).toHaveJSProperty('open', false);
    await expect(page.locator(`[id="${to.slice(1)}"]`)).toBeInViewport();
    // Field notes, then This page, In hindsight: the part, here.
    await fromDepth();
    const group = dialog.locator('[data-tf-page-group]');
    await expect(group).toContainText('This page');
    const hindsight = group.getByRole('link', { name: 'In hindsight' });
    const part = (await hindsight.getAttribute('href'))!;
    await hindsight.click();
    await expect(dialog).toHaveJSProperty('open', false);
    await expect(page.locator(`[id="${part.slice(1)}"]`)).toBeInViewport();
    expect(new URL(page.url()).hash).toBe(part);
  },
);
