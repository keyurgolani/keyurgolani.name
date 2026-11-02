import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { parse, stringify } from 'yaml';
import { readPair } from '../../packages/schema/src/node';
import { resolvePortfolioView, routedSlugs } from '../../packages/schema/src/index';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Shell's case page, /work/<slug>, in a browser (brief §5.6, P2): a man(1)
// page on the complete fixture under read-only, with a second work given its
// own page so the case has a next work (one server for the file: a worker's
// app options can't change inside it), at each width:
// - no sideways scroll, and no box past the window, the fixed bar's included;
// - no radius on the manual's sections, its synopsis or its decisions: the
//   character grid has none;
// - every part reachable by keyboard: Tab reaches each part's row in the
//   index, and the status line never covers what Tab reaches;
// - the palette lists the parts and jumps to one, landing at its head with
//   focus in it;
// - in print, both navigations print as lines in the flow;
// - with a second work that has its own page, the way on: Next with its
//   `man <slug>` line goes to it (the palette lists it too), and All work
//   to the work destination.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ = readPair(FIXTURE.files);
if (!READ.ok) throw new Error('complete does not read');
const SLUG = [
  ...routedSlugs(resolvePortfolioView(READ.pair, {}, { mediaBase: '/media' })),
].sort()[0]!;
const WORK = (READ.pair.portfolio.works ?? []).find((work) => work.slug === SLUG)!;
const SHOTS = process.env.SHELL_SHOTS;

