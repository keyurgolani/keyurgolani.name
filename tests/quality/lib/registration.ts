// The registration contract (#11, Slice 1, item 4). A surface that isn't a
// variant, such as #2's login page or a Studio page, registers by adding
// quality/surfaces/<id>.ts with the exports below; a registered variant or
// fixture unit may add quality/units/<registry id>.ts exporting only
// interactions, primaryActions, and notApplicable. The harness reads both
// directories, so a new surface, variant, pack, route, or fixture adds cells
// without a harness edit. A file that exports anything else, or leaves a
// field out, fails the plan, and with it the run.
//
// A Studio surface, #8's Owner Studio and #9's Demo Studio, may also export
// `requiresScript`, saying it needs its script by design and why: its cells
// with JavaScript off then check its honest no-JavaScript state, a notice
// it shows, and under failed enhancement its failure state, in place of
// comparing its content (lib/a11y/conditions.ts). No composition may: a
// visitor's page works without JavaScript.

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isReason } from './checks';

export const PROFILES = ['owner', 'demo', 'read-only'] as const;
export type Profile = (typeof PROFILES)[number];

export const PERFORMANCE_TIERS = ['light', 'medium', 'heavy'] as const;
export type PerformanceTier = (typeof PERFORMANCE_TIERS)[number];

