#!/usr/bin/env node
/**
 * Scaffold a variant package from the fallback composition (#5).
 *
 *   pnpm new-variant <id> [--no-install]
 *   node skills/variant-developer/scripts/new-variant.mjs <id> [--no-install]
 *
 * <id> is the id `site.yml`'s `appearance.variant` selects: a lowercase
 * letter, then 1 to 47 lowercase letters, digits, or hyphens. `fallback` and
 * `missing-variant` are taken. The script:
 *
 *   1. Copies packages/fallback-composition's package.json, tsconfig.json,
 *      manifest.json, src/index.tsx, and src/styles.css to
 *      packages/variant-<id>. Its tests and README stay behind.
 *   2. Names the package @portfolio/variant-<id>, and gives the manifest the
 *      id, a name, a promise and a description to replace, and provenance.
 *   3. Scopes the stylesheet to [data-variant='<id>'], with a class prefix
 *      of its own, and renames the component.
 *   4. Adds the package to @portfolio/web, with
 *      `pnpm --filter @portfolio/web add @portfolio/variant-<id>@workspace:*`,
 *      and runs `pnpm check:variants --package @portfolio/variant-<id>`.
 *      --no-install stops after step 3.
 *
 * Fill out DESIGN.md (skills/variant-developer/assets/DESIGN.template.md)
 * and get it approved before changing any code.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// skills/variant-developer/scripts, three levels below the repository root.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The registry grammar (`@portfolio/variant-contract`'s VARIANT_ID_PATTERN). */
const ID = /^[a-z][a-z0-9-]{1,47}$/;
/** Ids no scaffolded package may take: the fallback's own, and the one fixtures select to reach it. */
const TAKEN = new Set(['fallback', 'missing-variant']);
/** The fallback composition's files a new variant starts from. */
const FILES = ['package.json', 'tsconfig.json', 'manifest.json', 'src/index.tsx', 'src/styles.css'];
/** Class prefixes already in use: the fallback's and the kit's shared renderers'. */
const USED_PREFIXES = new Set(['fc', 'pf']);

export class ScaffoldError extends Error {}

