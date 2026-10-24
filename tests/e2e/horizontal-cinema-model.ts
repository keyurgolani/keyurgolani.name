import type { Frame, Page } from '@playwright/test';
import { expect } from '../harness/fixtures';

// Horizontal Cinema's five-chapter model and the readers its browser specs
// share (#17): what the page says is current, what's on screen, the URL,
// history, focus, and the live region.

/** The five chapters, by anchor, in order: the whole state model. */
export const CHAPTERS = ['prologue', 'origins', 'journey', 'craft', 'epilogue'] as const;
export type Chapter = (typeof CHAPTERS)[number];
export const LABELS = ['Prologue', 'Origins', 'Journey', 'Craft', 'Epilogue'];
export const anchor = (chapter: Chapter) => `#chapter-${chapter}`;
export const announced = (chapter: Chapter) => {
  const position = CHAPTERS.indexOf(chapter);
  return `Chapter ${position + 1} of 5: ${LABELS[position]}`;
};

export type Scope = Page | Frame;

/** Everything the chapter state shows, read in one go. */
export function read(scope: Scope) {
  return scope.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.hc-stage')!;
    const box = stage.getBoundingClientRect();
    const horizontal = getComputedStyle(stage).overflowX === 'auto';
    const chapters = [...document.querySelectorAll<HTMLElement>('.hc-chapter')];
    // The chapter on screen, by the page's own geometry: aligned at the
    // stage's start, or under the window's middle.
    // Vertical, the chapter at the window's top, its 1rem scroll margin allowed for; at the
    // page's foot, where a short chapter can't reach the top, the current one while it shows.
    const current = document.querySelector('.hc-filmstrip [aria-current="step"]');
    const held = chapters.find((chapter) => `#${chapter.id}` === current?.getAttribute('href'));
    const foot = scrollY + innerHeight >= document.documentElement.scrollHeight - 1;
    const shows = (chapter: Element | undefined) =>
      chapter !== undefined &&
      chapter.getBoundingClientRect().bottom > 0 &&
      chapter.getBoundingClientRect().top < innerHeight;
    const onScreen = horizontal
      ? chapters.find((chapter) => Math.abs(chapter.getBoundingClientRect().left - box.left) < 2)
      : foot && shows(held)
        ? held
        : [...chapters].reverse().find((chapter) => chapter.getBoundingClientRect().top <= 17);
    return {
      current: current?.getAttribute('href'),
      onScreen: onScreen ? `#${onScreen.id}` : null,
      hash: location.hash,
      history: history.length,
      progress: document.querySelector('.hc-progress')?.textContent ?? null,
      live: document.querySelector('.hc-cinema [aria-live]')?.textContent ?? '',
      focus: document.activeElement?.id ?? '',
      layout: horizontal ? 'horizontal' : 'vertical',
    };
  });
}

/** Waits for `chapter` to be current, wherever the stage sits. */
export async function expectCurrent(scope: Scope, chapter: Chapter): Promise<void> {
  await expect
    .poll(async () => {
      const { current, progress } = await read(scope);
      return { current, progress };
    })
    .toEqual({ current: anchor(chapter), progress: `0${CHAPTERS.indexOf(chapter) + 1} / 05` });
}

/** Waits for the controller to settle on `chapter`, current and on screen at once. */
export async function expectAt(scope: Scope, chapter: Chapter): Promise<void> {
  await expect
    .poll(async () => {
      const { current, onScreen, progress } = await read(scope);
      return { current, onScreen, progress };
    })
    .toEqual({
      current: anchor(chapter),
      onScreen: anchor(chapter),
      progress: `0${CHAPTERS.indexOf(chapter) + 1} / 05`,
    });
}

export async function load(scope: Page, url = '/'): Promise<void> {
  await scope.goto(url, { waitUntil: 'load' });
  await expect(scope.locator('[data-variant]')).toHaveAttribute(
    'data-variant',
    'horizontal-cinema',
  );
  await expect(scope.locator('.hc-cinema')).toHaveAttribute('data-ready', '');
}

/** Records whether each arrow key's keydown was cancelled, after every handler ran. */
export async function watchKeys(scope: Scope): Promise<void> {
  await scope.evaluate(() => {
    const page = window as Window & { __keys?: boolean[] };
    page.__keys = [];
    window.addEventListener('keydown', (event) => {
      if (event.key.startsWith('Arrow')) page.__keys!.push(event.defaultPrevented);
    });
  });
}

export const keys = (scope: Scope) =>
  scope.evaluate(() => (window as Window & { __keys?: boolean[] }).__keys ?? []);
