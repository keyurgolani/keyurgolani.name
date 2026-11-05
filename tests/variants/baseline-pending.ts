// The compositions whose screenshot baselines are pending (lead A, for RC1).
// baseline-pending.json names each one, keyed by its id, with the fix that
// will commit its baselines: who owns it, the release it lands in, and what
// it is. For a listed composition the variant specs still take and attach
// every screenshot and run every other check, but compare no screenshot,
// and the test carries a baseline-pending annotation naming the fix. Nothing
// else is skipped, and no threshold or mask moves.
//
// baseline-pending.test.ts holds the list to the committed baselines
// exactly: a composition is listed when it has none of its baselines in
// __screenshots__/, and only then. A listed one with any committed baseline
// fails, an unlisted one missing any fails, and so does a file no
// composition takes. So the list can't hide a missing baseline or outlive
// the fix that commits them. A final release refuses while the list names
// anything (ci/release/promote-check.mjs): v1.0.0 needs it empty.
//
// It imports no registry and no Playwright, so ci:unit and the release check
// read it without a build.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
/** The list, relative to the repository root, where the release check reads it too. */
export const PENDING_FILE = path.join('tests', 'variants', 'baseline-pending.json');
/** Where the variant specs' baselines are committed (playwright.config.ts's snapshotPathTemplate). */
export const BASELINES_DIR = path.join(HERE, '__screenshots__');
/** The committed baselines that belong to no composition: Demo Studio's Content panel. */
export const OTHER_BASELINES: readonly string[] = ['demo-studio-content.png'];

/** The fix that will commit a pending composition's baselines. */
export interface PendingBaseline {
  /** The stream that owns the fix, such as A. */
  readonly owner: string;
  /** The release it lands in, such as rc.2. */
  readonly release: string;
  /** What it is, in a sentence. */
  readonly fix: string;
}

export type PendingList = Readonly<Record<string, PendingBaseline>>;

/** The list as committed. */
export function readPendingList(root: string = REPO_ROOT): unknown {
  return JSON.parse(readFileSync(path.join(root, PENDING_FILE), 'utf8')) as unknown;
}

/** The modes whose page the variant specs screenshot, as a visitor first sees it. */
export const SHOT_MODES = ['desktop', 'mobile'] as const;

/** Whether the variant specs screenshot `mode`. */
export const takesShot = (mode: string): boolean =>
  (SHOT_MODES as readonly string[]).includes(mode);

/** A contract fixture's screenshot of the composition `id` in `mode`. */
export const fixtureShot = (id: string, fixture: string, mode: string) =>
  `${id}-${fixture}-${mode}`;

/** The bundled sample's screenshot of the composition `id` in `mode`. */
export const sampleShot = (id: string, mode: string) => `${id}-sample-${mode}`;

/**
 * Every baseline file the variant specs compare for the composition `id`:
 * each contract fixture in each shot mode, and the sample in each, except in
 * the fallback composition, which never renders the sample.
 */
export function expectedBaselines(
  id: string,
  fixtures: readonly string[],
  fallbackId: string,
): string[] {
  const shots = fixtures.flatMap((fixture) =>
    SHOT_MODES.map((mode) => fixtureShot(id, fixture, mode)),
  );
  if (id !== fallbackId) shots.push(...SHOT_MODES.map((mode) => sampleShot(id, mode)));
  return shots.map((shot) => `${shot}.png`).sort();
}

/** The annotation a listed composition's screenshot tests carry. */
export const pendingAnnotation = ({ owner, release, fix }: PendingBaseline) =>
  `baseline pending (${owner}, ${release}): ${fix}`;

const ENTRY_KEYS = ['fix', 'owner', 'release'];

/** What's wrong with one entry of the list, or nothing. */
function entryProblems(id: string, entry: unknown): string[] {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return [`${id}'s entry is not an object with an owner, a release, and a fix`];
  }
  const record = entry as Record<string, unknown>;
  const problems: string[] = [];
  const keys = Object.keys(record).sort();
  if (keys.join() !== ENTRY_KEYS.join()) {
    problems.push(`${id}'s entry has the keys [${keys}], not exactly [${ENTRY_KEYS}]`);
  }
  if (typeof record.owner !== 'string' || !/^[A-Z]$/.test(record.owner)) {
    problems.push(`${id}'s owner must be one stream letter, such as A`);
  }
  if (typeof record.release !== 'string' || !/^rc\.[1-9][0-9]*$/.test(record.release)) {
    problems.push(`${id}'s release must be a candidate, such as rc.2`);
  }
  if (typeof record.fix !== 'string' || record.fix.trim().length < 20) {
    problems.push(`${id}'s fix must name the fix that commits its baselines, in a sentence`);
  }
  return problems;
}

