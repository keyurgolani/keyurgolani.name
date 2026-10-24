import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  loadRegistrations,
  RegistrationError,
  validateSurface,
  validateUnit,
  type SurfaceRegistration,
} from './registration';

const LOGIN: SurfaceRegistration = {
  id: 'login',
  owner: '#2',
  profile: 'owner',
  routes: ['/studio/sign-in'],
  sources: ['apps/web/src/app/(studio)/studio/sign-in/**'],
  stateFixtures: [{ id: 'signed-out', query: {}, status: 200 }],
  performanceTier: 'light',
  auth: 'none',
  interactions: [
    { kind: 'status', name: 'Sign in', route: '/studio/sign-in', announces: 'Each state.' },
  ],
  primaryActions: ['Sign in'],
  notApplicable: [],
};

/** The problems validateSurface() finds in `exports`, or [] when it passes. */
function problems(exports: Record<string, unknown>, file = 'quality/surfaces/login.ts'): string[] {
  try {
    validateSurface(exports, file);
    return [];
  } catch (error) {
    assert.ok(error instanceof RegistrationError);
    return [...error.problems];
  }
}

test("the repository's registrations load and pass: #2's login page among them", async () => {
  const { surfaces, units } = await loadRegistrations();
  const login = surfaces.find((surface) => surface.id === 'login');
  assert.ok(login, 'quality/surfaces/login.ts registers login');
  assert.equal(login.profile, 'owner');
  assert.deepEqual(login.routes, ['/studio/sign-in']);
  assert.equal(login.auth, 'none');
  assert.ok(login.stateFixtures.length >= 1);
  assert.ok(Array.isArray(units));
});

test('a surface needs every field the contract lists', () => {
  assert.deepEqual(problems({ ...LOGIN }), []);
  for (const field of Object.keys(LOGIN)) {
    const { [field]: _gone, ...rest } = LOGIN as unknown as Record<string, unknown>;
    void _gone;
    assert.ok(
      problems(rest).some((problem) => problem.includes(`exports no ${field}`)),
      `without ${field}`,
    );
  }
});

test("a surface exports nothing the contract doesn't take", () => {
  assert.deepEqual(problems({ ...LOGIN, rows: ['default'] }), [
    "exports rows, which a registration doesn't take",
  ]);
});

test("a surface's id is its file's name, its routes are paths, and its values are the contract's", () => {
  assert.ok(problems({ ...LOGIN, id: 'sign-in' }).includes("id is login, the file's name"));
  assert.ok(problems({ ...LOGIN, routes: ['studio'] }).some((p) => p.includes("isn't a path")));
  assert.ok(problems({ ...LOGIN, routes: [] }).includes('routes names at least one'));
  assert.ok(
    problems({ ...LOGIN, profile: 'admin' }).some((p) => p.startsWith('profile is one of')),
  );
  assert.ok(problems({ ...LOGIN, auth: 'basic' }).some((p) => p.startsWith('auth is one of')));
  assert.ok(
    problems({ ...LOGIN, performanceTier: 'huge' }).some((p) => p.startsWith('performanceTier')),
  );
  assert.ok(
    problems({ ...LOGIN, stateFixtures: [] }).includes('stateFixtures lists at least one state'),
  );
  assert.ok(
    problems({
      ...LOGIN,
      stateFixtures: [
        { id: 'a', query: {}, status: 200 },
        { id: 'a', query: {}, status: 200 },
      ],
    }).some((p) => p.includes('listed twice')),
  );
});

test('a drag names its alternative, and a status change what it announces', () => {
  assert.ok(
    problems({
      ...LOGIN,
      interactions: [{ kind: 'drag', name: 'Focal point', route: '/studio' }],
    }).some((p) => p.includes('names its keyboard or single-pointer alternative')),
  );
  assert.ok(
    problems({ ...LOGIN, interactions: [{ kind: 'status', name: 'Save', route: '/studio' }] }).some(
      (p) => p.includes('says what its live region announces'),
    ),
  );
  assert.ok(
    problems({ ...LOGIN, interactions: [{ kind: 'hover', name: 'Menu', route: '/' }] }).some((p) =>
      p.startsWith('interactions[0].kind is one of'),
    ),
  );
});

test('an exclusion names exact cells with a reason, never a wildcard', () => {
  const exclude = (notApplicable: unknown) => problems({ ...LOGIN, notApplicable });
  assert.deepEqual(exclude([{ match: { viewport: '390x844' }, reason: 'Not on phones yet.' }]), []);
  assert.ok(
    exclude([{ match: { viewport: '*' }, reason: 'All.' }]).some((p) =>
      p.includes('never a wildcard'),
    ),
  );
  assert.ok(
    exclude([{ match: {}, reason: 'Nothing.' }]).some((p) => p.includes('names at least one')),
  );
  assert.ok(
    exclude([{ match: { tuple: 'x' }, reason: 'x' }]).some((p) => p.includes("isn't a cell field")),
  );
  assert.ok(exclude([{ match: { row: 'default' } }]).some((p) => p.includes('reason says why')));
  for (const reason of [' ', 'n/a', ' Not on phones yet.', 'Not on phones yet'])
    assert.ok(
      exclude([{ match: { row: 'default' }, reason }]).some((p) => p.includes('reason says why')),
      JSON.stringify(reason),
    );
});

