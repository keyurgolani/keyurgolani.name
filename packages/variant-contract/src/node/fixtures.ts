// The contract fixtures (#5, Slice 6; #10): #4's profession pairs, and pairs
// that push a composition, in packages/variant-contract/fixtures/<name>/.
// Each is a version 3 portfolio.yml and a site.yml that selects
// missing-variant, which no package registers, so a host renders it in the
// fallback composition until a test selects the variant it checks. None has
// a snapshot beside it, so a github section shows its profile link alone, and
// none reaches a host outside the app: links go to .test hosts, and every
// media asset names a file under the media root that has no rendition yet,
// so each image renders as unavailable.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the fixtures live. */
export const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/', import.meta.url));

/** What each fixture is for, by name. */
const PURPOSES = {
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
    'Hidden sections, what only they reach, a private work, and unregistered extension data, each holding canary-hidden.',
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

export type ContractFixtureName = keyof typeof PURPOSES;

export interface ContractFixture {
  readonly name: ContractFixtureName;
  /** What it checks. */
  readonly purpose: string;
  /** The absolute paths of its two documents. */
  readonly files: { readonly portfolio: string; readonly site: string };
}

/** The marker hidden-canary holds wherever a visitor must not see it. */
export const HIDDEN_CANARY = 'canary-hidden';

/** Every contract fixture, sorted by name. */
export const CONTRACT_FIXTURES: readonly ContractFixture[] = (
  Object.keys(PURPOSES) as ContractFixtureName[]
)
  .sort()
  .map((name) => ({
    name,
    purpose: PURPOSES[name],
    files: {
      portfolio: path.join(FIXTURES_DIR, name, 'portfolio.yml'),
      site: path.join(FIXTURES_DIR, name, 'site.yml'),
    },
  }));

/** The fixture `name`. Throws for one that doesn't exist. */
export function contractFixture(name: string): ContractFixture {
  const fixture = CONTRACT_FIXTURES.find((each) => each.name === name);
  if (!fixture) throw new Error(`No contract fixture is named ${name}.`);
  return fixture;
}
