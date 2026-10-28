import type { Diagnostic, Publication, SourceDocument } from './diagnostics';
import { PUBLISH_VALIDATORS } from './published-urls';
import { validatePublicationUnit } from './validate';

const PUBLISH_CODES: ReadonlySet<string> = new Set(
  PUBLISH_VALIDATORS.flatMap((validator) => validator.covers ?? []),
);

/**
 * The records PUBLISH_VALIDATORS raise on `unit`, given what #3 knows beside
 * it at publish and import (#10): an id the live revision gives another
 * type, and a derived change the owner hasn't accepted, each located like
 * any other record. #3's checkUnit runs these itself whenever it has a
 * publication, so no build's checks can leave the gate out.
 */
export function publishDiagnostics(
  unit: { readonly portfolio: SourceDocument; readonly site: SourceDocument },
  publication: Publication,
): readonly Diagnostic[] {
  const result = validatePublicationUnit(unit, { publication, validators: PUBLISH_VALIDATORS });
  return result.diagnostics.filter((diagnostic) => PUBLISH_CODES.has(diagnostic.code));
}
