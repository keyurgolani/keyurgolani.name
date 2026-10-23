// The quality thresholds (#11, AC5): every limit #11's gates and #19's
// computed contrast gate use, in quality/thresholds.json beside this file,
// validated here. Gate code reads its limits only through loadThresholds():
// the quality runner, pnpm quality:exceptions, and pnpm check:appearance,
// which hands the contrast and focus limits to #19's gate. #6's budgets stay
// in runtime-budgets.json.
//
// It sits beside its file, not under tests/, because a host script imports
// it: apps/web/scripts/appearance-targets.ts, which next build type-checks
// in the image build, where .dockerignore leaves tests/ out.
//
// The schema checks each value's shape and range and a few invariants a
// typo would break, such as a high-contrast floor under the base one. It
// holds no tier field: a limit is the same for Stable, Extended, and
// Experimental packs, so no tier can lower one.
// tests/quality/thresholds.test.ts holds the values to the refined body.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const THRESHOLDS_FILE = path.join(REPO_ROOT, 'quality', 'thresholds.json');

/** axe-core's tags for WCAG 2.0, 2.1, and 2.2 at levels A and AA: what a WCAG 2.2 AA run may name. */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

/** A viewport, WIDTHxHEIGHT in CSS px, such as 1440x900. */
export const VIEWPORT = /^([1-9]\d{1,4})x([1-9]\d{1,4})$/;

const Description = z.string().min(1);
/** A contrast ratio, from 1:1 to 21:1. */
const Ratio = z.number().min(1).max(21);
const Positive = z.number().positive().finite();
const Milliseconds = z.number().int().nonnegative();
const Days = z.number().int().positive();
const Viewport = z.string().regex(VIEWPORT, 'must be WIDTHxHEIGHT in CSS px, such as 1440x900.');
const Window = z
  .tuple([Milliseconds, Milliseconds])
  .refine(([from, to]) => from < to, 'must end after it starts.');
const ByTier = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ light: value, medium: value, heavy: value }).strict();

