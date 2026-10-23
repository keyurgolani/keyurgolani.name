import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTFOLIO_FILES } from './portfolio-files';

// The paths proxy.ts lets through under /_portfolio/ (#7) against the files
// registry generation wrote into public/_portfolio/, which `pnpm test` runs
// first: every file there is listed, so none answers 404, and nothing else is.

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(path.join(dir, entry.name))
      : entry.isFile()
        ? [path.join(dir, entry.name)]
        : [],
  );
}

test('the paths the proxy lets through under /_portfolio/ are exactly the files the registry wrote there (#7)', () => {
  const written = files(path.join(PUBLIC, '_portfolio')).map(
    (file) => `/${path.relative(PUBLIC, file).split(path.sep).join('/')}`,
  );
  assert.ok(written.length > 0, 'the registry wrote its files');
  assert.deepEqual([...PORTFOLIO_FILES].sort(), written.sort());
});
