import type { Page } from '@playwright/test';

/**
 * Lays `css` over the page from its first parse, before any script runs, so an element a script
 * observes is already as `css` sets it (hidden, or no size) when the script starts to watch it.
 */
export function styleFromTheStart(page: Page, css: string): Promise<void> {
  return page.addInitScript((text) => {
    const add = () => {
      const style = document.createElement('style');
      style.textContent = text;
      (document.head ?? document.documentElement).append(style);
    };
    if (document.documentElement) add();
    else
      new MutationObserver((_, watch) => {
        if (!document.documentElement) return;
        watch.disconnect();
        add();
      }).observe(document, { childList: true });
  }, css);
}

/** Every element still holding the page unsettled, by its own hold's name. */
export function pendingHolds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-enhancement-pending]')].map(
      (element) =>
        `${element.localName}.${[...element.classList].join('.')}: ${element.getAttribute('data-enhancement-pending')}`,
    ),
  );
}