test('a unit exports only interactions, primaryActions, and notApplicable', () => {
  const unit = validateUnit({ primaryActions: ['Open menu'] }, 'quality/units/fallback.ts');
  assert.equal(unit.id, 'fallback');
  assert.deepEqual(unit.primaryActions, ['Open menu']);
  assert.throws(
    () => validateUnit({ routes: ['/'] }, 'quality/units/fallback.ts'),
    /routes, which a registration/,
  );
  assert.throws(() => validateUnit({}, 'quality/units/fallback.ts'), /exports none of/);
});

test('a signed-in Studio surface may say it needs its script, with why; nothing else may', async () => {
  const file = 'quality/surfaces/studio.ts';
  const studio = {
    ...LOGIN,
    id: 'studio',
    routes: ['/studio'],
    auth: 'session',
    requiresScript: { reason: 'Studio draws its workspace with JavaScript.' },
  };
  assert.deepEqual(problems(studio, file), []);
  assert.deepEqual(validateSurface(studio, file).requiresScript, {
    reason: 'Studio draws its workspace with JavaScript.',
  });
  // The sign-in page is under /studio, and a visitor reaches it signed out: it may not.
  assert.ok(
    problems({ ...LOGIN, requiresScript: studio.requiresScript }).some((each) =>
      each.includes("its auth isn't session"),
    ),
  );
  // Without it, a surface's registration has none.
  assert.equal(
    validateSurface({ ...LOGIN }, 'quality/surfaces/login.ts').requiresScript,
    undefined,
  );
  // The reason is required, and says why in a sentence.
  for (const [bad, problem] of [
    [{}, 'requiresScript.reason says why'],
    [{ reason: '' }, 'requiresScript.reason says why'],
    [{ reason: 'Script.' }, 'requiresScript.reason says why'],
    [{ reason: 'Studio draws it.', expires: '2027-01-01' }, 'unknown fields: expires'],
    [true, 'requiresScript is an object'],
  ] as const) {
    assert.ok(
      problems({ ...studio, requiresScript: bad }, file).some((each) => each.includes(problem)),
      problem,
    );
  }
  // A surface whose pages aren't Studio's may not, and no composition may.
  assert.ok(
    problems({ ...studio, routes: ['/', '/studio'] }, file).some((each) =>
      each.includes("its routes aren't Studio's"),
    ),
  );
  assert.throws(
    () =>
      validateUnit(
        { requiresScript: { reason: 'It draws with JavaScript.' } },
        'quality/units/fallback.ts',
      ),
    /declares requiresScript, which only a Studio surface may/,
  );
  // Demo Studio (#9) has no session, and may too: under demo, at /studio, its one page.
  const demo = {
    ...studio,
    id: 'demo-studio',
    profile: 'demo',
    auth: 'none',
    routes: ['/studio'],
    requiresScript: { reason: 'Demo Studio keeps its changes in the browser with JavaScript.' },
  };
  assert.deepEqual(problems(demo, 'quality/surfaces/demo-studio.ts'), []);
  // Signed out anywhere else it may not: the sign-in page under any profile, any other
  // Studio path under demo, /studio under another profile, and no route at all.
  for (const [bad, what] of [
    [{ ...demo, routes: ['/studio/sign-in'] }, 'the sign-in page under demo'],
    [{ ...demo, routes: ['/studio', '/studio/sign-in'] }, 'the sign-in page beside /studio'],
    [{ ...demo, routes: ['/studio/preview'] }, 'another Studio page under demo'],
    [{ ...demo, profile: 'owner' }, '/studio signed out under owner'],
    [{ ...demo, profile: 'read-only' }, '/studio under read-only'],
    [{ ...LOGIN, profile: 'demo', requiresScript: demo.requiresScript }, 'the login surface under demo'],
    [{ ...demo, routes: [] }, 'no route'],
  ] as const) {
    assert.ok(
      problems(bad, 'quality/surfaces/demo-studio.ts').some((each) =>
        each.includes("its auth isn't session"),
      ),
      what,
    );
  }
  // The repository's Owner Studio declares it, with its reason, which its cells carry.
  const { surfaces } = await loadRegistrations();
  assert.match(
    surfaces.find((surface) => surface.id === 'studio')?.requiresScript?.reason ?? '',
    /JavaScript/,
  );
});

test('a registration file with a problem fails the load', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-registrations-'));
  try {
    mkdirSync(path.join(root, 'surfaces'));
    writeFileSync(path.join(root, 'surfaces', 'broken.ts'), "export const id = 'broken';\n");
    await assert.rejects(loadRegistrations(root), (error: unknown) => {
      assert.ok(error instanceof RegistrationError);
      assert.match(error.message, /surfaces\/broken\.ts is not a valid registration/);
      assert.ok(error.problems.includes('exports no owner'));
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing directory registers nothing', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-registrations-'));
  try {
    assert.deepEqual(await loadRegistrations(root), { surfaces: [], units: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
