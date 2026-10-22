// @portfolio/variant-contract/node (#5, Slice 3): the Node-only half of the
// contract. Registry generation reads the host's installed packages and
// writes its generated modules, and the source audit reads variant code and
// styles. The contract fixtures and the parity comparator (Slice 6) are here
// for the tests that render a variant. Nothing here runs in a browser but
// snapshotBoundary(), which a test hands to the page it reads.

export {
  HOST_PACKAGE,
  PACK_KINDS,
  readRegistry,
  REGISTRY_CODES,
  REGISTRY_KINDS,
  type ExtensionEntry,
  type FixtureGate,
  type FixturePackage,
  type PackCheck,
  type PackCompile,
  type PackEntry,
  type PackFile,
  type PackHooks,
  type PackKind,
  type RegistryCode,
  type RegistryDiagnostic,
  type RegistryKind,
  type RegistryOptions,
  type RegistryResult,
  type VariantEntry,
} from './registry';
export {
  GENERATED_FILES,
  packFiles,
  renderRegistry,
  writePackFiles,
  writeRegistry,
  type GeneratedFile,
  type PackWriteResult,
  type RenderOptions,
  type WriteResult,
} from './codegen';
export {
  AUDIT_CODES,
  auditKitSections,
  auditSharedStylesheet,
  auditVariant,
  kitImports,
  packageFiles,
  type AuditCode,
  type AuditFinding,
  type AuditTarget,
} from './audit';
export { formatAuditFindings, formatRegistryDiagnostics } from './report';
export { exportTarget, findInstalled, type PackageJson } from './packages';
export {
  CONTRACT_FIXTURES,
  contractFixture,
  FIXTURES_DIR,
  HIDDEN_CANARY,
  type ContractFixture,
  type ContractFixtureName,
} from './fixtures';
export {
  compareSnapshots,
  snapshotBoundary,
  type ParityDifference,
  type ParityNode,
} from './parity';
