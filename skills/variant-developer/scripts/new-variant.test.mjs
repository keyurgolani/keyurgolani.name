import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classPrefix, scaffold, ScaffoldError, titleCase } from './new-variant.mjs';

// `pnpm new-variant` (#5, Slice 3, item 9), up to the step that runs pnpm:
// a copy of the fallback composition that's a variant of its own.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FALLBACK = path.join(REPO, 'packages', 'fallback-composition');

/** A scratch repository holding the fallback composition, without its dependencies. */
function repository(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'new-variant-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(FALLBACK, path.join(root, 'packages', 'fallback-composition'), {
    recursive: true,
    filter: (source) => !/node_modules|tsbuildinfo/.test(source),
  });
  return root;
}

test('it copies the fallback composition into a variant of its own', (t) => {
  const root = repository(t);
  const { packageName, dir } = scaffold({ root, id: 'acme-ocean' });
  assert.equal(packageName, '@portfolio/variant-acme-ocean');
  assert.equal(dir, path.join(root, 'packages', 'variant-acme-ocean'));
  const read = (file) => readFileSync(path.join(dir, file), 'utf8');

  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.name, '@portfolio/variant-acme-ocean');
  assert.deepEqual(pkg.portfolio, { kind: 'variant', manifest: './manifest.json' });
  assert.deepEqual(Object.keys(pkg.exports), ['.', './manifest', './styles.css', './package.json']);
  assert.deepEqual(pkg.scripts, { typecheck: 'tsc --noEmit' });

  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.id, 'acme-ocean');
  assert.equal(manifest.name, 'Acme Ocean');
  assert.match(manifest.promise, /^Replace this with the composition idea/);
  assert.deepEqual(manifest.renderedKinds, []);
  assert.deepEqual(manifest.provenance, {
    provisional: true,
    sources: [{ source: 'The fallback composition', disposition: 'preserved' }],
  });

  const component = read('src/index.tsx');
  assert.match(component, /export default function AcmeOceanComposition\(/);
  assert.match(component, /className="ao-main"/);
  assert.match(component, /^\/\/ Acme Ocean, scaffolded from the fallback composition/m);
  assert.doesNotMatch(component, /FallbackComposition|"fc-|A site can't select it/);

  const styles = read('src/styles.css');
  assert.match(styles, /^\/\*\n \* Acme Ocean's layout\./);
  assert.match(
    styles,
    /\[data-variant='acme-ocean'\] \.ao-nav \[data-ui-slot='navigation\.list'\] \{/,
  );
  assert.doesNotMatch(styles, /fallback|\.fc-/);

  // The fallback's tests and README stay behind.
  for (const file of ['README.md', 'src/composition.test.tsx']) {
    assert.equal(existsSync(path.join(dir, file)), false, file);
  }
});

test('it refuses an id that is no registry id, is taken, or is already a package', (t) => {
  const root = repository(t);
  for (const id of ['Acme', 'a', '1-ocean', 'acme_ocean', 'fallback', 'missing-variant']) {
    assert.throws(() => scaffold({ root, id }), ScaffoldError, id);
  }
  scaffold({ root, id: 'acme-ocean' });
  assert.throws(() => scaffold({ root, id: 'acme-ocean' }), /already exists/);
});

test('names and class prefixes come from the id, never colliding with the shared ones', () => {
  assert.equal(titleCase('editorial-evidence'), 'Editorial Evidence');
  assert.equal(classPrefix('editorial-evidence'), 'ee');
  assert.equal(classPrefix('ocean'), 'ocean');
  // pf- is the kit's shared renderers', fc- the fallback's, and host- the host's own.
  assert.equal(classPrefix('paper-folio'), 'paper');
  assert.equal(classPrefix('film-cuts'), 'film');
  // An id whose first part is reserved too takes the whole id.
  assert.equal(classPrefix('pf-folio'), 'pffolio');
  assert.equal(classPrefix('fc-cuts'), 'fccuts');
  // An id that is a reserved prefix takes a v before it.
  assert.equal(classPrefix('pf'), 'vpf');
  assert.equal(classPrefix('fc'), 'vfc');
  assert.equal(classPrefix('host'), 'vhost');
  for (const id of ['pf', 'fc', 'host', 'pf-folio', 'fc-cuts', 'paper-folio', 'film-cuts', 'h-o']) {
    assert.ok(!['pf', 'fc', 'host'].includes(classPrefix(id)), id);
  }
});
