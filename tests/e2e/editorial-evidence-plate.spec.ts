import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';

// Editorial Evidence's Pl. 1 in a browser (EDI-1): the plate hangs from the
// contents' line on a mat that hugs the artwork, its marks sit on the
// artwork at every width, and from 1024 each note's leader runs from its key
// across the gutter and up into its mark. On the demo's sample, whose cover
// is a picture; the complete fixture's is unavailable (editorial-evidence.spec.ts).

test.use({ appOptions: DEMO_APP, viewport: { width: 1440, height: 900 } });

async function load(page: Page, route: string): Promise<void> {
  // The demo derives its media after it starts, so a cold server can serve the sample before
  // Pl. 1's renditions exist (every picture "Image unavailable"): load again until Pl. 1 has its
  // picture, as media.spec.ts's derivedHome() waits.
  await expect
    .poll(
      async () => {
        await page.goto(route, { waitUntil: 'load' });
        return page.locator('.ee-lead__frame img').count();
      },
      {
        message: `Pl. 1 had no picture on ${route} within 20 s: the demo derives the sample's media after it starts, and its renditions never arrived, so the plate is "Image unavailable" and there is nothing to measure`,
        // Under the test's own 30 s, so this message is what reports.
        timeout: 20_000,
      },
    )
    .toBeGreaterThan(0);
  await expect(page.locator('[data-variant]')).toHaveAttribute(
    'data-variant',
    'editorial-evidence',
  );
  await page.evaluate(() => document.fonts.ready);
}

/** Pl. 1 as laid out: its mat, its artwork, its marks, its notes' keys and their leaders (EDI-1). */
const plate = (page: Page) =>
  page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left,
        y: r.top,
        r: r.right,
        b: r.bottom,
        cx: (r.left + r.right) / 2,
        cy: (r.top + r.bottom) / 2,
      };
    };
    const all = (selector: string) => [...document.querySelectorAll(selector)].map(box);
    // A part the plate lacks fails by its name, never as a null read.
    const one = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`Pl. 1 has no ${selector} to measure`);
      return el;
    };
    // How far the mat's own edge reaches in from its foot: its border, and any inset shadow a
    // language draws there (a bevel, a rim), by its offset toward the foot, its spread and its
    // blur (r2 N-2).
    const mat = getComputedStyle(one('.ee-lead__frame'));
    let band = 0;
    for (const layer of mat.boxShadow.split(/,(?![^(]*\))/)) {
      if (!/\binset\b/.test(layer)) continue;
      const [, y = 0, blur = 0, spread = 0] = (
        layer.replace(/\([^)]*\)/g, '').match(/-?[\d.]+px/g) ?? []
      ).map(parseFloat);
      band = Math.max(band, -y + spread + blur);
    }
    return {
      foot: parseFloat(mat.borderBottomWidth) + band,
      frame: box(one('.ee-lead__frame')),
      art: box(one('.ee-lead__frame img')),
      contents: box(one('.ee-contents')),
      caption: box(one('.ee-lead__caption')),
      space: parseFloat(getComputedStyle(one('.ee-lead__pin')).minInlineSize),
      pins: all('.ee-lead__pin'),
      keys: all('.ee-lead__key'),
      runs: all('.ee-lead__run'),
      rises: all('.ee-lead__rise'),
      leaders: getComputedStyle(one('.ee-lead__leaders')).display,
    };
  });

type Plate = Awaited<ReturnType<typeof plate>>;

/** The clearance a run keeps from Pl. 1's mat top and foot, inside the mat or under it. */
const CLEARANCE = 6;

/**
 * Every run whose centre sits within CLEARANCE px of Pl. 1's mat top or foot, inside or outside:
 * a leader there reads as the mat's edge, not as a line across its ground (EE-LANG round 2, P1-1).
 * And every run inside the mat's foot ground, between the artwork and the foot, that comes within
 * CLEARANCE px of either: of the artwork's foot, or of where the mat's edge starts inside its foot,
 * its border and any bevel or rim, so it runs on flat ground (r2 N-2).
 */
