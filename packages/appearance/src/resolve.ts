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
import { APPEARANCE_AXES, ID_AXES, isDisplayMode, type IdAxis } from './axes';
import type { AppearanceDiagnostic } from './diagnostics';
import { axisFallback, findPack, isRegistered, type AppearanceRegistry } from './registry';
import { schemeRenders, type GeneratedSchemes } from './resolve-tokens';
import {
  alone,
  modeFits,
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
 * a variant to #5's fallback composition. A published mode the scheme lacks
 * is reported then, whatever the visitor sends. Then visitor values apply,
 * only on selectable axes (every axis under `demo`), and only registered,
 * renderable, non-Research ones. The variant, language, and typography
 * apply alone. The scheme and mode apply as a pair: both when they fit each
 * other, else the scheme when it fits the published mode, else the mode
 * when it fits the published scheme. Whatever doesn't fit drops silently,
 * so no visitor value leaves a scheme on a mode it lacks. `demo` reads the
 * query and `owner` and `read-only` the cookie, never the other.
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

  // The owner's diagnostic is about the published pair, so the cookie can't hide it.
  if (!modeFits(registry, current.colorScheme, current.displayMode)) {
    const native = findPack(registry, 'colorScheme', current.colorScheme)!.modes[0]!;
    diagnostics.push({
      code: 'appearance.mode-incompatible',
      axis: 'displayMode',
      message: `${current.colorScheme} has only a ${native} mode, so it can't show the published ${current.displayMode} and renders ${native} in its place.`,
      remediation: `Set the display mode to system, ${native}, or high-contrast, or pick a color scheme with a ${current.displayMode} mode.`,
    });
  }

  const values = visitorValues(input);
  const applied = new Set<AppearanceAxis>();
  /** The visitor's value on `axis`, when it's one that counts. */
  const counted = (axis: AppearanceAxis): string | undefined => {
    const value = values[axis];
    if (value === undefined) return undefined;
    if (input.profile !== 'demo' && input.visitorControls[axis] !== 'selectable') return undefined;
    return visitorAccepts(registry, axis, value, generated) ? value : undefined;
  };
  const apply = (axis: AppearanceAxis, value: string) => {
    // parseSelection() and visitorAccepts() have checked the value fits its axis.
    (requested as Record<AppearanceAxis, string>)[axis] = value;
    (current as Record<AppearanceAxis, string>)[axis] = value;
    applied.add(axis);
  };
  for (const axis of ['variant', 'designLanguage', 'typography'] as const) {
    const value = counted(axis);
    if (value !== undefined) apply(axis, value);
  }
  const scheme = counted('colorScheme');
  const mode = counted('displayMode') as DisplayMode | undefined;
  if (scheme !== undefined && mode !== undefined && modeFits(registry, scheme, mode)) {
    apply('colorScheme', scheme);
    apply('displayMode', mode);
  } else if (scheme !== undefined && modeFits(registry, scheme, current.displayMode)) {
    // A mode that came too doesn't fit this scheme, so it drops.
    apply('colorScheme', scheme);
  } else if (mode !== undefined && modeFits(registry, current.colorScheme, mode)) {
    apply('displayMode', mode);
  }

  // The scheme pins the mode on system, and on a published mode it lacks, which visitor values never make.
  const { modes } = findPack(registry, 'colorScheme', current.colorScheme)!;
  const pinned =
    (current.displayMode === 'system' && modes.length === 1) ||
    !modeFits(registry, current.colorScheme, current.displayMode);
  const resolvedMode: DisplayMode = pinned ? modes[0]! : current.displayMode;

  const base: Motion = input.motionPolicy === 'reduce' ? 'reduced' : 'full';
  const override = input.environment?.motion ?? 'full';
  return {
    selection: current,
    requested,
    resolvedMode,
    modeLocked: pinned,
    contrast: input.environment?.contrast === 'more' ? 'more' : 'system',
    motion: MOTION_RANK[override] < MOTION_RANK[base] ? override : base,
    enhancement: input.environment?.enhancement === 'off' ? 'off' : 'on',
    fallbackAxes: ID_AXES.filter((axis) => current[axis] !== requested[axis]),
    visitorAxes: APPEARANCE_AXES.filter((axis) => applied.has(axis)),
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

/**
 * Whether a visitor value counts on its own axis: a display mode, or an id
 * registered there (the fallback composition isn't), not Research, and for
 * a scheme, one that can render. How a scheme and a mode fit each other is
 * resolveAppearance()'s to weigh.
 */
function visitorAccepts(
  registry: AppearanceRegistry,
  axis: AppearanceAxis,
  value: string,
  generated: GeneratedSchemes | undefined,
): boolean {
  if (axis === 'displayMode') return isDisplayMode(value);
  if (valueProblem(registry, axis, value, alone(axis, value))) return false;
  if (axis === 'variant') return true;
  const pack = findPack(registry, axis, value)!;
  if (pack.manifest.tier === 'research') return false;
  return (
    axis !== 'colorScheme' || schemeRenders(findPack(registry, 'colorScheme', value)!, generated)
  );
}
