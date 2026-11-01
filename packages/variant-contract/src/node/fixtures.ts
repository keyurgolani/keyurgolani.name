// The contract fixtures (#5, Slice 6; #10): #4's profession pairs, and pairs
// that push a composition, in packages/variant-contract/fixtures/<name>/.
// Each is a version 3 portfolio.yml and a site.yml that selects
// missing-variant, which no package registers, so a host renders it in the
// fallback composition until a test selects the variant it checks. Only
// hidden-canary has a snapshot beside it, snapshots/github.json; every other
// github section shows its profile link alone. None reaches a host outside
// the app: links go to .test hosts, and every media asset names a file under
// the media root that has no rendition yet, so each image renders as
// unavailable.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTRACT_FIXTURE_NAMES,
  CONTRACT_FIXTURE_PURPOSES,
  type ContractFixtureName,
} from '../contract-fixtures';

export type { ContractFixtureName };

/** Where the fixtures live. */
export const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/', import.meta.url));

export interface ContractFixture {
  readonly name: ContractFixtureName;
  /** What it checks. */
  readonly purpose: string;
  /** The absolute paths of its two documents. */
  readonly files: { readonly portfolio: string; readonly site: string };
  /**
   * The unit files beside them, by their path in the unit, such as
   * snapshots/github.json: what a host reads from the source directory.
   */
  readonly unitFiles: readonly string[];
}

/** The snapshots and media document in a fixture's directory, by their path in the unit. */
function unitFilesIn(dir: string): string[] {
  return ['snapshots', 'media'].flatMap((folder) => {
    const at = path.join(dir, folder);
    if (!fs.existsSync(at)) return [];
    return fs
      .readdirSync(at)
      .sort()
      .map((name) => `${folder}/${name}`);
  });
}

/** The marker hidden-canary holds wherever a visitor must not see it. */
export const HIDDEN_CANARY = 'canary-hidden';

/** Every contract fixture, sorted by name. */
export const CONTRACT_FIXTURES: readonly ContractFixture[] = CONTRACT_FIXTURE_NAMES.map((name) => ({
  name,
  purpose: CONTRACT_FIXTURE_PURPOSES[name],
  files: {
    portfolio: path.join(FIXTURES_DIR, name, 'portfolio.yml'),
    site: path.join(FIXTURES_DIR, name, 'site.yml'),
  },
  unitFiles: unitFilesIn(path.join(FIXTURES_DIR, name)),
}));

/** The fixture `name`. Throws for one that doesn't exist. */
export function contractFixture(name: string): ContractFixture {
  const fixture = CONTRACT_FIXTURES.find((each) => each.name === name);
  if (!fixture) throw new Error(`No contract fixture is named ${name}.`);
  return fixture;
}
