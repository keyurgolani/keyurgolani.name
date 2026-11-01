import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// GITHUB_TOKEN's isolation (#10, Slice 3 item 1; threat rows github-1 and
// github-3): the deployment config reads it, owner's composition hands it
// to the GitHub adapter on @portfolio/core's owner side, and the CLI reads
// it for `sources refresh` through the adapter's own reader. No renderer,
// variant, kit module, page, or read-only or demo module reads it, and none
// loads the adapter, so no published page can call GitHub at request time.

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Every source file under `dir`, tests and their support left out. */
function sources(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const file = path.join(at, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'test-support' && entry.name !== '__fixtures__') walk(file);
      } else if (
        /\.(?:ts|tsx|mts|mjs|js)$/.test(entry.name) &&
        !/\.test\.[a-z]+$/.test(entry.name)
      ) {
        found.push(path.relative(ROOT, file));
      }
    }
  };
  walk(path.join(ROOT, dir));
  return found;
}

const PACKAGES = readdirSync(path.join(ROOT, 'packages')).map((name) => `packages/${name}/src`);
const ALL = [
  'apps/web/src',
  'apps/web/scripts',
  ...PACKAGES.filter((dir) => {
    try {
      readdirSync(path.join(ROOT, dir));
      return true;
    } catch {
      return false;
    }
  }),
].flatMap(sources);

/** What reads the token's value, as opposed to naming it in prose or a status label. */
const READS =
  /\bsecrets\.githubToken\b|\benv\.GITHUB_TOKEN\b|\bgithubTokenFrom\(|resolveFor\('GITHUB_TOKEN'\)/;

test('only the deployment config, owner composition, the CLI, and the adapter read GITHUB_TOKEN, and config.status only whether it is set', () => {
  const readers = ALL.filter((file) => READS.test(readFileSync(path.join(ROOT, file), 'utf8')));
  assert.deepEqual(readers.sort(), [
    // config.status reports it set or unset, never its value.
    'apps/web/src/server/config-summary.ts',
    'apps/web/src/server/config.ts',
    'apps/web/src/server/owner/index.ts',
    'packages/core/src/cli.ts',
    'packages/core/src/sources/github/index.ts',
  ]);
});

test('no renderer, variant, page, or read-only or demo module names the token or loads the GitHub adapter', () => {
  const adapter = /sources\/github|\bgithubAdapter\b|\bGITHUB_TOKEN\b|\bgithubToken\b/;
  const outside = ALL.filter(
    (file) =>
      !file.startsWith('packages/core/') &&
      !file.startsWith('apps/web/src/server/') &&
      adapter.test(readFileSync(path.join(ROOT, file), 'utf8')),
  );
  assert.deepEqual(outside, []);
  // In the server, only owner code and the config that reports it set or unset.
  const server = ALL.filter(
    (file) =>
      file.startsWith('apps/web/src/server/') &&
      !file.startsWith('apps/web/src/server/owner/') &&
      /sources\/github|\bgithubAdapter\b/.test(readFileSync(path.join(ROOT, file), 'utf8')),
  );
  assert.deepEqual(server, []);
  // The kit's fetchers are gone, and so is their export.
  const kit = JSON.parse(readFileSync(path.join(ROOT, 'packages/kit/package.json'), 'utf8')) as {
    exports: Record<string, string>;
  };
  assert.equal(kit.exports['./github'], undefined);
});
