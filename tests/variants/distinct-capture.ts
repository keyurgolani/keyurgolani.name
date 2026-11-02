// What the distinct guards capture in a browser (Design gate rule 5): a
// composition's home page on the complete contract fixture, at 1440x900 and
// 390x844, under one appearance tuple held constant
// (platform-neutral / warm-parchment / humanist-ui / system, light, the
// default row), with motion reduced and Math.random seeded as the visual
// cells seed it. Each capture is the boundary as snapshotBoundary() reads it,
// the first viewport's screenshot, the boxes of the top-level blocks across
// the first two viewports, and any section frame rendered shared.
// distinct.spec.ts guards the first-party compositions with them, and
// distinct-calibration.spec.ts measures the controls its thresholds come
// from. The arithmetic is distinct.ts's.
//
// Each composition gets one server, read-only on the complete fixture with
// every pack axis and the display mode the visitor's (the quality sweep's
// server), so a control's other tuple is the visitor's preference cookie on
// the same server, as the quality sweep applies it.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { createAppearanceRegistry, PLATFORM_DEFAULTS } from '../../packages/appearance/src/index';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { snapshotBoundary, type ParityNode } from '../../packages/variant-contract/src/node/parity';
import { startApp } from '../harness/app-server.mjs';
import { accepts, readBuildMeta, siteTextFor } from '../quality/cells';
import type { Tuple } from '../quality/coverage';
import { sweepSiteText } from '../quality/lib/server';
import { packCookie } from '../quality/lib/sweep';
import { RANDOM_SEED, seedRandomScript } from '../quality/lib/visual';
import {
  BOX_SELECTOR,
  BOX_VIEWPORTS,
  namedElements,
  sharedFrameSelector,
  withNames,
  type Box,
  type SharedFrame,
  type StructureNode,
  type ViewportId,
} from './distinct';
import { fixtureApp, WEB } from './target';

/** The fixture every capture renders: every kind, so every frame a composition has shows. */
export const FIXTURE = contractFixture('complete');
/** The route a capture loads: home, the first slice every composition lane builds. */
export const ROUTE = '/';

/** The viewports, as the variant modes set them. */
export const VIEWPORTS: Readonly<
  Record<
    ViewportId,
    { viewport: { width: number; height: number }; isMobile?: boolean; hasTouch?: boolean }
  >
> = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};

/** An appearance a capture renders in, against the tuple every guard holds. */
export interface Look {
  /** `default`, or the control's name. */
  readonly name: string;
  readonly designLanguage: string;
  readonly colorScheme: string;
  readonly typography: string;
  readonly displayMode: string;
}

/** The tuple the guards hold constant: the platform defaults, light. */
export const DEFAULT_LOOK: Look = {
  name: 'default',
  designLanguage: PLATFORM_DEFAULTS.designLanguage,
  colorScheme: PLATFORM_DEFAULTS.colorScheme,
  typography: PLATFORM_DEFAULTS.typography,
  displayMode: PLATFORM_DEFAULTS.displayMode,
};

/** The "same" controls' looks: appearance alone, which must not read as a different composition. */
export const CONTROL_LOOKS = {
  /** The guards' own tuple again, on a fresh load: the noise a re-render alone makes. */
  rerender: { ...DEFAULT_LOOK, name: 'rerender' },
  /** The same scheme in its dark mode. */
  dark: { ...DEFAULT_LOOK, name: 'dark', displayMode: 'dark' },
  /** A design language with a texture behind its surfaces; the first the composition renders as asked. */
  textured: ['paper-tactile', 'handcrafted-collage', 'claymorphic', 'atelier-luxury'],
  /** Another typography profile. */
  typography: { ...DEFAULT_LOOK, name: 'typography', typography: 'editorial-serif' },
} as const;

const registry = createAppearanceRegistry(readBuildMeta(WEB) as never);

