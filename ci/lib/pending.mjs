// Rows the rehearsal (ci/rehearsal.mjs) and the fresh-clone run
// (ci/fresh-clone.mjs) declare before they can run them, and what each
// waits on. A pending row fails its run once what it waits on has landed,
// so none stays pending past it (#12). Pure Node with no dependencies, so
// the fresh-clone run needs no install of its own.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './reports.mjs';

/** The variant ids a build registers but fixtures and fallback, from its generated asset manifest. */
export function registeredVariants(root = REPO_ROOT) {
  const file = path.join(root, 'apps', 'web', 'src', 'lib', 'generated', 'asset-manifest.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  return manifest.units
    .filter((unit) => unit.kind === 'variant' && !unit.fixture && unit.id !== 'fallback')
    .map((unit) => unit.id)
    .sort();
}

/**
 * The composition the sample site selects, the default a new owner starts
 * on: site.example.yml's appearance.variant, read without a YAML parser.
 */
export function defaultComposition(root = REPO_ROOT) {
  const text = readFileSync(path.join(root, 'site.example.yml'), 'utf8');
  const match =
    /^appearance:[^\n]*\n(?:(?:[ \t]+[^\n]*|[ \t]*#[^\n]*|)\n)*?[ \t]+variant:[ \t]*['"]?([\w-]+)/m.exec(
      text,
    );
  if (!match) throw new Error('site.example.yml names no appearance.variant');
  return match[1];
}

/**
 * What each pending row's `waitsOn` means, and how to tell it has landed.
 * `default-composition` goes by what the build does with the bundled sample
 * pair, never by what site.example.yml names: it has landed once
 * `portfolio-store import` publishes the sample (sampleImport()).
 */
export const LANDED = Object.freeze({
  'default-composition': {
    what: 'the bundled sample pair imports: the composition it selects is registered (#13, #111)',
    landed: ({ sampleImports }) => sampleImports === true,
  },
});

/**
 * What a `portfolio-store import` of the bundled sample pair into an empty
 * store says about the default composition: { sampleImports: true } when it
 * published, false when it refused the sample's variant alone, and an
 * `error` for anything else, which fails the run, since then nothing tells
 * whether a pending row can run.
 */
export function sampleImport({ status, out }) {
  if (status === 0 && /^live revision: rev_/m.test(out)) return { sampleImports: true };
  const codes = [...String(out).matchAll(/^\s+\S+: ([a-z_.-]+) \((blocks-[a-z]+)\)/gm)].map(
    (m) => m[1],
  );
  if (status === 1 && codes.length > 0 && codes.every((code) => code === 'variant.unavailable')) {
    return { sampleImports: false };
  }
  return {
    sampleImports: false,
    error: `the sample pair's import exited ${status}, refused for ${codes.join(', ') || 'no record'}, not only variant.unavailable`,
  };
}

/** Problems with pending rows: one per row whose blocker has landed, and one per unknown blocker. */
export function pendingProblems(rows, state) {
  const problems = [];
  for (const row of rows) {
    const blocker = LANDED[row.waitsOn];
    if (!blocker) problems.push(`${row.id} waits on ${row.waitsOn}, which LANDED doesn't define`);
    else if (blocker.landed(state)) {
      problems.push(
        `${row.id} is still pending, but what it waits on has landed: ${blocker.what}. Make it a real row.`,
      );
    }
  }
  return problems;
}
