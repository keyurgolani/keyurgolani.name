#!/usr/bin/env node
/**
 * Register a first-party composition in every list that names one (K-9).
 *
 *   pnpm register-variant <id> --family <family> --motion <motion> --tier <tier>
 *     --css <bytes> --js <bytes> --enhancement <bytes> --animation <count>
 *     --promise <sentence> --description <text>
 *     [--image <bytes>] [--font <bytes>] [--name <name>] [--no-install]
 *
 * It scaffolds packages/variant-<id> from the fallback composition when the
 * package is missing (new-variant.mjs), with the family, motion, tier,
 * budgets, promise, and description given, so its manifest carries the
 * composition's own copy, never the scaffold's placeholder, which
 * check:variants refuses (A2), then adds the id to each registration list:
 *
 *   - packages/variant-contract/src/ids.ts: COMPOSITION_IDS and FIRST_PARTY_PINS;
 *   - packages/variant-contract/src/status.ts: COMPOSITION_STATUS, as
 *     `pending`, so it's out of /sample's switch, the recipes, and Studio's
 *     picker until its lane flips it to `ready` (A2);
 *   - apps/web/package.json: the workspace dependency;
 *   - ci/shard-durations.json: a seed weight for the package's unit item;
 *   - quality/units/<id>.ts: a unit with `distinct` and `coverage` pending;
 *   - quality/manual-runs/templates/<id>.voiceover-safari-macos.yml;
 *   - the composition lists in tests/quality/{cells,checklist}.test.ts,
 *     apps/web/scripts/variant-css-budgets.test.ts, and the "this build
 *     registers" messages in apps/web/scripts/config.test.mjs and
 *     skills/portfolio-author/scripts/validate.test.mjs;
 *   - docs/configuration.md, docs/variants.md, and the variant-developer
 *     skill's SKILL.md and references/manifest-contract.md.
 *
 * Then, unless --no-install, it resolves the lockfile offline, refusing and
 * putting it back if anything changed beyond the new package's link and
 * importer, links it with a frozen install, and runs Prettier over what it
 * touched and `pnpm check:variants --package @portfolio/variant-<id>`.
 *
 * It's idempotent: a second run changes nothing, and an existing package or
 * entry is left as it is. Pins, or a manifest whose family, motion, tier,
 * name, or any budget disagrees with the arguments, stop it before it writes
 * anything, naming each field. It refuses an id that
 * isn't a registry id, is reserved (fallback, missing-variant), names a
 * quality surface or the reference variant, or is another package's.
 *
 * tests/variants/distinct.json isn't edited: its thresholds and controls are
 * a calibration's measurements (distinct-calibration.spec.ts), and the
 * guard reads the composition list from the registry.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parse as parseYaml } from 'yaml';
import { scaffold, ScaffoldError, titleCase } from './new-variant.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const ID = /^[a-z][a-z0-9-]{1,47}$/;
/** `@portfolio/variant-contract`'s RESERVED_IDS beyond the compositions, and the fixtures' id. */
const RESERVED = new Set(['fallback', 'missing-variant']);

/** manifest-schema.ts's enums; register-variant.test.mjs holds them to the schema. */
export const FAMILIES = [
  'monograph',
  'kinetic',
  'gallery',
  'bento',
  'sequence',
  'document',
  'custom',
];
export const MOTIONS = ['still', 'subtle', 'kinetic', 'adaptive', 'directed'];
export const TIERS = ['light', 'medium', 'heavy'];
/** The manifest's budget kinds, in the fallback manifest's order. */
export const BUDGET_KINDS = ['js', 'css', 'image', 'font', 'animation', 'enhancement'];
/** What a registration must give, from the brief's budget table. */
const REQUIRED_BUDGETS = ['css', 'js', 'enhancement', 'animation'];
/** The image budget for the stills alone, and fonts, which sit in the typography packs' budgets. */
export const DEFAULT_BUDGETS = { image: 61440, font: 0 };
/**
 * Seconds a new package's unit item weighs until `node ci/shards.mjs measure`
 * measures it. It takes effect once the package has a test script: the
 * scaffold has none, and ci/shards.mjs shards only packages with one.
 */
export const SHARD_SEED = 3;