function edgeRuns(p: Plate): string[] {
  return p.runs.flatMap((run, i) => {
    const near = (gap: number, what: string) =>
      Math.abs(gap) > CLEARANCE
        ? []
        : [
            `run ${i + 1}'s centre is ${Math.abs(gap).toFixed(1)} px ${gap < 0 ? 'above' : 'below'} ${what}`,
          ];
    const found = [
      ...near(run.cy - p.frame.y, "the mat's top"),
      ...near(run.cy - p.frame.b, "the mat's foot"),
    ];
    if (run.cy > p.art.b && run.cy < p.frame.b) {
      found.push(
        ...near(run.cy - p.art.b, "the artwork's foot"),
        ...near(run.cy - (p.frame.b - p.foot), "the mat's edge inside its foot"),
      );
    }
    return found;
  });
}

// On the demo's sample, whose cover is a picture (the complete fixture's is unavailable).
const SAMPLE =
  '/sample?variant=editorial-evidence&language=platform-neutral&scheme=warm-parchment&type=humanist-ui&mode=light';

for (const width of [1440, 1300, 1024, 768, 390]) {
  test(
    `at ${width}, Pl. 1 hangs on a hugging mat, its marks on the artwork, its leaders to the notes`,
    {
      annotation: [
        { type: 'route', description: '/sample' },
        { type: 'profile', description: 'demo' },
      ],
    },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await load(page, SAMPLE);
      await page.evaluate(() => document.fonts.ready);
      const p = await plate(page);
      // The mat hangs from the contents' line beside the head column, from the caption's beside the notes.
      if (width >= 1300) expect(Math.abs(p.frame.y - p.contents.y)).toBeLessThanOrEqual(2);
      else if (width >= 768) expect(Math.abs(p.frame.y - p.caption.y)).toBeLessThanOrEqual(2);
      // It hugs the artwork, its padding equal on every side.
      const pads = [
        p.art.x - p.frame.x,
        p.frame.r - p.art.r,
        p.art.y - p.frame.y,
        p.frame.b - p.art.b,
      ];
      expect(Math.max(...pads) - Math.min(...pads)).toBeLessThanOrEqual(1);
      // One mark per note, each well inside the picture.
      expect(p.pins.length).toBeGreaterThan(0);
      expect(p.keys).toHaveLength(p.pins.length);
      for (const pin of p.pins) {
        expect(pin.cx - p.art.x).toBeGreaterThanOrEqual(p.space);
        expect(p.art.r - pin.cx).toBeGreaterThanOrEqual(p.space);
        expect(pin.cy - p.art.y).toBeGreaterThanOrEqual(p.space);
        expect(p.art.b - pin.cy).toBeGreaterThanOrEqual(p.space);
      }
      // The sample's marks sit on its cover's front sheet (the review's measure at 1440).
      if (width === 1440) {
        for (const pin of p.pins) {
          expect(pin.cx).toBeGreaterThan(688);
          expect(pin.cx).toBeLessThan(914);
          expect(pin.cy).toBeGreaterThan(358);
          expect(pin.cy).toBeLessThan(548);
        }
      }
      // Under 1024 the notes sit among the marks or under the plate: the numerals key them alone.
      if (width < 1024) {
        expect(p.leaders).toBe('none');
        return;
      }
      // Each run leaves its key at the key's height and turns at its mark; the rise joins the two.
      // Where the notes sit under the marks (beside the head column) the runs step left from note 1
      // to the last; where they sit over them, right.
      expect(p.runs).toHaveLength(p.pins.length);
      const under = p.keys[0]!.cy > p.pins[0]!.cy;
      expect(under).toBe(width >= 1300);
      p.runs.forEach((run, i) => {
        const pin = p.pins[i]!;
        const key = p.keys[i]!;
        const rise = p.rises[i]!;
        expect(Math.abs(run.cy - key.cy)).toBeLessThanOrEqual(2);
        expect(Math.abs(run.x - pin.cx)).toBeLessThanOrEqual(2);
        expect(run.r).toBeLessThan(key.x);
        expect(Math.abs(rise.y - Math.min(pin.cy, key.cy))).toBeLessThanOrEqual(2);
        expect(Math.abs(rise.b - Math.max(pin.cy, key.cy))).toBeLessThanOrEqual(2);
        if (i > 0 && under) expect(run.x).toBeLessThan(p.runs[i - 1]!.x);
        if (i > 0 && !under) expect(run.x).toBeGreaterThan(p.runs[i - 1]!.x);
      });
      // No two leaders cross: no run passes through another note's rise.
      const crossings = p.runs.flatMap((run, i) =>
        p.rises.flatMap((rise, j) =>
          i !== j &&
          rise.x > run.x + 1 &&
          rise.x < run.r - 1 &&
          run.cy > rise.y + 1 &&
          run.cy < rise.b - 1
            ? [`run ${i + 1} crosses rise ${j + 1}`]
            : [],
        ),
      );
      expect(crossings).toEqual([]);
    },
  );
}

