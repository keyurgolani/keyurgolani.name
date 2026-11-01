#!/usr/bin/env node
// pnpm check:budgets (#6, items 3 and 4): holds every unit the build
// registers, each variant and appearance pack in ASSET_MANIFEST, to the
// budgets its manifest declares and the ceilings runtime-budgets.json sets,
// in six kinds: JS, CSS, image, font, animation, and enhancement
// (ci/lib/budgets.mjs says how each is measured). It reads the build output
// in apps/web, the asset manifest registry generation wrote beside it, and
// the report pnpm test:trace wrote, so run it after both, on a build with
// source maps. It also fails a unit stylesheet with a remote @import or
// url(), and a /_portfolio/ file a traced page loaded that no unit lists.
// Each typography that ships fonts gets a sample page line: an estimate of
// the font bytes a page loads under it, by the unicode-range of a traced
// page's text when the trace recorded one under it, else its Latin faces.
// That line is its font gate (R4); the bytes it ships in all are reported
// and never fail (docs/appearance.md, "Shipping fonts").
//
// It writes reports/budgets/budget-report.json, every unit and kind it
// checked with the records it found, and under ci/run.mjs one failure
// record per breach. It exits 1 on a breach, and 2 when an input is
// missing.
//
//   node ci/check-budgets.mjs [--trace <trace-report.json>]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attributeChunk,
  gzipBytes,
  sourceMapUrl,
  workspacePackages,
} from '../tests/harness/trace/attribution.mjs';
import {
  BUDGET_KINDS,
  checkBudgets,
  STUDIO_ASSETS,
  failureFields,
  label,
  reportRecord,
  reproCommand,
} from './lib/budgets.mjs';
import {
  currentGate,
  REPO_ROOT,
  reportError,
  reportsDir,
  writeFailureRecord,
} from './lib/reports.mjs';

export const WEB = path.join(REPO_ROOT, 'apps', 'web');
export const ASSET_MANIFEST = path.join(WEB, 'src', 'lib', 'generated', 'asset-manifest.json');
export const RUNTIME_BUDGETS = path.join(REPO_ROOT, 'runtime-budgets.json');
export const STATIC_DIR = path.join(WEB, '.next', 'static');
export const PUBLIC_DIR = path.join(WEB, 'public');
/** The typography picker's stills (P-5), as `pnpm stills:type` committed them. */
export const TYPE_STILLS_RECORD = path.join(WEB, 'studio-stills', 'type', 'stills.json');

/** A still's served name, as apps/web/src/lib/studio/type-stills.ts's servedStillName() gives it. */
export const servedStillName = ({ pack, role, sha256 }) =>
  `${pack}-${role}.${sha256.slice(0, 12)}.png`;

/**
 * Studio's own stills, each at the URL the build serves it at with its
 * bytes in the build's public/_portfolio/studio/, null when the build
 * lacks it. None when nothing is committed.
 *
 * @param {{ stills?: { pack: string, role: string, sha256: string }[] } | null} record
 * @param {(name: string) => number | null} sizeOf a served file's bytes, null when it's missing
 */
export function studioAssets(record = readRecord(), sizeOf = servedSize) {
  return (record?.stills ?? []).map((still) => {
    const name = servedStillName(still);
    return { url: `${STUDIO_ASSETS}${name}`, bytes: sizeOf(name) };
  });
}

/** The committed record, or null when there's none. */
function readRecord(file = TYPE_STILLS_RECORD) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/** A served Studio file's bytes in the build's public/, or null when it's missing. */
function servedSize(name) {
  try {
    return readFileSync(path.join(PUBLIC_DIR, '_portfolio', 'studio', name)).length;
  } catch {
    return null;
  }
}

/** Where the report goes, under the reports root CI uploads. */
export const reportFile = () => path.join(reportsDir(), 'budgets', 'budget-report.json');
const traceFile = () => path.join(reportsDir(), 'trace', 'trace-report.json');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Every .js file under `dir`, relative to it, sorted. */
function scripts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

