import { FALLBACK_ID, MISSING_VARIANT_ID } from './ids';

// The contract fixtures (#5, Slice 6; #10): their names, which
// fixture-names.ts holds without an import, and a fixture's site document
// selecting a variant.

export {
  CONTRACT_FIXTURE_NAMES,
  CONTRACT_FIXTURE_PURPOSES,
  isContractFixtureName,
  type ContractFixtureName,
} from './fixture-names';

/**
 * A fixture's site document, `text`, selecting `variant`. Each fixture's site
 * selects missing-variant, which no package registers, so the fallback
 * composition stands in until a host selects the variant it renders. The
 * fallback's own id is no selection, so for it the text stays as it is.
 * Throws for a site that no longer selects missing-variant.
 */
export function fixtureSiteSelecting(text: string, variant: string): string {
  const selected = `\n  variant: ${MISSING_VARIANT_ID}\n`;
  if (!text.includes(selected)) {
    throw new Error(`The fixture's site document no longer selects ${MISSING_VARIANT_ID}.`);
  }
  return variant === FALLBACK_ID ? text : text.replace(selected, `\n  variant: ${variant}\n`);
}