// Every run clears Pl. 1's mat top and foot by more than 6 px, in every language: the mat keeps
// EDI-1's step at least, whatever the language's surface space, so the first note's leader, which
// turns inside the mat, runs on its ground (EE-LANG round 2, P1-1). From 1440 the lower notes'
// leaders run under the mat to their keys, on the foot ground: EDI-1's elbow, by design, and
// clear of the foot too.
for (const language of [
  'platform-neutral',
  'raw-brutalist',
  'letterpress',
  'claymorphic',
  'glassmorphism',
]) {
  for (const width of [1440, 1024]) {
    test(
      `at ${width} under ${language}, every run's centre is more than 6 px from Pl. 1's mat top and foot, inside or outside`,
      {
        annotation: [
          { type: 'route', description: '/sample' },
          { type: 'profile', description: 'demo' },
        ],
      },
      async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await load(page, SAMPLE.replace('language=platform-neutral', `language=${language}`));
        await expect(page.locator('[data-variant]')).toHaveAttribute(
          'data-design-language',
          language,
        );
        const p = await plate(page);
        expect(p.runs.length).toBeGreaterThan(0);
        expect(edgeRuns(p)).toEqual([]);
        // And the first note's leader turns inside the mat, on its ground (the P1-1 case).
        expect(
          p.runs.some((run) => run.cy > p.frame.y + CLEARANCE && run.cy < p.frame.b - CLEARANCE),
        ).toBe(true);
      },
    );
  }
}

// The clearance check itself: a run nudged by the DOM to 3 px from the mat's foot, inside it or
// under it, fails it, and so does one 3 px above a bevel planted inside the foot; the clean plate
// passes. So the check above can bite.
test(
  "the run clearance itself: a run planted 3 px inside or under Pl. 1's mat foot, or over a bevel inside it, fails it",
  {
    annotation: [
      { type: 'route', description: '/sample' },
      { type: 'profile', description: 'demo' },
    ],
  },
  async ({ page }) => {
    await load(page, SAMPLE);
    const clean = await plate(page);
    expect(edgeRuns(clean)).toEqual([]);
    const last = clean.runs.length;
    expect(last).toBeGreaterThan(0);
    /** Moves the last run by the DOM until its centre sits `at` px from the mat's foot. */
    const nudge = (at: number) =>
      page.evaluate(
        ({ at, index }) => {
          const run = document.querySelectorAll<HTMLElement>('.ee-lead__run')[index]!;
          const mat = document.querySelector('.ee-lead__frame')!.getBoundingClientRect();
          run.style.translate = '';
          const r = run.getBoundingClientRect();
          run.style.translate = `0 ${mat.bottom + at - (r.top + r.bottom) / 2}px`;
        },
        { at, index: last - 1 },
      );
    const message = (what: string) =>
      expect.stringMatching(new RegExp(`^run ${last}'s centre is [23]\\.\\d px ${what}$`));
    // 3 px under the foot, on the page's ground.
    await nudge(3);
    expect(edgeRuns(await plate(page))).toEqual([message("below the mat's foot")]);
    // 3 px inside the foot, on its edge.
    await nudge(-3);
    const inside = await plate(page);
    expect(Math.abs(inside.runs[last - 1]!.cy - inside.frame.b + 3)).toBeLessThan(0.5);
    expect(edgeRuns(inside)).toContainEqual(message("above the mat's foot"));
    // A 20 px bevel planted inside the foot, the run 3 px above where it starts: on the flat
    // ground by the box, on the bevel's crease by the eye.
    await page.locator('.ee-lead__frame').evaluate((mat) => {
      (mat as HTMLElement).style.boxShadow = 'inset 0 -20px 0 0 rgb(0 0 0 / 0.2)';
    });
    const planted = await plate(page);
    expect(planted.foot).toBeGreaterThanOrEqual(20);
    await nudge(-(planted.foot + 3));
    expect(edgeRuns(await plate(page))).toEqual([message("above the mat's edge inside its foot")]);
  },
);

