import { FALLBACK_ID, MISSING_VARIANT_ID } from './ids';

// The contract fixtures' names, and what each is for (#5, Slice 6; #10).
// Each is a pair under packages/variant-contract/fixtures/<name>/, which only
// Node reads: ./node's CONTRACT_FIXTURES says where its files are. The names
// are here, in the root entry, so the host's route table can tell a fixture's
// name from any other path segment (#7's dev route) without reading a file.

/** What each fixture is for, by name. */
export const CONTRACT_FIXTURE_PURPOSES = {
  academic:
    "#4's academic pair, in German: a research program with a case study, papers, talks, a patent, and teaching.",
  complete:
    'Every core section kind and record type with every field: the curation lists, a full case study, every evidence type and chronology kind, and media of every kind.',
  consulting:
    "#4's consulting pair, in US English: services, clients, results, and an engagement written up as a case study.",
  design:
    "#4's design pair, in British English: a thesis, a signature inquiry with a case study, a proof strip, and a chronology in three lanes.",
  engineering:
    "#4's engineering pair: a deploy orchestrator with a case study, a stack, experience, and a github section with no snapshot.",
  'hidden-canary':
    "Hidden sections and what only they reach, a hidden github section's snapshot and an excluded repository, private records and media wherever they're named, and unregistered extension data, each holding canary-hidden.",
  'identity-only': 'The identity and one bare hero: the least that can go live.',
  large: 'A hundred works, a series of a hundred photos, and a hundred skills.',
  'long-text': 'Long and unbroken text, non-Latin titles, and duplicate titles.',
  'missing-media': 'Images that never arrive, and items with none.',
  mixed:
    "#4's mixed pair, right to left in Arabic: essays, a podcast, talks, and a custom section.",
  music: "#4's music pair, in Brazilian Portuguese: records, shows, a radio session, and press.",
  photography:
    "#4's photography pair, in Swedish: image series, press, and an exhibition, with a private series.",
  rtl: 'A right-to-left portfolio in Hebrew, with one section in English.',
  sparse: 'Many kinds, each with only what it requires.',
  writing: "#4's writing pair, in British English: a novel, essays, press, and a testimonial.",
} as const;

export type ContractFixtureName = keyof typeof CONTRACT_FIXTURE_PURPOSES;

/** Every contract fixture's name, sorted. */
export const CONTRACT_FIXTURE_NAMES: readonly ContractFixtureName[] = (
  Object.keys(CONTRACT_FIXTURE_PURPOSES) as ContractFixtureName[]
).sort();

/** Whether `name` is a contract fixture's. */
export function isContractFixtureName(name: string): name is ContractFixtureName {
  return (CONTRACT_FIXTURE_NAMES as readonly string[]).includes(name);
}

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
