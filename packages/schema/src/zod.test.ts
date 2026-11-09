import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from './zod';

// The demo's worker, the preview frame, and Studio run under a strict CSP, with
// no 'unsafe-eval'. zod 4 probes for `new Function` when it builds an object
// schema unless it's jitless, and the browser reports the probe as a violation.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = 'packages/schema/src/zod.ts';
/** This file, whose own samples name zod. */
const SELF = 'packages/schema/src/zod.test.ts';
/** Where product code lives: the packages and the app, their tests and scripts too. */
const PRODUCT = ['packages', 'apps'];
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
/** Any import, export-from, dynamic import, or require of zod or a zod subpath. */
const ZOD_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])zod(?:\/[^'"]*)?\1/m;

test('the z product modules import runs jitless, so building a schema never probes eval', () => {
  assert.equal(z.config().jitless, true);
  // A schema built after the import compiles nothing.
  assert.equal(z.object({ a: z.string() }).safeParse({ a: 'b' }).success, true);
  assert.equal(z.config().jitless, true);
});

test('no product source imports zod but the one module that configures it', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--', ...PRODUCT], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(
      (file) =>
        SOURCE.test(file) && file !== MODULE && file !== SELF && !file.includes('/node_modules/'),
    );
  assert.ok(files.length > 100, `only ${files.length} product sources listed`);
  const offenders = files.filter((file) =>
    ZOD_IMPORT.test(readFileSync(path.join(ROOT, file), 'utf8')),
  );
  assert.deepEqual(offenders, [], 'these import zod directly; import z from @portfolio/schema/zod');
});

test('a bundler keeps the config: the package names zod.ts in sideEffects', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, 'packages/schema/package.json'), 'utf8'),
  ) as { sideEffects?: unknown };
  assert.ok(
    Array.isArray(manifest.sideEffects) && manifest.sideEffects.includes('./src/zod.ts'),
    `sideEffects is ${JSON.stringify(manifest.sideEffects)}`,
  );
});

test('the scan catches every form of a zod import, and not a mention', () => {
  for (const form of [
    "import { z } from 'zod';",
    'import { z } from "zod/v4";',
    "import type { ZodType } from 'zod/v4/core';",
    "export { z } from 'zod/mini';",
    "const { z } = await import('zod');",
    "const { z } = require('zod');",
    "import 'zod';",
  ]) {
    assert.ok(ZOD_IMPORT.test(form), form);
  }
  for (const mention of [
    "import { z } from './zod';",
    "import { z } from '@portfolio/schema/zod';",
    "import { z } from 'zod-validation-error';",
    '// zod 4 builds a fast path',
  ]) {
    assert.ok(!ZOD_IMPORT.test(mention), mention);
  }
});