/** Every file a registration may edit besides the package and the two files it creates. */
export const REGISTRATION_FILES = [
  'packages/variant-contract/src/ids.ts',
  'packages/variant-contract/src/status.ts',
  'apps/web/package.json',
  'ci/shard-durations.json',
  'tests/quality/cells.test.ts',
  'tests/quality/checklist.test.ts',
  'apps/web/scripts/variant-css-budgets.test.ts',
  'apps/web/scripts/config.test.mjs',
  'skills/portfolio-author/scripts/validate.test.mjs',
  'docs/configuration.md',
  'docs/variants.md',
  'skills/variant-developer/SKILL.md',
  'skills/variant-developer/references/manifest-contract.md',
];
/** The files a registration reads and never edits. */
export const SOURCE_FILES = [
  'quality/manual-runs/templates/fallback.voiceover-safari-macos.yml',
  'runtime-budgets.json',
];

export class RegisterError extends Error {}

const unitFile = (id) => `quality/units/${id}.ts`;
const templateFile = (id) => `quality/manual-runs/templates/${id}.voiceover-safari-macos.yml`;

// ---- validation -------------------------------------------------------------

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The manifest ids of every package under packages/, but packages/variant-<id> itself. */
function otherPackageIds(root, id) {
  const ids = new Map();
  const visit = (dir, depth) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      const sub = path.join(dir, entry.name);
      if (path.relative(root, sub) === path.join('packages', `variant-${id}`)) continue;
      const manifest = path.join(sub, 'manifest.json');
      if (existsSync(manifest)) {
        const found = readJson(manifest).id;
        if (typeof found === 'string') ids.set(found, path.relative(root, sub));
      }
      if (depth > 0) visit(sub, depth - 1);
    }
  };
  visit(path.join(root, 'packages'), 1);
  return ids;
}

/** Why `id` can't be a first-party composition here, or null. */
export function idRefusal(root, id) {
  if (typeof id !== 'string' || !ID.test(id)) {
    return `${JSON.stringify(id)} isn't a variant id: a lowercase letter, then 1 to 47 lowercase letters, digits, or hyphens.`;
  }
  if (RESERVED.has(id)) return `${id} is reserved. Pick another id.`;
  const surfaces = path.join(root, 'quality', 'surfaces');
  if (existsSync(surfaces) && readdirSync(surfaces).includes(`${id}.ts`)) {
    return `${id} is a quality surface's id (quality/surfaces/${id}.ts), so its cells and checklist would collide. Pick another id.`;
  }
  const reference = path.join(root, 'tests', 'external-variant', 'manifest.json');
  if (existsSync(reference) && readJson(reference).id === id) {
    return `${id} is the reference variant's id (tests/external-variant). Pick another id.`;
  }
  const taken = otherPackageIds(root, id).get(id);
  if (taken) return `${id} is the id of ${taken}'s manifest. Pick another id.`;
  return null;
}

/**
 * Why `name` can't be the manifest's name, or null: the manifest's rules
 * (plain text on one line, up to 60 characters, no `<` or `>`), and no `*`
 * or backtick, which the Markdown lists it goes into would read as markup.
 */
