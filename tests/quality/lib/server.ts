// The app under test for one cell (#11, Slice 1, item 6): the quality
// build's standalone server (tests/harness/app-server.mjs's startApp, never
// next dev) on the cell's state fixture, its site document publishing the
// cell's tuple, under its profile, with the fixed clock and the socket guard
// preloaded into it alone, behind the harness's egress trap. An owner
// server's password is the run's canary, so the artifact scan finds a leak
// of either.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  contractFixture,
  type ContractFixtureName,
} from '../../../packages/variant-contract/src/node/fixtures';
import type { AppOptions } from '../../harness/fixtures';
import { OWNER_CLI } from '../../harness/owner-secret.mjs';
import { siteTextFor, type Cell } from '../cells';
import type { Tuple } from '../coverage';
import { canaryPassword } from './artifacts.mjs';
import { APP_NODE_OPTIONS } from './clock';
import type { Profile } from './registration';

/** What a cell's server is: the cells that share one share all of it. */
export interface CellServer {
  readonly source: ContractFixtureName;
  readonly tuple: Tuple;
  readonly profile: Profile;
}

export function cellServer(cell: Cell): CellServer {
  return { source: cell.source, tuple: cell.tuple, profile: cell.profile };
}

/** A small gray PNG and a one-page PDF, standing in for the assets a fixture links. */
const IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAAAAADbboAnAAAADklEQVR4nGPYAgUMpDAAj6MhwZIy8f4AAAAASUVORK5CYII=',
  'base64',
);
const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';

/** The files a fixture links on the site itself, such as /papers/..., as an owner ships them in public/. */
function ownerAssets(portfolio: string): Record<string, string | Uint8Array> {
  const assets: Record<string, string | Uint8Array> = {};
  for (const [, value] of readFileSync(portfolio, 'utf8').matchAll(
    /:\s*['"]?(\/(?!\/)[^\s'"#?]+\.[a-z0-9]+)['"]?\s*$/gim,
  )) {
    const file = value!.slice(1);
    assets[file] = /\.pdf$/i.test(file) ? PDF : IMAGE;
  }
  return assets;
}

const hashes = new Map<string, string>();

/** The owner CLI's hash of `password`, once per process. */
export function ownerHash(password: string): string {
  const cached = hashes.get(password);
  if (cached) return cached;
  const [file, ...args] = OWNER_CLI;
  const result = spawnSync(file!, [...args, 'hash-password', '--stdin'], {
    input: `${password}\n${password}\n`,
    encoding: 'utf8',
    timeout: 120_000,
  });
  const hash = (result.stdout ?? '').replace(/\n$/, '');
  if (result.status !== 0 || !hash.startsWith('$scrypt$')) {
    throw new Error(`hash-password --stdin exited ${result.status ?? result.signal}`);
  }
  hashes.set(password, hash);
  return hash;
}

/** startApp's options for `server`, on the quality build at `web`, with `canary` as the owner password. */
export function appOptionsFor(server: CellServer, web: string, canary: string): AppOptions {
  const fixture = contractFixture(server.source);
  const dir = path.dirname(fixture.files.portfolio);
  const base: AppOptions = {
    web,
    portfolio: fixture.files.portfolio,
    siteText: siteTextFor(fixture, server.tuple),
    publicFiles: ownerAssets(fixture.files.portfolio),
    sourceFiles: Object.fromEntries(
      fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
    env: { NODE_OPTIONS: APP_NODE_OPTIONS },
  };
  switch (server.profile) {
    case 'read-only':
      return base;
    case 'owner':
      return {
        ...base,
        dataName: 'data',
        env: { ...base.env, PORTFOLIO_PROFILE: 'owner' },
        envFiles: {
          PORTFOLIO_AUTH_PASSWORD_HASH_FILE: {
            path: 'secrets/owner_password_hash',
            text: `${ownerHash(canaryPassword(canary))}\n`,
          },
        },
      };
    case 'demo':
      return {
        ...base,
        portfolio: null,
        site: null,
        siteText: undefined,
        sourceFiles: {},
        env: { ...base.env, PORTFOLIO_PROFILE: 'demo', PORTFOLIO_SOURCE_DIR: '' },
      };
  }
}