const annotation = [
  { type: 'route', description: '/work/[slug]' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

/**
 * The complete fixture with a second work given its own page, listed after the case's work in
 * the same section, so the case has a next work.
 */
const NEXT_SLUG = 'object-title';
function withNext(): string {
  const doc = parse(readFileSync(FIXTURE.files.portfolio, 'utf8')) as {
    works: { id: string; [key: string]: unknown }[];
  };
  const work = doc.works.find(({ id }) => id === NEXT_SLUG);
  if (!work) throw new Error(`complete has no ${NEXT_SLUG}`);
  Object.assign(work, { slug: NEXT_SLUG, caseStudy: { challenge: 'Object challenge.' } });
  // One fixed folder, rewritten by each load with the same text, so runs don't pile up in /tmp.
  const dir = path.join(tmpdir(), 'kgn-shell-case-next');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'portfolio.yml');
  // Written aside and renamed in, so a worker never copies a half-written file.
  writeFileSync(`${file}.${process.pid}`, stringify(doc));
  renameSync(`${file}.${process.pid}`, file);
  return file;
}

test.use({
  appOptions: {
    portfolio: withNext(),
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'shell'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

async function load(page: Page): Promise<void> {
  await page.goto(`/work/${SLUG}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'shell');
  await expect(page.locator('[data-sh-enhanced]')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(WORK.title);
}

/** The status line's top edge. */
const barTop = (page: Page) =>
  page.locator('[data-sh-tmux]').evaluate((el) => el.getBoundingClientRect().top);

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test.describe(`at ${viewport.width}`, () => {
    test.use({ viewport });

    test(
      'the man page: no sideways scroll, no box past the window, no radius on the manual',
      { annotation, tag },
      async ({ page }) => {
        await load(page);
        const report = await page.evaluate(() => {
          const width = document.documentElement.clientWidth;
          const past = (el: Element) => el.getBoundingClientRect().right > width + 0.5;
          const held = (el: Element) => {
            for (let at = el.parentElement; at; at = at.parentElement) {
              if (getComputedStyle(at).overflowX !== 'visible') return !past(at);
            }
            return false;
          };
          const offenders = [...document.body.querySelectorAll('*')]
            .filter((el) => past(el) && el.parentElement && !past(el.parentElement) && !held(el))
            .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
          const rounded = [
            ...document.querySelectorAll(
              '.sh-man, .sh-man__sec, .sh-man__h, .sh-man__body, .sh-man__kv, .sh-man__kv dt, .sh-man__kv dd, .sh-man__dec, .sh-man__see, .sh-man__run',
            ),
          ]
            .filter((el) => getComputedStyle(el).borderRadius !== '0px')
            .map((el) => el.className);
          return {
            scroll: document.documentElement.scrollWidth,
            width,
            offenders,
            rounded,
            sections: document.querySelectorAll('.sh-man__sec').length,
          };
        });
        expect(report.scroll).toBeLessThanOrEqual(report.width);
        expect(report.offenders).toEqual([]);
        expect(report.rounded).toEqual([]);
        expect(report.sections).toBeGreaterThan(4);
        if (SHOTS) {
          await page.screenshot({ path: `${SHOTS}/case-${viewport.width}-fold.png` });
          await page.screenshot({
            path: `${SHOTS}/case-${viewport.width}-full.png`,
            fullPage: true,
          });
        }
      },
    );

    test(
      'every part is reachable by keyboard, and what Tab reaches clears the status line',
      { annotation, tag },
      async ({ page }) => {
        await load(page);
        const rows = await page
          .locator('.sh-pane .sh-row[data-sh-target]')
          .evaluateAll((all) => all.map((a) => a.getAttribute('href')!));
        expect(rows.length).toBeGreaterThan(4);
        const reached = new Set<string>();
        const covered: string[] = [];
        for (let i = 0; i < 400; i++) {
          await page.keyboard.press('Tab');
          const stop = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) return null;
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            const ring = parseFloat(s.outlineWidth) + Math.max(0, parseFloat(s.outlineOffset));
            const bar = document.querySelector('[data-sh-tmux]')!;
            return {
              href: el.getAttribute('href'),
              inBar: bar.contains(el),
              row: el.matches('.sh-pane .sh-row'),
              bottom: r.bottom + ring,
              top: r.top - ring,
              height: r.height,
              text: (el.textContent ?? '').trim().slice(0, 30),
            };
          });
          if (!stop) break;
          if (stop.row && stop.href) reached.add(stop.href);
          const edge = await barTop(page);
          // Anything whose bottom (its ring included) sits below the bar's top is covered,
          // the stop wholly behind the bar as much as one across its edge.
          if (!stop.inBar && stop.height > 0 && stop.bottom > edge + 0.5) {
            covered.push(`${stop.text} (${Math.round(stop.bottom)} > ${Math.round(edge)})`);
          }
          if (stop.inBar && stop.text.includes('jump')) break;
        }
        if (viewport.width >= 1280) {
          expect([...rows].filter((href) => !reached.has(href))).toEqual([]);
        } else {
          // Below the docked width the palette is the index: jump lists every part.
          await expect(page.locator('.sh-pane')).toBeHidden();
          await page.locator('[data-sh-jump]').click();
          const listed = await page
            .locator('dialog.sh-dlg [role="option"]')
            .evaluateAll((all) => all.map((option) => option.getAttribute('data-href')));
          await page.keyboard.press('Escape');
          expect(rows.filter((href) => !listed.includes(href))).toEqual([]);
        }
        expect(covered).toEqual([]);
      },
    );

    test(
      'each part, landed on from its index row (its fragment where the palette is the index), has its head in view and clear of the status line',
      { annotation, tag },
      async ({ page }) => {
        await load(page);
        const rows = await page
          .locator('.sh-pane .sh-row[data-sh-target]')
          .evaluateAll((all) => all.map((a) => a.getAttribute('href')!));
        expect(rows.length).toBeGreaterThan(4);
        const unclear: string[] = [];
        for (const href of rows) {
          await page.evaluate(() => scrollTo(0, 0));
          if (viewport.width >= 1280) {
            const row = page.locator(`.sh-pane .sh-row[href="${href}"]`);
            await row.scrollIntoViewIfNeeded();
            await row.click();
          } else {
            // The index is the palette here; its row's link is the same fragment.
            await page.evaluate((to) => {
              location.hash = to;
            }, href);
          }
          await expect(page).toHaveURL(new RegExp(`${href}$`));
          const head = await page.locator(`[id="${href.slice(1)}"]`).evaluate((el) => {
            const top = el.getBoundingClientRect().top;
            const h = el.querySelector(':scope > .sh-man__h')!.getBoundingClientRect();
            const bar = document.querySelector('[data-sh-tmux]')!.getBoundingClientRect().top;
            return { top, bottom: h.bottom, bar };
          });
          if (head.top < -0.5 || head.bottom > head.bar + 0.5) {
            unclear.push(
              `${href}: top ${Math.round(head.top)}, head ${Math.round(head.bottom)} > ${Math.round(head.bar)}`,
            );
          }
        }
        expect(unclear).toEqual([]);
      },
    );
  });
}

test(
  'the palette lists the case parts and jumps to one, landing at its head with focus in it',
  { annotation, tag },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page);
    await page.locator('[data-sh-jump]').click();
    const dialog = page.locator('dialog.sh-dlg');
    await expect(dialog).toHaveJSProperty('open', true);
    const options = await dialog
      .getByRole('option')
      .evaluateAll((all) => all.map((option) => option.getAttribute('aria-label')));
    for (const part of ['Name', 'Synopsis', 'Authors']) expect(options).toContain(part);
    const target = WORK.caseStudy?.decisions?.length ? 'Decisions' : 'Authors';
    await page.keyboard.type(target);
    await expect(dialog.locator('[role="option"][aria-selected="true"]')).toHaveAttribute(
      'aria-label',
      target,
    );
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveJSProperty('open', false);
    const hash = await page.evaluate(() => location.hash.slice(1));
    expect(hash).toMatch(new RegExp(`--${target.toLowerCase()}$`));
    const landed = page.locator(`[id="${hash}"]`);
    // At its head: its top where its scroll margin puts it, or, when the page's end holds it
    // lower, still in view with its heading clear of the status line.
    await expect
      .poll(() =>
        landed.evaluate((el) => {
          const top = el.getBoundingClientRect().top;
          const margin = parseFloat(getComputedStyle(el).scrollMarginBlockStart) || 0;
          const end = scrollY >= document.documentElement.scrollHeight - innerHeight - 1;
          const head = el.querySelector(':scope > .sh-man__h')!.getBoundingClientRect().bottom;
          const bar = document.querySelector('[data-sh-tmux]')!.getBoundingClientRect().top;
          return top >= -1 && (top <= margin + 2 || (end && head <= bar + 0.5));
        }),
      )
      .toBe(true);
    expect(await landed.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    // The spy names where the session is: the counter reads the landed part's place among the
    // page's sections (every one is in ~/work, so the window alone can't tell), and the window.
    const place = await page.evaluate((id) => {
      const blocks = [...document.querySelectorAll('.sh-block')];
      return `${blocks.findIndex((block) => block.id === id) + 1}/${blocks.length}`;
    }, hash);
    expect(place).not.toMatch(/^0\//);
    await expect(page.locator('[data-sh-count]')).toHaveText(place);
    await expect(page.locator('.sh-tmux__win[data-dest="work"]')).toHaveAttribute(
      'aria-current',
      'location',
    );
  },
);

test(
  'the running head and foot are one line each at every width, the title never stacked twice',
  { annotation, tag },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page);
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [run, most] of [
        ['.sh-man__run:not(.sh-man__run--foot)', 2],
        ['.sh-man__run--foot', 1],
      ] as const) {
        const line = await page.locator(run).evaluate((el) => {
          const box = el.getBoundingClientRect();
          // A line's height: the first part's, which never wraps.
          const row = el.children[0]!.getBoundingClientRect().height;
          // What shows: the parts on the one line, not those wrapped past its box.
          const shown = [...el.children].filter((child) => {
            const r = child.getBoundingClientRect();
            return r.width > 0 && r.top < box.bottom - 0.5;
          });
          const title = el.lastElementChild!.textContent;
          return {
            height: box.height,
            row,
            tops: shown.map((child) => Math.round(child.getBoundingClientRect().top)),
            titles: shown.filter((child) => child.textContent === title).length,
          };
        });
        const at = `${run} at ${width}`;
        expect(line.height, at).toBeLessThan(line.row * 1.5);
        expect(new Set(line.tops).size, `${at}: ${line.tops.join(', ')}`).toBe(1);
        // Both of the head's copies of the title only on one line; the foot's once.
        expect(line.titles, at).toBeLessThanOrEqual(most);
      }
    }
  },
);

test(
  'a focused body link keeps the page between its ring and its words',
  { annotation, tag },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page);
    const link = page.locator('main .sh-man .sh-man__body a[href]:not([data-ui-slot])').first();
    await link.evaluate((el) => {
      el.setAttribute('data-test-gap', '');
      (el as HTMLElement).scrollIntoView({ block: 'center' });
    });
    // Reached by the keyboard, so the ring shows.
    await page.evaluate(() => {
      const stops = [...document.querySelectorAll<HTMLElement>('a[href], button:not([hidden])')];
      const at = stops.findIndex((el) => el.hasAttribute('data-test-gap'));
      stops[at - 1]!.focus({ preventScroll: true });
    });
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-test-gap]')).toBeFocused();
    // The clear band inside the ring: its offset, a transparent border, and the padding of a
    // link with no fill. The platform's ring sits at the language's offset (0 here), so Shell
    // builds the band inside it.
    const measured = await page.locator('[data-test-gap]').evaluate((el) => {
      const s = getComputedStyle(el);
      const clear = (colour: string) => /rgba\(.*,\s*0\)$|transparent/.test(colour);
      return {
        style: s.outlineStyle,
        gap:
          (parseFloat(s.outlineOffset) || 0) +
          (clear(s.borderLeftColor) ? parseFloat(s.borderLeftWidth) || 0 : 0) +
          (clear(s.backgroundColor) ? parseFloat(s.paddingLeft) || 0 : 0),
      };
    });
    expect(measured.style).not.toBe('none');
    expect(measured.gap).toBeGreaterThanOrEqual(1);
  },
);

test(
  'in print the index and the status line print as lines in the flow',
  { annotation, tag },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page);
    await page.emulateMedia({ media: 'print' });
    const printed = await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>('[data-sh-tmux]')!;
      const pane = document.querySelector<HTMLElement>('.sh-pane')!;
      return {
        bar: getComputedStyle(bar).position,
        pane: getComputedStyle(pane).position,
        wins: getComputedStyle(bar.querySelector('.sh-tmux__wins')!).display,
        rows: [...pane.querySelectorAll('.sh-row')].filter(
          (a) => a.getBoundingClientRect().height > 0,
        ).length,
        all: pane.querySelectorAll('.sh-row').length,
      };
    });
    expect(printed.bar).toBe('static');
    expect(printed.pane).toBe('static');
    expect(printed.wins).not.toBe('none');
    expect(printed.rows).toBe(printed.all);
  },
);

test.describe('with a next work', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test(
    'Next goes to the next work, by its man line and the palette, and All work to the work destination',
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      const on = page.locator('nav.sh-man__on');
      const next = on.locator('.sh-man__go a[data-sh-work]');
      await expect(next).toHaveText('Object title');
      expect(await next.getAttribute('href')).toMatch(new RegExp(`/work/${NEXT_SLUG}$`));
      await expect(on.locator('p.sh-man__go').first()).toContainText('Next:');
      // Its command line, hidden from assistive tech, runs man on its slug.
      const line = on.locator('.sh-cmd').first();
      await expect(line).toHaveAttribute('aria-hidden', 'true');
      await expect(line).toContainText(`man ${NEXT_SLUG}`);
      // All work is the status line's work window.
      const all = await on.locator('.sh-man__all a').getAttribute('href');
      expect(all).toBe(await page.locator('.sh-tmux__win[data-dest="work"]').getAttribute('href'));
      // The palette lists the next work by its title, under Work.
      await page.locator('[data-sh-jump]').click();
      const dialog = page.locator('dialog.sh-dlg');
      await expect(dialog).toHaveJSProperty('open', true);
      const work = dialog.locator('[role="group"]').filter({ hasText: /^Work/ });
      await expect(work.getByRole('option', { name: 'Object title' })).toHaveCount(1);
      await page.keyboard.press('Escape');
      // And it goes there: the next page is the next work's, with no Next of its own.
      await next.click();
      await expect(page).toHaveURL(new RegExp(`/work/${NEXT_SLUG}$`));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Object title');
      await expect(page.locator('nav.sh-man__on')).not.toContainText('Next:');
      if (SHOTS) {
        await page.goBack();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(WORK.title);
        await on.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/case-1440-next.png` });
      }
    },
  );
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(
    `at ${viewport.width} with 200% text, the man page scrolls no way but down, NAME breaks no word, and the bar keeps jump whole`,
    { annotation, tag },
    async ({ page }) => {
      await page.setViewportSize(viewport);
      await load(page);
      // 200% text: the root size doubled, as the tokens are rem-based (WCAG 1.4.4).
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const wide = await page.evaluate(() => {
        const root = document.documentElement;
        const over = [...document.querySelectorAll<HTMLElement>('[data-variant] *')]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.right > root.clientWidth + 0.5)
          .sort((a, b) => b.r.right - a.r.right)
          .slice(0, 3)
          .map(
            ({ el, r }) => `${el.tagName.toLowerCase()}.${el.className}: ${Math.round(r.right)}`,
          );
        return { scroll: root.scrollWidth - root.clientWidth, over };
      });
      expect(wide.scroll, wide.over.join('; ')).toBeLessThanOrEqual(0);
      // NAME at the text's own size: every word of the title on one line (a word that's longer
      // than the column may still wrap, which isn't the 2x step breaking it).
      const name = page.getByRole('heading', { level: 1 });
      const sizes = await name.evaluate((el) => {
        const probe = document.createElement('span');
        probe.style.fontSize = 'var(--type-body-font-size)';
        el.parentElement!.append(probe);
        const body = getComputedStyle(probe).fontSize;
        probe.remove();
        return { title: getComputedStyle(el).fontSize, body };
      });
      expect(sizes.title).toBe(sizes.body);
      const jump = (await page.locator('[data-sh-tmux] .sh-tmux__jump:visible').boundingBox())!;
      expect(jump.x + jump.width).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(jump.x).toBeGreaterThanOrEqual(0);
    },
  );
}