/**
 * The file each of a package's enhancement exports resolves to, as the
 * package.json the host installed declares it: a subpath's target, or its
 * `import` or `default` condition's.
 */
export function enhancementEntries(unit, web = WEB) {
  if (!unit.enhancements?.length) return {};
  let exports = {};
  try {
    ({ exports = {} } = readJson(path.join(web, 'node_modules', unit.packageName, 'package.json')));
  } catch {
    // A package the host can't read resolves no export.
  }
  const target = (value) => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') return target(value.import ?? value.default);
    return null;
  };
  return Object.fromEntries(
    unit.enhancements.map((enhancement) => [
      enhancement.id,
      target(exports?.[enhancement.export]) ?? null,
    ]),
  );
}

/**
 * Each async chunk group the build's loaders name: the chunks one dynamic
 * import loads together, as Turbopack writes its loader,
 * `Promise.all(["static/chunks/a.js", "static/chunks/b.js"].map(...))`,
 * each as the path it's served at.
 *
 * @param {string} code a chunk's text
 * @returns {string[][]}
 */
export function asyncGroups(code) {
  const groups = [];
  for (const [, list] of code.matchAll(
    /Promise\.all\(\[((?:\s*["']static\/chunks\/[^"']+["']\s*,?)+)\]\s*\.map\(/g,
  )) {
    groups.push(
      [...list.matchAll(/["'](static\/chunks\/[^"']+)["']/g)].map(([, chunk]) => `/_next/${chunk}`),
    );
  }
  return groups;
}

/**
 * The build's chunks that hold an enhancement, attributed through their
 * source maps: each JS chunk under `staticDir` whose map names one of
 * `files`, and every other chunk of the async group a loader loads it
 * with, so a library split into a chunk of its own still counts. A chunk
 * that holds an entry lists its group's others in `loadedWith`. A group's
 * chunk with no map still counts, whole: its gzip bytes as one module no
 * package claims, so a chunk the check can't attribute fails closed.
 *
 * @param {string[]} files the enhancement entries, as their packages name them
 */
export function buildChunks(files, staticDir = STATIC_DIR) {
  const suffixes = files.filter(Boolean).map((file) => `/${file.replace(/^\.\//, '')}`);
  if (suffixes.length === 0) return [];
  const workspace = workspacePackages(REPO_ROOT);
  const all = scripts(path.join(staticDir, 'chunks')).map((file) => {
    const full = path.join(staticDir, 'chunks', file);
    const code = readFileSync(full, 'utf8');
    const served = `/_next/static/chunks/${file.split(path.sep).join('/')}`;
    const named = sourceMapUrl(code, `http://build.invalid/_next/static/chunks/${file}`);
    const mapFile = named?.startsWith('http://build.invalid/')
      ? path.join(staticDir, '..', decodeURI(new URL(named).pathname).replace(/^\/_next\//, ''))
      : `${full}.map`;
    let map = null;
    try {
      if (existsSync(mapFile)) map = readJson(mapFile);
    } catch {
      map = null;
    }
    return { served, code, map };
  });
  const holds = ({ map }) => {
    if (!map) return false;
    const sources = [
      ...(map.sources ?? []),
      ...(map.sections ?? []).flatMap((section) => section.map?.sources ?? []),
    ];
    return sources.some((source) => suffixes.some((suffix) => source.endsWith(suffix)));
  };
  const groups = all.flatMap(({ code }) => asyncGroups(code));
  const byPath = new Map(all.map((chunk) => [chunk.served, chunk]));
  const attribute = ({ served, code, map }) =>
    map
      ? { path: served, ...attributeChunk({ url: served, code, map, workspace }) }
      : {
          path: served,
          gzipBytes: gzipBytes(code),
          modules: [{ source: served, package: null, gzipBytes: gzipBytes(code) }],
        };
  const found = new Map();
  for (const chunk of all.filter(holds)) {
    const others = [
      ...new Set(
        groups
          .filter((group) => group.includes(chunk.served))
          .flat()
          .filter((other) => other !== chunk.served && byPath.has(other)),
      ),
    ];
    // A holding chunk no group names: the loader's text wasn't read, and the check says so.
    const ungrouped = !groups.some((group) => group.includes(chunk.served));
    found.set(chunk.served, {
      ...attribute(chunk),
      loadedWith: others,
      ...(ungrouped ? { ungrouped: true } : {}),
    });
    for (const other of others) {
      if (!found.has(other)) found.set(other, attribute(byPath.get(other)));
    }
  }
  return [...found.values()];
}

/**
 * The chunks a variant's page loads statically, by the path each is served
 * at: every entry's in the client reference manifest the build writes for
 * its experience segment, and the root's own, from build-manifest.json.
 * Null when the build has no such manifest, so its statics aren't known.
 *
 * @param {string} id the variant's id
 * @returns {Set<string> | null}
 */
export function staticChunks(id, web = WEB) {
  const next = path.join(web, '.next');
  const manifest = path.join(
    next,
    'server',
    'app',
    '(site)',
    '_experience',
    id,
    '[[...route]]',
    'page_client-reference-manifest.js',
  );
  let entryJSFiles;
  try {
    // globalThis.__RSC_MANIFEST["…/page"] = {…};
    const text = readFileSync(manifest, 'utf8');
    const json = text.slice(text.indexOf('] = ') + 4).replace(/;\s*$/, '');
    ({ entryJSFiles } = JSON.parse(json));
  } catch {
    return null;
  }
  if (!entryJSFiles || typeof entryJSFiles !== 'object') return null;
  let root = [];
  try {
    const build = readJson(path.join(next, 'build-manifest.json'));
    root = [...(build.rootMainFiles ?? []), ...(build.polyfillFiles ?? [])];
  } catch {
    // No build manifest: the segment's entries alone.
  }
  return new Set(
    [...Object.values(entryJSFiles).flat(), ...root]
      .filter((file) => typeof file === 'string' && file.startsWith('static/'))
      .map((file) => `/_next/${file}`),
  );
}

/** A stylesheet's text from the build's public/ tree, by the URL it's served at. */
export function publicStylesheet(publicDir = PUBLIC_DIR) {
  return (url) => {
    const file = path.join(publicDir, ...url.split('/').filter(Boolean));
    if (!file.startsWith(publicDir + path.sep)) return null;
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };
}

const kb = (bytes) => (bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`);
const amount = (metric, value) =>
  value === null || value === undefined ? 'none' : metric === 'animation' ? `${value}` : kb(value);

/**
 * A typography's sample page line: the font bytes a page loads under it,
 * by the traced page's text or, with no text traced, its Latin faces.
 */
/**
 * A checked row's line. A typography's shipped font total, which its
 * sample page line gates in its place (R4), reads `info`, never OVER.
 */
export function checkedLine(row) {
  const over = row.limit !== null && row.actual > row.limit;
  const status = row.gated === false ? 'info' : over ? 'OVER' : 'ok  ';
  return (
    `[budgets] ${status} ${row.kind} ${row.id} ${row.metric}` +
    `${row.kind === 'studio' ? (row.total ? ' in all' : ` ${row.assets[0]?.asset ?? ''}`) : ''}` +
    `${row.gated === false ? ' shipped in all, reported' : ''}` +
    `${row.enhancement ? ` (${row.enhancement})` : ''}${row.route ? ` on ${row.route}` : ''}: ` +
    `${amount(row.metric, row.actual)} of ${amount(row.metric, row.limit)} (${row.limitFrom})`
  );
}

export function sampleLine(row) {
  const over = row.limit !== null && row.actual > row.limit;
  const basis =
    row.basis === 'text'
      ? `estimated by the text of ${row.route ?? 'a traced page'}`
      : 'estimated as its Latin faces';
  return (
    `[budgets] ${over ? 'OVER' : 'ok  '} ${row.kind} ${row.id} font on a sample page (${basis}, ` +
    `${row.assets.length} file${row.assets.length === 1 ? '' : 's'}): ` +
    `${amount('font', row.actual)} of ${amount('font', row.limit)} (${row.limitFrom})`
  );
}

function parseArgs(argv) {
  const options = { trace: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--trace' && argv[i + 1]) options.trace = path.resolve(argv[(i += 1)]);
    else throw new Error(`unknown argument ${argv[i]}; the one option is --trace <file>`);
  }
  return options;
}

function main(argv, env = process.env) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`[budgets] ${error.message}`);
    return 2;
  }
  const trace = options.trace ?? traceFile();
  const inputs = [
    [ASSET_MANIFEST, 'run pnpm build'],
    [RUNTIME_BUDGETS, 'restore it from git'],
    [STATIC_DIR, 'run pnpm build'],
    [trace, 'run pnpm test:trace'],
  ];
  for (const [file, fix] of inputs) {
    if (!existsSync(file)) {
      reportError(`[budgets] no ${path.relative(REPO_ROOT, file)}: ${fix} first.`, {
        title: 'budgets',
      });
      return 2;
    }
  }
  const manifest = readJson(ASSET_MANIFEST);
  const { budgets: ceilings } = readJson(RUNTIME_BUDGETS);
  const report = readJson(trace);
  const entries = new Map(manifest.units.map((unit) => [unit, enhancementEntries(unit)]));
  const chunks = buildChunks([...entries.values()].flatMap((byId) => Object.values(byId)));
  const { records, checked, samples } = checkBudgets({
    units: manifest.units,
    platform: manifest.platform ?? null,
    ceilings,
    trace: report,
    chunks,
    entries: (unit) => entries.get(unit) ?? {},
    statics: (unit) => staticChunks(unit.id),
    stylesheet: publicStylesheet(),
    studio: studioAssets(),
  });

  const out = reportFile();
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        version: 1,
        tool: 'pnpm check:budgets',
        generatedAt: new Date().toISOString(),
        inputs: {
          assetManifest: path.relative(REPO_ROOT, ASSET_MANIFEST),
          trace: path.relative(REPO_ROOT, trace),
          traceCommand: report.command ?? null,
          traceFailures: report.failures ?? [],
          build: path.relative(REPO_ROOT, STATIC_DIR),
        },
        kinds: BUDGET_KINDS,
        units: manifest.units.map((unit) => ({
          kind: unit.kind,
          id: unit.id,
          package: unit.packageName,
          ...(unit.performanceTier ? { performanceTier: unit.performanceTier } : {}),
          budgets: unit.budgets ?? {},
        })),
        checked,
        samples,
        records: records.map(reportRecord),
      },
      null,
      2,
    )}\n`,
  );

  for (const row of checked) console.log(checkedLine(row));
  for (const row of samples) console.log(sampleLine(row));
  console.log(`[budgets] report: ${path.relative(REPO_ROOT, out)}`);
  if (records.length === 0) {
    console.log(`[budgets] ${manifest.units.length} unit(s) within their budgets`);
    return 0;
  }
  const gate = currentGate(env);
  const artifacts = [out, trace]
    .map((file) => path.relative(reportsDir(), file))
    .filter((file) => !file.startsWith('..'));
  for (const record of records) {
    reportError(
      `${record.unit ? `${label(record.unit)}: ` : ''}${record.test} (${record.metric}, ${record.asset})`,
      { title: `budget: ${record.metric}` },
    );
    if (gate) {
      writeFailureRecord(
        failureFields(record, {
          gate: gate.gate,
          reproCommand: reproCommand(env.BUDGET_FIXTURES),
          artifacts,
        }),
      );
    }
  }
  console.error(`[budgets] ${records.length} breach(es)`);
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
