import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LATIN_PAGE } from '@portfolio/appearance/node';
import { minimalWoff2 } from '../../../packages/appearance/src/test-support/woff2';
import { LATIN_PAGE as BUDGET_LATIN_PAGE } from '../../../ci/lib/budgets.mjs';

test("check:budgets' Latin page is check:appearance's, code point for code point", () => {
  assert.deepEqual(
    BUDGET_LATIN_PAGE,
    LATIN_PAGE.map(([first, last]) => [first, last]),
  );
});

// `pnpm catalog:fonts` against a scratch checkout: one typography pack, and
// a fake font package installed in its node_modules. vendor copies from
// there and writes the provenance record; verify holds the pack to it; a
// package that isn't installed is never fetched.

const SCRIPT = fileURLToPath(new URL('./catalog-fonts.ts', import.meta.url));
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const FONT = 'files/fake-sans-latin-400-normal.woff2';
const COPYRIGHT = 'Copyright 2024 The Fake Sans Project Authors (https://example.test/fake-sans)';

function checkout(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-catalog-fonts-'));
  const pkg = path.join(root, 'packages', 'acme-type');
  fs.mkdirSync(path.join(pkg, 'packs', 'acme-sans'), { recursive: true });
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({
      name: '@acme/type',
      version: '1.0.0',
      portfolio: { kind: 'typography', packs: './packs' },
    }),
  );
  // A pack that ships fonts cites each family's copyright line, from its package's LICENSE.
  fs.writeFileSync(
    path.join(pkg, 'packs', 'acme-sans', 'manifest.json'),
    `${JSON.stringify({ provenance: { copyright: COPYRIGHT } })}\n`,
  );
  const font = path.join(root, 'node_modules', '@fontsource', 'fake-sans');
  fs.mkdirSync(path.join(font, 'files'), { recursive: true });
  fs.writeFileSync(
    path.join(font, 'package.json'),
    JSON.stringify({ name: '@fontsource/fake-sans', version: '5.2.6', license: 'OFL-1.1' }),
  );
  fs.writeFileSync(
    path.join(font, 'LICENSE'),
    `${COPYRIGHT}\n\nSIL OPEN FONT LICENSE Version 1.1\n`,
  );
  fs.writeFileSync(path.join(font, FONT), minimalWoff2());
  return root;
}

const run = (root: string, ...args: string[]) =>
  spawnSync(process.execPath, [TSX, SCRIPT, ...args, '--root', root], { encoding: 'utf8' });

test('vendor copies from node_modules and writes the record, and verify holds the pack to it', () => {
  const root = checkout();
  try {
    const pack = path.join(root, 'packages', 'acme-type', 'packs', 'acme-sans');
    const vendored = run(root, 'vendor', 'acme-sans', '@fontsource/fake-sans', FONT);
    assert.equal(vendored.status, 0, vendored.stderr);
    assert.match(
      vendored.stdout,
      /Vendored 1 file\(s\) from @fontsource\/fake-sans@5\.2\.6 \(OFL-1\.1\) into packages\/acme-type\/packs\/acme-sans/,
    );
    assert.deepEqual(fs.readdirSync(pack).sort(), [
      'LICENSE-fontsource-fake-sans.txt',
      'fake-sans-latin-400-normal.woff2',
      'fonts.provenance.json',
      'manifest.json',
    ]);
    const verified = run(root, 'verify');
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(
      verified.stdout,
      /1 font file\(s\) in 1 typography pack\(s\) match their provenance records/,
    );

    // A changed byte fails verify, naming the file.
    const file = path.join(pack, 'fake-sans-latin-400-normal.woff2');
    const bytes = fs.readFileSync(file);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    fs.writeFileSync(file, bytes);
    const broken = run(root, 'verify');
    assert.equal(broken.status, 1);
    assert.match(
      broken.stderr,
      /packages\/acme-type\/packs\/acme-sans\/fake-sans-latin-400-normal\.woff2: .*isn't the file that was vendored/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("vendor never fetches: a package that isn't installed, or a pack that doesn't exist, is refused", () => {
  const root = checkout();
  try {
    const missing = run(root, 'vendor', 'acme-sans', '@fontsource/not-installed', FONT);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /isn't in node_modules\. This never fetches/);
    const nopack = run(root, 'vendor', 'no-such-pack', '@fontsource/fake-sans', FONT);
    assert.equal(nopack.status, 1);
    assert.match(nopack.stderr, /No typography pack is named no-such-pack/);
    const refused = run(root, 'vendor', 'acme-sans', '@fontsource/fake-sans', 'files/none.woff2');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /has no files\/none\.woff2\. Nothing was written\./);
    assert.equal(run(root, 'vendor', 'acme-sans').status, 2);
    // A pack id or package name that could climb out of where it belongs is refused outright (#review L3).
    const climb = run(root, 'vendor', '../../acme-type', '@fontsource/fake-sans', FONT);
    assert.equal(climb.status, 2);
    assert.match(climb.stderr, /isn't a pack id/);
    const sideways = run(
      root,
      'vendor',
      'acme-sans',
      '../../node_modules/@fontsource/fake-sans',
      FONT,
    );
    assert.equal(sideways.status, 2);
    assert.match(sideways.stderr, /isn't an npm package name/);
    // A package installed under one name whose package.json gives another is refused.
    const impostor = path.join(root, 'node_modules', '@fontsource', 'impostor');
    fs.cpSync(path.join(root, 'node_modules', '@fontsource', 'fake-sans'), impostor, {
      recursive: true,
    });
    const mismatch = run(root, 'vendor', 'acme-sans', '@fontsource/impostor', FONT);
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /is @fontsource\/fake-sans, not @fontsource\/impostor/);
    assert.equal(
      fs.existsSync(
        path.join(root, 'packages', 'acme-type', 'packs', 'acme-sans', 'fonts.provenance.json'),
      ),
      false,
    );
    assert.equal(run(root, 'nonsense').status, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
