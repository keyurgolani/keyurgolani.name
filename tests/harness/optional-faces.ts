// A page's optional faces (a typography pack's `display: optional` fonts, which take over only if
// they're there as the text first lays out) pinned to one state for a browser test, so no test
// depends on whether a face beats the browser's block window. Every harness context routes its
// requests, which turns the HTTP cache off, so each load is a first visit: left alone, an optional
// face would race.
//
//   const faces = await optionalFaces(page);
//   await pinFaces(page, faces, 'fallback'); // or 'designed', before the navigation
//   await page.goto('/');
//   const fonts = await renderedFonts(page, '.ag-id__line'); // what the text drew in
//
// - 'fallback': each optional face's file is refused, so the page keeps its metric-matched fallback,
//   as a first visit that the face misses does.
// - 'designed': the page adds, as its document starts, a copy of each optional face that blocks
//   while it loads (`display: block`), so its text lays out in the face from the first frame, as a
//   visit with the face in the cache does. A copy with the same family, weight and style comes
//   after the stylesheet's rule, so the browser picks it. With script off the copies can't run, so
//   the stylesheets that declare the faces are also served with each `font-display: optional` as
//   `block`: the text waits for the face, and the page settles in it either way.
import type { Page } from '@playwright/test';

export interface OptionalFace {
  /** The stylesheet that declares it, as its HTML links it. */
  readonly sheet: string;
  readonly family: string;
  readonly url: string;
  readonly weight: string;
  readonly style: string;
  readonly unicodeRange: string;
}

export type FaceState = 'fallback' | 'designed';

/** A declaration's value in an @font-face block, unquoted. */
function value(block: string, name: string): string | null {
  const found = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(block)?.[1]?.trim();
  return found === undefined ? null : found.replace(/^"(.*)"$/, '$1');
}

/** Every @font-face with font-display: optional in the stylesheets `route`'s HTML links. */
export async function optionalFaces(page: Page, route = '/'): Promise<OptionalFace[]> {
  const html = await (await page.request.get(route)).text();
  const hrefs = [...html.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => /\brel="stylesheet"/.test(tag))
    .map((tag) => /\bhref="([^"]+)"/.exec(tag)?.[1])
    .filter((href): href is string => href !== undefined);
  const faces: OptionalFace[] = [];
  for (const href of [...new Set(hrefs)]) {
    const css = await (await page.request.get(href)).text();
    for (const [, block] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      if (value(block!, 'font-display') !== 'optional') continue;
      const url = /url\("?([^")]+)"?\)/.exec(value(block!, 'src') ?? '')?.[1];
      const family = value(block!, 'font-family');
      if (!url || !family) continue;
      faces.push({
        sheet: href,
        family,
        url,
        weight: value(block!, 'font-weight') ?? 'normal',
        style: value(block!, 'font-style') ?? 'normal',
        unicodeRange: value(block!, 'unicode-range') ?? 'U+0-10FFFF',
      });
    }
  }
  return faces;
}

/**
 * Pins `faces` to `state` for the page's next navigations. Its routes are the page's context's, so a
 * test that clears its page's own routes (page.unrouteAll()) keeps them. Nothing to pin, nothing done.
 */
export async function pinFaces(
  page: Page,
  faces: readonly OptionalFace[],
  state: FaceState,
): Promise<void> {
  if (faces.length === 0) return;
  if (state === 'fallback') {
    const files = new Set(faces.map((face) => new URL(face.url, 'http://x').pathname));
    await page.context().route(
      (url) => files.has(url.pathname),
      (route) => route.abort('blockedbyclient'),
    );
    return;
  }
  const sheets = new Set(faces.map((face) => new URL(face.sheet, 'http://x').pathname));
  await page.context().route(
    (url) => sheets.has(url.pathname),
    async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        /font-display:\s*optional/g,
        'font-display: block',
      );
      await route.fulfill({ response, body });
    },
  );
  await page.addInitScript((list: OptionalFace[]) => {
    for (const face of list) {
      const copy = new FontFace(face.family, `url("${new URL(face.url, location.href).href}")`, {
        weight: face.weight,
        style: face.style,
        unicodeRange: face.unicodeRange,
        display: 'block',
      });
      document.fonts.add(copy);
      copy.load().catch(() => {});
    }
  }, faces as OptionalFace[]);
}

/** The fonts the browser drew the first element matching `selector` in, and whether each is a web font. */
export async function renderedFonts(
  page: Page,
  selector: string,
): Promise<{ familyName: string; isCustomFont: boolean }[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return [];
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts.map(({ familyName, isCustomFont }) => ({ familyName, isCustomFont }));
  } finally {
    await cdp.detach();
  }
}
