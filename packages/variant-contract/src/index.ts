// @portfolio/variant-contract (#5): the variant contract, version 2. This
// root entry imports only zod and @portfolio/schema, reads no environment,
// needs no Web Crypto, and runs in a browser, so the host, #7's preview
// frame, and #9's in-browser render share it. Discovery, code generation, and
// the source audit go in a Node-only ./node subpath (Slice 3).

export {
  CONTRACT_MAJOR,
  CONTRACT_MINOR,
  CONTRACT_VERSION,
  parseContractVersion,
  TOKEN_CONTRACT_VERSION,
} from './version';
export {
  COMPOSITION_IDS,
  FALLBACK_ID,
  FIRST_PARTY_PINS,
  FIRST_PARTY_SCOPE,
  idProblem,
  MISSING_VARIANT_ID,
  packageScope,
  RESERVED_IDS,
  VARIANT_ID_PATTERN,
  type IdProblem,
} from './ids';
export { BUDGET_KINDS, BudgetsSchema, type BudgetKind, type Budgets } from './budgets';
export {
  COMPOSITION_FAMILIES,
  CONTROL_ID_PATTERN,
  DISPOSITIONS,
  FIELD_POINTER,
  ManifestSchema,
  MOTION_INTENTS,
  PERFORMANCE_TIERS,
  PLACEMENTS,
  REQUIREMENT_FLAGS,
  SLOT_LEVELS,
  V1_FIELDS,
  type ContentSlot,
  type ControlDeclaration,
  type ControlMigration,
  type EnhancementDeclaration,
  type MigrationOperation,
  type VariantManifest,
  type ViewDeclaration,
} from './manifest-schema';
export {
  MANIFEST_CODES,
  toPointer,
  UNIT_CODES,
  type ManifestCode,
  type ManifestDiagnostic,
  type ManifestSeverity,
  type UnitCode,
} from './diagnostics';
export { validateManifest, type ManifestContext, type ManifestResult } from './validate-manifest';
export { keyVerdict, type KeyVerdict } from './keys';
export { isReservedSegment, RESERVED_SEGMENTS } from './segments';
export {
  dispatch,
  href,
  idFor,
  normalizeBasePath,
  routeHref,
  type DispatchOptions,
  type DispatchResult,
  type HrefOptions,
  type IdOptions,
  type LinkContext,
  type RouteTarget,
} from './routes';
export {
  checkControlValues,
  contentIndex,
  materializeControls,
  migrateControls,
  serializeControls,
  type ContentIndex,
  type ControlChange,
  type ControlProblem,
  type ControlsEntry,
  type ControlValue,
  type ControlValues,
  type MigrationResult,
} from './controls';
export {
  planControlsMigration,
  type ControlsMigrationEntry,
  type ControlsMigrationPlan,
  type ControlsMigrationStatus,
} from './controls-migration';
export { findVariant, type RegisteredVariant, type VariantRegistry } from './registry';
export {
  findUnit,
  UNIT_KINDS,
  type AssetFileRef,
  type AssetManifest,
  type AssetUnit,
  type StylesheetRef,
  type UnitEnhancement,
  type UnitKind,
} from './asset-manifest';
export {
  compatibilityFor,
  evaluateCompatibility,
  REPORT_VERSION,
  type CompatibilityOptions,
  type CompatibilityReport,
  type CompatibilityStatus,
  type KindRenderer,
  type KindReport,
  type RouteReport,
  type SlotReport,
} from './compatibility';
export { contractValidators, validateCompatibility, type ValidatorOptions } from './validators';
export {
  buildRenderInput,
  viewSeed,
  type RenderInputArgs,
  type VariantRenderInput,
} from './render-input';
export { sha256 } from './sha256';
export {
  CONTRACT_FIXTURE_NAMES,
  CONTRACT_FIXTURE_PURPOSES,
  fixtureSiteSelecting,
  isContractFixtureName,
  type ContractFixtureName,
} from './contract-fixtures';