// The mat is the language's card in every corner and on every edge: EE resets none of its
// radius or border, an asymmetric language's included (EE-LANG round 2, r2 L-6).
for (const language of ['platform-neutral', 'memphis', 'soft-organic', 'raw-brutalist']) {
  test(
    `under ${language}, Pl. 1's mat takes the language's card radius and border on all four sides`,
    {
      annotation: [
        { type: 'route', description: '/sample' },
        { type: 'profile', description: 'demo' },
      ],
    },
    async ({ page }) => {
      await load(page, SAMPLE.replace('language=platform-neutral', `language=${language}`));
      await expect(page.locator('[data-variant]')).toHaveAttribute(
        'data-design-language',
        language,
      );
      const sides = await page.locator('.ee-lead__frame').evaluate((mat) => {
        const read = (style: CSSStyleDeclaration) =>
          [
            'borderTopLeftRadius',
            'borderTopRightRadius',
            'borderBottomRightRadius',
            'borderBottomLeftRadius',
            'borderTopWidth',
            'borderRightWidth',
            'borderBottomWidth',
            'borderLeftWidth',
            'borderTopStyle',
            'borderLeftStyle',
          ].map((key) => style[key as keyof CSSStyleDeclaration] as string);
        // A probe with only the card's two tokens set, in the mat's own context.
        const probe = document.createElement('div');
        probe.style.borderRadius = 'var(--ui-radius-card)';
        probe.style.border = 'var(--ui-border-card)';
        mat.append(probe);
        const card = read(getComputedStyle(probe));
        probe.remove();
        return { mat: read(getComputedStyle(mat)), card };
      });
      expect(sides.mat).toEqual(sides.card);
    },
  );
}

// The standfirst's foot (P3 L-4): beside the head column the lead opening takes a step off it, so
// Pl. 1's notes ride high enough for note 1's leader; on two columns it keeps the larger one. The
// bare opening, with no Pl. 1, keeps its full step (editorial-evidence-opening.spec.ts).
for (const width of [1440, 1024]) {
  const step = width >= 1300 ? '--space-s' : '--space-l';
  test(
    `at ${width}, the lead opening's standfirst ends on ${step}`,
    {
      annotation: [
        { type: 'route', description: '/sample' },
        { type: 'profile', description: 'demo' },
      ],
    },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await load(page, SAMPLE);
      await expect(page.locator('.ee-opening')).not.toHaveClass(/\bee-opening--bare\b/);
      const foot = await page.locator('.ee-thesis__stand').evaluate((stand, token) => {
        // The token as a length here, on a probe beside the standfirst.
        const probe = document.createElement('div');
        probe.style.paddingBlockEnd = `var(${token})`;
        stand.parentElement!.append(probe);
        const want = parseFloat(getComputedStyle(probe).paddingBlockEnd);
        probe.remove();
        return { got: parseFloat(getComputedStyle(stand).paddingBlockEnd), want };
      }, step);
      expect(foot.want, `${step} resolves to a length`).toBeGreaterThan(0);
      expect(foot.got).toBeCloseTo(foot.want, 1);
    },
  );
}

// The ruled index (EE-LANG P4) beside the head column: its rules and steps fit the room the plain
// list had, so it never sets the opening's height and so never moves Pl. 1's notes and their
// leaders. Laid out from its top, it ends short of its column's foot, in every language and in
// the widest type, on the sample, whose index is the longest the demo has.
for (const type of ['humanist-ui', 'accessible-reading']) {
  for (const language of [
    'platform-neutral',
    'claymorphic',
    'raw-brutalist',
    'glassmorphism',
    'material-3-inspired',
    'letterpress',
  ]) {
    test(
      `under ${language} and ${type} at 1440, the ruled index fits its column with room to spare`,
      {
        annotation: [
          { type: 'route', description: '/sample' },
          { type: 'profile', description: 'demo' },
        ],
      },
      async ({ page }) => {
        await load(
          page,
          `/sample?variant=editorial-evidence&language=${language}&scheme=warm-parchment&type=${type}&mode=light`,
        );
        const fit = await page.locator('.ee-contents__list').evaluate((list) => {
          const foot = list.getBoundingClientRect().bottom;
          // Laid out from its top, with the column's spare room left at the end, not between.
          list.style.justifyContent = 'flex-start';
          const last = list.lastElementChild!.getBoundingClientRect().bottom;
          list.style.justifyContent = '';
          return { spare: foot - last, rules: list.querySelectorAll('li + li').length };
        });
        expect(fit.rules).toBeGreaterThan(1);
        expect(fit.spare, "the index's spare room in its column").toBeGreaterThan(4);
      },
    );
  }
}
