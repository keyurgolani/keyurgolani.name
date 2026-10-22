// resolveAppearance() (#19, Slice 1, item 4): what a presentation boundary
// and its head render for a published selection, the visitor's values, the
// profile, and the environment, plus the owner's diagnostics. It is pure and
// browser-safe, so the host, #7's frames (whose environmentAttributes()
// calls it), and Demo Studio get one answer.

import type {
  AppearanceAxis,
  AppearanceSelection,
  DisplayMode,
  MotionPolicy,
  VisitorControls,
} from '@portfolio/schema';
import { APPEARANCE_AXES, ID_AXES, type IdAxis } from './axes';
import type { AppearanceDiagnostic } from './diagnostics';
import { axisFallback, findPack, isRegistered, type AppearanceRegistry } from './registry';
import { schemeRenders, type GeneratedSchemes } from './resolve-tokens';
import {
  alone,
  parseSelection,
  valueProblem,
  type Selection,
  type SelectionText,
} from './selection';

/** #1's deployment profiles. */
export type Profile = 'owner' | 'read-only' | 'demo';

/** How much motion renders: `full`, `reduced`, or `static` (paused). */
export type Motion = 'full' | 'reduced' | 'static';
const MOTION_RANK: Readonly<Record<Motion, number>> = { full: 2, reduced: 1, static: 0 };

export interface AppearanceEnvironment {
  /** prefers-contrast, as #7's override or the request reports it. */
  readonly contrast?: 'system' | 'more';
  /** #7's motion override or #6's pause. It can only lower the site's motion. */
  readonly motion?: Motion;
  /** Whether #7's enhancements run. */
  readonly enhancement?: 'on' | 'off';
}

/** The visitor's appearance values, as the request carries them. */
export interface VisitorInput {
  /** The preference cookie's value, which owner and read-only read. */
  readonly cookie?: string | null;
  /** The request's query, which demo reads. */
  readonly query?: SelectionText;
}

export interface ResolveInput {
  /** The live revision's appearance, or a draft's, or #7's override. */
  readonly published: AppearanceSelection;
  readonly visitorControls: VisitorControls;
  readonly motionPolicy: MotionPolicy;
  readonly visitor?: VisitorInput;
  readonly profile: Profile;
  readonly environment?: AppearanceEnvironment;
  readonly registry: AppearanceRegistry;
  /** Generated scheme sets, from the revision's snapshot or Demo Studio. */
  readonly generated?: GeneratedSchemes;
}

export interface ResolvedAppearance {
  /** What renders: each id registered and renderable, else its axis's fallback, and the requested display mode. */
  readonly selection: Selection;
  /** What was asked for: the published values, with the visitor's applied. */
  readonly requested: Selection;
  /**
   * The display mode that renders: `system` only for a scheme with both base
   * modes, else the requested mode or the scheme's native one.
   */
  readonly resolvedMode: DisplayMode;
  /** The scheme pinned the mode to its native one: `system`, or a mode it lacks, on a single-mode scheme. */
  readonly modeLocked: boolean;
  readonly contrast: 'system' | 'more';
  readonly motion: Motion;
  readonly enhancement: 'on' | 'off';
  /** The id axes whose requested value isn't what renders. */
  readonly fallbackAxes: readonly IdAxis[];
  /** The axes a visitor value set, so the response varies with it. */
  readonly visitorAxes: readonly AppearanceAxis[];
  /** For the owner's log and Studio; visitors see none. */
  readonly diagnostics: readonly AppearanceDiagnostic[];
}

/**
 * Resolves one boundary's appearance. Each published id that this build
 * can't render falls back on its axis alone: a pack to the first-party one,
 * a variant to #5's fallback composition. Then visitor values apply, only on
 * selectable axes (every axis under `demo`), only for registered,
 * renderable, non-Research values, in axis order, each dropped silently
 * when it doesn't fit what's applied already. `demo` reads the query and
 * `owner` and `read-only` the cookie, never the other.
 */
