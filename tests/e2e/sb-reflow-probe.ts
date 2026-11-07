// Rows 45/50 CI probe, evidence only, not for merge (branch kgn-e/sb-probe-ci). On #178 (run
// 42312753050), 8 of Spatial Bento's 12 1440 default cells, <pack>/warm-parchment/humanist-ui/system on
// the complete fixture's home, fail one reflow root-text record that names no element: "the page scrolls
// sideways: 1066-1069px of content in 1024px". platform-neutral and carbon-inspired fail; minimal-flat and
// material-3-inspired pass. It doesn't reproduce on macOS, even under the font proxy, so this reads the
// page on CI Linux, with its fonts, for those four packs, one spec file each (a file's appOptions serve one
// site). The page goes through the reflow conditions in the check's order, each entered by the check's
// own enterReflowCondition, and is read at 200% root text at 1024x768; then at 1024x768 with 100% root
// text, as a control. Each reading has:
// - the document's scrollWidth against innerWidth;
// - the 25 elements reaching furthest right, each with its selector, rect, computed white-space,
//   min-width and overflow, and whether it sits inside an SVG whose overflow is visible;
// - each .sb-stage__body's resolved grid-template-columns and gaps;
// - the widest .sb-contents__name, with its text and width;
// - the pack's resolved type and space tokens: the root font size, the body's and a board name's font
//   family, size, weight and letter-spacing, and the --space-*, --layout-* and --type-* properties;
// - the @font-face rules and loaded faces of the families in those stacks; and, once a pack, fc-match for
//   every family in the stacks and every local() name their faces give.
// The readings are printed in the log as one "[sb-probe] json" line per pack, with a few readable lines,
// and attached as JSON. It passes whatever it finds: a probe, not a test.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { siteTextFor } from '../quality/cells';
import {
  enterReflowCondition,
  reflowConditions,
  type ReflowCondition,
} from '../quality/lib/a11y/conditions';

/** The packs #178 split on: the first two fail root-text at 1024, the last two pass. */
export const PROBE_PACKS = {
  'platform-neutral': 'fails on #178',
  'carbon-inspired': 'fails on #178',
  'minimal-flat': 'passes on #178',
  'material-3-inspired': 'passes on #178',
} as const;

/** What one reading holds. */
interface Reading {
  readonly label: string;
  readonly settled: boolean;
  readonly page: Record<string, unknown>;
  readonly widest: readonly Record<string, unknown>[];
  readonly stageBodies: readonly Record<string, unknown>[];
  readonly widestName: Record<string, unknown> | null;
  readonly tokens: Record<string, string>;
}