/** `none`, or a #2 test session made once in global setup and shared as storage state. */
export const AUTH_MODES = ['none', 'session'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

/** What an interaction is: a dialog, a disclosure, a drag with its alternative, or a status change. */
export const INTERACTION_KINDS = ['dialog', 'disclosure', 'drag', 'status'] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

export interface Interaction {
  readonly kind: InteractionKind;
  /** Its control's accessible name, as a tester finds it. */
  readonly name: string;
  /** The route it's on. */
  readonly route: string;
  /** For a drag: the keyboard or single-pointer path that does the same (2.5.7). */
  readonly alternative?: string;
  /** For a status change: what its live region announces (4.1.3). */
  readonly announces?: string;
}

/** The fields a cell varies on, each optional in a match: what notApplicable excludes. */
export const CELL_FIELDS = ['route', 'state', 'viewport', 'row', 'engine'] as const;
export type CellField = (typeof CELL_FIELDS)[number];

/** Cells excluded with the reason: every cell whose fields equal the match's. */
export interface NotApplicable {
  readonly match: Readonly<Partial<Record<CellField, string>>>;
  readonly reason: string;
}

/**
 * A state the surface renders, reached through its URL: `query` is added
 * to each route, and the response answers `status`.
 */
export interface SurfaceState {
  readonly id: string;
  readonly query: Readonly<Record<string, string>>;
  readonly status: number;
}

/** A Studio surface's declaration that it needs its script by design, with why. */
export interface RequiresScript {
  readonly reason: string;
}

export interface SurfaceRegistration {
  readonly id: string;
  /** Who fixes what its cells find, such as an issue (#2) or a GitHub handle. */
  readonly owner: string;
  /** The deployment profile that serves it. */
  readonly profile: Profile;
  /** Its paths; the first is the one its appearance rows run on. */
  readonly routes: readonly string[];
  /** Globs of the files it's built from, which a manual run's record goes stale on. */
  readonly sources: readonly string[];
  /** The states it renders; the first is its default. */
  readonly stateFixtures: readonly SurfaceState[];
  readonly performanceTier: PerformanceTier;
  readonly auth: AuthMode;
  readonly interactions: readonly Interaction[];
  /** The accessible names of its primary touch controls, which need 44x44 targets. */
  readonly primaryActions: readonly string[];
  readonly notApplicable: readonly NotApplicable[];
  /** Present for a Studio surface that needs its script by design. */
  readonly requiresScript?: RequiresScript;
}

export interface UnitRegistration {
  readonly id: string;
  readonly interactions: readonly Interaction[];
  readonly primaryActions: readonly string[];
  readonly notApplicable: readonly NotApplicable[];
}

const SURFACE_EXPORTS = [
  'id',
  'owner',
  'profile',
  'routes',
  'sources',
  'stateFixtures',
  'performanceTier',
  'auth',
  'interactions',
  'primaryActions',
  'notApplicable',
] as const;
const UNIT_EXPORTS = ['interactions', 'primaryActions', 'notApplicable'] as const;
/** What a surface may export besides SURFACE_EXPORTS. */
const OPTIONAL_SURFACE_EXPORTS = ['requiresScript'] as const;

/** Whether `route` is Studio's: /studio, or a path under it. */
const isStudioRoute = (route: unknown) =>
  typeof route === 'string' && (route === '/studio' || route.startsWith('/studio/'));

/** Demo Studio's pages (#9): what the demo profile serves behind sandbox.view, with no session. */
const DEMO_STUDIO_ROUTES: readonly unknown[] = ['/studio'];

function requiresScript(value: unknown, problems: string[]): void {
  const item = value as Record<string, unknown> | null;
  if (item === null || typeof item !== 'object') {
    problems.push('requiresScript is an object, { reason }');
    return;
  }
  const unknown = Object.keys(item).filter((key) => key !== 'reason');
  if (unknown.length > 0) problems.push(`requiresScript has unknown fields: ${unknown.join(', ')}`);
  if (!isReason(item.reason)) {
    problems.push(
      'requiresScript.reason says why it needs its script, in a sentence of three words or more',
    );
  }
}

const ID = /^[a-z][a-z0-9-]*$/;
/** A path the app serves: a slash, then no space, query, or fragment. */
const ROUTE = /^\/[^\s?#]*$/;

/** One problem with a registration file, by the file and the field. */
export class RegistrationError extends Error {
  constructor(
    readonly file: string,
    readonly problems: readonly string[],
  ) {
    super(`${file} is not a valid registration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'RegistrationError';
  }
}

type Exports = Readonly<Record<string, unknown>>;

const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';

function strings(value: unknown, field: string, problems: string[], { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || !value.every(isString)) {
    problems.push(`${field} is a list of non-empty strings`);
    return [];
  }
  if (nonEmpty && value.length === 0) problems.push(`${field} names at least one`);
  if (new Set(value).size !== value.length) problems.push(`${field} lists a value twice`);
  return value as string[];
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  problems: string[],
) {
  if (!allowed.includes(value as T)) problems.push(`${field} is one of ${allowed.join(', ')}`);
}

function interactions(value: unknown, problems: string[]): void {
  if (!Array.isArray(value)) {
    problems.push('interactions is a list');
    return;
  }
  value.forEach((item: Record<string, unknown>, index) => {
    const at = `interactions[${index}]`;
    if (item === null || typeof item !== 'object') {
      problems.push(`${at} is an object`);
      return;
    }
    const unknown = Object.keys(item).filter(
      (key) => !['kind', 'name', 'route', 'alternative', 'announces'].includes(key),
    );
    if (unknown.length > 0) problems.push(`${at} has unknown fields: ${unknown.join(', ')}`);
    oneOf(item.kind, INTERACTION_KINDS, `${at}.kind`, problems);
    if (!isString(item.name)) problems.push(`${at}.name is its control's accessible name`);
    if (!isString(item.route) || !ROUTE.test(item.route)) problems.push(`${at}.route is a path`);
    if (item.kind === 'drag' && !isString(item.alternative)) {
      problems.push(`${at} is a drag, so it names its keyboard or single-pointer alternative`);
    }
    if (item.kind === 'status' && !isString(item.announces)) {
      problems.push(`${at} is a status change, so it says what its live region announces`);
    }
  });
}

function notApplicable(value: unknown, problems: string[]): void {
  if (!Array.isArray(value)) {
    problems.push('notApplicable is a list');
    return;
  }
  value.forEach((item: Record<string, unknown>, index) => {
    const at = `notApplicable[${index}]`;
    if (item === null || typeof item !== 'object') {
      problems.push(`${at} is an object`);
      return;
    }
    const unknown = Object.keys(item).filter((key) => !['match', 'reason'].includes(key));
    if (unknown.length > 0) problems.push(`${at} has unknown fields: ${unknown.join(', ')}`);
    if (!isReason(item.reason)) {
      problems.push(
        `${at}.reason says why the cells don't apply, in a sentence of three words or more`,
      );
    }
    const match = item.match as Record<string, unknown> | undefined;
    if (match === null || typeof match !== 'object' || Object.keys(match).length === 0) {
      problems.push(`${at}.match names at least one of ${CELL_FIELDS.join(', ')}`);
      return;
    }
    for (const [key, field] of Object.entries(match)) {
      if (!(CELL_FIELDS as readonly string[]).includes(key)) {
        problems.push(`${at}.match.${key} isn't a cell field (${CELL_FIELDS.join(', ')})`);
      } else if (!isString(field) || field.includes('*')) {
        // An exclusion names exact cells, as an exception's scope does.
        problems.push(`${at}.match.${key} is one exact value, never a wildcard`);
      }
    }
  });
}

function unexpectedExports(exports: Exports, allowed: readonly string[]): string[] {
  return Object.keys(exports)
    .filter((key) => key !== 'default' && key !== '__esModule' && !allowed.includes(key))
    .map((key) => `exports ${key}, which a registration doesn't take`);
}

/** Checks a surface module's exports, throwing a RegistrationError for any problem. */
export function validateSurface(exports: Exports, file: string): SurfaceRegistration {
  const problems = unexpectedExports(exports, [...SURFACE_EXPORTS, ...OPTIONAL_SURFACE_EXPORTS]);
  for (const key of SURFACE_EXPORTS) {
    if (!(key in exports)) problems.push(`exports no ${key}`);
  }
  const expected = path.basename(file, path.extname(file));
  if (!isString(exports.id) || !ID.test(exports.id)) problems.push('id is a lowercase slug');
  else if (exports.id !== expected) problems.push(`id is ${expected}, the file's name`);
  if (!isString(exports.owner)) problems.push('owner names who fixes what its cells find');
  oneOf(exports.profile, PROFILES, 'profile', problems);
  const routes = strings(exports.routes, 'routes', problems, { nonEmpty: true });
  for (const route of routes) {
    if (!ROUTE.test(route)) problems.push(`routes has ${route}, which isn't a path`);
  }
  strings(exports.sources, 'sources', problems, { nonEmpty: true });
  if (!Array.isArray(exports.stateFixtures) || exports.stateFixtures.length === 0) {
    problems.push('stateFixtures lists at least one state');
  } else {
    const ids = new Set<string>();
    exports.stateFixtures.forEach((state: Record<string, unknown>, index) => {
      const at = `stateFixtures[${index}]`;
      if (state === null || typeof state !== 'object') {
        problems.push(`${at} is an object`);
        return;
      }
      const unknown = Object.keys(state).filter((key) => !['id', 'query', 'status'].includes(key));
      if (unknown.length > 0) problems.push(`${at} has unknown fields: ${unknown.join(', ')}`);
      if (!isString(state.id) || !ID.test(state.id)) problems.push(`${at}.id is a lowercase slug`);
      else if (ids.has(state.id)) problems.push(`${at}.id ${state.id} is listed twice`);
      else ids.add(state.id);
      const query = state.query as Record<string, unknown> | undefined;
      if (
        query === null ||
        typeof query !== 'object' ||
        !Object.values(query).every((value) => typeof value === 'string')
      ) {
        problems.push(`${at}.query is an object of strings`);
      }
      if (!Number.isInteger(state.status) || (state.status as number) < 200) {
        problems.push(`${at}.status is the HTTP status the state answers`);
      }
    });
  }
  oneOf(exports.performanceTier, PERFORMANCE_TIERS, 'performanceTier', problems);
  oneOf(exports.auth, AUTH_MODES, 'auth', problems);
  interactions(exports.interactions, problems);
  strings(exports.primaryActions, 'primaryActions', problems);
  notApplicable(exports.notApplicable, problems);
  if ('requiresScript' in exports) {
    requiresScript(exports.requiresScript, problems);
    // Only a Studio surface: every route of it /studio or under it, and signed in, or Demo
    // Studio, which has no session: under demo, its one page, behind sandbox.view (#9). Any
    // other page a visitor reaches signed out, as the sign-in page is, works without JavaScript.
    const demoStudio =
      exports.profile === 'demo' &&
      exports.auth === 'none' &&
      Array.isArray(exports.routes) &&
      exports.routes.length > 0 &&
      exports.routes.every((route) => DEMO_STUDIO_ROUTES.includes(route));
    if (Array.isArray(exports.routes) && !exports.routes.every(isStudioRoute)) {
      problems.push(
        "declares requiresScript, which only a Studio surface may, and its routes aren't Studio's: a page outside /studio works without JavaScript",
      );
    }
    if (exports.auth !== 'session' && !demoStudio) {
      problems.push(
        "declares requiresScript, which only a signed-in Studio surface or Demo Studio may, and its auth isn't session: a page reached signed out works without JavaScript",
      );
    }
  }
  if (problems.length > 0) throw new RegistrationError(file, problems);
  return Object.fromEntries(
    [...SURFACE_EXPORTS, ...OPTIONAL_SURFACE_EXPORTS]
      .filter((key) => key in exports)
      .map((key) => [key, exports[key]]),
  ) as never;
}

/** Checks a unit module's exports, for the registry id `id`, its file's name. */
export function validateUnit(exports: Exports, file: string): UnitRegistration {
  const problems = unexpectedExports(exports, UNIT_EXPORTS);
  if ('requiresScript' in exports) {
    problems.push(
      "declares requiresScript, which only a Studio surface may: a composition's page works without JavaScript",
    );
  }
  if (UNIT_EXPORTS.every((key) => !(key in exports))) {
    problems.push(`exports none of ${UNIT_EXPORTS.join(', ')}`);
  }
  if ('interactions' in exports) interactions(exports.interactions, problems);
  if ('primaryActions' in exports) strings(exports.primaryActions, 'primaryActions', problems);
  if ('notApplicable' in exports) notApplicable(exports.notApplicable, problems);
  if (problems.length > 0) throw new RegistrationError(file, problems);
  return {
    id: path.basename(file, path.extname(file)),
    interactions: (exports.interactions as Interaction[] | undefined) ?? [],
    primaryActions: (exports.primaryActions as string[] | undefined) ?? [],
    notApplicable: (exports.notApplicable as NotApplicable[] | undefined) ?? [],
  };
}

/** The repository's quality/ directory. */
export const QUALITY_DIR = fileURLToPath(new URL('../../../quality/', import.meta.url));

/** Each .ts module in `dir`, sorted, as [file, exports]. A missing directory has none. */
async function modulesIn(dir: string): Promise<[string, Exports][]> {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const modules: [string, Exports][] = [];
  for (const name of names.sort()) {
    const file = path.join(dir, name);
    modules.push([file, (await import(pathToFileURL(file).href)) as Exports]);
  }
  return modules;
}

export interface Registrations {
  readonly surfaces: readonly SurfaceRegistration[];
  readonly units: readonly UnitRegistration[];
}

/** Every registration under `root` (quality/ by default), checked. */
export async function loadRegistrations(root: string = QUALITY_DIR): Promise<Registrations> {
  const relative = (file: string) => path.relative(path.dirname(path.resolve(root)), file);
  const surfaces = await modulesIn(path.join(root, 'surfaces'));
  const units = await modulesIn(path.join(root, 'units'));
  return {
    surfaces: surfaces.map(([file, exports]) => validateSurface(exports, relative(file))),
    units: units.map(([file, exports]) => validateUnit(exports, relative(file))),
  };
}