export const ThresholdsSchema = z
  .object({
    version: z.literal(1),
    description: Description,
    conformance: z
      .object({
        description: Description,
        standard: z.literal('WCAG 2.2'),
        level: z.enum(['A', 'AA', 'AAA']),
        axeTags: z.array(z.enum(AXE_TAGS)).nonempty(),
      })
      .strict(),
    contrast: z
      .object({
        description: Description,
        text: Ratio,
        largeText: Ratio,
        nonText: Ratio,
        largeTextPt: Positive,
        largeBoldTextPt: Positive,
        largeBoldWeight: z.number().int().min(100).max(1000),
        highContrast: z.object({ text: Ratio, largeText: Ratio, nonText: Ratio }).strict(),
        print: z
          .object({
            text: Ratio,
            paper: z.string().regex(/^#[0-9a-f]{6}$/, 'must be a lowercase hex color.'),
          })
          .strict(),
        textureRaise: z.number().min(1).max(2),
      })
      .strict(),
    focus: z.object({ description: Description, perimeterPx: Positive }).strict(),
    targets: z
      .object({
        description: Description,
        minimumPx: Positive,
        narrowPx: Positive,
        narrowMaxWidth: z.number().int().positive(),
        primaryPx: Positive,
      })
      .strict(),
    viewports: z
      .object({
        description: Description,
        every: z.array(Viewport).nonempty(),
        occlusionAndTargets: z.array(Viewport).nonempty(),
        reflow: z.array(Viewport).nonempty(),
        zoom: z
          .array(
            z
              .object({ viewport: Viewport, deviceScaleFactor: z.number().int().min(2).max(4) })
              .strict(),
          )
          .nonempty(),
        rootText: z
          .array(z.object({ viewport: Viewport, scale: z.number().min(1.5).max(4) }).strict())
          .nonempty(),
        textSpacing: z.array(Viewport).nonempty(),
      })
      .strict(),
    textSpacing: z
      .object({
        description: Description,
        lineHeight: Positive,
        paragraphSpacing: Positive,
        letterSpacing: Positive,
        wordSpacing: Positive,
      })
      .strict(),
    reducedMotion: z
      .object({
        description: Description,
        transitionMs: Milliseconds,
        rafWindowMs: Window,
        rafCallbacks: z.number().int().nonnegative(),
      })
      .strict(),
    vitals: z
      .object({
        description: Description,
        lcpMs: z.number().int().positive(),
        cls: z.number().positive().max(1),
        tbtMs: z.number().int().positive(),
        canvasLcpMinShare: z.number().positive().max(1),
      })
      .strict(),
    idle: z
      .object({
        description: Description,
        startMs: Milliseconds,
        windowMs: z.number().int().positive(),
        taskDurationMs: ByTier(z.number().int().positive()),
      })
      .strict(),
    memory: z
      .object({
        description: Description,
        sampleMs: z.number().int().positive(),
        heapMiB: ByTier(Positive),
        growthWindowMs: Window,
        growthMiB: Positive,
      })
      .strict(),
    timing: z
      .object({
        description: Description,
        runs: z.number().int().positive(),
        releaseTolerance: z.number().nonnegative().max(1),
      })
      .strict(),
    exceptions: z
      .object({
        description: Description,
        maxDays: Days,
        quarantineMaxDays: Days,
        warnDays: Days,
      })
      .strict(),
    flakes: z
      .object({
        description: Description,
        limit: z.number().int().positive(),
        windowDays: Days,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const order = (
      pathTo: (string | number)[],
      low: number,
      high: number,
      message: string,
    ): void => {
      if (low > high) ctx.addIssue({ code: 'custom', path: pathTo, message });
    };
    const { contrast, targets, exceptions, memory } = value;
    order(['contrast', 'largeText'], contrast.largeText, contrast.text, 'must not exceed text.');
    order(
      ['contrast', 'highContrast', 'text'],
      contrast.text,
      contrast.highContrast.text,
      'must be at least contrast.text.',
    );
    order(
      ['contrast', 'highContrast', 'largeText'],
      contrast.largeText,
      contrast.highContrast.largeText,
      'must be at least contrast.largeText.',
    );
    order(
      ['contrast', 'highContrast', 'nonText'],
      contrast.nonText,
      contrast.highContrast.nonText,
      'must be at least contrast.nonText.',
    );
    order(
      ['contrast', 'largeBoldTextPt'],
      contrast.largeBoldTextPt,
      contrast.largeTextPt,
      'must not exceed largeTextPt.',
    );
    order(
      ['targets', 'narrowPx'],
      targets.minimumPx,
      targets.narrowPx,
      'must be at least minimumPx.',
    );
    order(
      ['targets', 'primaryPx'],
      targets.narrowPx,
      targets.primaryPx,
      'must be at least narrowPx.',
    );
    order(
      ['exceptions', 'quarantineMaxDays'],
      exceptions.quarantineMaxDays,
      exceptions.maxDays,
      'must not exceed maxDays.',
    );
    order(
      ['memory', 'growthWindowMs'],
      memory.growthWindowMs[0],
      memory.sampleMs,
      'must start at or before sampleMs.',
    );
  });

export type Thresholds = z.infer<typeof ThresholdsSchema>;

/** Each of a zod error's issues, as `path: message`. */
export function issueLines(error: z.ZodError): string[] {
  return error.issues.map(
    (issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(file)'}: ${issue.message}`,
  );
}

/** `value` as thresholds, or every problem with it. */
export function parseThresholds(
  value: unknown,
):
  | { readonly ok: true; readonly thresholds: Thresholds }
  | { readonly ok: false; readonly problems: string[] } {
  const parsed = ThresholdsSchema.safeParse(value);
  return parsed.success
    ? { ok: true, thresholds: parsed.data }
    : { ok: false, problems: issueLines(parsed.error) };
}

/**
 * The thresholds in `file`, quality/thresholds.json unless a test names
 * another. Throws, naming the file and every problem, when it can't be read
 * or doesn't validate, so a gate never runs on a guessed limit.
 */
export function loadThresholds(file: string = THRESHOLDS_FILE): Thresholds {
  const shown = path.relative(REPO_ROOT, file) || file;
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${shown} can't be read as JSON: ${(error as Error).message}`);
  }
  const parsed = parseThresholds(value);
  if (!parsed.ok) {
    throw new Error(
      `${shown} doesn't validate:\n${parsed.problems.map((line) => `  ${line}`).join('\n')}`,
    );
  }
  return parsed.thresholds;
}

/** A viewport string's width and height, such as { width: 1440, height: 900 } for 1440x900. */
export function viewportSize(viewport: string): {
  readonly width: number;
  readonly height: number;
} {
  const match = VIEWPORT.exec(viewport);
  if (!match) throw new Error(`${viewport} isn't WIDTHxHEIGHT in CSS px.`);
  return { width: Number(match[1]), height: Number(match[2]) };
}