export function nameRefusal(name) {
  if (typeof name !== 'string' || name.trim() === '') return '--name is empty';
  if (name.trim() !== name) return '--name has spaces at its start or end';
  if (name.length > 60) return `--name is ${name.length} characters, over 60`;
  if (/[\u0000-\u001f\u007f]/.test(name)) return '--name is one line, with no control characters';
  if (/[<>*`]/.test(name)) return '--name has no <, >, *, or backtick';
  return null;
}

/**
 * Why `text` can't be the manifest's `field`, or null: plain text on one
 * line, up to `max` characters, no `<` or `>`, and not the scaffold's
 * placeholder, which check:variants refuses (A2).
 */
export function copyRefusal(field, text, max) {
  if (typeof text !== 'string' || text.trim() === '') return `--${field} is required`;
  if (text.trim() !== text) return `--${field} has spaces at its start or end`;
  if ([...text].length > max) return `--${field} is ${[...text].length} characters, over ${max}`;
  if (/[\u0000-\u001f\u007f]/.test(text))
    return `--${field} is one line, with no control characters`;
  if (/[<>]/.test(text)) return `--${field} has no < or >`;
  if (text.startsWith('Replace this with'))
    return `--${field} is the composition's own, not the scaffold's placeholder`;
  return null;
}

function checkOptions(root, { family, motion, tier, budgets, name, promise, description }) {
  const problems = [];
  if (name !== undefined) {
    const refusal = nameRefusal(name);
    if (refusal) problems.push(refusal);
  }
  for (const refusal of [
    copyRefusal('promise', promise, 140),
    copyRefusal('description', description, 1000),
  ]) {
    if (refusal) problems.push(refusal);
  }
  if (!FAMILIES.includes(family)) problems.push(`--family is one of ${FAMILIES.join(', ')}`);
  if (!MOTIONS.includes(motion)) problems.push(`--motion is one of ${MOTIONS.join(', ')}`);
  if (!TIERS.includes(tier)) problems.push(`--tier is one of ${TIERS.join(', ')}`);
  const full = { ...DEFAULT_BUDGETS, ...budgets };
  for (const kind of REQUIRED_BUDGETS) {
    if (budgets?.[kind] === undefined) problems.push(`--${kind} is required`);
  }
  for (const kind of Object.keys(full)) {
    if (!BUDGET_KINDS.includes(kind)) problems.push(`${kind} is no budget kind`);
    else if (!Number.isInteger(full[kind]) || full[kind] < 0) {
      problems.push(`--${kind} is a whole number, 0 or more`);
    }
  }
  const ceilingsFile = path.join(root, 'runtime-budgets.json');
  if (problems.length === 0 && existsSync(ceilingsFile)) {
    const ceilings = readJson(ceilingsFile).budgets?.tiers?.[tier] ?? {};
    for (const kind of BUDGET_KINDS) {
      if (ceilings[kind] !== undefined && full[kind] > ceilings[kind]) {
        problems.push(
          `--${kind} ${full[kind]} is over the ${tier} tier's ceiling, ${ceilings[kind]}`,
        );
      }
    }
  }
  if (problems.length > 0) throw new RegisterError(problems.join('; '));
  return Object.fromEntries(BUDGET_KINDS.map((kind) => [kind, full[kind]]));
}

// ---- text edits -------------------------------------------------------------

/** `pattern`'s one match in `text`, or a RegisterError naming the file and what it looked for. */
function match(text, pattern, file, what) {
  const found = pattern.exec(text);
  if (!found) throw new RegisterError(`${file} no longer has ${what}, so it can't be edited.`);
  return found;
}

/** `text` with `found`'s groups after the first replaced by `parts`. */
function splice(text, found, parts) {
  return text.slice(0, found.index) + parts.join('') + text.slice(found.index + found[0].length);
}

const quoted = (body) => [...body.matchAll(/'([^'\n]*)'/g)].map((each) => each[1]);
const sorted = (items) => [...items].sort();

function idsTs(text, { id, tier, motion }, file) {
  const list = match(
    text,
    /(export const COMPOSITION_IDS = \[\n)((?: {2}'[a-z0-9-]+',\n)*)(\] as const;)/,
    file,
    'the COMPOSITION_IDS array',
  );
  if (!quoted(list[2]).includes(id)) {
    text = splice(text, list, [list[1], list[2], `  '${id}',\n`, list[3]]);
  }
  const pins = match(
    text,
    /(export const FIRST_PARTY_PINS: [\s\S]*?\n> = \{\n)((?: {2}(?:'[a-z0-9-]+'|[a-z][a-z0-9]*): \{ performanceTier: '[a-z]+', motionIntent: '[a-z]+' \},\n)*)(\};)/,
    file,
    'the FIRST_PARTY_PINS map, one line a composition',
  );
  const line = new RegExp(
    `^ {2}'?${id}'?: \\{ performanceTier: '([a-z]+)', motionIntent: '([a-z]+)' \\},$`,
    'm',
  ).exec(pins[2]);
  if (line && (line[1] !== tier || line[2] !== motion)) {
    throw new RegisterError(
      `${file} pins ${id} to ${line[1]} and ${line[2]}, not ${tier} and ${motion}. Change the pin by hand if the design changed.`,
    );
  }
  if (!line) {
    text = splice(text, pins, [
      pins[1],
      pins[2],
      `  '${id}': { performanceTier: '${tier}', motionIntent: '${motion}' },\n`,
      pins[3],
    ]);
  }
  return text;
}