export function resolveAppearance(input: ResolveInput): ResolvedAppearance {
  const { registry, generated } = input;
  const diagnostics: AppearanceDiagnostic[] = [];
  const requested: { -readonly [A in AppearanceAxis]: Selection[A] } = pick(input.published);
  const current = { ...requested };

  for (const axis of ID_AXES) {
    const id = requested[axis];
    const problem = renderProblem(registry, axis, id, generated);
    if (problem) {
      diagnostics.push(problem);
      current[axis] = axisFallback(axis);
    } else if (axis !== 'variant' && findPack(registry, axis, id)?.manifest.tier === 'research') {
      diagnostics.push({
        code: 'appearance.not-publishable',
        axis,
        message: `${id} is a Research pack, which can't be published. It renders here only for review.`,
        remediation: 'Select a stable, extended, or experimental pack.',
      });
    }
  }

  const visitorAxes: AppearanceAxis[] = [];
  const values = visitorValues(input);
  for (const axis of APPEARANCE_AXES) {
    const value = values[axis];
    if (value === undefined) continue;
    if (input.profile !== 'demo' && input.visitorControls[axis] !== 'selectable') continue;
    if (!visitorAccepts(registry, axis, value, current, generated)) continue;
    // parseSelection() and valueProblem() have checked the value fits its axis.
    (requested as Record<AppearanceAxis, string>)[axis] = value;
    (current as Record<AppearanceAxis, string>)[axis] = value;
    visitorAxes.push(axis);
  }

  const { modes } = findPack(registry, 'colorScheme', current.colorScheme)!;
  const native = modes[0]!;
  let resolvedMode: DisplayMode = current.displayMode;
  let modeLocked = false;
  if (current.displayMode === 'system' && modes.length === 1) {
    resolvedMode = native;
    modeLocked = true;
  } else if (
    (current.displayMode === 'light' || current.displayMode === 'dark') &&
    !modes.includes(current.displayMode)
  ) {
    resolvedMode = native;
    modeLocked = true;
    diagnostics.push({
      code: 'appearance.mode-incompatible',
      axis: 'displayMode',
      message: `${current.colorScheme} has only a ${native} mode, so it renders ${native} in place of the requested ${current.displayMode}.`,
      remediation: `Set the display mode to system, ${native}, or high-contrast, or pick a color scheme with a ${current.displayMode} mode.`,
    });
  }

  const base: Motion = input.motionPolicy === 'reduce' ? 'reduced' : 'full';
  const override = input.environment?.motion ?? 'full';
  return {
    selection: current,
    requested,
    resolvedMode,
    modeLocked,
    contrast: input.environment?.contrast === 'more' ? 'more' : 'system',
    motion: MOTION_RANK[override] < MOTION_RANK[base] ? override : base,
    enhancement: input.environment?.enhancement === 'off' ? 'off' : 'on',
    fallbackAxes: ID_AXES.filter((axis) => current[axis] !== requested[axis]),
    visitorAxes,
    diagnostics,
  };
}

function pick(selection: AppearanceSelection): { -readonly [A in AppearanceAxis]: Selection[A] } {
  return {
    variant: selection.variant,
    designLanguage: selection.designLanguage,
    colorScheme: selection.colorScheme,
    typography: selection.typography,
    displayMode: selection.displayMode,
  };
}

/** Why a published id can't render, so its axis falls back. */
function renderProblem(
  registry: AppearanceRegistry,
  axis: IdAxis,
  id: string,
  generated: GeneratedSchemes | undefined,
): AppearanceDiagnostic | null {
  if (!isRegistered(registry, axis, id)) {
    const problem = valueProblem(registry, axis, id, alone(axis, id));
    return (
      problem && {
        ...problem,
        message: `${problem.message} The ${fallbackName(axis)} renders in its place.`,
      }
    );
  }
  if (axis === 'colorScheme' && !schemeRenders(findPack(registry, 'colorScheme', id)!, generated)) {
    return {
      code: 'appearance.input-missing',
      axis,
      message: `${id} is generated from an appearance input, and nothing generated for it is here, so ${axisFallback(axis)} renders in its place.`,
      remediation: `Give ${id} its appearanceInputs entry and save the draft, which generates it, then publish.`,
    };
  }
  return null;
}

function fallbackName(axis: IdAxis): string {
  return axis === 'variant' ? 'fallback composition' : `first-party ${axisFallback(axis)}`;
}

function visitorValues(input: ResolveInput) {
  const source = input.profile === 'demo' ? input.visitor?.query : input.visitor?.cookie;
  return source === undefined || source === null ? {} : parseSelection(source);
}

/** Whether a visitor value applies: registered, renderable, not Research, and fitting what's applied. */
function visitorAccepts(
  registry: AppearanceRegistry,
  axis: AppearanceAxis,
  value: string,
  current: Selection,
  generated: GeneratedSchemes | undefined,
): boolean {
  if (valueProblem(registry, axis, value, current)) return false;
  if (axis === 'variant' || axis === 'displayMode') return true;
  const pack = findPack(registry, axis, value)!;
  if (pack.manifest.tier === 'research') return false;
  return (
    axis !== 'colorScheme' || schemeRenders(findPack(registry, 'colorScheme', value)!, generated)
  );
}
