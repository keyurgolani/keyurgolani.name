// What a browser test reads from a document to show Studio stayed out of a
// preview (#7, AC1): the sentinel custom property only host-chrome.css
// defines, every selector of every stylesheet the document loaded, its
// scripts, and its markup, plus every CSP violation the page raised (AC6).
import type { Frame, Page } from '@playwright/test';

/** The custom property host-chrome.css defines on :root, and nothing else does. */
export const STUDIO_SENTINEL = '--studio-sentinel';

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

/**
 * Records every securitypolicyviolation the page raises from its first
 * script on, for `violations` to read. Call it before the page loads.
 */
export async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations?.push(
        `${event.effectiveDirective} blocked ${event.blockedURI || '(inline)'}`,
      );
    });
  });
}

/** The violations recordViolations saw so far, in the page or in one of its frames. */
export const violations = (page: Page | Frame): Promise<string[]> =>
  page.evaluate(() => window.__cspViolations ?? []);

/** What a loaded document holds, as AC1's inventory reads it. */
export interface DocumentInventory {
  /** The sentinel's value on the root element: empty unless host-chrome.css loaded. */
  readonly sentinel: string;
  /** Every selector of every rule in every stylesheet it may read, inside at-rules too. */
  readonly selectors: readonly string[];
  /**
   * The path of every stylesheet it loaded. A preview frame's opaque origin
   * can't read the rules of the ones it loads from the app, so these name
   * them for the caller to compare.
   */
  readonly stylesheets: readonly string[];
  /** The src of every script element. */
  readonly scripts: readonly string[];
  /** Inline scripts that run (not JSON-LD) without the response's nonce. */
  readonly unnoncedInline: number;
  /** The class names in the body. */
  readonly classes: readonly string[];
  readonly forms: number;
  readonly passwordFields: number;
}

/** Reads the inventory of the page's or the frame's current document, whose CSP nonce is `nonce`. */
export function inventory(page: Page | Frame, nonce: string): Promise<DocumentInventory> {
  return page.evaluate(
    ({ sentinel, nonce: expected }) => {
      const selectors: string[] = [];
      const stylesheets: string[] = [];
      const walk = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule) selectors.push(rule.selectorText);
          if ('cssRules' in rule && rule.cssRules) walk(rule.cssRules as CSSRuleList);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        if (sheet.href) stylesheets.push(new URL(sheet.href).pathname);
        let rules: CSSRuleList | null = null;
        try {
          rules = sheet.cssRules;
        } catch {
          // Another origin's sheet, as every one is to an opaque frame.
        }
        if (rules) walk(rules);
      }
      const scripts = Array.from(document.scripts);
      const classes = new Set<string>();
      for (const element of Array.from(document.body.querySelectorAll('[class]'))) {
        for (const name of Array.from(element.classList)) classes.add(name);
      }
      for (const name of Array.from(document.body.classList)) classes.add(name);
      return {
        sentinel: getComputedStyle(document.documentElement).getPropertyValue(sentinel).trim(),
        selectors,
        stylesheets,
        scripts: scripts.flatMap((script) => (script.src ? [new URL(script.src).pathname] : [])),
        unnoncedInline: scripts.filter(
          (script) =>
            !script.src && script.type !== 'application/ld+json' && script.nonce !== expected,
        ).length,
        classes: [...classes],
        forms: document.forms.length,
        passwordFields: document.querySelectorAll('input[type="password"]').length,
      };
    },
    { sentinel: STUDIO_SENTINEL, nonce },
  );
}

/** The nonce in a CSP header value, or ''. */
export const nonceOf = (csp: string | undefined): string =>
  /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp ?? '')?.[1] ?? '';