/** `look` for `variant` as the quality plan's tuple. */
const tupleOf = (variant: string, look: Look): Tuple => ({
  variant,
  designLanguage: look.designLanguage,
  colorScheme: look.colorScheme,
  typography: look.typography,
  displayMode: look.displayMode,
});

/** The control looks for `variant`: a re-render, dark, textured, and another typography, each one it renders as asked. */
export function controlLooks(variant: string): Look[] {
  const language = CONTROL_LOOKS.textured.find((id) =>
    accepts(registry, tupleOf(variant, { ...DEFAULT_LOOK, designLanguage: id }), 'read-only'),
  );
  if (!language) throw new Error(`${variant} renders none of the textured languages as asked`);
  const looks = [
    CONTROL_LOOKS.rerender,
    CONTROL_LOOKS.dark,
    { ...DEFAULT_LOOK, name: 'textured', designLanguage: language },
    CONTROL_LOOKS.typography,
  ];
  for (const look of looks) {
    expect(
      accepts(registry, tupleOf(variant, look), 'read-only'),
      `${variant} in ${look.name}`,
    ).toBe(true);
  }
  return looks;
}

/** One composition, in one look, at one viewport. */
export interface Capture {
  readonly variant: string;
  readonly look: string;
  readonly viewport: ViewportId;
  /** snapshotBoundary()'s tree, with whether each element has an accessible name. */
  readonly boundary: StructureNode;
  readonly png: Buffer;
  /** The top-level blocks across the first two viewports (distinct.ts's BOX_SELECTOR). */
  readonly boxes: readonly Box[];
  /** Section frames inside the boundary rendered with data-renderer="shared". */
  readonly frames: readonly SharedFrame[];
}

/**
 * The static layouts in tests/fixtures/variants/static-layouts/, by name:
 * "different" controls by construction for the calibration, each a style
 * and its markup, which never ship.
 */
export const STATIC_LAYOUTS_DIR = fileURLToPath(
  new URL('../fixtures/variants/static-layouts/', import.meta.url),
);

export function staticLayouts(): { readonly name: string; readonly html: string }[] {
  return readdirSync(STATIC_LAYOUTS_DIR)
    .filter((file) => file.endsWith('.html'))
    .sort()
    .map((file) => ({
      name: `static-${path.basename(file, '.html')}`,
      html: readFileSync(path.join(STATIC_LAYOUTS_DIR, file), 'utf8'),
    }));
}

/**
 * The complete fixture's site, publishing the guards' tuple for `variant`,
 * every pack the visitor's, and motion reduced: the boundary renders the
 * reduce policy as data-motion="reduced", which stops every composition's
 * motion, enhancements' included.
 */
export function captureSite(variant: string): string {
  const document = parseDocument(
    sweepSiteText(siteTextFor(FIXTURE, tupleOf(variant, DEFAULT_LOOK))),
  );
  document.set('motionPolicy', 'reduce');
  return document.toString();
}

/** Loaded, its fonts in, and two frames drawn: what the variant modes call settled. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

/** The boundary's resolved appearance, as its attributes name it. */
const boundaryLook = (page: Page) =>
  page.locator('[data-appearance-boundary="document"]').evaluate((boundary) => ({
    variant: boundary.getAttribute('data-variant'),
    designLanguage: boundary.getAttribute('data-design-language'),
    colorScheme: boundary.getAttribute('data-color-scheme'),
    typography: boundary.getAttribute('data-typography'),
    displayMode: boundary.getAttribute('data-display-mode'),
    motion: boundary.getAttribute('data-motion'),
  }));

/**
 * The boxes of the top-level blocks in the page's boundary, at the top of
 * the page, clipped to the window's width and the first BOX_VIEWPORTS
 * viewports, normalized by the viewport. The host's skip link and its
 * visitor-control slot are the host's, not the composition's, so they're
 * left out, and so is anything without a box, hidden, or inside an svg.
 */
