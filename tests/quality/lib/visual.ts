// The visual cells' conditions (#11, Slice 1, item 7): they run only in the
// pinned Playwright image, the one CI's variants job uses, by digest, and
// fail when the image's fonts differ from tests/quality/container/fonts.txt,
// so a screenshot never compares across font sets. Math.random is seeded in
// the page, so anything random renders the same each run. Anywhere else
// they skip with VISUAL_SKIP, a reason the run counts as declared. Slice 4
// commits their baselines.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The image CI's variants job runs in, and the quality jobs too, by digest. */
export const VISUAL_IMAGE =
  'mcr.microsoft.com/playwright:v1.58.2-noble@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d';

/** Why a visual cell skips outside the image. */
export const VISUAL_SKIP =
  'Visual cells run only in the pinned Playwright image, mcr.microsoft.com/playwright:v1.58.2-noble, which only CI runs.';

/** Whether this run is in the pinned image: CI's quality jobs name it in QUALITY_CONTAINER. */
export function inPinnedImage(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.QUALITY_CONTAINER === VISUAL_IMAGE;
}

/** The fonts the image must have. */
export const FONTS_FILE = fileURLToPath(new URL('../container/fonts.txt', import.meta.url));

/**
 * fonts.txt's header, which fonts.observed.txt starts with too, so the
 * observed file is committed byte for byte (#11, 11-4). The list starts
 * empty: the first scheduled run in the image writes it, and its visual
 * cells fail until it's committed.
 */
export const FONTS_HEADER = [
  '# The fonts the pinned Playwright image has (#11, Slice 1, item 7), as',
  '# `fc-list : file family style` prints them, one per line, sorted. Every',
  "# visual cell fails when the image's list differs from this one, so a",
  '# screenshot never compares across font sets. Each visual run in the image',
  '# writes what it found, this header included, to',
  '# reports/quality/fonts.observed.txt. `pnpm quality:fonts -- <that file>`',
  '# checks a downloaded copy, and with --write copies it here byte for byte',
  '# (CONTRIBUTING.md, "The nightly quality matrix"). Until this file lists a',
  '# font, every visual cell fails in the image.',
].join('\n');

/** fonts.observed.txt for `fonts`: the header, then the list, as fonts.txt keeps it. */
export function observedFontsText(fonts: readonly string[]): string {
  return `${FONTS_HEADER}\n${fonts.map((font) => `${font}\n`).join('')}`;
}

/** One `fc-list : file family style` line: an absolute font file, its families, and its styles. */
const FONT_LINE = /^\/[^:\n]+: [^:\n]+(?::style=[^\n]+)?$/;

/**
 * Why `text`, a downloaded fonts.observed.txt, can't become fonts.txt, one
 * line each, or none: it must be fonts.txt's header, then at least one font
 * in fc-list's form, sorted, each once, ending in a newline.
 */
export function observedFontsProblems(text: string): string[] {
  if (!text.startsWith(`${FONTS_HEADER}\n`)) {
    return [
      "It doesn't start with fonts.txt's header, so it isn't a visual run's fonts.observed.txt.",
    ];
  }
  const problems: string[] = [];
  if (!text.endsWith('\n')) problems.push("It doesn't end in a newline.");
  const lines = text.slice(FONTS_HEADER.length + 1).split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0) problems.push('It lists no font.');
  lines.forEach((line, index) => {
    if (!FONT_LINE.test(line)) {
      problems.push(
        `Line ${index + 1} of the list isn't an fc-list font line: ${JSON.stringify(line)}.`,
      );
    }
  });
  if (normalizeFonts(lines.join('\n')).join('\n') !== lines.join('\n')) {
    problems.push("The list isn't sorted with each font once, as a visual run writes it.");
  }
  return problems;
}

/** A font list as fonts.txt keeps it: one `file: family:style` per line, sorted, without comments. */
export function normalizeFonts(text: string): string[] {
  return [
    ...new Set(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#')),
    ),
  ].sort();
}

/** fc-list's fonts in the running image, normalized. */
export function imageFonts(): string[] {
  return normalizeFonts(
    execFileSync('fc-list', [':', 'file', 'family', 'style'], { encoding: 'utf8' }),
  );
}

export function expectedFonts(file: string = FONTS_FILE): string[] {
  return normalizeFonts(readFileSync(file, 'utf8'));
}

/** What the image has that fonts.txt doesn't, and the other way round. */
export function fontDifference(expected: readonly string[], actual: readonly string[]) {
  return {
    missing: expected.filter((font) => !actual.includes(font)),
    extra: actual.filter((font) => !expected.includes(font)),
  };
}

/** The seed every visual cell's Math.random starts from. */
export const RANDOM_SEED = 0x11a11;

/**
 * Replaces Math.random with mulberry32 from `seed`, before the page's own
 * scripts, so it returns the same sequence on every load. Runs in the page.
 */
export function seedRandomScript(seed: number): void {
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
