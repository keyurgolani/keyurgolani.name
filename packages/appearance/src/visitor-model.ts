// What the visitor's appearance control offers (#19, Slice 3, item 3), as
// plain data the server builds and VisitorAppearance renders: one control
// per selectable axis, in axis order, the packs grouped by tier with Stable
// first, the variants by name, and each choice the current selection can't
// take disabled with the reason. Research packs never appear, and neither
// does a generated scheme with nothing generated for it, which a visitor
// couldn't apply. Under demo there's none, since #9's pickers drive the
// appearance there.

import type { AppearanceAxis, DisplayMode, VisitorControls } from '@portfolio/schema';
import { FALLBACK_ID } from '@portfolio/variant-contract';
import { APPEARANCE_AXES, PACK_AXES, QUERY_KEYS, type PackAxis } from './axes';
import type { AppearanceStylesheets } from './boundary';
import type { PackTier } from './manifests';
import { findPack, type AppearanceRegistry } from './registry';
import type { Profile, ResolvedAppearance } from './resolve';
import { schemeRenders, type GeneratedSchemes } from './resolve-tokens';
import { modeFits } from './selection';

/**
 * Where the control's form posts: Slice 4's preference route, which sets
 * the visitor's appearance cookie. Its body is the form's fields under the
 * query keys parseSelection() reads, with `reset` and `return`; with
 * JavaScript, the same values as JSON, or { "reset": true }.
 */
export const APPEARANCE_PREFERENCE_ROUTE = '/api/appearance';

/** One choice in a control. */
export interface VisitorChoice {
  readonly value: string;
  readonly label: string;
  /** Why the current selection can't take it, such as `no light mode`. Set only on a disabled choice. */
  readonly unavailable?: string;
  /** The compiled stylesheet it needs, which the control loads before it applies the choice. */
  readonly stylesheet?: string;
}

/** The tiers a visitor sees, in the order they're listed. */
export const VISITOR_TIERS = [
  'stable',
  'extended',
  'experimental',
] as const satisfies readonly Exclude<PackTier, 'research'>[];
export type VisitorTier = (typeof VISITOR_TIERS)[number];

export const TIER_LABELS: Readonly<Record<VisitorTier, string>> = {
  stable: 'Stable',
  extended: 'Extended',
  experimental: 'Experimental',
};

export interface VisitorChoiceGroup {
  /** The packs' tier, or null for the variants, which have none. */
  readonly tier: VisitorTier | null;
  readonly label: string;
  readonly choices: readonly VisitorChoice[];
}

/** One selectable axis's control. */
export interface VisitorAxisControl {
  readonly axis: AppearanceAxis;
  /** The form field's name: the axis's query key, the one parseSelection() reads. */
  readonly name: string;
  readonly label: string;
  /** What's applied now. */
  readonly value: string;
  readonly groups: readonly VisitorChoiceGroup[];
  /** Said beside the control, such as a single-mode scheme pinning the display mode. */
  readonly note?: string;
}

export interface VisitorAppearanceModel {
  /** One per selectable axis, in axis order. None when no axis is selectable, and none under demo. */
  readonly controls: readonly VisitorAxisControl[];
}

export interface VisitorModelInput {
  readonly registry: AppearanceRegistry;
  /** The document boundary's resolved appearance: what's applied now. */
  readonly appearance: Pick<ResolvedAppearance, 'selection' | 'resolvedMode' | 'modeLocked'>;
  readonly visitorControls: VisitorControls;
  readonly profile: Profile;
  /** Where each pack's stylesheet is, so the control can load one before it applies it. */
  readonly stylesheets?: AppearanceStylesheets;
  /** The generated scheme sets the resolver has, so a generated scheme with none isn't offered. */
  readonly generated?: GeneratedSchemes;
}

/** Each axis's label, the reviewed prototype's. */
export const AXIS_LABELS: Readonly<Record<AppearanceAxis, string>> = {
  variant: 'Variant',
  designLanguage: 'Design language',
  colorScheme: 'Color scheme',
  typography: 'Typography',
  displayMode: 'Display mode',
};

export const DISPLAY_MODE_LABELS: Readonly<Record<DisplayMode, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  'high-contrast': 'High contrast',
};

const MODE_ORDER: readonly DisplayMode[] = ['system', 'light', 'dark', 'high-contrast'];

const byLabel = (a: VisitorChoice, b: VisitorChoice) =>
  a.label.localeCompare(b.label, 'en') || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);