const readBoxes = (page: Page): Promise<Box[]> =>
  page.evaluate(
    ({ selector, depth }) => {
      const boundary = document.querySelector('[data-variant]');
      if (!boundary) return [];
      const width = window.innerWidth;
      const height = window.innerHeight;
      const boxes: { kind: string; x: number; y: number; width: number; height: number }[] = [];
      for (const element of boundary.querySelectorAll(selector)) {
        if (element.closest('[data-visitor-control-slot], [data-ui-slot="skip-link"]')) continue;
        if (element.parentElement?.closest('svg')) continue;
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
        const rect = element.getBoundingClientRect();
        const left = Math.max(0, rect.left);
        const right = Math.min(width, rect.right);
        const top = Math.max(0, rect.top + window.scrollY);
        const bottom = Math.min(depth * height, rect.bottom + window.scrollY);
        if (right <= left || bottom <= top) continue;
        boxes.push({
          kind: element.tagName.toLowerCase(),
          x: left / width,
          y: top / height,
          width: (right - left) / width,
          height: (bottom - top) / height,
        });
      }
      return boxes;
    },
    { selector: BOX_SELECTOR, depth: BOX_VIEWPORTS },
  );

/** What every capture reads from a settled page, kept beside the report for a rerun without a browser. */
async function measure(
  page: Page,
  testInfo: TestInfo,
  variant: string,
  look: string,
  viewport: ViewportId,
): Promise<Capture> {
  // It runs in the page, reading the page's own document with no argument.
  const boundary = await page.evaluate(snapshotBoundary as () => ParityNode | null);
  expect(boundary, `${variant} renders a boundary`).not.toBeNull();
  // Whether each element has an accessible name, as booleans: never the name's text.
  const structure = withNames(boundary!, await page.evaluate(namedElements as () => boolean[]));
  const frames = await page.locator(sharedFrameSelector(variant)).evaluateAll((elements) =>
    elements.map((element) => ({
      tag: element.tagName.toLowerCase(),
      sectionId: element.getAttribute('data-section-id') ?? element.id ?? null,
      kind: element.getAttribute('data-kind'),
    })),
  );
  const boxes = await readBoxes(page);
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const name = `${variant}-${look}-${viewport}`;
  writeFileSync(testInfo.outputPath(`${name}.png`), png);
  writeFileSync(
    testInfo.outputPath(`${name}.json`),
    `${JSON.stringify({ boundary: structure, boxes })}\n`,
  );
  return { variant, look, viewport, boundary: structure, png, boxes, frames };
}

/** The visitor's cookie for `look`, only when it differs from the published tuple. */
function lookCookies(variant: string, look: Look, origin: string) {
  const same =
    look.designLanguage === DEFAULT_LOOK.designLanguage &&
    look.colorScheme === DEFAULT_LOOK.colorScheme &&
    look.typography === DEFAULT_LOOK.typography &&
    look.displayMode === DEFAULT_LOOK.displayMode;
  return same ? [] : [packCookie({ tuple: tupleOf(variant, look) }, origin)];
}

const escapeAttribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const attributeText = (list: readonly (readonly [string, string])[]) =>
  list.map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');

/**
 * The static layouts, each set inside a copy of `page`'s document boundary
 * with `page.setContent`: the same stylesheets, the same tuple's
 * attributes, and the layout's own style and markup in place of the
 * composition's. Its `data-variant` names the layout.
 */
