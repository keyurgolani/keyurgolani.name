// @portfolio/variant-contract/node (#5, Slice 3): the Node-only half of the
// contract. Registry generation reads the host's installed packages and
// writes its generated modules, and the source audit reads variant code and
// styles. Nothing here runs in a browser.

export {
  HOST_PACKAGE,
  PACK_KINDS,
  readRegistry,
  REGISTRY_CODES,
  REGISTRY_KINDS,
  type ExtensionEntry,
  type RegistryCode,
  type RegistryDiagnostic,
  type RegistryKind,
  type RegistryOptions,
  type RegistryResult,
  type VariantEntry,
} from './registry';
export {
  GENERATED_FILES,
  renderRegistry,
  writeRegistry,
  type GeneratedFile,
  type WriteResult,
} from './codegen';
export {
  AUDIT_CODES,
  auditKitSections,
  auditVariant,
  packageFiles,
  type AuditCode,
  type AuditFinding,
  type AuditTarget,
} from './audit';
export { formatAuditFindings, formatRegistryDiagnostics } from './report';
export { exportTarget, findInstalled, type PackageJson } from './packages';