function statusTs(text, { id }, file) {
  const map = match(
    text,
    /(export const COMPOSITION_STATUS: [\s\S]*?\n> = \{\n|export const COMPOSITION_STATUS: Readonly<Record<string, CompositionStatus>> = \{\n)((?: {2}(?:'[a-z0-9-]+'|[a-z][a-z0-9]*): '(?:pending|ready)',\n)*)(\};)/,
    file,
    'the COMPOSITION_STATUS map, one line a composition',
  );
  // An id already listed keeps its status: its lane's, whichever it is.
  if (new RegExp(`^ {2}'?${id}'?: `, 'm').test(map[2])) return text;
  return splice(text, map, [map[1], map[2], `  '${id}': 'pending',\n`, map[3]]);
}

function webPackageJson(text, { id }) {
  const pkg = JSON.parse(text);
  const name = `@portfolio/variant-${id}`;
  if (pkg.dependencies?.[name]) return text;
  const dependencies = { ...pkg.dependencies, [name]: 'workspace:*' };
  pkg.dependencies = Object.fromEntries(
    Object.keys(dependencies)
      .sort()
      .map((key) => [key, dependencies[key]]),
  );
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function shardDurations(text, { id }) {
  const durations = JSON.parse(text);
  const key = `pkg:packages/variant-${id}`;
  if (durations.unit?.[key] !== undefined) return text;
  const unit = { ...durations.unit, [key]: SHARD_SEED };
  durations.unit = Object.fromEntries(
    Object.keys(unit)
      .sort()
      .map((each) => [each, unit[each]]),
  );
  return `${JSON.stringify(durations, null, 2)}\n`;
}

function cellsTest(text, { id }, file) {
  const plan = match(
    text,
    /(assert\.deepEqual\(ids\.sort\(\), \[\n)((?: {4}'[^'\n]*',\n)+)( {2}\]\);)/,
    file,
    "the PR plan's sorted cell ids",
  );
  const cells = quoted(plan[2]);
  const cell = `${id} complete / system`;
  if (!cells.includes(cell)) {
    const body = sorted([...cells, cell])
      .map((each) => `    '${each}',\n`)
      .join('');
    text = splice(text, plan, [plan[1], body, plan[3]]);
  }
  const targets = match(
    text,
    /(assert\.deepEqual\(plan\.targets, \[\n)((?: {4}\{ kind: '[a-z]+', id: '[a-z0-9-]+' \},\n)+)( {2}\]\);)/,
    file,
    "the PR plan's targets",
  );
  const entries = [...targets[2].matchAll(/kind: '([a-z]+)', id: '([a-z0-9-]+)'/g)].map(
    ([, kind, each]) => ({ kind, id: each }),
  );
  if (!entries.some((each) => each.kind === 'composition' && each.id === id)) {
    entries.push({ kind: 'composition', id });
    entries.sort((a, b) => (a.kind + ' ' + a.id < b.kind + ' ' + b.id ? -1 : 1));
    const body = entries
      .map((each) => `    { kind: '${each.kind}', id: '${each.id}' },\n`)
      .join('');
    text = splice(text, targets, [targets[1], body, targets[3]]);
  }
  return text;
}

function checklistTest(text, { id }, file) {
  const list = match(
    text,
    /(assert\.deepEqual\(compositions, \[\n)((?: {4}'[a-z0-9-]+',\n)+)( {2}\]\);)/,
    file,
    'the registered compositions',
  );
  const before = quoted(list[2]);
  if (before.includes(id)) return text;
  const after = sorted([...before, id]);
  text = splice(text, list, [list[1], after.map((each) => `    '${each}',\n`).join(''), list[3]]);
  const message = `, ${before.join(', ')}\\.`;
  if (text.split(message).length !== 2) {
    throw new RegisterError(
      `${file} no longer names ${before.join(', ')} once in "Registered: ...".`,
    );
  }
  return text.replace(message, `, ${after.join(', ')}\\.`);
}

function cssBudgetsTest(text, { id }, file) {
  const list = match(
    text,
    /( {2}\/\/ The fallback and the first-party compositions at least\.\n {2}for \(const id of \[\n)((?: {4}'[a-z0-9-]+',\n)+)( {2}\]\) \{)/,
    file,
    'the list of compositions it measures',
  );
  const ids = quoted(list[2]);
  if (ids.includes(id)) return text;
  const rest = sorted([...ids.filter((each) => each !== 'fallback'), id]);
  const body = ['fallback', ...rest].map((each) => `    '${each}',\n`).join('');
  return splice(text, list, [list[1], body, list[3]]);
}

/** The "select one this build registers: a, b." messages, each with the id in order. */
function registersMessage(text, { id }, file) {
  const pattern = /(select one this build registers: )([a-z0-9-]+(?:, [a-z0-9-]+)*)(\.)/g;
  if (!pattern.test(text)) {
    throw new RegisterError(`${file} no longer has "select one this build registers: ...".`);
  }
  return text.replace(pattern, (_, head, list, tail) => {
    const ids = list.split(', ');
    return ids.includes(id)
      ? `${head}${list}${tail}`
      : `${head}${sorted([...ids, id]).join(', ')}${tail}`;
  });
}

function configurationDoc(text, { id }, file) {
  const found = match(
    text,
    /(This build registers )(`[a-z0-9-]+`[^\n]*?)(and the fallback composition)/,
    file,
    '"This build registers ... and the fallback composition"',
  );
  const named = [...found[2].matchAll(/`([a-z0-9-]+)`/g)];
  if (named.some((each) => each[1] === id)) return text;
  const next = named.find((each) => each[1] > id);
  const at = next ? next.index : found[2].length;
  const list = `${found[2].slice(0, at)}\`${id}\`, ${found[2].slice(at)}`;
  return splice(text, found, [found[1], list, found[3]]);
}

function variantsDoc(text, { id, name, family, motion, tier }, file) {
  const section = match(
    text,
    /(## The first-party compositions\n\n[^\n]*\n\n)((?:- \*\*[^*\n]+\*\* \([^\n]*\n)+)/,
    file,
    'the first-party compositions list',
  );
  if (section[2].includes(`(\`packages/variant-${id}\``)) return text;
  const bullets = section[2].split('\n').filter(Boolean);
  bullets.push(
    `- **${name}** (\`packages/variant-${id}\`): \`${family}\`, \`${motion}\`, and \`${tier}\`, scaffolded from the fallback composition. Its lane replaces this line with what it does.`,
  );
  const nameOf = (line) => /^- \*\*([^*]+)\*\*/.exec(line)[1];
  bullets.sort((a, b) => (nameOf(a) < nameOf(b) ? -1 : 1));
  return splice(text, section, [section[1], `${bullets.join('\n')}\n`]);
}

function skillDoc(text, { id, name, family, motion, tier }, file) {
  const block = match(
    text,
    /(Reference packages:\n\n(?:- \*\*`[^`]+`\*\*:[^\n]*\n)*?)((?:- \*\*`packages\/variant-[^`]+`\*\*:[^\n]*\n)+)/,
    file,
    "the reference packages' list of compositions",
  );
  if (block[2].includes(`- **\`packages/variant-${id}\`**`)) return text;
  const line = `- **\`packages/variant-${id}\`**: ${name}, a first-party composition, \`${family}\`, \`${motion}\`, and \`${tier}\`, scaffolded from the fallback composition. Its lane replaces this line with what it does.\n`;
  return splice(text, block, [block[1], block[2], line]);
}

function manifestContractDoc(text, { id, tier, motion }, file) {
  const reserved = match(
    text,
    /(the first-party composition ids in `COMPOSITION_IDS` \()([^)]*)(\))/,
    file,
    'the reserved composition ids',
  );
  const ids = [...reserved[2].matchAll(/`([a-z0-9-]+)`/g)].map((each) => each[1]);
  if (!ids.includes(id)) {
    text = splice(text, reserved, [reserved[1], `${reserved[2]}, \`${id}\``, reserved[3]]);
  }
  const pins = match(
    text,
    /(`FIRST_PARTY_PINS` in `packages\/variant-contract\/src\/ids\.ts`:\n\n)((?:- `[a-z0-9-]+`: [a-z]+ and [a-z]+\n)+)/,
    file,
    'the pinned values list',
  );
  const line = new RegExp(`^- \`${id}\`: ([a-z]+) and ([a-z]+)$`, 'm').exec(pins[2]);
  if (line && (line[1] !== tier || line[2] !== motion)) {
    throw new RegisterError(
      `${file} pins ${id} to ${line[1]} and ${line[2]}, not ${tier} and ${motion}.`,
    );
  }
  if (!line) text = splice(text, pins, [pins[1], `${pins[2]}- \`${id}\`: ${tier} and ${motion}\n`]);
  return text;
}

const EDITS = {
  'packages/variant-contract/src/ids.ts': idsTs,
  'packages/variant-contract/src/status.ts': statusTs,
  'apps/web/package.json': webPackageJson,
  'ci/shard-durations.json': shardDurations,
  'tests/quality/cells.test.ts': cellsTest,
  'tests/quality/checklist.test.ts': checklistTest,
  'apps/web/scripts/variant-css-budgets.test.ts': cssBudgetsTest,
  'apps/web/scripts/config.test.mjs': registersMessage,
  'skills/portfolio-author/scripts/validate.test.mjs': registersMessage,
  'docs/configuration.md': configurationDoc,
  'docs/variants.md': variantsDoc,
  'skills/variant-developer/SKILL.md': skillDoc,
  'skills/variant-developer/references/manifest-contract.md': manifestContractDoc,
};

// ---- created files ----------------------------------------------------------

/** A new composition's quality unit: the fallback's high-contrast exclusion, and both pendings. */
export function unitSource(name) {
  return `// ${name}'s quality unit (#11, Slice 1, item 4), from pnpm register-variant. As
// for the fallback composition: under read-only a site page takes the
// visitor's display mode from the preference cookie (#19, Slice 4), never
// from the query the high-contrast row sets, so the row can't take there, and
// fails closed as an ignored emulation. The display-mode cells publish
// high-contrast in the site document instead. Remove this once the row sets
// the cookie.
import type { NotApplicable } from '../../tests/quality/lib/registration';

export const notApplicable: readonly NotApplicable[] = [
  {
    match: { row: 'high-contrast' },
    reason:
      "Under read-only a site page reads the visitor's display mode from the preference cookie, not the query the row sets; the display-mode cells publish high-contrast in the site document, and the primitives run in it through the tuples that publish it.",
  },
];

// Pending its redesign (Design gate rule 5): the distinct design guards report this
// composition's pairs with other pending ones and fail none of them, and
// fail it as stale once it differs from every other. Its lane removes this
// line when its home slice passes design review.
export const distinct = 'pending';

// Pending its phase 2: it still renders some core
// kinds through the kit's shared renderers, or hands its case-study page to
// the fallback, so check:variants and the outline sweep report those instead
// of failing it. Its lane removes this line once it renders every core kind
// itself and its own case-study page.
export const coverage = 'pending';
`;
}

/**
 * The VoiceOver with Safari template, as `pnpm quality:checklist -- <id>
 * --record` prints it for a unit with no interactions or primary actions:
 * the fallback's, with its id. tests/quality/checklist.test.ts holds every
 * committed template to the generator's output.
 */
export function templateSource(root, id) {
  const fallback = readFileSync(path.join(root, SOURCE_FILES[0]), 'utf8');
  return fallback.replace(/\bfallback\b/g, id);
}

// ---- the registration -------------------------------------------------------

/**
 * Registers `id` under `root`: scaffolds packages/variant-<id> if it's
 * missing, and adds it to every registration list. Every edit is worked out
 * before any file is written, so a list that can't be edited stops it with
 * nothing changed. Returns the files it changed or created, relative to
 * `root`, sorted, and whether it scaffolded the package.
 */
export function register({
  root = ROOT,
  id,
  family,
  motion,
  tier,
  budgets,
  name,
  promise,
  description,
}) {
  const refusal = idRefusal(root, id);
  if (refusal) throw new RegisterError(refusal);
  const full = checkOptions(root, { family, motion, tier, budgets, name, promise, description });

  const dir = path.join(root, 'packages', `variant-${id}`);
  const manifestPath = path.join(dir, 'manifest.json');
  const exists = existsSync(dir);
  let displayName = name;
  if (exists) {
    if (!existsSync(manifestPath)) throw new RegisterError(`${dir} has no manifest.json.`);
    const manifest = readJson(manifestPath);
    const pkg = readJson(path.join(dir, 'package.json'));
    // Every value the arguments set, so an existing manifest never silently keeps another.
    const differs = (field, actual, wanted) =>
      actual !== wanted &&
      `its ${field} is ${actual === undefined ? 'unset' : JSON.stringify(actual)}, not ${JSON.stringify(wanted)}`;
    const wrong = [
      pkg.name !== `@portfolio/variant-${id}` && `its package is ${pkg.name}`,
      manifest.id !== id && `its manifest's id is ${manifest.id}`,
      name !== undefined && differs('name', manifest.name, name),
      differs('promise', manifest.promise, promise),
      differs('description', manifest.description, description),
      differs('compositionFamily', manifest.compositionFamily, family),
      differs('motionIntent', manifest.motionIntent, motion),
      differs('performanceTier', manifest.performanceTier, tier),
      ...BUDGET_KINDS.map((kind) =>
        differs(`budgets.${kind}`, manifest.budgets?.[kind], full[kind]),
      ),
    ].filter(Boolean);
    if (wrong.length > 0) {
      throw new RegisterError(`packages/variant-${id} doesn't match: ${wrong.join(', ')}.`);
    }
    displayName = manifest.name;
  }
  displayName ??= titleCase(id);
  const context = { id, name: displayName, family, motion, tier };

  const writes = new Map();
  for (const file of REGISTRATION_FILES) {
    const at = path.join(root, file);
    if (!existsSync(at)) throw new RegisterError(`${file} is missing.`);
    const before = readFileSync(at, 'utf8');
    const after = EDITS[file](before, context, file);
    if (after !== before) writes.set(file, after);
  }
  if (!existsSync(path.join(root, unitFile(id)))) {
    writes.set(unitFile(id), unitSource(displayName));
  }
  if (!existsSync(path.join(root, templateFile(id)))) {
    writes.set(templateFile(id), templateSource(root, id));
  }

  const touched = [...writes.keys()];
  if (!exists) {
    try {
      scaffold({ root, id });
    } catch (error) {
      if (error instanceof ScaffoldError) throw new RegisterError(error.message);
      throw error;
    }
    const manifest = readJson(manifestPath);
    Object.assign(manifest, {
      name: displayName,
      promise,
      description,
      compositionFamily: family,
      motionIntent: motion,
      performanceTier: tier,
      budgets: full,
    });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const listed = (sub) =>
      readdirSync(path.join(dir, sub), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? listed(path.join(sub, entry.name))
          : [path.join('packages', `variant-${id}`, sub, entry.name)],
      );
    touched.push(...listed(''));
  }
  for (const [file, text] of writes) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return {
    touched: touched.map((file) => file.split(path.sep).join('/')).sort(),
    scaffolded: !exists,
  };
}

// ---- the command ------------------------------------------------------------

/** Runs pnpm in the repository, with its output on this terminal. */
function pnpm(root, args) {
  console.log(`$ pnpm ${args.join(' ')}`);
  return spawnSync('pnpm', args, { cwd: root, stdio: 'inherit' }).status ?? 1;
}

/** pnpm's errors for a package or its metadata missing from the offline cache. */
const OFFLINE_MISS = /ERR_PNPM_NO_OFFLINE_(?:META|TARBALL)/;

/**
 * Runs pnpm `args` offline. Only when the cache lacks a package or its
 * metadata does it run them again with --prefer-offline, which may read the
 * registry's metadata; any other failure stops it there.
 */
function pnpmOffline(root, args) {
  console.log(`$ pnpm ${[...args, '--offline'].join(' ')}`);
  const run = spawnSync('pnpm', [...args, '--offline'], {
    cwd: root,
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  process.stdout.write(run.stdout ?? '');
  process.stderr.write(run.stderr ?? '');
  if (run.status === 0) return 0;
  if (!OFFLINE_MISS.test(`${run.stdout}${run.stderr}`)) return run.status ?? 1;
  return pnpm(root, [...args, '--prefer-offline']);
}

/**
 * The lockfile changes between `before` and `after`, both parsed, besides
 * the two a registration makes: `apps/web`'s link to the new package, and
 * the new package's own importer. Each is a path, such as
 * `packages/react@19.2.5`; none means the install resolved nothing else.
 */
export function lockfileDrift(before, after, id) {
  const name = `@portfolio/variant-${id}`;
  const importer = `packages/variant-${id}`;
  const next = structuredClone(after ?? {});
  const link = next.importers?.['apps/web']?.dependencies?.[name];
  if (
    link?.specifier === 'workspace:*' &&
    link?.version === `link:../../${importer}` &&
    !before?.importers?.['apps/web']?.dependencies?.[name]
  ) {
    delete next.importers['apps/web'].dependencies[name];
  }
  if (next.importers?.[importer] && !before?.importers?.[importer]) delete next.importers[importer];
  const drift = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(next)])) {
    const [a, b] = [before?.[key], next[key]];
    if (same(a, b)) continue;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
      for (const entry of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!same(a[entry], b[entry])) drift.push(`${key}/${entry}`);
      }
    } else drift.push(key);
  }
  return drift.sort();
}

/**
 * Updates the lockfile for the new package and links it. It resolves the
 * lockfile alone first, and puts the old one back, refusing, if anything
 * changed beyond the registration's own two entries, such as drift from an
 * edit already in the tree. Then a frozen install links what it resolved.
 */
function install(root, id) {
  const file = path.join(root, 'pnpm-lock.yaml');
  const before = readFileSync(file, 'utf8');
  const resolved = pnpmOffline(root, ['install', '--lockfile-only']);
  if (resolved !== 0) {
    writeFileSync(file, before);
    return resolved;
  }
  const drift = lockfileDrift(parseYaml(before), parseYaml(readFileSync(file, 'utf8')), id);
  if (drift.length > 0) {
    writeFileSync(file, before);
    console.error(
      `error: the install would change pnpm-lock.yaml beyond @portfolio/variant-${id}'s link and importer, so the lockfile is as it was:`,
    );
    for (const entry of drift) console.error(`  ${entry}`);
    console.error('Commit or undo the change that needs it, then run register-variant again.');
    return 1;
  }
  return pnpmOffline(root, ['install', '--frozen-lockfile']);
}

const USAGE =
  'usage: pnpm register-variant <id> --family <family> --motion <motion> --tier <tier> --css <bytes> --js <bytes> --enhancement <bytes> --animation <count> --promise <sentence> --description <text> [--image <bytes>] [--font <bytes>] [--name <name>] [--no-install]';

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        family: { type: 'string' },
        motion: { type: 'string' },
        tier: { type: 'string' },
        name: { type: 'string' },
        promise: { type: 'string' },
        description: { type: 'string' },
        'no-install': { type: 'boolean' },
        ...Object.fromEntries(BUDGET_KINDS.map((kind) => [kind, { type: 'string' }])),
      },
    });
  } catch (error) {
    console.error(`error: ${error.message}\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  const budgets = {};
  for (const kind of BUDGET_KINDS) {
    if (values[kind] !== undefined)
      budgets[kind] = /^\d+$/.test(values[kind]) ? Number(values[kind]) : NaN;
  }
  let result;
  try {
    result = register({
      id: positionals[0],
      family: values.family,
      motion: values.motion,
      tier: values.tier,
      name: values.name,
      promise: values.promise,
      description: values.description,
      budgets,
    });
  } catch (error) {
    if (!(error instanceof RegisterError)) throw error;
    console.error(`error: ${error.message}`);
    return 1;
  }
  const packageName = `@portfolio/variant-${positionals[0]}`;
  if (result.touched.length === 0)
    console.log(`${positionals[0]} is already registered everywhere.`);
  for (const file of result.touched) console.log(`wrote ${file}`);
  if (values['no-install']) {
    console.log('next: pnpm install --offline, then pnpm exec prettier --write on the files above');
    return 0;
  }
  const installed = install(ROOT, positionals[0]);
  if (installed !== 0) return installed;
  const formatted = result.touched.filter((file) =>
    /\.(?:[cm]?[jt]sx?|json|md|ya?ml|css)$/.test(file),
  );
  if (formatted.length > 0) {
    const status = pnpm(ROOT, ['exec', 'prettier', '--write', ...formatted]);
    if (status !== 0) return status;
  }
  const checked = pnpm(ROOT, ['check:variants', '--package', packageName]);
  if (checked !== 0) return checked;
  // A new id reaches tests far from the lists above (a common word can trip a
  // host-source scan), so the registration isn't done until the whole suite is.
  console.log('next: pnpm -r test, and commit the registration only once it passes.');
  if (result.scaffolded) {
    console.log('next: copy skills/variant-developer/assets/DESIGN.template.md to');
    console.log(`  packages/variant-${positionals[0]}/DESIGN.md, fill it out, and get it approved`);
    console.log('  before changing any code.');
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