/** `acme-ocean` to `Acme Ocean`. */
export function titleCase(id) {
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** A short class prefix for the id: its parts' initials, or its first part when that's taken. */
export function classPrefix(id) {
  const parts = id.split('-').filter(Boolean);
  const initials = parts.map((part) => part[0]).join('');
  const prefix = initials.length >= 2 ? initials : parts[0];
  return USED_PREFIXES.has(prefix) ? parts[0] : prefix;
}

function replaced(text, from, to, file) {
  if (!text.includes(from)) {
    throw new ScaffoldError(`packages/fallback-composition/${file} no longer has ${from}.`);
  }
  return text.split(from).join(to);
}

/**
 * Copies the fallback composition to packages/variant-<id> under `root` and
 * makes it a variant of its own. Returns the package's name and directory.
 */
export function scaffold({ root = ROOT, id }) {
  if (!ID.test(id)) {
    throw new ScaffoldError(
      `${JSON.stringify(id)} isn't a variant id: a lowercase letter, then 1 to 47 lowercase letters, digits, or hyphens.`,
    );
  }
  if (TAKEN.has(id)) throw new ScaffoldError(`${id} is taken. Pick another id.`);
  const source = path.join(root, 'packages', 'fallback-composition');
  const target = path.join(root, 'packages', `variant-${id}`);
  if (!existsSync(source)) throw new ScaffoldError(`There's no fallback composition at ${source}.`);
  if (existsSync(target)) throw new ScaffoldError(`${target} already exists.`);

  const name = titleCase(id);
  const packageName = `@portfolio/variant-${id}`;
  const prefix = classPrefix(id);
  const read = (file) => readFileSync(path.join(source, file), 'utf8');
  const texts = Object.fromEntries(FILES.map((file) => [file, read(file)]));

  const pkg = JSON.parse(texts['package.json']);
  pkg.name = packageName;
  pkg.version = '0.1.0';
  pkg.description = `${name}: a composition for the portfolio.`;
  // The fallback's tests stay behind, so there's nothing for a test script to run yet.
  pkg.scripts = { typecheck: pkg.scripts.typecheck };
  texts['package.json'] = `${JSON.stringify(pkg, null, 2)}\n`;

  const manifest = JSON.parse(texts['manifest.json']);
  manifest.id = id;
  manifest.name = name;
  manifest.promise = 'Replace this with the composition idea from DESIGN.md, in one sentence.';
  manifest.description =
    'Replace this with what the composition does with the portfolio, from DESIGN.md.';
  manifest.provenance = {
    provisional: true,
    sources: [{ source: 'The fallback composition', disposition: 'preserved' }],
  };
  texts['manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;

  let component = texts['src/index.tsx'];
  component = replaced(
    component,
    'FallbackComposition',
    `${name.replace(/ /g, '')}Composition`,
    'src/index.tsx',
  );
  component = replaced(component, '"fc-', `"${prefix}-`, 'src/index.tsx');
  // Its opening comment describes the fallback; a new variant's says where it came from.
  component = component.replace(
    /\n(\/\/ The fallback composition \(#5\)[^\n]*\n(?:\/\/[^\n]*\n)*)/,
    `\n// ${name}, scaffolded from the fallback composition (#5): every section in\n// content order through the kit's shared renderers, until DESIGN.md says\n// otherwise. Composition only: color, type, and motion timing are #19's.\n`,
  );
  texts['src/index.tsx'] = component;

  let styles = texts['src/styles.css'];
  styles = replaced(
    styles,
    "[data-variant='fallback']",
    `[data-variant='${id}']`,
    'src/styles.css',
  );
  styles = replaced(styles, '.fc-', `.${prefix}-`, 'src/styles.css');
  styles = styles.replace(
    /^\/\*[\s\S]*?\*\/\n/,
    `/*\n * ${name}'s layout. Composition only: spacing and arrangement, with color,\n * type, and motion left to #19's appearance axes. Every rule sits under\n * [data-variant='${id}'], and every property is logical.\n */\n`,
  );
  texts['src/styles.css'] = styles;

  for (const file of FILES) {
    mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
    writeFileSync(path.join(target, file), texts[file]);
  }
  return { packageName, dir: target };
}

/** Runs pnpm in the repository, with its output on this terminal. */
function pnpm(root, args) {
  console.log(`$ pnpm ${args.join(' ')}`);
  return spawnSync('pnpm', args, { cwd: root, stdio: 'inherit' }).status ?? 1;
}

function main(argv) {
  const args = argv.filter((arg) => arg !== '--no-install');
  if (args.length !== 1 || args[0].startsWith('--')) {
    console.error('usage: pnpm new-variant <id> [--no-install]');
    return 2;
  }
  let created;
  try {
    created = scaffold({ id: args[0] });
  } catch (error) {
    if (!(error instanceof ScaffoldError)) throw error;
    console.error(`error: ${error.message}`);
    return 1;
  }
  console.log(`created ${path.relative(ROOT, created.dir)}/`);
  if (argv.includes('--no-install')) {
    console.log(`next: pnpm --filter @portfolio/web add ${created.packageName}@workspace:*`);
  } else {
    const added = pnpm(ROOT, [
      '--filter',
      '@portfolio/web',
      'add',
      `${created.packageName}@workspace:*`,
    ]);
    if (added !== 0) return added;
    const checked = pnpm(ROOT, ['check:variants', '--package', created.packageName]);
    if (checked !== 0) return checked;
  }
  console.log('next: copy skills/variant-developer/assets/DESIGN.template.md to');
  console.log(`  ${path.relative(ROOT, created.dir)}/DESIGN.md, fill it out, and get it approved`);
  console.log('  before changing any code.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