/** The visitor control's model: what VisitorAppearance renders. */
export function visitorAppearanceModel(input: VisitorModelInput): VisitorAppearanceModel {
  if (input.profile === 'demo') return { controls: [] };
  const controls = APPEARANCE_AXES.filter(
    (axis) => input.visitorControls[axis] === 'selectable',
  ).map((axis) => control(input, axis));
  return { controls };
}

function control(input: VisitorModelInput, axis: AppearanceAxis): VisitorAxisControl {
  const { registry, appearance } = input;
  const base = { axis, name: QUERY_KEYS[axis], label: AXIS_LABELS[axis] };
  if (axis === 'displayMode') {
    const scheme = findPack(registry, 'colorScheme', appearance.selection.colorScheme);
    const schemeName = scheme?.manifest.name ?? appearance.selection.colorScheme;
    const choices = MODE_ORDER.map((mode): VisitorChoice => {
      const fits = modeFits(registry, appearance.selection.colorScheme, mode);
      return {
        value: mode,
        label: DISPLAY_MODE_LABELS[mode],
        ...(fits ? {} : { unavailable: `${schemeName} has no ${mode} mode` }),
      };
    });
    const native = scheme?.modes[0];
    return {
      ...base,
      value: appearance.selection.displayMode,
      groups: [{ tier: null, label: AXIS_LABELS.displayMode, choices }],
      ...(appearance.modeLocked && native
        ? { note: `${schemeName} has only a ${native} mode, so it shows ${native}.` }
        : {}),
    };
  }
  if (axis === 'variant') {
    const choices = registry.variants
      .filter(({ manifest }) => manifest.id !== FALLBACK_ID)
      .map(({ manifest }): VisitorChoice => ({ value: manifest.id, label: manifest.name }))
      .sort(byLabel);
    return withCurrent(
      {
        ...base,
        value: appearance.selection.variant,
        groups: [{ tier: null, label: 'Variants', choices }],
      },
      () =>
        registry.variants.find(({ manifest }) => manifest.id === appearance.selection.variant)
          ?.manifest.name,
    );
  }
  return withCurrent(
    packControl(input, axis, base),
    () => findPack(registry, axis, appearance.selection[axis])?.manifest.name,
  );
}

function packControl(
  input: VisitorModelInput,
  axis: PackAxis,
  base: Pick<VisitorAxisControl, 'axis' | 'name' | 'label'>,
): VisitorAxisControl {
  const { registry, appearance, stylesheets, generated } = input;
  const mode = appearance.selection.displayMode;
  const groups = VISITOR_TIERS.map((tier): VisitorChoiceGroup => {
    const choices = [...registry.packs[axis].values()]
      .filter(({ manifest }) => manifest.tier === tier)
      .filter(
        (pack) =>
          axis !== 'colorScheme' ||
          schemeRenders(findPack(registry, 'colorScheme', pack.manifest.id)!, generated),
      )
      .map(({ manifest }): VisitorChoice => {
        const stylesheet = stylesheets?.pack(axis, manifest.id) ?? undefined;
        const fits = axis !== 'colorScheme' || modeFits(registry, manifest.id, mode);
        return {
          value: manifest.id,
          label: manifest.name,
          ...(fits ? {} : { unavailable: `no ${mode} mode` }),
          ...(stylesheet ? { stylesheet } : {}),
        };
      })
      .sort(byLabel);
    return { tier, label: TIER_LABELS[tier], choices };
  }).filter((group) => group.choices.length > 0);
  return { ...base, value: appearance.selection[axis], groups };
}

/**
 * The control, with what's applied now listed as a disabled choice when it
 * isn't one a visitor could pick, such as the fallback composition standing
 * in for a missing variant, so the control never shows another value as
 * the one in effect.
 */
function withCurrent(
  control: VisitorAxisControl,
  name: () => string | undefined,
): VisitorAxisControl {
  const listed = control.groups.some((group) =>
    group.choices.some((choice) => choice.value === control.value),
  );
  if (listed) return control;
  const current: VisitorChoice = {
    value: control.value,
    label: name() ?? control.value,
    unavailable: "can't be selected",
  };
  return {
    ...control,
    groups: [{ tier: null, label: 'Current', choices: [current] }, ...control.groups],
  };
}

/** Whether `axis` is one the control's choices load a stylesheet for. */
export function loadsStylesheet(axis: AppearanceAxis): axis is PackAxis {
  return (PACK_AXES as readonly string[]).includes(axis);
}