function read(page: Page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const selector = (el: Element) => {
      let out = '';
      let at: Element | null = el;
      for (let depth = 0; at && at !== document.body && depth < 6; depth += 1) {
        const cls =
          typeof at.className === 'string' && at.className.trim()
            ? `.${at.className.trim().split(/\s+/).join('.')}`
            : '';
        out = `${at.localName}${at.id ? `#${at.id}` : ''}${cls}${out ? ` > ${out}` : ''}`;
        at = at.parentElement;
      }
      return out;
    };
    const rect = (el: Element) => {
      const b = el.getBoundingClientRect();
      const r = (n: number) => Math.round(n * 10) / 10;
      return {
        left: r(b.left),
        top: r(b.top),
        right: r(b.right),
        bottom: r(b.bottom),
        width: r(b.width),
        height: r(b.height),
      };
    };
    const inVisibleSvg = (el: Element) => {
      for (let up = el.parentElement; up; up = up.parentElement) {
        if (up.localName === 'svg' && getComputedStyle(up).overflow.includes('visible'))
          return true;
      }
      return false;
    };
    const type = (el: Element | null) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        selector: selector(el),
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing,
        wordSpacing: cs.wordSpacing,
        lineHeight: cs.lineHeight,
      };
    };
    const all = [...document.body.querySelectorAll('*')].filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 || b.height > 0;
    });
    const widest = all
      .map((el) => ({ el, right: el.getBoundingClientRect().right }))
      .sort((a, b) => b.right - a.right)
      .slice(0, 25)
      .map(({ el }) => {
        const cs = getComputedStyle(el);
        return {
          selector: selector(el),
          rect: rect(el),
          whiteSpace: cs.whiteSpace,
          minWidth: cs.minWidth,
          overflow: cs.overflow,
          overflowX: cs.overflowX,
          position: cs.position,
          inVisibleSvg: inVisibleSvg(el),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        };
      });
    const stageBodies = [...document.querySelectorAll('.sb-stage__body')].map((el) => {
      const cs = getComputedStyle(el);
      const row = el.querySelector('.sb-contents__row');
      const leader = el.querySelector('.sb-contents__leader');
      return {
        selector: selector(el),
        rect: rect(el),
        gridTemplateColumns: cs.gridTemplateColumns,
        columnGap: cs.columnGap,
        rowGap: cs.rowGap,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        rowColumns: row ? getComputedStyle(row).gridTemplateColumns : null,
        rowGap2: row ? getComputedStyle(row).columnGap : null,
        leaderMargin: leader ? getComputedStyle(leader).marginInline : null,
        still: el.querySelector('.sb-still')?.getAttribute('data-stage') ?? null,
      };
    });
    const names = [...document.querySelectorAll('.sb-contents__name')].map((el) => ({
      selector: selector(el),
      text: (el.textContent ?? '').trim(),
      width: el.getBoundingClientRect().width,
      rect: rect(el),
      scrollWidth: el.scrollWidth,
      whiteSpace: getComputedStyle(el).whiteSpace,
      fontFamily: getComputedStyle(el).fontFamily,
      fontSize: getComputedStyle(el).fontSize,
    }));
    names.sort((a, b) => b.width - a.width);
    // The --space-*, --layout-* and --type-* properties the stylesheets declare, as the stage resolves them.
    const declared = new Set<string>();
    const walk = (rules: CSSRuleList) => {
      for (const rule of [...rules]) {
        if ('style' in rule && rule.style instanceof CSSStyleDeclaration) {
          for (const name of [...rule.style]) {
            if (/^--(space|layout|type)-/.test(name)) declared.add(name);
          }
        }
        if ('cssRules' in rule && rule.cssRules) walk(rule.cssRules as CSSRuleList);
      }
    };
    for (const sheet of [...document.styleSheets]) {
      try {
        walk(sheet.cssRules);
      } catch {
        // A sheet the page can't read adds nothing.
      }
    }
    const at = document.querySelector('.sb-stage__body') ?? document.body;
    const resolved = getComputedStyle(at);
    const tokens = Object.fromEntries(
      [...declared].sort().map((name) => [name, resolved.getPropertyValue(name).trim()]),
    );
    // The @font-face rules and loaded faces of every family in the body's and a board name's stacks.
    const families = new Set(
      [document.body, document.querySelector('.sb-contents__name')]
        .filter((el): el is Element => Boolean(el))
        .flatMap((el) => getComputedStyle(el).fontFamily.split(','))
        .map((name) => name.trim().replace(/^["']|["']$/g, '')),
    );
    const faces: Record<string, string>[] = [];
    const facesIn = (rules: CSSRuleList) => {
      for (const rule of [...rules]) {
        if (rule instanceof CSSFontFaceRule) {
          const family = rule.style
            .getPropertyValue('font-family')
            .trim()
            .replace(/^["']|["']$/g, '');
          if (families.has(family)) {
            faces.push({
              family,
              src: rule.style.getPropertyValue('src'),
              weight: rule.style.getPropertyValue('font-weight'),
              style: rule.style.getPropertyValue('font-style'),
              sizeAdjust: rule.style.getPropertyValue('size-adjust'),
              unicodeRange: rule.style.getPropertyValue('unicode-range'),
            });
          }
        } else if ('cssRules' in rule && rule.cssRules) facesIn(rule.cssRules as CSSRuleList);
      }
    };
    for (const sheet of [...document.styleSheets]) {
      try {
        facesIn(sheet.cssRules);
      } catch {
        // A sheet the page can't read adds nothing.
      }
    }
    const fontSet = [...document.fonts]
      .filter((face) => families.has(face.family.replace(/^["']|["']$/g, '')))
      .map((face) => ({
        family: face.family,
        weight: face.weight,
        style: face.style,
        status: face.status,
      }));
    const boundary = document.querySelector('[data-color-scheme]');
    return {
      page: {
        scrollWidth: html.scrollWidth,
        scrollingElementScrollWidth: document.scrollingElement?.scrollWidth ?? null,
        clientWidth: html.clientWidth,
        innerWidth,
        innerHeight,
        bodyScrollWidth: document.body.scrollWidth,
        rootFontSize: getComputedStyle(html).fontSize,
        appearance: boundary
          ? Object.fromEntries(
              [...boundary.attributes]
                .filter((a) => a.name.startsWith('data-'))
                .map((a) => [a.name, a.value]),
            )
          : null,
        trebuchetLoaded: document.fonts.check('16px "Trebuchet MS"'),
        faces,
        fontSet,
        bodyType: type(document.body),
        nameType: type(document.querySelector('.sb-contents__name')),
        metaType: type(document.querySelector('.sb-contents__meta')),
        namesCount: names.length,
      },
      widest,
      stageBodies,
      widestName: names[0] ?? null,
      tokens,
    };
  });
}

type Pack = keyof typeof PROBE_PACKS;

/** The tuple the probe serves for `pack`: <pack>/warm-parchment/humanist-ui/system. */
const tupleFor = (pack: Pack) => ({
  variant: 'spatial-bento',
  designLanguage: pack,
  colorScheme: 'warm-parchment',
  typography: 'humanist-ui',
  displayMode: 'system',
});

/** The spec file's test.use for `pack`: its site, and the quality cell's own 1440 default context. */
export function sbProbeUse(pack: Pack) {
  const fixture = contractFixture('complete');
  const dir = path.dirname(fixture.files.portfolio);
  return {
    appOptions: {
      portfolio: fixture.files.portfolio,
      siteText: siteTextFor(fixture, tupleFor(pack)),
      sourceFiles: Object.fromEntries(
        fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
      ),
    },
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
    colorScheme: 'light' as const,
  };
}

/** The probe's title for `pack`. */
export const sbProbeTitle = (pack: Pack) =>
  `sb reflow probe: ${pack} (${PROBE_PACKS[pack]}), the home at 1024x768, 200% root text and 100%`;

/** The probe for `pack`: Spatial Bento's home, read as the file header says. */
export function sbProbe(pack: Pack) {
  return async ({ page }: { page: Page }, testInfo: TestInfo) => {
    testInfo.setTimeout(120_000);
    const readings: Reading[] = [];
    const cdp = await page.context().newCDPSession(page);
    try {
      await page.goto('/', { waitUntil: 'load' });
      // The check's own order: 320, 200% zoom, then 200% root text, read there.
      for (const condition of reflowConditions()) {
        const settled = await enterReflowCondition(page, cdp, condition, '/');
        if (condition.rule === 'root-text') {
          readings.push({
            label: `${condition.rule} ${condition.id} at ${condition.text * 100}% root text`,
            settled,
            ...(await read(page)),
          });
        }
      }
      const rootText = reflowConditions().find((each) => each.rule === 'root-text')!;
      const control: ReflowCondition = { ...rootText, rule: 'control', text: 1 };
      const settled = await enterReflowCondition(page, cdp, control, '/');
      readings.push({
        label: `control ${control.id} at 100% root text`,
        settled,
        ...(await read(page)),
      });
    } finally {
      await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
      await cdp.detach().catch(() => undefined);
    }
    // fc-match for every family in the resolved stacks and every local() name their faces give.
    const first = readings[0]?.page as
      | {
          bodyType?: { fontFamily?: string };
          nameType?: { fontFamily?: string };
          faces?: { src: string }[];
        }
      | undefined;
    const names = new Set<string>();
    for (const stack of [first?.bodyType?.fontFamily, first?.nameType?.fontFamily]) {
      for (const name of (stack ?? '').split(',')) {
        const family = name.trim().replace(/^["']|["']$/g, '');
        if (family) names.add(family);
      }
    }
    for (const face of first?.faces ?? []) {
      for (const [, local] of face.src.matchAll(/local\(["']?([^"')]+)["']?\)/g)) names.add(local!);
    }
    const fcMatch: Record<string, string> = {};
    for (const name of names) {
      try {
        fcMatch[name] = execFileSync('fc-match', [name], { encoding: 'utf8' }).trim();
      } catch (error) {
        fcMatch[name] = `fc-match failed: ${(error as Error).message.split('\n')[0]}`;
      }
      console.log(`[sb-probe] ${pack} fc-match "${name}": ${fcMatch[name]}`);
    }
    const result = {
      pack,
      expected: PROBE_PACKS[pack],
      tuple: tupleFor(pack),
      path: '/',
      fcMatch,
      readings,
    };
    console.log(`[sb-probe] json ${JSON.stringify(result)}`);
    for (const reading of readings) {
      console.log(
        `[sb-probe] ${pack} ${reading.label}: scrollWidth ${String(reading.page.scrollWidth)} in innerWidth ${String(reading.page.innerWidth)}, settled ${String(reading.settled)}`,
      );
      for (const body of reading.stageBodies) {
        console.log(
          `[sb-probe]   ${String(body.selector)}: columns ${String(body.gridTemplateColumns)}, gap ${String(body.columnGap)}`,
        );
      }
      if (reading.widestName) {
        console.log(
          `[sb-probe]   widest name "${String(reading.widestName.text)}": ${String(reading.widestName.width)}px`,
        );
      }
      for (const each of reading.widest.slice(0, 8)) {
        const r = each.rect as { right: number; width: number };
        console.log(
          `[sb-probe]   right ${r.right} width ${r.width} ${String(each.selector)} white-space ${String(each.whiteSpace)} min-width ${String(each.minWidth)} overflow ${String(each.overflow)}${each.inVisibleSvg ? ' (in a visible-overflow svg)' : ''}`,
        );
      }
    }
    await testInfo.attach(`sb-reflow-probe-${pack}.json`, {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });
  };
}
