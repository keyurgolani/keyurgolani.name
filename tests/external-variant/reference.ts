// What the reference variant's checks know about it (#5, Slice 6): its id,
// from its manifest, and the site documents that select it.
import type { ContractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { siteFor, type RegisteredVariant } from '../variants/target';
import { REFERENCE_ID } from './id';

export { REFERENCE_ID };

/** The fixture's site document, selecting the reference variant with its compact control on. */
export function compactSite(fixture: ContractFixture, reference: RegisteredVariant): string {
  return (
    `${siteFor(fixture, reference)}variantControls:\n` +
    `  ${REFERENCE_ID}:\n    version: ${reference.manifest.controls.version}\n` +
    '    values:\n      compact: true\n'
  );
}