export interface BaselineState {
  /** The first-party compositions the variant specs screenshot, by id. */
  readonly compositions: readonly string[];
  /** The fallback composition's id, which never renders the sample. */
  readonly fallbackId: string;
  /** The contract fixtures' names. */
  readonly fixtures: readonly string[];
  /** The files committed in __screenshots__/. */
  readonly files: readonly string[];
  /** The list, as parsed. */
  readonly pending: unknown;
}

/** Every way the list and the committed baselines disagree, or nothing. */
export function baselineProblems(state: BaselineState): string[] {
  const { compositions, fallbackId, fixtures, pending } = state;
  if (typeof pending !== 'object' || pending === null || Array.isArray(pending)) {
    return [`${PENDING_FILE} must be an object keyed by composition id`];
  }
  const list = pending as Record<string, unknown>;
  const files = new Set(state.files);
  const problems: string[] = [];
  const ids = Object.keys(list);
  if (ids.join() !== [...ids].sort().join()) problems.push(`${PENDING_FILE} must list ids sorted`);
  for (const id of ids) {
    if (!compositions.includes(id)) {
      problems.push(`${id} is listed, but no first-party composition has that id`);
      continue;
    }
    problems.push(...entryProblems(id, list[id]));
  }
  const taken = new Set(OTHER_BASELINES);
  for (const id of compositions) {
    const expected = expectedBaselines(id, fixtures, fallbackId);
    for (const file of expected) taken.add(file);
    const committed = expected.filter((file) => files.has(file));
    if (id in list) {
      if (committed.length > 0) {
        problems.push(
          `${id} is listed as pending, but ${committed.length} of its ${expected.length} baselines are committed (${committed.slice(0, 3).join(', ')}${committed.length > 3 ? ', ...' : ''}): take it off the list in the commit that adds them`,
        );
      }
    } else {
      const missing = expected.filter((file) => !files.has(file));
      if (missing.length > 0) {
        problems.push(
          `${id} isn't listed as pending, but ${missing.length} of its ${expected.length} baselines aren't committed (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''}): commit them, or list it with the fix that will`,
        );
      }
    }
  }
  for (const file of OTHER_BASELINES) {
    if (!files.has(file)) problems.push(`${file} isn't committed`);
  }
  for (const file of [...files].sort()) {
    if (!taken.has(file)) problems.push(`${file} is committed, but no composition takes it`);
  }
  return problems;
}

/**
 * The first-party compositions a default build registers, by id: the
 * @portfolio/ packages @portfolio/web depends on whose portfolio.kind is
 * variant, leaving out the test fixtures (portfolio.fixture), which register
 * only behind their flags. Sorted.
 */
interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly portfolio?: {
    readonly kind?: string;
    readonly manifest?: string;
    readonly fixture?: boolean;
  };
  readonly id?: string;
}

export function firstPartyCompositions(root: string = REPO_ROOT): string[] {
  const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as PackageJson;
  const byName = new Map<string, string>();
  const packages = path.join(root, 'packages');
  const scan = (dir: string, depth: number) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      const at = path.join(dir, entry.name);
      let name: string | undefined;
      try {
        name = read(path.join(at, 'package.json')).name;
      } catch {
        // No package.json here: a folder of packages, such as budget-fixtures.
      }
      if (name) byName.set(name, at);
      else if (depth > 0) scan(at, depth - 1);
    }
  };
  scan(packages, 1);
  const web = read(path.join(root, 'apps', 'web', 'package.json'));
  const ids: string[] = [];
  for (const name of Object.keys({ ...web.dependencies })) {
    if (!name.startsWith('@portfolio/')) continue;
    const dir = byName.get(name);
    if (!dir)
      throw new Error(`@portfolio/web depends on ${name}, which no package under packages/ is`);
    const portfolio = read(path.join(dir, 'package.json')).portfolio;
    if (portfolio?.kind !== 'variant' || portfolio.fixture === true) continue;
    const id = portfolio.manifest ? read(path.join(dir, portfolio.manifest)).id : undefined;
    if (!id) throw new Error(`${name} is a variant with no manifest id`);
    ids.push(id);
  }
  return ids.sort();
}

/** The files committed in __screenshots__/. */
export const committedBaselines = (dir: string = BASELINES_DIR) =>
  readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .sort();
