// @portfolio/appearance (#19): the four appearance axes and the display mode.
// This root entry imports only zod, @portfolio/schema, and
// @portfolio/variant-contract's browser-safe root: no React, no Node, and
// no next/*, so the host, #7's preview frames, and #9's Demo Studio in the
// browser resolve the same way. So does ./generators. The compiler and the
// contrast check are ./node (Slice 2). The boundary and the visitor control
// (./react) and the primitives (./primitives) peer on React (Slice 3).

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
export { fontStackProblem, languageValueProblem, stylesheetValueProblem } from './values';
export { composite, contrast, deltaE, isHex, luminance, mix } from './color';
export {
  ACCENT_DELTA,
  anchorV1,
  DISTINCT_PAIRS,
  highContrastV1,
  QUIET_TEXT_DELTA,
  type Anchors,
} from './derive';
export {
  APPEARANCE_LAYERS,
  LAYER_ORDER,
  startsWithLayerOrder,
  type AppearanceLayer,
} from './layers';
export {
  COLOR_SET_NAMES,
  isHighContrastSet,
  printSet,
  schemeSets,
  setPolarity,
  type ColorSetName,
  type SchemeSets,
} from './sets';
export {
  CATEGORICAL_ROLES,
  contrastReport,
  FILL_PAIRS,
  GATE_TARGETS,
  gateLanguage,
  gateSet,
  gateTypography,
  GROUND_ROLES,
  isLargeText,
  NEUTRAL_LANGUAGE,
  SMALL_SIGNATURE,
  TEXT_ROLES,
  type ContrastReport,
  type GateLanguage,
  type GatePair,
  type GateTargets,
  type GateTypography,
} from './gate';
export {
  ACCESSIBILITY_CHECKS,
  ALLOWED_LICENSES,
  CATALOG_TIERS,
  ColorSchemeManifestSchema,
  ColorTokenSetSchema,
  DesignLanguageManifestSchema,
  LICENSE_STATES,
  PACK_TIERS,
  ResearchRecordSchema,
  TypographyManifestSchema,
  UPSTREAM_LICENSES,
  type AccessibilityCheck,
  type CatalogTier,
  type ColorSchemeManifest,
  type ColorTokenSet,
  type DesignLanguageManifest,
  type FontAssetDeclaration,
  type LicenseState,
  type PackProvenance,
  type PackTier,
  type ResearchRecord,
  type TypographyManifest,
  type UpstreamLicense,
} from './manifests';
export {
  AXIS_BY_KIND,
  baseModes,
  packIdProblem,
  REQUIRED_CHECKS,
  SCRIPT_FILE,
  validatePackManifest,
  type PackContext,
  type PackManifest,
  type PackManifestByKind,
  type PackResult,
} from './validate-pack';
export { licenseExclusion, isUpstreamLicense } from './governance';
export {
  axisFallback,
  createAppearanceRegistry,
  exclusionOf,
  findPack,
  findSelectableVariant,
  isRegistered,
  otherAxes,
  selectableIds,
  type AppearanceMeta,
  type ExcludedPack,
  type PackFileRef,
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
export {
  ACTION_EMPHASES,
  PRIMITIVES,
  SLOT_VALUES,
  SLOTS,
  STATUSES,
  SURFACE_EMPHASES,
  type ActionEmphasis,
  type SlotName,
  type SlotValue,
  type Status,
  type SurfaceEmphasis,
} from './slots';
export { boundaryId, localIdProblem, partId, prefixedId, type BoundaryIds } from './ids';
export {
  attributeAxis,
  BOUNDARY_KINDS,
  boundaryAttributes,
  diagnosticCodes,
  lowerMotion,
  registryStylesheets,
  stylesheetHrefs,
  type AppearanceStylesheets,
  type BoundaryAppearance,
  type BoundaryAttributes,
  type BoundaryKind,
} from './boundary';
export {
  APPEARANCE_PREFERENCE_ROUTE,
  AXIS_LABELS,
  DISPLAY_MODE_LABELS,
  TIER_LABELS,
  VISITOR_TIERS,
  visitorAppearanceModel,
  type VisitorAppearanceModel,
  type VisitorAxisControl,
  type VisitorChoice,
  type VisitorChoiceGroup,
  type VisitorModelInput,
  type VisitorTier,
} from './visitor-model';
