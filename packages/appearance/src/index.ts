// @portfolio/appearance (#19): the four appearance axes and the display mode.
// This root entry imports only zod, @portfolio/schema, and
// @portfolio/variant-contract's browser-safe root: no React, no Node, and
// no next/*, so the host, #7's preview frames, and #9's Demo Studio in the
// browser resolve the same way. The compiler and audit (./node), the
// boundary and primitives (./react, ./primitives), and the scheme
// generators (./generators) arrive in Slices 2 and 3.

export {
  APPEARANCE_AXES,
  AXIS_NAMES,
  DEFAULT_VISITOR_CONTROLS,
  DISPLAY_MODES,
  ID_AXES,
  isDisplayMode,
  isPackAxis,
  PACK_AXES,
  PACK_KIND_BY_AXIS,
  PLATFORM_DEFAULTS,
  QUERY_KEYS,
  type BaseMode,
  type IdAxis,
  type PackAxis,
  type PackKind,
} from './axes';
export {
  COLOR_ROLES,
  colorProperty,
  LANGUAGE_KEYS,
  LAYOUT_PREFIX,
  languageProperty,
  measureProperty,
  TOKEN_CONTRACT_VERSION,
  TOKEN_PREFIXES,
  TOKEN_PROPERTIES,
  TYPOGRAPHY_FIELDS,
  TYPOGRAPHY_MEASURES,
  TYPOGRAPHY_ROLES,
  typographyProperty,
  type ColorRole,
  type ColorTokens,
  type LanguageKey,
  type LanguageTokens,
  type TypeRole,
  type TypographyField,
  type TypographyMeasure,
  type TypographyMeasures,
  type TypographyRole,
  type TypographyRoles,
} from './tokens';
export { fontStackProblem, languageValueProblem } from './values';
export { contrast, isHex, luminance, mix } from './color';
export { anchorV1, highContrastV1, type Anchors } from './derive';
export {
  ColorSchemeManifestSchema,
  ColorTokenSetSchema,
  DesignLanguageManifestSchema,
  PACK_TIERS,
  TypographyManifestSchema,
  type ColorSchemeManifest,
  type ColorTokenSet,
  type DesignLanguageManifest,
  type FontAssetDeclaration,
  type PackProvenance,
  type PackTier,
  type TypographyManifest,
} from './manifests';
export {
  baseModes,
  packIdProblem,
  validatePackManifest,
  type PackContext,
  type PackManifest,
  type PackManifestByKind,
  type PackResult,
} from './validate-pack';
export {
  axisFallback,
  createAppearanceRegistry,
  findPack,
  findSelectableVariant,
  isRegistered,
  otherAxes,
  selectableIds,
  type AppearanceMeta,
  type AppearanceRegistry,
  type MetaPack,
  type PackEntry,
  type RegisteredLanguage,
  type RegisteredScheme,
  type RegisteredTypography,
} from './registry';
export { APPEARANCE_CODES, type AppearanceCode, type AppearanceDiagnostic } from './diagnostics';
export {
  modeFits,
  parseSelection,
  serializeSelection,
  setAxis,
  valueProblem,
  type Selection,
  type SelectionText,
  type SelectionValues,
  type SetAxisResult,
} from './selection';
export {
  generatedSets,
  resolveTokens,
  schemeRenders,
  type GeneratedScheme,
  type GeneratedSchemes,
  type ResolvedTokens,
  type TokenRequest,
} from './resolve-tokens';
export {
  resolveAppearance,
  type AppearanceEnvironment,
  type Motion,
  type Profile,
  type ResolvedAppearance,
  type ResolveInput,
  type VisitorInput,
} from './resolve';
export { validateAppearance, type AppearanceValidatorOptions } from './validator';
export { legacyAppearanceRemediation } from './remediation';
export { coversScript, scriptOf } from './scripts';
