// The contract fixtures (#5, Slice 6): #4's profession pairs, and pairs that
// push a composition, in packages/variant-contract/fixtures/<name>/. Each is
// a portfolio.yml and a site.yml that selects missing-variant, which no
// package registers, so a host renders it in the fallback composition until a
// test selects the variant it checks. None carries GitHub data, and none
// reaches a host outside the app: links go to .test hosts, and images are
// data URLs or point at files the app doesn't have, on purpose.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the fixtures live. */
export const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/', import.meta.url));

/** What each fixture is for, by name. */
const PURPOSES = {
  academic: "#4's academic pair, in German: publications, talks, education, and patents.",
  complete: 'Every core section kind with every field, and every image bundled as a data URL.',
  consulting: "#4's consulting pair, in US English: services, stats, and testimonials.",
  design: "#4's design pair, in Japanese: projects, a gallery, and testimonials.",
  engineering: "#4's engineering pair: projects, stats, experience, and a stack.",
  'hidden-canary': 'Hidden sections and unregistered extension data, each holding canary-hidden.',
  'identity-only': 'The identity and one bare hero: the least that can go live.',
  large: 'A hundred projects, photos, and skills.',
  'long-text': 'Long and unbroken text, non-Latin titles, and duplicate titles.',
  'missing-media': 'Images that answer 404, and items with none.',
  mixed: "#4's mixed pair, right to left in Arabic: writings, episodes, and talks.",
  music: "#4's music pair, in Brazilian Portuguese: a discography, talks, and fun facts.",
  photography: "#4's photography pair, in Swedish: galleries, external portfolios, and press.",
  rtl: 'A right-to-left portfolio in Hebrew, with one section in English.',
  sparse: 'Many kinds, each with only what it requires.',
  writing: "#4's writing pair, in British English: essays, publications, and press.",
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
