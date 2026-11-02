import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../harness/fixtures';

// Mission Control's archived strip on the bundled sample, whose archived work
// has the longest fold name of any strip ("Credits, notes and tags"): at a
// tablet's width, a phone held sideways and a desk at 200% zoom the summary
// keeps a reading measure, never the one letter a line it set when the foot's
// track took the strip's width (the design review's B1). Nothing overflows
// there, so the sideways-scroll checks can't see it: this measures the text.
// And no other text block in main is set narrower than 8 characters. Under
// read-only, on MC's own packs.

const REPO = new URL('../../', import.meta.url);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

/** The bundled sample as an owner's own: read-only refuses the sample's name, title, and share image. */
function ownedSample(): string {
  const sample = readFileSync(fileURLToPath(new URL('portfolio.example.yml', REPO)), 'utf8');
  const owned = sample
    .replace('\n  name: Anamika Devi\n', '\n  name: Rowan Console\n')
    .replace(/\n {2}title: Anamika Devi[^\n]*\n/, '\n  title: Rowan Console, portfolio\n')
    .replace('\n  ogImage:\n    asset: og-image\n', '\n');
  if (/\n {2}name: Anamika Devi\n|\n {2}title: Anamika Devi|\n {2}ogImage:/.test(owned)) {
    throw new Error("The sample's identity moved: update ownedSample().");
  }
  return owned;
}

/** The example site, selecting Mission Control on its own packs. */
function missionSite(): string {
  const site = readFileSync(fileURLToPath(new URL('site.example.yml', REPO)), 'utf8');
  const selected = site
    .replace('\n  variant: editorial-evidence\n', '\n  variant: mission-control\n')
    .replace('\n  designLanguage: platform-neutral\n', '\n  designLanguage: utility-dense\n')
    .replace('\n  colorScheme: warm-parchment\n', '\n  colorScheme: control-room\n')
    .replace('\n  typography: humanist-ui\n', '\n  typography: console-mono\n');
  if (!selected.includes('\n  variant: mission-control\n') || !selected.includes('console-mono')) {
    throw new Error("The example site's appearance moved: update missionSite().");
  }
  return selected;
}

test.use({
  appOptions: {
    portfolio: null,
    siteText: missionSite(),
    sourceFiles: {
      'portfolio.yml': ownedSample(),
      'snapshots/github.json': readFileSync(new URL('snapshots/github.json', REPO), 'utf8'),
    },
  },
});

/** Each strip's summary, and any open text block in main, in characters of its own face. */
const measure = () => {
  const ch = (element: Element) => {
    const probe = document.createElement('span');
    probe.textContent = '0';
    probe.style.cssText = 'position: absolute; visibility: hidden; font: inherit';
    element.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  };
  const chars = (element: Element) => element.getBoundingClientRect().width / ch(element);
  const strips = [...document.querySelectorAll('.mc-strip')].map((strip) => {
    const summary = strip.querySelector('.mc-strip__summary');
    return {
      title: strip.querySelector('.mc-strip__title')?.textContent ?? '',
      fold: strip.querySelector('summary')?.textContent?.trim() ?? '',
      summary: summary ? Math.round(chars(summary) * 10) / 10 : null,
    };
  });
  const narrow: string[] = [];
  for (const element of document.querySelectorAll(
    'main :is(p, li, dd, blockquote, figcaption, h2, h3, h4, .pf-rich-text)',
  )) {
    // A closed fold's content isn't set; a short label can be as narrow as its words.
    if (element.closest('details:not([open]) > :not(summary)')) continue;
    const text = element.textContent?.trim() ?? '';
    if (text.length < 12) continue;
    const box = element.getBoundingClientRect();
    if (box.height === 0) continue;
    const wide = chars(element);
    if (wide < 8)
      narrow.push(
        `${element.className || element.tagName}: ${wide.toFixed(1)}ch "${text.slice(0, 30)}"`,
      );
  }
  return { strips, narrow };
};

test(
  'the archived strip keeps its summary a reading measure at tablet widths and 200% zoom, and no text block in main is narrower than 8 characters (the design review’s B1)',
  { annotation },
  async ({ page }) => {
    // 720 is a 1440 desk at 200% zoom; 600 to 900 are the widths the strip collapsed at.
    for (const width of [1440, 1024, 900, 768, 720, 600]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.locator('[data-variant="mission-control"]')).toHaveCount(1);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const { strips, narrow } = await page.evaluate(measure);
      expect(strips.length, `${width}: the sample has its archived strip`).toBeGreaterThan(0);
      for (const strip of strips) {
        expect(strip.fold, `${width}: the strip's fold`).not.toBe('');
        expect(
          strip.summary,
          `${width}: ${strip.title}'s summary, beside "${strip.fold}"`,
        ).not.toBeNull();
        expect(
          strip.summary!,
          `${width}: ${strip.title}'s summary in characters, beside "${strip.fold}"`,
        ).toBeGreaterThanOrEqual(20);
      }
      expect(narrow, `${width}: text blocks narrower than 8ch`).toEqual([]);
    }
  },
);
