import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { auditedFiles, variantPackageDirs } from '@portfolio/appearance/node';
import { generateRegistry, REPO_ROOT } from './registry-options';

// What the appearance source audit reads (#19, Slice 5): every variant
// package registry generation can register, under any fixture flag, is one
// of the packages the audit finds, and the audit finds no other but one
// @portfolio/web doesn't depend on yet, such as Editorial Evidence until #13
// registers it. Each file a variant's stylesheet compiles from is one the
// audit reads, so a skipped directory never hides a stylesheet.

const real = (file: string) => fs.realpathSync(file);

/** The variants generation registers with `flags`, and nothing written. */
async function registered(flags: Record<string, string>) {
  const env = { ...process.env } as Record<string, string | undefined>;
  for (const name of Object.keys(env)) if (/_FIXTURES$/.test(name)) delete env[name];
  const { result } = await generateRegistry({ ...env, ...flags }, { write: false });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.variants;
}

test("the audit's variant packages are the ones generation registers, and it reads every file their stylesheets compile from", async () => {
  const runs = await Promise.all([
    registered({}),
    registered({ BUDGET_FIXTURES: '1', PREVIEW_FIXTURES: '1', APPEARANCE_FIXTURES: '1' }),
    registered({ BUDGET_FIXTURES: 'over' }),
  ]);
  const variants = runs.flat();
  const audited = variantPackageDirs(path.join(REPO_ROOT, 'packages')).map(real).sort();
  const registeredDirs = new Set(variants.map(({ dir }) => real(dir)));
  for (const dir of registeredDirs) assert.ok(audited.includes(dir), `the audit misses ${dir}`);
  const { dependencies = {}, devDependencies = {} } = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'apps', 'web', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  for (const dir of audited.filter((each) => !registeredDirs.has(each))) {
    const { name } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      name: string;
    };
    assert.ok(
      !(name in dependencies) && !(name in devDependencies),
      `${name} is a dependency of @portfolio/web that no run registers`,
    );
  }
  assert.ok(registeredDirs.size >= 5, [...registeredDirs].join(' '));
  for (const variant of variants) {
    const dir = real(variant.dir);
    const read = new Set(auditedFiles(dir).map(real));
    // The stylesheets it compiles from, not the images they name.
    const inputs = variant.stylesheetInputs.filter(
      (file) => file.endsWith('.css') && real(file).startsWith(`${dir}${path.sep}`),
    );
    assert.ok(
      inputs.length > 0,
      `${variant.manifest.id} compiles its stylesheet from its own files`,
    );
    for (const input of inputs) {
      assert.ok(read.has(real(input)), `${variant.manifest.id}: the audit skips ${input}`);
    }
  }
});