async function captureStatics(
  page: Page,
  testInfo: TestInfo,
  viewport: ViewportId,
): Promise<Capture[]> {
  const shell = await page.evaluate(() => {
    const boundary = document.querySelector('[data-appearance-boundary="document"]')!;
    const attributes = (element: Element) =>
      [...element.attributes].map(({ name, value }) => [name, value] as [string, string]);
    return {
      html: attributes(document.documentElement),
      body: attributes(document.body),
      boundary: attributes(boundary).filter(([name]) => name !== 'data-variant'),
      sheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map(
        (link) => (link as HTMLLinkElement).href,
      ),
      styles: [...document.querySelectorAll('style')].map((style) => style.textContent ?? ''),
    };
  });
  const captures: Capture[] = [];
  for (const layout of staticLayouts()) {
    await page.setContent(
      [
        '<!doctype html>',
        `<html${attributeText(shell.html)}><head><meta charset="utf-8">`,
        ...shell.sheets.map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`),
        ...shell.styles.map((text) => `<style>${text}</style>`),
        `</head><body${attributeText(shell.body)}>`,
        `<div${attributeText(shell.boundary)} data-variant="${layout.name}">${layout.html}</div>`,
        '</body></html>',
      ].join('\n'),
    );
    await settle(page);
    captures.push(await measure(page, testInfo, layout.name, DEFAULT_LOOK.name, viewport));
  }
  return captures;
}

/**
 * Starts `variant`'s server on `web`'s build, and captures its home in
 * each of `looks` at each viewport, and with `statics`, each static layout
 * in the guards' tuple on that server. The server reaches no host outside
 * the app, and the browser's requests outside it are aborted.
 */
export async function captureComposition({
  browser,
  web = WEB,
  variant,
  looks = [DEFAULT_LOOK],
  statics = false,
  testInfo,
  onPage,
}: {
  readonly browser: Browser;
  readonly web?: string;
  readonly variant: string;
  readonly looks?: readonly Look[];
  readonly statics?: boolean;
  readonly testInfo: TestInfo;
  /** Reads more from each settled page after its capture, such as the pack guard's token-use count. */
  readonly onPage?: (page: Page, capture: Capture) => Promise<void>;
}): Promise<Capture[]> {
  const options = fixtureApp(FIXTURE, { manifest: { id: variant } });
  const app = await startApp({
    ...options,
    web,
    siteText: captureSite(variant),
    logFile: testInfo.outputPath(`${variant}-server.log`),
  });
  const captures: Capture[] = [];
  try {
    for (const look of looks) {
      for (const [viewport, emulation] of Object.entries(VIEWPORTS) as [
        ViewportId,
        (typeof VIEWPORTS)[ViewportId],
      ][]) {
        const context = await browser.newContext({
          ...emulation,
          baseURL: app.origin,
          colorScheme: 'light',
          reducedMotion: 'reduce',
        });
        try {
          await context.route('**/*', (route) =>
            new URL(route.request().url()).origin === app.origin
              ? route.continue()
              : route.abort('blockedbyclient'),
          );
          await context.addCookies(lookCookies(variant, look, app.origin));
          const page = await context.newPage();
          await page.addInitScript(seedRandomScript, RANDOM_SEED);
          const response = await page.goto(ROUTE);
          expect(response?.status(), `${variant} ${look.name} ${viewport}: ${ROUTE}`).toBe(200);
          await settle(page);
          const rendered = await boundaryLook(page);
          expect(rendered, `${variant} renders ${look.name} as asked`).toEqual({
            variant,
            designLanguage: look.designLanguage,
            colorScheme: look.colorScheme,
            typography: look.typography,
            displayMode: look.displayMode,
            motion: 'reduced',
          });
          const capture = await measure(page, testInfo, variant, look.name, viewport);
          captures.push(capture);
          await onPage?.(page, capture);
          if (statics && look.name === DEFAULT_LOOK.name) {
            captures.push(...(await captureStatics(page, testInfo, viewport)));
          }
        } finally {
          await context.close();
        }
      }
    }
    expect(app.egress(), `${variant}'s server reached no outside host`).toEqual([]);
  } finally {
    await app.stop();
  }
  return captures;
}

/** Where the guards' reports go, beside the variant specs' own. */
export const reportPath = (testInfo: TestInfo, ...parts: string[]) =>
  path.join(path.dirname(testInfo.project.outputDir), 'distinct', ...parts);
