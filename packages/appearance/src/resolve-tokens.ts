// Typed token values (#19, Slice 1, item 5), for server code that needs a
// color or a size rather than a stylesheet, such as #22's social image. The
// compiler (Slice 2) writes the same values as custom properties.

import { PACK_AXES, type BaseMode, type PackAxis } from './axes';
import { withDerivedRoles } from './derived-roles';
import { GENERATOR_V1_FOCUS_TARGETS } from './solve';
import {
  deriveHighContrastSet,
  type AuthoredTokens,
  type SchemeAnchors,
  type SchemeDerivation,
} from './sets';
import { ColorTokenSetSchema } from './manifests';
import {
  axisFallback,
  canonicalId,
  findPack,
  type AppearanceRegistry,
  type RegisteredScheme,
} from './registry';
import type { ColorTokens, LanguageTokens, TypographyMeasures, TypographyRoles } from './tokens';

/**
 * A generator scheme's sets, as #10's draft save stores them in the draft's
 * `derived.schemes` and publish freezes them into the revision's snapshot.
 * A generator gives both base modes.
 */
export interface GeneratedScheme {
  readonly light: ColorTokens;
  readonly dark: ColorTokens;
  /**
   * The high-contrast sets a generator solved with its base sets (#20's
   * generators, with high-contrast-v2), which render as they are. Without
   * them, high-contrast-v1 derives them from the base sets.
   */
  readonly highContrast?: { readonly light: ColorTokens; readonly dark: ColorTokens };
}

/** Generated sets by scheme id. */
export type GeneratedSchemes = Readonly<Record<string, GeneratedScheme>>;

/** The generated sets for `schemeId`, when there are complete ones. */
export function generatedSets(
  generated: GeneratedSchemes | undefined,
  schemeId: string,
): GeneratedScheme | undefined {
  const entry = generated && Object.hasOwn(generated, schemeId) ? generated[schemeId] : undefined;
  if (!entry) return undefined;
  const complete = (set: unknown) => ColorTokenSetSchema.safeParse(set).success;
  if (!complete(entry.light) || !complete(entry.dark)) return undefined;
  if (
    entry.highContrast &&
    !(complete(entry.highContrast.light) && complete(entry.highContrast.dark))
  )
    return undefined;
  return completed(entry);
}

const completedCache = new WeakMap<GeneratedScheme, GeneratedScheme>();

/**
 * `entry` with the roles K-2 added in every set, derived from the
 * others where a record from before them leaves them out, as its
 * generator, at version 1, derives them (GENERATOR_V1_FOCUS_TARGETS): once
 * per entry, so the high-contrast cache keyed on it still holds.
 */
function completed(entry: GeneratedScheme): GeneratedScheme {
  let done = completedCache.get(entry);
  if (!done) {
    const { highContrast } = entry;
    done = {
      ...entry,
      light: withDerivedRoles(entry.light, false, GENERATOR_V1_FOCUS_TARGETS),
      dark: withDerivedRoles(entry.dark, false, GENERATOR_V1_FOCUS_TARGETS),
      ...(highContrast
        ? {
            highContrast: {
              light: withDerivedRoles(highContrast.light, true),
              dark: withDerivedRoles(highContrast.dark, true),
            },
          }
        : {}),
    };
    completedCache.set(entry, done);
  }
  return done;
}

/** Whether a registered scheme can render: authored or anchored sets, or complete generated ones. */
export function schemeRenders(
  scheme: RegisteredScheme,
  generated: GeneratedSchemes | undefined,
): boolean {
  return !scheme.manifest.generator || generatedSets(generated, scheme.manifest.id) !== undefined;
}

export interface TokenRequest {
  readonly designLanguage: string;
  readonly colorScheme: string;
  readonly typography: string;
  /** The page's polarity. A single-mode scheme gives its native mode's colors whichever is asked. */
  readonly polarity: BaseMode;
  /** The high-contrast set of that polarity, which high-contrast and prefers-contrast: more use. */
  readonly highContrast?: boolean;
}

export interface ResolvedTokens {
  /** The packs the values are from: those requested, or each axis's fallback. */
  readonly packs: { readonly [A in PackAxis]: string };
  /** The axes whose requested pack this build can't render, so the fallback's values are given. */
  readonly fallbackAxes: readonly PackAxis[];
  /** The colors' polarity: the one requested, or a single-mode scheme's native mode. */
  readonly polarity: BaseMode;
  readonly highContrast: boolean;
  readonly color: ColorTokens;
  readonly language: LanguageTokens;
  readonly typography: TypographyRoles;
  readonly measures: TypographyMeasures;
}

const highContrastCache = new WeakMap<object, Map<BaseMode, ColorTokens>>();

/** A scheme's high-contrast set of `polarity`: its authored one, else the one its derivation derives. */
function highContrastSet(
  key: object,
  sets: { readonly light?: ColorTokens; readonly dark?: ColorTokens },
  authored: AuthoredTokens | undefined,
  polarity: BaseMode,
  derivation: SchemeDerivation | undefined,
  anchors?: SchemeAnchors,
): ColorTokens {
  // An authored set gets the roles K-2 added from its others where it leaves them out.
  if (authored) return withDerivedRoles(authored, true);
  let cached = highContrastCache.get(key);
  if (!cached) highContrastCache.set(key, (cached = new Map()));
  let set = cached.get(polarity);
  if (!set)
    cached.set(polarity, (set = deriveHighContrastSet(sets, polarity, derivation, anchors)));
  return set;
}

/**
 * The values of one request. An unregistered pack, or a generator scheme
 * with nothing generated, gives its axis's fallback's values, named in
 * `fallbackAxes`. It throws only for a registry createAppearanceRegistry()
 * didn't make.
 */
export function resolveTokens(
  registry: AppearanceRegistry,
  request: TokenRequest,
  options: { readonly generated?: GeneratedSchemes } = {},
): ResolvedTokens {
  const fallbackAxes: PackAxis[] = [];
  const packs = {} as { [A in PackAxis]: string };
  for (const axis of PACK_AXES) {
    // A retired pack's id (LANG-1) gives its survivor's values, which is no fallback.
    const id = canonicalId(registry, axis, request[axis]);
    const entry = findPack(registry, axis, id);
    const renders =
      entry !== undefined &&
      (axis !== 'colorScheme' || schemeRenders(entry as RegisteredScheme, options.generated));
    packs[axis] = renders ? id : axisFallback(axis);
    if (!renders) fallbackAxes.push(axis);
  }
  const language = findPack(registry, 'designLanguage', packs.designLanguage)!;
  const scheme = findPack(registry, 'colorScheme', packs.colorScheme)!;
  const typography = findPack(registry, 'typography', packs.typography)!;

  const generated = scheme.manifest.generator
    ? generatedSets(options.generated, scheme.manifest.id)!
    : undefined;
  const sets = generated ?? scheme.sets;
  const polarity = scheme.modes.includes(request.polarity) ? request.polarity : scheme.modes[0]!;
  const highContrast = request.highContrast === true;
  const color = highContrast
    ? (generated?.highContrast?.[polarity] ??
      highContrastSet(
        generated ?? scheme,
        sets,
        scheme.manifest.highContrast?.[polarity],
        polarity,
        generated ? undefined : scheme.manifest.derivation,
        generated ? undefined : scheme.manifest.anchors,
      ))
    : sets[polarity]!;

  return {
    packs,
    fallbackAxes,
    polarity,
    highContrast,
    color,
    language: language.manifest.tokens,
    typography: typography.manifest.roles,
    measures: typography.manifest.measures,
  };
}
